import { describe, expect, it } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha2.js';
import { wallet } from './wallet.js';
import { buildDirectory, buildFile } from '../../test/factories/filesystem.js';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockNetworkViewFromConnectivity,
  mockSession,
} from '../../test/factories/commandEnv.js';
import { applyPatches, type Patch } from '../filesystem/applyPatches.js';
import { createFsView } from '../filesystem/fsView.js';
import {
  defaultDirectoryPermissions,
  defaultFilePermissions,
} from '../filesystem/defaultPermissions.js';
import { GUEST_HOME_DIR, HOME_DIR, ROOT_DIR } from '../generation/baseFs.js';
import { bytesToHex, hexToBytes } from '../identity/hex.js';
import { assignHomeNetwork } from '../network/homeNetwork.js';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces.js';
import { asAbsPath, type UserType } from '../types.js';
import type {
  CommandEnv,
  CommandResult,
  PatchApi,
  WalletBalanceResult,
  WalletHistoryResult,
  WalletTransferOrder,
  WalletTransferResult,
} from './types.js';
import type { TransferRecord } from '../wallet/handleWalletHistory.js';
import type { Directory, FileNode } from '../filesystem/types.js';

const NO_FLAGS = new Map<string, string | true>();

const SYNOPSIS = 'wallet init | balance [address] | history [address] | send <address> <amount>';
const USAGE = `wallet: usage: ${SYNOPSIS}`;

const linesOf = (result: CommandResult, kind: 'text' | 'error'): string[] =>
  result.kind === 'sync'
    ? result.lines.filter((line) => line.kind === kind).map((line) => line.content)
    : [];

const textLines = (result: CommandResult): string[] => linesOf(result, 'text');
const errorLines = (result: CommandResult): string[] => linesOf(result, 'error');

const exitCodeOf = (result: CommandResult): number | undefined =>
  result.kind === 'sync' ? result.exitCode : undefined;

/** The three homes a shell can stand in, each with the reach a generated box
 *  gives it, so what the walker says about a wallet is what it says in play. */
const boxWithHomes = (): Directory =>
  buildDirectory({
    home: buildDirectory({
      alice: buildDirectory({}, { owner: 'alice', perms: HOME_DIR }),
      guest: buildDirectory({}, { owner: 'guest', perms: GUEST_HOME_DIR }),
    }),
    root: buildDirectory({}, { owner: 'root', perms: ROOT_DIR }),
  });

type Told =
  | { readonly path: string; readonly isNew: boolean }
  | { readonly path: string; readonly owner: string };

/** A shell on a box, with a patch seam that keeps what it was sent in the shape
 *  the real one sends it. Replaying that journal over the tree is how a test
 *  reads the wallet back: through the materializer and the walker, as the
 *  player and the server both do, rather than off the arguments of a call. */
const walletEnv = (
  options: {
    readonly tree?: Directory;
    readonly userType?: UserType;
    readonly username?: string;
    /** The tree the machine answers with when the command re-reads it. Absent,
     *  a reload hands back the same tree: a box nobody else is writing. */
    readonly reloadTo?: Directory;
    /** The one patch the box refuses, as a round trip that never completed. */
    readonly refuses?: keyof PatchApi;
  } = {},
): {
  readonly env: CommandEnv;
  readonly treeAfter: () => Directory;
  /** Which patches were asked for, in order. */
  readonly asked: readonly (keyof PatchApi)[];
  /** What the box was told about a node beyond its content and its reach: the
   *  two facts a replay of the journal cannot show. */
  readonly told: readonly Told[];
} => {
  const tree = options.tree ?? boxWithHomes();
  const userType = options.userType ?? 'user';
  const username = options.username ?? 'alice';
  const reloaded = options.reloadTo;
  const journal: Patch[] = [];
  const asked: (keyof PatchApi)[] = [];
  const told: Told[] = [];
  /** Note the ask, and say whether the box lets it through. */
  const accepts = (patch: keyof PatchApi): boolean => {
    asked.push(patch);
    return options.refuses !== patch;
  };
  const REFUSED = { ok: false, error: 'network_error' } as const;
  const patches: PatchApi = {
    write: async (path, content, patchOptions) => {
      if (!accepts('write')) return REFUSED;
      told.push({ path, isNew: patchOptions?.isNew ?? false });
      journal.push({
        path,
        content,
        owner: patchOptions?.owner ?? username,
        permissions: patchOptions?.permissions ?? defaultFilePermissions(userType),
      });
      return { ok: true };
    },
    remove: async () => ({ ok: true }),
    mkdir: async (path) => {
      if (!accepts('mkdir')) return REFUSED;
      journal.push({
        path,
        content: null,
        owner: username,
        permissions: defaultDirectoryPermissions(userType),
        nodeType: 'directory',
      });
      return { ok: true };
    },
    setDirectoryPermissions: async (path, permissions, { owner }) => {
      if (!accepts('setDirectoryPermissions')) return REFUSED;
      told.push({ path, owner });
      journal.push({ path, content: null, owner, permissions, nodeType: 'directory' });
      return { ok: true };
    },
  };
  const env = mockCommandEnv({
    fs: mockFsViewFromTree(tree, {
      userType,
      cwd: asAbsPath('/'),
      ...(reloaded === undefined ? {} : { onReload: async () => reloaded }),
    }),
    session: mockSession({ username, userType }),
    patches,
  });
  return { env, treeAfter: () => applyPatches(reloaded ?? tree, journal), asked, told };
};

/** A box where alice's home already holds `entries` under `.wallet`. */
const boxWithWalletDirectory = (entries: Readonly<Record<string, FileNode>>): Directory =>
  buildDirectory({
    home: buildDirectory({
      alice: buildDirectory(
        { '.wallet': buildDirectory(entries, { owner: 'alice' }) },
        { owner: 'alice', perms: HOME_DIR },
      ),
    }),
  });

const ALICE_WALLET = '/home/alice/.wallet/wallet.dat';

const readAs = (tree: Directory, userType: UserType, path: string) =>
  createFsView(tree, { userType }).read(asAbsPath(path));

/** The address a key answers to, worked out here from the rule itself — `jsc`
 *  and the first 40 hex characters of the public key's sha256 — so the test
 *  does not ask the code under test what its own answer should be. */
const addressOfKey = (keyHex: string): string => {
  const privateKey = hexToBytes(keyHex);
  if (privateKey === null) throw new Error(`not a hex key: ${keyHex}`);
  return `jsc${bytesToHex(sha256(ed.getPublicKey(privateKey))).slice(0, 40)}`;
};

/** The two lines of the wallet at `path`, read as root so the walker's opinion
 *  of the reader is not what a test about the file's content turns on. Throws
 *  unless the file is exactly an address line and a key line. */
const walletAt = (
  tree: Directory,
  path: string,
): { readonly address: string; readonly key: string } => {
  const stored = readAs(tree, 'root', path);
  if (!stored.ok) throw new Error(`no wallet at ${path}: ${stored.error}`);
  const written = /^address: (jsc[0-9a-f]{40})\nkey: ([0-9a-f]{64})\n$/.exec(stored.content);
  if (written === null) throw new Error(`${path} is not two labelled lines:\n${stored.content}`);
  const [, address, key] = written;
  return { address: address as string, key: key as string };
};

