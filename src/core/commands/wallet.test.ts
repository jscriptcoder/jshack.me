import { describe, expect, it } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha2.js';
import { wallet } from './wallet.js';
import { buildDirectory, buildFile } from '../../test/factories/filesystem.js';
import {
  mockCommandEnv,
  mockFsViewFromTree,
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
import { asAbsPath, type UserType } from '../types.js';
import type { CommandEnv, CommandResult, PatchApi } from './types.js';
import type { Directory, FileNode } from '../filesystem/types.js';

const NO_FLAGS = new Map<string, string | true>();

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

describe('wallet — anything that is not a subcommand', () => {
  it.each([
    ['no argument', []],
    ['an unknown subcommand', ['nope']],
    ['a subcommand in the wrong case', ['INIT']],
  ])('prints the usage for %s and makes nothing', async (_label, args) => {
    const { env, asked } = walletEnv();

    const result = await wallet.execute(env, args, NO_FLAGS);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: 'wallet: usage: wallet init' }],
      exitCode: 1,
    });
    expect(asked).toEqual([]);
  });
});

describe('wallet — what the manual promises', () => {
  // The manual's first argument is what tab completion offers after `wallet `,
  // and its synopsis is what the usage line repeats. A subcommand named in
  // either before it works would be a promise the command cannot keep.
  it('names init, and only init, as the thing a wallet does', () => {
    expect(wallet.manual?.synopsis).toBe('wallet init');
    expect(wallet.manual?.arguments?.[0]?.values).toEqual(['init']);
  });
});