describe('wallet init — a key file on the box', () => {
  it('writes a wallet.dat whose address is the one its key derives', async () => {
    const { env, treeAfter } = walletEnv();

    await wallet.execute(env, ['init'], NO_FLAGS);

    const { address, key } = walletAt(treeAfter(), '/home/alice/.wallet/wallet.dat');
    expect(address).toBe(addressOfKey(key));
  });

  // The whole of what `init` says. No line about backing the file up and none
  // about who can read it: what a key file is worth is the player's to find out.
  it('prints the address and the path of the file, and nothing else', async () => {
    const { env, treeAfter } = walletEnv();

    const result = await wallet.execute(env, ['init'], NO_FLAGS);

    const { address } = walletAt(treeAfter(), '/home/alice/.wallet/wallet.dat');
    expect(result).toEqual({
      kind: 'sync',
      lines: [
        { kind: 'text', content: `address: ${address}` },
        { kind: 'text', content: 'wallet: /home/alice/.wallet/wallet.dat' },
      ],
      exitCode: 0,
    });
  });

  // A key is made on the box, so a box with no connection makes one all the
  // same. Said out loud because every other thing a wallet does asks the ledger.
  it('makes a wallet on a box with no network', async () => {
    const { env, treeAfter } = walletEnv();
    expect(env.network.isOnline()).toBe(false);

    const result = await wallet.execute(env, ['init'], NO_FLAGS);

    expect(exitCodeOf(result)).toBe(0);
    expect(walletAt(treeAfter(), '/home/alice/.wallet/wallet.dat').key).toMatch(/^[0-9a-f]{64}$/);
  });

  // Each account has its own wallet, root included: the file lands in the home
  // of whoever the shell is, which after `su` is not the player's own.
  it.each([
    ['a user shell', 'alice', 'user', '/home/alice/.wallet/wallet.dat'],
    ['a guest shell', 'guest', 'guest', '/home/guest/.wallet/wallet.dat'],
    ['a root shell', 'root', 'root', '/root/.wallet/wallet.dat'],
  ] as const)(
    'puts the wallet of %s in that account’s home',
    async (_label, username, userType, path) => {
      const { env, treeAfter } = walletEnv({ username, userType });

      const result = await wallet.execute(env, ['init'], NO_FLAGS);

      const { address } = walletAt(treeAfter(), path);
      expect(textLines(result)).toEqual([`address: ${address}`, `wallet: ${path}`]);
    },
  );

  // Who the file opens for: the account that made it, and root. Tiers are flat
  // lists, not a ladder, so a root shell's wallet opens for root alone. Nobody
  // executes it: a key file is data.
  it.each([
    ['a user shell', 'alice', 'user', '/home/alice/.wallet', ['root', 'user']],
    ['a guest shell', 'guest', 'guest', '/home/guest/.wallet', ['root', 'guest']],
    ['a root shell', 'root', 'root', '/root/.wallet', ['root']],
  ] as const)(
    'opens the wallet of %s to that account and root only',
    async (_label, username, userType, directory, reach) => {
      const { env, treeAfter } = walletEnv({ username, userType });

      await wallet.execute(env, ['init'], NO_FLAGS);

      const made = createFsView(treeAfter(), { userType: 'root' });
      expect(made.stat(asAbsPath(`${directory}/wallet.dat`))?.perms).toEqual({
        read: reach,
        write: reach,
        execute: [],
      });
      expect(made.stat(asAbsPath(directory))).toMatchObject({
        kind: 'directory',
        owner: username,
        perms: { read: reach, write: reach, execute: reach },
      });
    },
  );

  // `/home/guest` is the one home every tier can walk into, so it is where the
  // wallet's own reach is all that stands between the file and another tier.
  it('keeps a guest’s wallet from a tier that can walk into /home/guest', async () => {
    const { env, treeAfter } = walletEnv({ username: 'guest', userType: 'guest' });

    await wallet.execute(env, ['init'], NO_FLAGS);

    const tree = treeAfter();
    const path = '/home/guest/.wallet/wallet.dat';
    expect(readAs(tree, 'guest', path).ok).toBe(true);
    expect(readAs(tree, 'user', path)).toEqual({ ok: false, error: 'permission_denied' });
    expect(createFsView(tree, { userType: 'user' }).list(asAbsPath('/home/guest/.wallet'))).toEqual(
      { ok: false, error: 'permission_denied' },
    );
  });

  // A wallet moved aside leaves its directory behind, and that directory may
  // have been made by hand and open to everyone. The key still goes in, the
  // directory is closed, and what was already in it stays.
  it('uses a .wallet directory that is already there, and closes it', async () => {
    const tree = boxWithWalletDirectory({ 'old.dat': buildFile('kept\n', { owner: 'alice' }) });
    const { env, treeAfter, asked } = walletEnv({ tree });

    const result = await wallet.execute(env, ['init'], NO_FLAGS);

    expect(exitCodeOf(result)).toBe(0);
    const made = createFsView(treeAfter(), { userType: 'root' });
    expect(walletAt(treeAfter(), ALICE_WALLET).key).toMatch(/^[0-9a-f]{64}$/);
    expect(made.read(asAbsPath('/home/alice/.wallet/old.dat'))).toEqual({
      ok: true,
      content: 'kept\n',
    });
    expect(made.stat(asAbsPath('/home/alice/.wallet'))?.perms).toEqual({
      read: ['root', 'user'],
      write: ['root', 'user'],
      execute: ['root', 'user'],
    });
    // Making a directory that exists would tell the box it is new, and a box
    // that believes that forgets the directory differently when it is removed.
    expect(asked).toEqual(['setDirectoryPermissions', 'write']);
  });

  // Two things the box is told that no reading of the tree shows. A file it is
  // not told is new is forgotten differently when the player removes it to hide
  // it, and a directory whose owner is left out stops belonging to anybody.
  it('tells the box the key file is new and the directory is the account’s', async () => {
    const { env, told } = walletEnv({ username: 'guest', userType: 'guest' });

    await wallet.execute(env, ['init'], NO_FLAGS);

    expect(told).toEqual([
      { path: '/home/guest/.wallet', owner: 'guest' },
      { path: '/home/guest/.wallet/wallet.dat', isNew: true },
    ]);
  });

  it('makes a different key every time', async () => {
    const first = walletEnv();
    const second = walletEnv();

    await wallet.execute(first.env, ['init'], NO_FLAGS);
    await wallet.execute(second.env, ['init'], NO_FLAGS);

    const path = '/home/alice/.wallet/wallet.dat';
    expect(walletAt(first.treeAfter(), path).key).not.toBe(walletAt(second.treeAfter(), path).key);
  });
});

describe('wallet init — what it refuses', () => {
  // Whatever sits at the path is somebody's wallet as far as `init` can tell,
  // and overwriting it would strand every coin at its address. A file that
  // holds no key at all is refused the same way: `init` never reads it.
  it.each([
    [
      'a wallet',
      'address: jsc0000000000000000000000000000000000000000\nkey: ' + 'c'.repeat(64) + '\n',
    ],
    ['a file that is no wallet', 'not a key\n'],
  ])('leaves %s that is already in place exactly as it was', async (_label, content) => {
    const tree = boxWithWalletDirectory({ 'wallet.dat': buildFile(content, { owner: 'alice' }) });
    const { env, treeAfter, asked } = walletEnv({ tree });

    const result = await wallet.execute(env, ['init'], NO_FLAGS);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: `wallet: a wallet already exists at ${ALICE_WALLET}` }],
      exitCode: 1,
    });
    expect(asked).toEqual([]);
    expect(readAs(treeAfter(), 'root', ALICE_WALLET)).toEqual({ ok: true, content });
  });

  // The question is asked of the machine, not of what this terminal last saw:
  // a wallet made a moment ago in another terminal is one this would replace.
  it('sees a wallet this terminal has not been shown yet', async () => {
    const withWallet = boxWithWalletDirectory({
      'wallet.dat': buildFile('made elsewhere\n', { owner: 'alice' }),
    });
    const { env, asked } = walletEnv({ tree: boxWithHomes(), reloadTo: withWallet });

    const result = await wallet.execute(env, ['init'], NO_FLAGS);

    expect(errorLines(result)).toEqual([`wallet: a wallet already exists at ${ALICE_WALLET}`]);
    expect(exitCodeOf(result)).toBe(1);
    expect(asked).toEqual([]);
  });

  const cannotCreate = (reason: string): CommandResult => ({
    kind: 'sync',
    lines: [{ kind: 'error', content: `wallet: can't create '${ALICE_WALLET}': ${reason}` }],
    exitCode: 1,
  });

  // Each of these is checked before anything is asked of the box, so a doomed
  // `init` leaves no half-made directory behind and prints no address.
  it.each([
    [
      'the account has no home on this box',
      buildDirectory({ home: buildDirectory({}) }),
      'No such file or directory',
    ],
    [
      'the home is not the account’s to write in',
      buildDirectory({
        home: buildDirectory({
          alice: buildDirectory({}, { owner: 'root', perms: { write: ['root'] } }),
        }),
      }),
      'Permission denied',
    ],
    [
      'the .wallet directory is not the account’s to write in',
      buildDirectory({
        home: buildDirectory({
          alice: buildDirectory(
            { '.wallet': buildDirectory({}, { owner: 'root', perms: { write: ['root'] } }) },
            { owner: 'alice', perms: HOME_DIR },
          ),
        }),
      }),
      'Permission denied',
    ],
    [
      '.wallet is a file',
      buildDirectory({
        home: buildDirectory({
          alice: buildDirectory(
            { '.wallet': buildFile('in the way\n', { owner: 'alice' }) },
            { owner: 'alice', perms: HOME_DIR },
          ),
        }),
      }),
      'Not a directory',
    ],
  ])('makes nothing when %s', async (_label, tree, reason) => {
    const { env, treeAfter, asked } = walletEnv({ tree });

    const result = await wallet.execute(env, ['init'], NO_FLAGS);

    expect(result).toEqual(cannotCreate(reason));
    expect(asked).toEqual([]);
    expect(treeAfter()).toEqual(tree);
  });

  // An address on screen is a promise that its key is on disk. When the box
  // turns down any step, the player is told, and nothing later is attempted:
  // above all, no key is written into a directory that was never closed.
  it.each([
    ['make the directory', 'mkdir', ['mkdir']],
    ['close the directory', 'setDirectoryPermissions', ['mkdir', 'setDirectoryPermissions']],
    ['write the key', 'write', ['mkdir', 'setDirectoryPermissions', 'write']],
  ] as const)('prints no address when the box will not %s', async (_label, refuses, attempted) => {
    const { env, treeAfter, asked } = walletEnv({ refuses });

    const result = await wallet.execute(env, ['init'], NO_FLAGS);

    expect(result).toEqual(cannotCreate('I/O error'));
    expect(asked).toEqual(attempted);
    expect(readAs(treeAfter(), 'root', ALICE_WALLET)).toEqual({ ok: false, error: 'not_found' });
  });
});

const PLAYER_KEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';

/** A workstation whose WiFi card has joined a network and holds an address on it. */
const joinedConnectivity = (): ConnectivityState => {
  const cold = buildColdStartConnectivity(PLAYER_KEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0 in cold start');
  const { localIp } = assignHomeNetwork(PLAYER_KEY, ESSID);
  const joined = {
    ...wlan0,
    association: { essid: ESSID, bssid: 'AA:BB:CC:DD:EE:FF' },
    ipv4: localIp,
  };
  return { interfaces: new Map(cold.interfaces).set('wlan0', joined) };
};

/** A shell that can reach the ledger, and a ledger that answers from `held` and
 *  keeps every address it was asked about and every transfer it was sent. An
 *  address it does not hold reads as the real one reads an address it has never
 *  seen. It moves no coins: what a transfer comes back as is `transfers`. */
const ledgerEnv = (
  options: Parameters<typeof walletEnv>[0] & {
    readonly held?: Readonly<Record<string, number>>;
    /** The next sequence number of each address that has sent before. */
    readonly sequences?: Readonly<Record<string, number>>;
    /** Absent, the shell stands on a workstation that has joined a network. */
    readonly connectivity?: ConnectivityState;
    readonly essid?: string | null;
    /** What every read comes back as, in place of an answer from `held`. */
    readonly answers?: WalletBalanceResult;
    /** What every transfer comes back as. Absent, the ledger makes it. */
    readonly transfers?: WalletTransferResult;
    /** The transfers the ledger lists for each address, newest first. */
    readonly recorded?: Readonly<Record<string, readonly TransferRecord[]>>;
    /** What every history comes back as, in place of a list from `recorded`. */
    readonly lists?: WalletHistoryResult;
  } = {},
): {
  readonly env: CommandEnv;
  readonly asked: readonly string[];
  readonly sent: readonly WalletTransferOrder[];
  /** Every address whose history was asked for. */
  readonly listed: readonly string[];
  /** Everything the command wrote to a box: patches asked for and log lines. */
  readonly written: readonly string[];
} => {
  const asked: string[] = [];
  const sent: WalletTransferOrder[] = [];
  const listed: string[] = [];
  const logged: string[] = [];
  const box = walletEnv(options);
  const logs = (line: string) => async () => {
    logged.push(line);
  };
  return {
    env: {
      ...box.env,
      session: { ...box.env.session, essid: options.essid ?? null },
      network: mockNetworkViewFromConnectivity(options.connectivity ?? joinedConnectivity()),
      log: {
        appendAuthLog: logs('auth.log'),
        appendKernLog: logs('kern.log'),
        appendAccessLog: logs('access.log'),
      },
      wallet: {
        balance: async (address) => {
          asked.push(address);
          return (
            options.answers ?? {
              ok: true,
              balance: options.held?.[address] ?? 0,
              nextSequence: options.sequences?.[address] ?? 0,
            }
          );
        },
        transfer: async (order) => {
          sent.push(order);
          return options.transfers ?? { ok: true };
        },
        history: async (address) => {
          listed.push(address);
          return options.lists ?? { ok: true, transfers: options.recorded?.[address] ?? [] };
        },
      },
    },
    asked,
    sent,
    listed,
    get written() {
      return [...box.asked, ...logged];
    },
  };
};

const SOMEBODY = `jsc${'0123456789abcdef'.repeat(3).slice(0, 40)}`;

describe('wallet balance — what an address holds', () => {
  it('prints an address and what the ledger holds at it', async () => {
    const { env, asked } = ledgerEnv({ held: { [SOMEBODY]: 250 } });

    const result = await wallet.execute(env, ['balance', SOMEBODY], NO_FLAGS);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'text', content: `${SOMEBODY}  250 JSC` }],
      exitCode: 0,
    });
    expect(asked).toEqual([SOMEBODY]);
  });

  it('reads an address the ledger has never seen as holding nothing', async () => {
    const { env } = ledgerEnv();

    const result = await wallet.execute(env, ['balance', SOMEBODY], NO_FLAGS);

    expect(textLines(result)).toEqual([`${SOMEBODY}  0 JSC`]);
    expect(exitCodeOf(result)).toBe(0);
  });

  it('prints the largest balance the ledger holds as plain digits', async () => {
    const { env } = ledgerEnv({ held: { [SOMEBODY]: Number.MAX_SAFE_INTEGER } });

    const result = await wallet.execute(env, ['balance', SOMEBODY], NO_FLAGS);

    expect(textLines(result)).toEqual([`${SOMEBODY}  9007199254740991 JSC`]);
  });

  it('asks from a box the shell hopped to, whatever the player’s own card is doing', async () => {
    const { env, asked } = ledgerEnv({
      held: { [SOMEBODY]: 7 },
      essid: ESSID,
      connectivity: buildColdStartConnectivity(PLAYER_KEY),
    });

    const result = await wallet.execute(env, ['balance', SOMEBODY], NO_FLAGS);

    expect(textLines(result)).toEqual([`${SOMEBODY}  7 JSC`]);
    expect(asked).toEqual([SOMEBODY]);
  });
});

const SOME_KEY = 'c0ffee'.repeat(11).slice(0, 64);
const OTHER_KEY = '5ca1ab1e'.repeat(8);

describe('wallet balance — the wallet in place', () => {
  it.each([
    ['a user shell', 'user', 'alice', ALICE_WALLET],
    ['a root shell', 'root', 'root', '/root/.wallet/wallet.dat'],
    ['a guest shell', 'guest', 'guest', '/home/guest/.wallet/wallet.dat'],
  ] as const)(
    'reads the address of the wallet %s made, with no address named',
    async (_label, userType, username, path) => {
      const made = walletEnv({ userType, username });
      await wallet.execute(made.env, ['init'], NO_FLAGS);
      const { address } = walletAt(made.treeAfter(), path);
      const { env, asked } = ledgerEnv({
        tree: made.treeAfter(),
        userType,
        username,
        held: { [address]: 500 },
      });

      const result = await wallet.execute(env, ['balance'], NO_FLAGS);

      expect(result).toEqual({
        kind: 'sync',
        lines: [{ kind: 'text', content: `${address}  500 JSC` }],
        exitCode: 0,
      });
      expect(asked).toEqual([address]);
    },
  );

  it('answers for the key line, and never for what the address line says', async () => {
    const tree = boxWithWalletDirectory({
      'wallet.dat': buildFile(`address: ${addressOfKey(OTHER_KEY)}\nkey: ${SOME_KEY}\n`, {
        owner: 'alice',
      }),
    });
    const { env, asked } = ledgerEnv({ tree });

    const result = await wallet.execute(env, ['balance'], NO_FLAGS);

    expect(textLines(result)).toEqual([`${addressOfKey(SOME_KEY)}  0 JSC`]);
    expect(asked).toEqual([addressOfKey(SOME_KEY)]);
  });

  it('finds the key line when it is the only line in the file', async () => {
    const tree = boxWithWalletDirectory({
      'wallet.dat': buildFile(`key: ${SOME_KEY}\n`, { owner: 'alice' }),
    });
    const { env, asked } = ledgerEnv({ tree });

    await wallet.execute(env, ['balance'], NO_FLAGS);

    expect(asked).toEqual([addressOfKey(SOME_KEY)]);
  });
});

describe('wallet balance — what it refuses without asking the ledger', () => {
  it('names the file that is not there when no wallet is in place', async () => {
    const { env, asked } = ledgerEnv();

    const result = await wallet.execute(env, ['balance'], NO_FLAGS);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: `wallet: no wallet at ${ALICE_WALLET}` }],
      exitCode: 1,
    });
    expect(asked).toEqual([]);
  });

  it.each([
    ['an empty file', ''],
    ['an address line and no key line', `address: ${SOMEBODY}\n`],
    ['a key one character short', `key: ${SOME_KEY.slice(1)}\n`],
    ['a key one character long', `key: ${SOME_KEY}0\n`],
    ['a key in upper case', `key: ${SOME_KEY.toUpperCase()}\n`],
    ['a key with text before its label', `my key: ${SOME_KEY}\n`],
    ['a key that is not hex', `key: ${'z'.repeat(64)}\n`],
    ['the same file after gpg -c', 'jA0ECQMCm1Zr3n0p+uX/0kABm9w3kq1c0de'],
  ])('finds no key in %s', async (_label, content) => {
    const tree = boxWithWalletDirectory({ 'wallet.dat': buildFile(content, { owner: 'alice' }) });
    const { env, asked } = ledgerEnv({ tree });

    const result = await wallet.execute(env, ['balance'], NO_FLAGS);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: `wallet: no key in ${ALICE_WALLET}` }],
      exitCode: 1,
    });
    expect(asked).toEqual([]);
  });

  it('finds no key in a wallet.dat that is a directory', async () => {
    const tree = boxWithWalletDirectory({ 'wallet.dat': buildDirectory({}, { owner: 'alice' }) });
    const { env, asked } = ledgerEnv({ tree });

    const result = await wallet.execute(env, ['balance'], NO_FLAGS);

    expect(errorLines(result)).toEqual([`wallet: no key in ${ALICE_WALLET}`]);
    expect(asked).toEqual([]);
  });

  it('says so when the wallet is there and this tier may not read it', async () => {
    const tree = boxWithWalletDirectory({
      'wallet.dat': buildFile(`key: ${SOME_KEY}\n`, {
        owner: 'root',
        perms: { read: ['root'], write: ['root'], execute: [] },
      }),
    });
    const { env, asked } = ledgerEnv({ tree });

    const result = await wallet.execute(env, ['balance'], NO_FLAGS);

    expect(result).toEqual({
      kind: 'sync',
      lines: [
        { kind: 'error', content: `wallet: can't read '${ALICE_WALLET}': Permission denied` },
      ],
      exitCode: 1,
    });
    expect(asked).toEqual([]);
  });

  it.each([
    ['the mint’s label', 'coinbase'],
    ['an address in upper case', SOMEBODY.toUpperCase()],
    ['an address one character short', SOMEBODY.slice(0, -1)],
    ['an address one character long', `${SOMEBODY}0`],
    ['an address with a character that is not hex', `${SOMEBODY.slice(0, -1)}g`],
    ['an address with text before it', `x${SOMEBODY}`],
    ['a bare key', SOME_KEY],
    ['nothing at all', ''],
  ])('takes %s for no address', async (_label, text) => {
    const { env, asked } = ledgerEnv();

    const result = await wallet.execute(env, ['balance', text], NO_FLAGS);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: `wallet: '${text}' is not an address` }],
      exitCode: 1,
    });
    expect(asked).toEqual([]);
  });

  it('prints the usage for more than one address', async () => {
    const { env, asked } = ledgerEnv();

    const result = await wallet.execute(env, ['balance', SOMEBODY, SOMEBODY], NO_FLAGS);

    expect(errorLines(result)).toEqual([USAGE]);
    expect(exitCodeOf(result)).toBe(1);
    expect(asked).toEqual([]);
  });
});

describe('wallet balance — with nowhere to ask from', () => {
  const offline = { connectivity: buildColdStartConnectivity(PLAYER_KEY) };
  const UNREACHABLE = 'wallet: network is unreachable — connect to a network first';

  it('refuses an address on a workstation that has joined no network', async () => {
    const { env, asked } = ledgerEnv(offline);

    const result = await wallet.execute(env, ['balance', SOMEBODY], NO_FLAGS);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: UNREACHABLE }],
      exitCode: 1,
    });
    expect(asked).toEqual([]);
  });

  it('refuses the wallet in place the same way', async () => {
    const tree = boxWithWalletDirectory({
      'wallet.dat': buildFile(`key: ${SOME_KEY}\n`, { owner: 'alice' }),
    });
    const { env, asked } = ledgerEnv({ ...offline, tree });

    const result = await wallet.execute(env, ['balance'], NO_FLAGS);

    expect(errorLines(result)).toEqual([UNREACHABLE]);
    expect(asked).toEqual([]);
  });

  it('reports text that is not an address before the missing network', async () => {
    const { env } = ledgerEnv(offline);

    const result = await wallet.execute(env, ['balance', 'coinbase'], NO_FLAGS);

    expect(errorLines(result)).toEqual([`wallet: 'coinbase' is not an address`]);
  });

  it('reports a missing wallet before the missing network', async () => {
    const { env } = ledgerEnv(offline);

    const result = await wallet.execute(env, ['balance'], NO_FLAGS);

    expect(errorLines(result)).toEqual([`wallet: no wallet at ${ALICE_WALLET}`]);
  });
});

describe('wallet balance — a ledger that does not answer', () => {
  it('says so, and prints no balance', async () => {
    const { env, asked } = ledgerEnv({ answers: { ok: false, error: 'network_error' } });

    const result = await wallet.execute(env, ['balance', SOMEBODY], NO_FLAGS);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: 'wallet: the ledger did not answer' }],
      exitCode: 1,
    });
    expect(asked).toEqual([SOMEBODY]);
  });
});

const SOMEBODY_ELSE = `jsc${'fedcba9876543210'.repeat(3).slice(0, 40)}`;

describe('wallet history — what an address has done', () => {
  it('prints one line per transfer the ledger lists, newest first', async () => {
    const { env, listed, asked, sent } = ledgerEnv({
      recorded: {
        [SOMEBODY]: [
          { from: SOMEBODY, to: SOMEBODY_ELSE, amount: 500, at: '2026-10-11T14:09:41.000Z' },
          { from: SOMEBODY_ELSE, to: SOMEBODY, amount: 200, at: '2026-10-11T14:05:00.000Z' },
          { from: null, to: SOMEBODY, amount: 500, at: '2026-10-11T14:02:59.999Z' },
        ],
      },
    });

    const result = await wallet.execute(env, ['history', SOMEBODY], NO_FLAGS);

    expect(result).toEqual({
      kind: 'sync',
      lines: [
        { kind: 'text', content: `2026-10-11 14:09  -500 JSC  to ${SOMEBODY_ELSE}` },
        { kind: 'text', content: `2026-10-11 14:05  +200 JSC  from ${SOMEBODY_ELSE}` },
        { kind: 'text', content: '2026-10-11 14:02  +500 JSC  from coinbase' },
      ],
      exitCode: 0,
    });
    expect(listed).toEqual([SOMEBODY]);
    expect(asked).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('prints nothing, and fails nothing, for an address that has done nothing', async () => {
    const { env, listed } = ledgerEnv();

    const result = await wallet.execute(env, ['history', SOMEBODY], NO_FLAGS);

    expect(result).toEqual({ kind: 'sync', lines: [], exitCode: 0 });
    expect(listed).toEqual([SOMEBODY]);
  });

  it('prints the day and the minute the ledger gave, in its own clock', async () => {
    const { env } = ledgerEnv({
      recorded: {
        [SOMEBODY]: [{ from: null, to: SOMEBODY, amount: 1, at: '2027-01-05T04:07:09.000Z' }],
      },
    });

    const result = await wallet.execute(env, ['history', SOMEBODY], NO_FLAGS);

    expect(textLines(result)).toEqual(['2027-01-05 04:07  +1 JSC  from coinbase']);
  });

  it('prints the largest amount there is as plain digits, coming and going', async () => {
    const { env } = ledgerEnv({
      recorded: {
        [SOMEBODY]: [
          {
            from: SOMEBODY,
            to: SOMEBODY_ELSE,
            amount: Number.MAX_SAFE_INTEGER,
            at: '2026-10-11T14:09:00.000Z',
          },
          {
            from: SOMEBODY_ELSE,
            to: SOMEBODY,
            amount: Number.MAX_SAFE_INTEGER,
            at: '2026-10-11T14:05:00.000Z',
          },
        ],
      },
    });

    const result = await wallet.execute(env, ['history', SOMEBODY], NO_FLAGS);

    expect(textLines(result)).toEqual([
      `2026-10-11 14:09  -9007199254740991 JSC  to ${SOMEBODY_ELSE}`,
      `2026-10-11 14:05  +9007199254740991 JSC  from ${SOMEBODY_ELSE}`,
    ]);
  });

  it('prints every transfer it is handed, however many', async () => {
    const twenty = Array.from({ length: 20 }, (_unused, index) => ({
      from: null,
      to: SOMEBODY,
      amount: 20 - index,
      at: '2026-10-11T14:02:00.000Z',
    }));
    const { env } = ledgerEnv({ recorded: { [SOMEBODY]: twenty } });

    const result = await wallet.execute(env, ['history', SOMEBODY], NO_FLAGS);

    expect(textLines(result)).toHaveLength(20);
    expect(textLines(result)[0]).toBe('2026-10-11 14:02  +20 JSC  from coinbase');
    expect(textLines(result)[19]).toBe('2026-10-11 14:02  +1 JSC  from coinbase');
  });

  it('asks from a box the shell hopped to, whatever the player’s own card is doing', async () => {
    const { env, listed } = ledgerEnv({
      recorded: {
        [SOMEBODY]: [{ from: null, to: SOMEBODY, amount: 7, at: '2026-10-11T14:02:00.000Z' }],
      },
      essid: ESSID,
      connectivity: buildColdStartConnectivity(PLAYER_KEY),
    });

    const result = await wallet.execute(env, ['history', SOMEBODY], NO_FLAGS);

    expect(textLines(result)).toEqual(['2026-10-11 14:02  +7 JSC  from coinbase']);
    expect(listed).toEqual([SOMEBODY]);
  });

  it('writes nothing to the box and adds a line to no log', async () => {
    const { env, written } = ledgerEnv({
      recorded: {
        [SOMEBODY]: [{ from: null, to: SOMEBODY, amount: 7, at: '2026-10-11T14:02:00.000Z' }],
      },
    });

    await wallet.execute(env, ['history', SOMEBODY], NO_FLAGS);

    expect(written).toEqual([]);
  });
});

/** A box where alice's wallet holds `keyHex`. */
const boxWithKey = (keyHex: string): Directory =>
  boxWithWalletDirectory({
    'wallet.dat': buildFile(`address: ${addressOfKey(keyHex)}\nkey: ${keyHex}\n`, {
      owner: 'alice',
    }),
  });

const OWN = addressOfKey(SOME_KEY);

const refusedWith = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: message }],
  exitCode: 1,
});

describe('wallet history — the wallet in place', () => {
  it('lists what the wallet in place has done, with no address named', async () => {
    const { env, listed, asked } = ledgerEnv({
      tree: boxWithKey(SOME_KEY),
      recorded: {
        [OWN]: [
          { from: OWN, to: SOMEBODY, amount: 500, at: '2026-10-11T14:09:00.000Z' },
          { from: null, to: OWN, amount: 500, at: '2026-10-11T14:02:00.000Z' },
        ],
      },
    });

    const result = await wallet.execute(env, ['history'], NO_FLAGS);

    expect(result).toEqual({
      kind: 'sync',
      lines: [
        { kind: 'text', content: `2026-10-11 14:09  -500 JSC  to ${SOMEBODY}` },
        { kind: 'text', content: '2026-10-11 14:02  +500 JSC  from coinbase' },
      ],
      exitCode: 0,
    });
    expect(listed).toEqual([OWN]);
    expect(asked).toEqual([]);
  });

  it('answers for the key line, and never for what the address line says', async () => {
    const tree = boxWithWalletDirectory({
      'wallet.dat': buildFile(`address: ${addressOfKey(OTHER_KEY)}\nkey: ${SOME_KEY}\n`, {
        owner: 'alice',
      }),
    });
    const { env, listed } = ledgerEnv({ tree });

    await wallet.execute(env, ['history'], NO_FLAGS);

    expect(listed).toEqual([OWN]);
  });

  it('lists the wallet a guest shell made', async () => {
    const made = walletEnv({ userType: 'guest', username: 'guest' });
    await wallet.execute(made.env, ['init'], NO_FLAGS);
    const { address } = walletAt(made.treeAfter(), '/home/guest/.wallet/wallet.dat');
    const { env, listed } = ledgerEnv({
      tree: made.treeAfter(),
      userType: 'guest',
      username: 'guest',
    });

    const result = await wallet.execute(env, ['history'], NO_FLAGS);

    expect(exitCodeOf(result)).toBe(0);
    expect(listed).toEqual([address]);
  });
});

describe('wallet history — what it refuses without asking the ledger', () => {
  it('names the file that is not there when no wallet is in place', async () => {
    const { env, listed } = ledgerEnv();

    const result = await wallet.execute(env, ['history'], NO_FLAGS);

    expect(result).toEqual(refusedWith(`wallet: no wallet at ${ALICE_WALLET}`));
    expect(listed).toEqual([]);
  });

  it('finds no key in a wallet that was encrypted where it lay', async () => {
    const tree = boxWithWalletDirectory({
      'wallet.dat': buildFile('jA0ECQMCm1Zr3n0p+uX/0kABm9w3kq1c0de', { owner: 'alice' }),
    });
    const { env, listed } = ledgerEnv({ tree });

    const result = await wallet.execute(env, ['history'], NO_FLAGS);

    expect(result).toEqual(refusedWith(`wallet: no key in ${ALICE_WALLET}`));
    expect(listed).toEqual([]);
  });

  it('says so when the wallet is there and this tier may not read it', async () => {
    const tree = boxWithWalletDirectory({
      'wallet.dat': buildFile(`key: ${SOME_KEY}\n`, {
        owner: 'root',
        perms: { read: ['root'], write: ['root'], execute: [] },
      }),
    });
    const { env, listed } = ledgerEnv({ tree });

    const result = await wallet.execute(env, ['history'], NO_FLAGS);

    expect(result).toEqual(refusedWith(`wallet: can't read '${ALICE_WALLET}': Permission denied`));
    expect(listed).toEqual([]);
  });

  it.each([
    ['the mint’s label', 'coinbase'],
    ['an address in upper case', SOMEBODY.toUpperCase()],
    ['an address one character short', SOMEBODY.slice(0, -1)],
    ['an address one character long', `${SOMEBODY}0`],
    ['an address with a character that is not hex', `${SOMEBODY.slice(0, -1)}g`],
    ['an address with text before it', `x${SOMEBODY}`],
    ['a bare key', SOME_KEY],
    ['nothing at all', ''],
  ])('takes %s for no address', async (_label, text) => {
    const { env, listed } = ledgerEnv({ tree: boxWithKey(SOME_KEY) });

    const result = await wallet.execute(env, ['history', text], NO_FLAGS);

    expect(result).toEqual(refusedWith(`wallet: '${text}' is not an address`));
    expect(listed).toEqual([]);
  });

  it('prints the usage for more than one address', async () => {
    const { env, listed } = ledgerEnv();

    const result = await wallet.execute(env, ['history', SOMEBODY, SOMEBODY_ELSE], NO_FLAGS);

    expect(result).toEqual(refusedWith(USAGE));
    expect(listed).toEqual([]);
  });
});

describe('wallet history — with nowhere to ask from', () => {
  const offline = { connectivity: buildColdStartConnectivity(PLAYER_KEY) };
  const UNREACHABLE = 'wallet: network is unreachable — connect to a network first';

  it('refuses an address on a workstation that has joined no network', async () => {
    const { env, listed } = ledgerEnv(offline);

    const result = await wallet.execute(env, ['history', SOMEBODY], NO_FLAGS);

    expect(result).toEqual(refusedWith(UNREACHABLE));
    expect(listed).toEqual([]);
  });

  it('refuses the wallet in place the same way', async () => {
    const { env, listed } = ledgerEnv({ ...offline, tree: boxWithKey(SOME_KEY) });

    const result = await wallet.execute(env, ['history'], NO_FLAGS);

    expect(result).toEqual(refusedWith(UNREACHABLE));
    expect(listed).toEqual([]);
  });

  it('reports text that is not an address before the missing network', async () => {
    const { env } = ledgerEnv(offline);

    const result = await wallet.execute(env, ['history', 'coinbase'], NO_FLAGS);

    expect(errorLines(result)).toEqual([`wallet: 'coinbase' is not an address`]);
  });

  it('reports a missing wallet before the missing network', async () => {
    const { env } = ledgerEnv(offline);

    const result = await wallet.execute(env, ['history'], NO_FLAGS);

    expect(errorLines(result)).toEqual([`wallet: no wallet at ${ALICE_WALLET}`]);
  });
});

describe('wallet history — a ledger that does not answer', () => {
  it('says so, and prints no part of a list', async () => {
    const { env, listed } = ledgerEnv({ lists: { ok: false, error: 'network_error' } });

    const result = await wallet.execute(env, ['history', SOMEBODY], NO_FLAGS);

    expect(result).toEqual(refusedWith('wallet: the ledger did not answer'));
    expect(listed).toEqual([SOMEBODY]);
  });
});

describe('wallet send — coins leaving the wallet in place', () => {
  it('prints what moved and where to', async () => {
    const { env, asked, sent } = ledgerEnv({ tree: boxWithKey(SOME_KEY), held: { [OWN]: 500 } });

    const result = await wallet.execute(env, ['send', SOMEBODY, '200'], NO_FLAGS);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'text', content: `sent 200 JSC to ${SOMEBODY}` }],
      exitCode: 0,
    });
    expect(asked).toEqual([OWN]);
    expect(sent).toEqual([{ keyHex: SOME_KEY, to: SOMEBODY, amount: 200, sequence: 0 }]);
  });

  it('names the sequence number the ledger gave for its own address', async () => {
    const { env, sent } = ledgerEnv({
      tree: boxWithKey(SOME_KEY),
      held: { [OWN]: 500 },
      sequences: { [OWN]: 7, [SOMEBODY]: 3 },
    });

    await wallet.execute(env, ['send', SOMEBODY, '200'], NO_FLAGS);

    expect(sent.map((order) => order.sequence)).toEqual([7]);
  });

  it('sends a single coin, and the largest amount there is, exactly', async () => {
    const { env, sent } = ledgerEnv({ tree: boxWithKey(SOME_KEY) });

    const one = await wallet.execute(env, ['send', SOMEBODY, '1'], NO_FLAGS);
    const all = await wallet.execute(env, ['send', SOMEBODY, '9007199254740991'], NO_FLAGS);

    expect(textLines(one)).toEqual([`sent 1 JSC to ${SOMEBODY}`]);
    expect(textLines(all)).toEqual([`sent 9007199254740991 JSC to ${SOMEBODY}`]);
    expect(sent.map((order) => order.amount)).toEqual([1, Number.MAX_SAFE_INTEGER]);
  });

  it('signs with the key line, whatever the address line says', async () => {
    const tree = boxWithWalletDirectory({
      'wallet.dat': buildFile(`address: ${addressOfKey(OTHER_KEY)}\nkey: ${SOME_KEY}\n`, {
        owner: 'alice',
      }),
    });
    const { env, asked, sent } = ledgerEnv({ tree });

    await wallet.execute(env, ['send', SOMEBODY, '200'], NO_FLAGS);

    expect(asked).toEqual([OWN]);
    expect(sent.map((order) => order.keyHex)).toEqual([SOME_KEY]);
  });

  it('sends from the wallet a guest shell made', async () => {
    const made = walletEnv({ userType: 'guest', username: 'guest' });
    await wallet.execute(made.env, ['init'], NO_FLAGS);
    const { address, key } = walletAt(made.treeAfter(), '/home/guest/.wallet/wallet.dat');
    const { env, asked, sent } = ledgerEnv({
      tree: made.treeAfter(),
      userType: 'guest',
      username: 'guest',
    });

    const result = await wallet.execute(env, ['send', SOMEBODY, '200'], NO_FLAGS);

    expect(exitCodeOf(result)).toBe(0);
    expect(asked).toEqual([address]);
    expect(sent.map((order) => order.keyHex)).toEqual([key]);
  });

  it('sends to an address that could be anybody’s, with no check that it is held', async () => {
    const nobody = `jsc${'f'.repeat(40)}`;
    const { env, asked, sent } = ledgerEnv({ tree: boxWithKey(SOME_KEY) });

    const result = await wallet.execute(env, ['send', nobody, '200'], NO_FLAGS);

    expect(textLines(result)).toEqual([`sent 200 JSC to ${nobody}`]);
    expect(asked).toEqual([OWN]);
    expect(sent.map((order) => order.to)).toEqual([nobody]);
  });

  it('leaves it to the ledger to say whether the balance covers the amount', async () => {
    const { env, sent } = ledgerEnv({ tree: boxWithKey(SOME_KEY), held: { [OWN]: 100 } });

    const result = await wallet.execute(env, ['send', SOMEBODY, '200'], NO_FLAGS);

    expect(textLines(result)).toEqual([`sent 200 JSC to ${SOMEBODY}`]);
    expect(sent).toHaveLength(1);
  });

  it('asks from a box the shell hopped to, whatever the player’s own card is doing', async () => {
    const { env, sent } = ledgerEnv({
      tree: boxWithKey(SOME_KEY),
      essid: ESSID,
      connectivity: buildColdStartConnectivity(PLAYER_KEY),
    });

    const result = await wallet.execute(env, ['send', SOMEBODY, '200'], NO_FLAGS);

    expect(exitCodeOf(result)).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('writes nothing to the box and adds a line to no log', async () => {
    const { env, written } = ledgerEnv({ tree: boxWithKey(SOME_KEY), held: { [OWN]: 500 } });

    await wallet.execute(env, ['send', SOMEBODY, '200'], NO_FLAGS);

    expect(written).toEqual([]);
  });
});

describe('wallet send — a transfer the ledger does not make', () => {
  it('says the wallet does not hold enough, and names the wallet', async () => {
    const { env, sent } = ledgerEnv({
      tree: boxWithKey(SOME_KEY),
      transfers: { ok: false, error: 'insufficient_balance' },
    });

    const result = await wallet.execute(env, ['send', SOMEBODY, '200'], NO_FLAGS);

    expect(result).toEqual(refusedWith(`wallet: not enough JSC at ${OWN}`));
    expect(sent).toHaveLength(1);
  });

  it.each([
    ['another holder of the key sent first', 'stale_sequence'],
    ['the destination can hold no more', 'destination_full'],
  ] as const)('says only that the ledger refused when %s', async (_label, error) => {
    const { env } = ledgerEnv({ tree: boxWithKey(SOME_KEY), transfers: { ok: false, error } });

    const result = await wallet.execute(env, ['send', SOMEBODY, '200'], NO_FLAGS);

    expect(result).toEqual(refusedWith('wallet: the ledger refused the transfer'));
  });

  it('says the ledger did not answer when the transfer got no answer', async () => {
    const { env } = ledgerEnv({
      tree: boxWithKey(SOME_KEY),
      transfers: { ok: false, error: 'network_error' },
    });

    const result = await wallet.execute(env, ['send', SOMEBODY, '200'], NO_FLAGS);

    expect(result).toEqual(refusedWith('wallet: the ledger did not answer'));
  });

  it('sends nothing when it could not read its sequence number', async () => {
    const { env, asked, sent } = ledgerEnv({
      tree: boxWithKey(SOME_KEY),
      answers: { ok: false, error: 'network_error' },
    });

    const result = await wallet.execute(env, ['send', SOMEBODY, '200'], NO_FLAGS);

    expect(result).toEqual(refusedWith('wallet: the ledger did not answer'));
    expect(asked).toEqual([OWN]);
    expect(sent).toEqual([]);
  });
});

describe('wallet send — what it refuses without asking the ledger', () => {
  it.each([
    ['no address and no amount', ['send']],
    ['an address and no amount', ['send', SOMEBODY]],
    ['a third word', ['send', SOMEBODY, '200', 'JSC']],
    ['a third word that is empty', ['send', SOMEBODY, '200', '']],
  ])('prints the usage for %s', async (_label, args) => {
    const { env, asked, sent } = ledgerEnv({ tree: boxWithKey(SOME_KEY) });

    const result = await wallet.execute(env, args, NO_FLAGS);

    expect(result).toEqual(refusedWith(USAGE));
    expect([...asked, ...sent]).toEqual([]);
  });

  it.each([
    ['the mint’s label', 'coinbase'],
    ['an address in upper case', SOMEBODY.toUpperCase()],
    ['an address one character short', SOMEBODY.slice(0, -1)],
    ['an address one character long', `${SOMEBODY}0`],
    ['a bare key', OTHER_KEY],
    ['nothing at all', ''],
  ])('takes %s for no address', async (_label, text) => {
    const { env, asked, sent } = ledgerEnv({ tree: boxWithKey(SOME_KEY) });

    const result = await wallet.execute(env, ['send', text, '200'], NO_FLAGS);

    expect(result).toEqual(refusedWith(`wallet: '${text}' is not an address`));
    expect([...asked, ...sent]).toEqual([]);
  });

  it.each([
    ['nothing', '0'],
    ['one past the largest the ledger holds', '9007199254740992'],
    ['a fraction', '2.5'],
    ['a whole number written with a fraction', '250.0'],
    ['an exponent', '1e3'],
    ['a plus sign', '+5'],
    ['a negative amount', '-5'],
    ['a leading zero', '0250'],
    ['an amount with its unit', '250JSC'],
    ['a word', 'all'],
    ['an empty amount', ''],
  ])('takes %s for no amount', async (_label, text) => {
    const { env, asked, sent } = ledgerEnv({ tree: boxWithKey(SOME_KEY) });

    const result = await wallet.execute(env, ['send', SOMEBODY, text], NO_FLAGS);

    expect(result).toEqual(refusedWith(`wallet: '${text}' is not an amount`));
    expect([...asked, ...sent]).toEqual([]);
  });

  it('names the file that is not there when no wallet is in place', async () => {
    const { env, asked, sent } = ledgerEnv();

    const result = await wallet.execute(env, ['send', SOMEBODY, '200'], NO_FLAGS);

    expect(result).toEqual(refusedWith(`wallet: no wallet at ${ALICE_WALLET}`));
    expect([...asked, ...sent]).toEqual([]);
  });

  it('finds no key in a wallet that was encrypted where it lay', async () => {
    const tree = boxWithWalletDirectory({
      'wallet.dat': buildFile('jA0ECQMCm1Zr3n0p+uX/0kABm9w3kq1c0de', { owner: 'alice' }),
    });
    const { env, asked, sent } = ledgerEnv({ tree });

    const result = await wallet.execute(env, ['send', SOMEBODY, '200'], NO_FLAGS);

    expect(result).toEqual(refusedWith(`wallet: no key in ${ALICE_WALLET}`));
    expect([...asked, ...sent]).toEqual([]);
  });

  it('says so when the wallet is there and this tier may not read it', async () => {
    const tree = boxWithWalletDirectory({
      'wallet.dat': buildFile(`key: ${SOME_KEY}\n`, {
        owner: 'root',
        perms: { read: ['root'], write: ['root'], execute: [] },
      }),
    });
    const { env, asked, sent } = ledgerEnv({ tree });

    const result = await wallet.execute(env, ['send', SOMEBODY, '200'], NO_FLAGS);

    expect(result).toEqual(refusedWith(`wallet: can't read '${ALICE_WALLET}': Permission denied`));
    expect([...asked, ...sent]).toEqual([]);
  });

  it('refuses to send to the address of the wallet in place', async () => {
    const { env, asked, sent } = ledgerEnv({ tree: boxWithKey(SOME_KEY), held: { [OWN]: 500 } });

    const result = await wallet.execute(env, ['send', OWN, '200'], NO_FLAGS);

    expect(result).toEqual(refusedWith(`wallet: can't send to this wallet's own address`));
    expect([...asked, ...sent]).toEqual([]);
  });

  it('refuses with nowhere to ask from', async () => {
    const { env, asked, sent } = ledgerEnv({
      tree: boxWithKey(SOME_KEY),
      connectivity: buildColdStartConnectivity(PLAYER_KEY),
    });

    const result = await wallet.execute(env, ['send', SOMEBODY, '200'], NO_FLAGS);

    expect(result).toEqual(
      refusedWith('wallet: network is unreachable — connect to a network first'),
    );
    expect([...asked, ...sent]).toEqual([]);
  });
});

describe('wallet send — which refusal comes first', () => {
  const offline = { connectivity: buildColdStartConnectivity(PLAYER_KEY) };

  it('reports text that is not an address before an amount that is not one', async () => {
    const { env } = ledgerEnv();

    const result = await wallet.execute(env, ['send', 'coinbase', 'lots'], NO_FLAGS);

    expect(errorLines(result)).toEqual([`wallet: 'coinbase' is not an address`]);
  });

  it('reports an amount that is not one before the missing wallet', async () => {
    const { env } = ledgerEnv();

    const result = await wallet.execute(env, ['send', SOMEBODY, 'lots'], NO_FLAGS);

    expect(errorLines(result)).toEqual([`wallet: 'lots' is not an amount`]);
  });

  it('reports a missing wallet before the missing network', async () => {
    const { env } = ledgerEnv(offline);

    const result = await wallet.execute(env, ['send', SOMEBODY, '200'], NO_FLAGS);

    expect(errorLines(result)).toEqual([`wallet: no wallet at ${ALICE_WALLET}`]);
  });

  it('reports a send to its own address before the missing network', async () => {
    const { env } = ledgerEnv({ ...offline, tree: boxWithKey(SOME_KEY) });

    const result = await wallet.execute(env, ['send', OWN, '200'], NO_FLAGS);

    expect(errorLines(result)).toEqual([`wallet: can't send to this wallet's own address`]);
  });
});

describe('wallet — a key that is not the one in the wallet in place', () => {
  // Coins leave by one route: `send`, signed by the key in place. A key lying
  // anywhere else is spent by putting it there, never by naming its file.
  it('spends no key file it is pointed at, and asks the ledger nothing', async () => {
    const copiedAddress = addressOfKey(OTHER_KEY);
    const tree = boxWithWalletDirectory({
      'wallet.dat': buildFile(`address: ${OWN}\nkey: ${SOME_KEY}\n`, { owner: 'alice' }),
      'loot.dat': buildFile(`address: ${copiedAddress}\nkey: ${OTHER_KEY}\n`, { owner: 'alice' }),
    });
    const { env, asked, sent, written } = ledgerEnv({ tree, held: { [copiedAddress]: 500 } });

    const result = await wallet.execute(env, ['sweep', '/home/alice/.wallet/loot.dat'], NO_FLAGS);

    expect(result).toEqual(refusedWith(USAGE));
    expect([...asked, ...sent, ...written]).toEqual([]);
  });
});

describe('wallet — anything that is not a subcommand', () => {
  it.each([
    ['no argument', []],
    ['an unknown subcommand', ['nope']],
    ['a subcommand in the wrong case', ['INIT']],
    ['another subcommand in the wrong case', ['Balance']],
    ['a third subcommand in the wrong case', ['SEND', SOMEBODY, '200']],
    ['a fourth subcommand in the wrong case', ['History', SOMEBODY]],
  ])('prints the usage for %s and makes nothing', async (_label, args) => {
    const { env, asked } = walletEnv();

    const result = await wallet.execute(env, args, NO_FLAGS);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: USAGE }],
      exitCode: 1,
    });
    expect(asked).toEqual([]);
  });
});

describe('wallet — what the manual promises', () => {
  // The manual's first argument is what tab completion offers after `wallet `,
  // and its synopsis is what the usage line repeats. A subcommand named in
  // either before it works would be a promise the command cannot keep.
  it('shows an address in its examples that the wallet takes for one', async () => {
    const shown = (wallet.manual?.examples ?? [])
      .map((example) => example.command.split(' '))
      .filter(([, subcommand, address]) => subcommand === 'balance' && address !== undefined);
    expect(shown).toHaveLength(1);

    for (const [, ...args] of shown) {
      const { env } = ledgerEnv();

      const result = await wallet.execute(env, args, NO_FLAGS);

      expect(exitCodeOf(result)).toBe(0);
    }
  });

  it('shows a send in its examples that a wallet holding enough can make', async () => {
    const shown = (wallet.manual?.examples ?? [])
      .map((example) => example.command.split(' '))
      .filter(([, subcommand]) => subcommand === 'send');
    expect(shown).toHaveLength(1);

    for (const [, ...args] of shown) {
      const { env, sent } = ledgerEnv({ tree: boxWithKey(SOME_KEY) });

      const result = await wallet.execute(env, args, NO_FLAGS);

      expect(exitCodeOf(result)).toBe(0);
      expect(sent).toHaveLength(1);
    }
  });

  it('shows no subcommand in its examples that the wallet does not have', () => {
    const shown = (wallet.manual?.examples ?? [])
      .map((example) => example.command.split(' '))
      .filter(([command]) => command === 'wallet')
      .map(([, subcommand]) => subcommand);

    expect([...new Set(shown)]).toEqual(['init', 'balance', 'history', 'send']);
  });

  it('shows both histories in its examples, and a wallet in place can read each', async () => {
    const shown = (wallet.manual?.examples ?? [])
      .map((example) => example.command.split(' '))
      .filter(([, subcommand]) => subcommand === 'history');
    expect(shown.map((words) => words.length)).toEqual([2, 3]);

    for (const [, ...args] of shown) {
      const { env, listed } = ledgerEnv({ tree: boxWithKey(SOME_KEY) });

      const result = await wallet.execute(env, args, NO_FLAGS);

      expect(exitCodeOf(result)).toBe(0);
      expect(listed).toHaveLength(1);
    }
  });

  it('names the four things a wallet does, and nothing else', () => {
    expect(wallet.manual?.synopsis).toBe(SYNOPSIS);
    expect(wallet.manual?.arguments?.[0]?.values).toEqual(['init', 'balance', 'history', 'send']);
  });

  // Only a subcommand is a keyword. Where an address or an amount is typed,
  // tab completion is left to offer paths.
  it('offers no keywords after the subcommand', () => {
    const afterTheSubcommand = (wallet.manual?.arguments ?? []).slice(1);

    expect(afterTheSubcommand.map((argument) => argument.name)).toEqual(['address', 'amount']);
    expect(afterTheSubcommand.map((argument) => argument.values)).toEqual([undefined, undefined]);
  });

  it('says in the manual what history and send do, and promises no sweep', () => {
    expect(wallet.manual?.description).toContain('"history"');
    expect(wallet.manual?.description).toContain('"send"');
    expect(wallet.manual?.description).not.toMatch(/sweep|swept/i);
  });

  it('ends by naming the explorer, where the same ledger is read on the web', () => {
    expect(wallet.manual?.description).toMatch(
      / The same ledger can be read on the web at chainit\.io: any address, the latest transfers, and the richest addresses\.$/,
    );
  });
});
