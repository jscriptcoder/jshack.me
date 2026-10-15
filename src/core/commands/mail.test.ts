import { describe, expect, it } from 'vitest';
import { mail } from './mail.js';
import { buildCommandContext } from '../scripting/commandContext.js';
import { buildDirectory, buildFile } from '../../test/factories/filesystem.js';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockNetworkViewFromConnectivity,
  mockPatchApi,
  mockSession,
} from '../../test/factories/commandEnv.js';
import { applyPatches, type Patch } from '../filesystem/applyPatches.js';
import { createFsView } from '../filesystem/fsView.js';
import { defaultFilePermissions } from '../filesystem/defaultPermissions.js';
import { HOME_DIR, ROOT_DIR } from '../generation/baseFs.js';
import { assignHomeNetwork } from '../network/homeNetwork.js';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces.js';
import { APT_PACKAGES } from '../packages/aptPackages.js';
import { asAbsPath, type UserType } from '../types.js';
import type {
  CommandEnv,
  CommandResult,
  InboxMessage,
  InboxResult,
  MailLogin,
  MailMessage,
  MessageResult,
} from './types.js';
import type { Directory } from '../filesystem/types.js';

const NO_FLAGS = new Map<string, string | true>();
const USAGE = 'mail: usage: mail [read <n>] | login | logout';
const PLAYER_KEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';

const linesOf = (result: CommandResult, kind: 'text' | 'error'): string[] =>
  result.kind === 'sync'
    ? result.lines.filter((line) => line.kind === kind).map((line) => line.content)
    : [];

const exitCodeOf = (result: CommandResult): number | undefined =>
  result.kind === 'sync' ? result.exitCode : undefined;

/** A workstation whose WiFi card has joined a network and holds an address on it. */
const joinedConnectivity = (): ConnectivityState => {
  const cold = buildColdStartConnectivity(PLAYER_KEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0 in cold start');
  const joined = {
    ...wlan0,
    association: { essid: ESSID, bssid: 'AA:BB:CC:DD:EE:FF' },
    ipv4: assignHomeNetwork(PLAYER_KEY, ESSID).localIp,
  };
  return { interfaces: new Map(cold.interfaces).set('wlan0', joined) };
};

const mailrc = (...lines: readonly string[]): string => `${lines.join('\n')}\n`;

const NEO_MAILRC = mailrc('set from=neo@emailit.io', 'set password=s3cret');

/** A box where alice's home holds `aliceRc` as `.mailrc` and root's holds `rootRc`, each
 *  readable by its owner and root only, as `mail login` leaves it. */
const boxWith = (rcs: { readonly aliceRc?: string; readonly rootRc?: string }): Directory => {
  const ownerOnly = (owner: UserType) => ({
    read: [owner, 'root'] as UserType[],
    write: [owner, 'root'] as UserType[],
    execute: [] as UserType[],
  });
  return buildDirectory({
    home: buildDirectory({
      alice: buildDirectory(
        rcs.aliceRc === undefined
          ? {}
          : { '.mailrc': buildFile(rcs.aliceRc, { owner: 'alice', perms: ownerOnly('user') }) },
        { owner: 'alice', perms: HOME_DIR },
      ),
    }),
    root: buildDirectory(
      rcs.rootRc === undefined
        ? {}
        : { '.mailrc': buildFile(rcs.rootRc, { owner: 'root', perms: ownerOnly('root') }) },
      { owner: 'root', perms: ROOT_DIR },
    ),
  });
};

const message = (overrides: Partial<InboxMessage> = {}): InboxMessage => ({
  number: 1,
  sender: 'noreply@emailit.io',
  subject: 'Welcome to emailit.io',
  deliveredAt: '2026-10-15T09:12:03.123456+00:00',
  read: false,
  ...overrides,
});

const opened = (overrides: Partial<MailMessage> = {}): MailMessage => ({
  number: 1,
  sender: 'noreply@emailit.io',
  subject: 'Welcome to emailit.io',
  deliveredAt: '2026-10-15T09:12:03.123456+00:00',
  body: 'Welcome to emailit.io, neo.\n\nThis mailbox is not read.\n',
  ...overrides,
});

type Prompted = { readonly message: string; readonly masked: boolean };

/** A shell on `tree` as alice (or `userType`), online unless told otherwise, and an
 *  emailit.io that answers every inbox with `answers` and every message with `opens`,
 *  and keeps every login it was asked with and every message asked for. The player
 *  answers prompts with `typed`, in order. What the box was told to write or remove is
 *  journalled in the shape the real seam sends it, so `treeAfter` reads the box back
 *  through the walker, as a player would. */
const mailEnv = (
  options: {
    readonly tree?: Directory;
    readonly userType?: UserType;
    readonly connectivity?: ConnectivityState;
    readonly answers?: InboxResult;
    readonly opens?: MessageResult;
    readonly typed?: readonly string[];
    /** The one patch the box refuses, as a round trip that never completed. */
    readonly refuses?: 'write' | 'remove';
  } = {},
): {
  readonly env: CommandEnv;
  readonly asked: readonly MailLogin[];
  readonly opensAsked: readonly { readonly login: MailLogin; readonly number: number }[];
  readonly prompted: readonly Prompted[];
  /** Whether each write told the box the file was new. */
  readonly writtenAsNew: readonly boolean[];
  readonly treeAfter: () => Directory;
} => {
  const asked: MailLogin[] = [];
  const opensAsked: { readonly login: MailLogin; readonly number: number }[] = [];
  const prompted: Prompted[] = [];
  const writtenAsNew: boolean[] = [];
  const journal: Patch[] = [];
  const answers = [...(options.typed ?? [])];
  const userType = options.userType ?? 'user';
  const username = userType === 'root' ? 'root' : 'alice';
  const tree = options.tree ?? boxWith({ aliceRc: NEO_MAILRC });
  const REFUSED = { ok: false, error: 'network_error' } as const;
  const env = mockCommandEnv({
    fs: mockFsViewFromTree(tree, { userType, cwd: asAbsPath('/') }),
    session: mockSession({ username, userType }),
    network: mockNetworkViewFromConnectivity(options.connectivity ?? joinedConnectivity()),
    prompt: async (asking) => {
      prompted.push(asking);
      return answers.shift() ?? '';
    },
    patches: mockPatchApi({
      write: async (path, content, patchOptions) => {
        if (options.refuses === 'write') return REFUSED;
        writtenAsNew.push(patchOptions?.isNew ?? false);
        journal.push({
          path,
          content,
          owner: patchOptions?.owner ?? username,
          permissions: patchOptions?.permissions ?? defaultFilePermissions(userType),
        });
        return { ok: true };
      },
      remove: async (path) => {
        if (options.refuses === 'remove') return REFUSED;
        journal.push({ path, content: null, owner: username });
        return { ok: true };
      },
    }),
    mail: {
      inbox: async (login) => {
        asked.push(login);
        return options.answers ?? { ok: true, messages: [message()] };
      },
      read: async (login, number) => {
        opensAsked.push({ login, number });
        return options.opens ?? { ok: true, message: opened() };
      },
    },
  });
  return {
    env,
    asked,
    opensAsked,
    prompted,
    writtenAsNew,
    treeAfter: () => applyPatches(tree, journal),
  };
};

const readAs = (tree: Directory, userType: UserType, path: string) =>
  createFsView(tree, { userType }).read(asAbsPath(path));

describe('mail — the inbox of whoever ~/.mailrc names', () => {
  it('lists the inbox one message to a line: unread mark, number, sender, date, subject', async () => {
    const { env } = mailEnv();

    const result = await mail.execute(env, [], NO_FLAGS);

    expect(linesOf(result, 'text')).toEqual([
      'N    1  noreply@emailit.io      Oct 15 09:12  Welcome to emailit.io',
    ]);
    expect(exitCodeOf(result)).toBe(0);
  });

  it('asks emailit.io with the handle and password the file holds', async () => {
    const { env, asked } = mailEnv();

    await mail.execute(env, [], NO_FLAGS);

    expect(asked).toEqual([{ handle: 'neo', password: 's3cret' }]);
  });

  it('marks a read message with a space, and keeps the list in the order it came', async () => {
    const { env } = mailEnv({
      answers: {
        ok: true,
        messages: [
          message({ read: true }),
          message({ number: 12, sender: 'trin@emailit.io', subject: 'hi', read: false }),
        ],
      },
    });

    expect(linesOf(await mail.execute(env, [], NO_FLAGS), 'text')).toEqual([
      '     1  noreply@emailit.io      Oct 15 09:12  Welcome to emailit.io',
      'N   12  trin@emailit.io         Oct 15 09:12  hi',
    ]);
  });

  it('dates a message in UTC, whatever offset the server wrote it with', async () => {
    const { env } = mailEnv({
      answers: { ok: true, messages: [message({ deliveredAt: '2026-10-16T01:05:00+02:00' })] },
    });

    expect(linesOf(await mail.execute(env, [], NO_FLAGS), 'text')[0]).toContain('Oct 15 23:05');
  });

  it('keeps the date one width early in a month and early in a day', async () => {
    const { env } = mailEnv({
      answers: { ok: true, messages: [message({ deliveredAt: '2026-10-05T08:03:00Z' })] },
    });

    expect(linesOf(await mail.execute(env, [], NO_FLAGS), 'text')).toEqual([
      'N    1  noreply@emailit.io      Oct  5 08:03  Welcome to emailit.io',
    ]);
  });

  it('cuts a line at 80 characters', async () => {
    const { env } = mailEnv({
      answers: { ok: true, messages: [message({ subject: 'x'.repeat(100) })] },
    });

    const [line] = linesOf(await mail.execute(env, [], NO_FLAGS), 'text');

    expect(line).toBe(`N    1  noreply@emailit.io      Oct 15 09:12  ${'x'.repeat(34)}`);
  });

  it('says so when the inbox is empty', async () => {
    const { env } = mailEnv({ answers: { ok: true, messages: [] } });

    const result = await mail.execute(env, [], NO_FLAGS);

    expect(linesOf(result, 'text')).toEqual(['No mail for neo@emailit.io']);
    expect(exitCodeOf(result)).toBe(0);
  });

  it('reads the address in any case as the one lowercase address', async () => {
    const { env, asked } = mailEnv({
      tree: boxWith({ aliceRc: mailrc('set from=Neo@EmailIt.IO', 'set password=s3cret') }),
    });

    await mail.execute(env, [], NO_FLAGS);

    expect(asked).toEqual([{ handle: 'neo', password: 's3cret' }]);
  });
});

describe('mail — ~/.mailrc as the player may write it', () => {
  it('skips blank lines and # comments, and takes the lines in either order', async () => {
    const { env, asked } = mailEnv({
      tree: boxWith({
        aliceRc: mailrc(
          '# saved by mail login',
          '',
          'set password=s3cret',
          'set from=neo@emailit.io',
        ),
      }),
    });

    await mail.execute(env, [], NO_FLAGS);

    expect(asked).toEqual([{ handle: 'neo', password: 's3cret' }]);
  });

  it('keeps a password to the end of its line, spaces and = included', async () => {
    const { env, asked } = mailEnv({
      tree: boxWith({ aliceRc: mailrc('set from=neo@emailit.io', 'set password=a b=c ') }),
    });

    await mail.execute(env, [], NO_FLAGS);

    expect(asked).toEqual([{ handle: 'neo', password: 'a b=c ' }]);
  });

  it.each([
    ['no password', mailrc('set from=neo@emailit.io')],
    ['no address', mailrc('set password=s3cret')],
    ['nothing', ''],
  ])('says the file holds no login when it has %s, asking nobody', async (_missing, content) => {
    const { env, asked } = mailEnv({ tree: boxWith({ aliceRc: content }) });

    const result = await mail.execute(env, [], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual(['mail: ~/.mailrc has no login']);
    expect(exitCodeOf(result)).toBe(1);
    expect(asked).toEqual([]);
  });

  it('refuses an address at any other domain, asking nobody', async () => {
    const { env, asked } = mailEnv({
      tree: boxWith({ aliceRc: mailrc('set from=neo@gmail.com', 'set password=s3cret') }),
    });

    const result = await mail.execute(env, [], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual(['mail: neo@gmail.com: unknown domain']);
    expect(asked).toEqual([]);
  });
});

describe('mail — when there is no inbox to list', () => {
  it('says the shell is not logged in when the user has no ~/.mailrc, asking nobody', async () => {
    const { env, asked } = mailEnv({ tree: boxWith({}) });

    const result = await mail.execute(env, [], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual(['mail: not logged in — run mail login']);
    expect(exitCodeOf(result)).toBe(1);
    expect(asked).toEqual([]);
  });

  it('uses the ~/.mailrc of the user the shell stands as, and no other', async () => {
    const { env, asked } = mailEnv({
      userType: 'root',
      tree: boxWith({
        aliceRc: NEO_MAILRC,
        rootRc: mailrc('set from=trin@emailit.io', 'set password=follow'),
      }),
    });

    await mail.execute(env, [], NO_FLAGS);

    expect(asked).toEqual([{ handle: 'trin', password: 'follow' }]);
  });

  it('says it cannot read a ~/.mailrc the user has been shut out of', async () => {
    const lockedOut = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory(
          {
            '.mailrc': buildFile(NEO_MAILRC, {
              owner: 'alice',
              perms: { read: ['root'], write: ['root'], execute: [] },
            }),
          },
          { owner: 'alice', perms: HOME_DIR },
        ),
      }),
    });
    const { env, asked } = mailEnv({ tree: lockedOut });

    const result = await mail.execute(env, [], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual([
      "mail: can't read '/home/alice/.mailrc': Permission denied",
    ]);
    expect(asked).toEqual([]);
  });

  it('says to wait when emailit.io is holding back guesses from this player', async () => {
    const { env } = mailEnv({ answers: { ok: false, error: 'throttled' } });

    const result = await mail.execute(env, [], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual(['mail: too many failed logins, wait a minute']);
    expect(exitCodeOf(result)).toBe(1);
  });

  it('says the login failed when emailit.io turns the password down, naming the address', async () => {
    const { env } = mailEnv({ answers: { ok: false, error: 'login_failed' } });

    const result = await mail.execute(env, [], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual(['mail: login failed for neo@emailit.io']);
    expect(exitCodeOf(result)).toBe(1);
  });

  it.each(['host_unreachable', 'network_error'] as const)(
    'says it cannot reach emailit.io when the inbox comes back %s',
    async (error) => {
      const { env } = mailEnv({ answers: { ok: false, error } });

      const result = await mail.execute(env, [], NO_FLAGS);

      expect(linesOf(result, 'error')).toEqual(['mail: cannot reach emailit.io']);
      expect(exitCodeOf(result)).toBe(1);
    },
  );

  it('says it cannot reach emailit.io from a box with no network, asking nobody', async () => {
    const { env, asked } = mailEnv({ connectivity: buildColdStartConnectivity(PLAYER_KEY) });

    const result = await mail.execute(env, [], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual(['mail: cannot reach emailit.io']);
    expect(asked).toEqual([]);
  });

  it('prints its usage for a subcommand it does not have', async () => {
    const { env, asked } = mailEnv();

    const result = await mail.execute(env, ['fetch'], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual([USAGE]);
    expect(asked).toEqual([]);
  });
});

describe('mail — where it can run', () => {
  it('comes with mailutils, which apt installs', () => {
    expect(mail.availability).toEqual({ kind: 'installed-package', packageName: 'mailutils' });
    expect(APT_PACKAGES.find((entry) => entry.name === 'mailutils')?.binaries).toEqual(['mail']);
  });
});

describe('mail read — one message, which emailit.io then marks read', () => {
  it('prints the headers, a blank line and the body as written', async () => {
    const { env } = mailEnv();

    const result = await mail.execute(env, ['read', '1'], NO_FLAGS);

    expect(linesOf(result, 'text')).toEqual([
      'From: noreply@emailit.io',
      'To: neo@emailit.io',
      'Date: Thu, 15 Oct 2026 09:12:03 +0000',
      'Subject: Welcome to emailit.io',
      '',
      'Welcome to emailit.io, neo.',
      '',
      'This mailbox is not read.',
    ]);
    expect(exitCodeOf(result)).toBe(0);
  });

  it('asks for the message by its number, with the login ~/.mailrc holds', async () => {
    const { env, opensAsked, asked } = mailEnv();

    await mail.execute(env, ['read', '12'], NO_FLAGS);

    expect(opensAsked).toEqual([{ login: { handle: 'neo', password: 's3cret' }, number: 12 }]);
    expect(asked).toEqual([]);
  });

  it('dates the message in UTC, with a two-digit day', async () => {
    const { env } = mailEnv({
      opens: { ok: true, message: opened({ deliveredAt: '2026-10-05T10:03:00+02:00' }) },
    });

    const lines = linesOf(await mail.execute(env, ['read', '1'], NO_FLAGS), 'text');

    expect(lines[2]).toBe('Date: Mon, 05 Oct 2026 08:03:00 +0000');
  });

  it('prints a body with no closing newline whole', async () => {
    const { env } = mailEnv({ opens: { ok: true, message: opened({ body: 'one\ntwo' }) } });

    const lines = linesOf(await mail.execute(env, ['read', '1'], NO_FLAGS), 'text');

    expect(lines.slice(4)).toEqual(['', 'one', 'two']);
  });

  it('says there is no such message when the inbox holds none by that number', async () => {
    const { env } = mailEnv({ opens: { ok: false, error: 'no_message' } });

    const result = await mail.execute(env, ['read', '7'], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual(['mail: no message 7']);
    expect(exitCodeOf(result)).toBe(1);
  });

  it.each(['x', '0', '-1', '1.5', '01'])(
    'answers %s as a message the inbox does not hold, asking nobody',
    async (number) => {
      const { env, opensAsked } = mailEnv();

      const result = await mail.execute(env, ['read', number], NO_FLAGS);

      expect(linesOf(result, 'error')).toEqual([`mail: no message ${number}`]);
      expect(opensAsked).toEqual([]);
    },
  );

  it.each([[['read']], [['read', '1', '2']]])('prints its usage for %o', async (args) => {
    const { env, opensAsked } = mailEnv();

    const result = await mail.execute(env, args, NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual([USAGE]);
    expect(opensAsked).toEqual([]);
  });

  it('says to wait when emailit.io is holding back guesses from this player', async () => {
    const { env } = mailEnv({ opens: { ok: false, error: 'throttled' } });

    const result = await mail.execute(env, ['read', '1'], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual(['mail: too many failed logins, wait a minute']);
  });

  it('says the login failed when emailit.io turns the password down', async () => {
    const { env } = mailEnv({ opens: { ok: false, error: 'login_failed' } });

    const result = await mail.execute(env, ['read', '1'], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual(['mail: login failed for neo@emailit.io']);
  });

  it.each(['host_unreachable', 'network_error'] as const)(
    'says it cannot reach emailit.io when the message comes back %s',
    async (error) => {
      const { env } = mailEnv({ opens: { ok: false, error } });

      const result = await mail.execute(env, ['read', '1'], NO_FLAGS);

      expect(linesOf(result, 'error')).toEqual(['mail: cannot reach emailit.io']);
    },
  );

  it('asks nobody from a box with no network, or with no ~/.mailrc', async () => {
    const offline = mailEnv({ connectivity: buildColdStartConnectivity(PLAYER_KEY) });
    const loggedOut = mailEnv({ tree: boxWith({}) });

    expect(linesOf(await mail.execute(offline.env, ['read', '1'], NO_FLAGS), 'error')).toEqual([
      'mail: cannot reach emailit.io',
    ]);
    expect(linesOf(await mail.execute(loggedOut.env, ['read', '1'], NO_FLAGS), 'error')).toEqual([
      'mail: not logged in — run mail login',
    ]);
    expect([...offline.opensAsked, ...loggedOut.opensAsked]).toEqual([]);
  });
});

const ALICE_RC = '/home/alice/.mailrc';

describe('mail login — the login written to ~/.mailrc', () => {
  it('asks for the address, then the password unseen', async () => {
    const { env, prompted } = mailEnv({ tree: boxWith({}), typed: ['neo@emailit.io', 's3cret'] });

    await mail.execute(env, ['login'], NO_FLAGS);

    expect(prompted).toEqual([
      { message: 'Address: ', masked: false },
      { message: 'Password: ', masked: true },
    ]);
  });

  it('saves the address and password as set lines, and counts the new mail', async () => {
    const { env, treeAfter } = mailEnv({
      tree: boxWith({}),
      typed: ['neo@emailit.io', 's3cret'],
    });

    const result = await mail.execute(env, ['login'], NO_FLAGS);

    expect(linesOf(result, 'text')).toEqual(['You have 1 new message.']);
    expect(exitCodeOf(result)).toBe(0);
    expect(readAs(treeAfter(), 'user', ALICE_RC)).toEqual({ ok: true, content: NEO_MAILRC });
  });

  it('asks emailit.io before it writes anything, with what was typed', async () => {
    const { env, asked } = mailEnv({ tree: boxWith({}), typed: ['neo@emailit.io', 'a b=c'] });

    await mail.execute(env, ['login'], NO_FLAGS);

    expect(asked).toEqual([{ handle: 'neo', password: 'a b=c' }]);
  });

  it('leaves the file to its user and root, so a guest on the box cannot read it', async () => {
    const { env, treeAfter } = mailEnv({ tree: boxWith({}), typed: ['neo', 's3cret'] });

    await mail.execute(env, ['login'], NO_FLAGS);

    expect(readAs(treeAfter(), 'root', ALICE_RC).ok).toBe(true);
    expect(readAs(treeAfter(), 'guest', ALICE_RC)).toEqual({
      ok: false,
      error: 'permission_denied',
    });
    expect(createFsView(treeAfter(), { userType: 'root' }).stat(asAbsPath(ALICE_RC))?.owner).toBe(
      'alice',
    );
  });

  it("writes root's login to root's home, for root alone", async () => {
    const { env, treeAfter } = mailEnv({
      userType: 'root',
      tree: boxWith({}),
      typed: ['trin', 'follow'],
    });

    await mail.execute(env, ['login'], NO_FLAGS);

    expect(readAs(treeAfter(), 'root', '/root/.mailrc')).toEqual({
      ok: true,
      content: mailrc('set from=trin@emailit.io', 'set password=follow'),
    });
    expect(readAs(treeAfter(), 'user', '/root/.mailrc').ok).toBe(false);
  });

  it('takes a bare handle, in any case, as the lowercase address at emailit.io', async () => {
    const { env, asked, treeAfter } = mailEnv({ tree: boxWith({}), typed: [' Neo ', 's3cret'] });

    await mail.execute(env, ['login'], NO_FLAGS);

    expect(asked).toEqual([{ handle: 'neo', password: 's3cret' }]);
    expect(readAs(treeAfter(), 'user', ALICE_RC)).toEqual({ ok: true, content: NEO_MAILRC });
  });

  it.each([
    [[message(), message({ number: 2 })], 'You have 2 new messages.'],
    [[message({ read: true }), message({ number: 2, read: true })], 'You have no new messages.'],
    [[], 'You have no new messages.'],
  ])('counts only unread mail as new', async (messages, said) => {
    const { env } = mailEnv({
      tree: boxWith({}),
      typed: ['neo', 's3cret'],
      answers: { ok: true, messages },
    });

    expect(linesOf(await mail.execute(env, ['login'], NO_FLAGS), 'text')).toEqual([said]);
  });

  it('replaces a ~/.mailrc already there, telling the box the file is not new', async () => {
    const { env, treeAfter, writtenAsNew } = mailEnv({ typed: ['trin', 'follow'] });

    await mail.execute(env, ['login'], NO_FLAGS);

    expect(readAs(treeAfter(), 'user', ALICE_RC)).toEqual({
      ok: true,
      content: mailrc('set from=trin@emailit.io', 'set password=follow'),
    });
    expect(writtenAsNew).toEqual([false]);
  });

  it('tells the box a first ~/.mailrc is new', async () => {
    const { env, writtenAsNew } = mailEnv({ tree: boxWith({}), typed: ['neo', 's3cret'] });

    await mail.execute(env, ['login'], NO_FLAGS);

    expect(writtenAsNew).toEqual([true]);
  });

  it('refuses an address at another domain before asking for the password', async () => {
    const { env, prompted, asked, treeAfter } = mailEnv({
      tree: boxWith({}),
      typed: ['neo@gmail.com', 's3cret'],
    });

    const result = await mail.execute(env, ['login'], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual(['mail: neo@gmail.com: unknown domain']);
    expect(exitCodeOf(result)).toBe(1);
    expect(prompted).toHaveLength(1);
    expect(asked).toEqual([]);
    expect(readAs(treeAfter(), 'user', ALICE_RC).ok).toBe(false);
  });

  it('refuses an empty address before asking for the password', async () => {
    const { env, prompted, asked } = mailEnv({ tree: boxWith({}), typed: ['  ', 's3cret'] });

    const result = await mail.execute(env, ['login'], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual(['mail: no address given']);
    expect(prompted).toHaveLength(1);
    expect(asked).toEqual([]);
  });

  it('writes nothing, and says to wait, while emailit.io is holding back guesses', async () => {
    const { env, treeAfter } = mailEnv({
      tree: boxWith({}),
      typed: ['neo', 's3cret'],
      answers: { ok: false, error: 'throttled' },
    });

    const result = await mail.execute(env, ['login'], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual(['mail: too many failed logins, wait a minute']);
    expect(readAs(treeAfter(), 'user', ALICE_RC).ok).toBe(false);
  });

  it('writes nothing, and leaves a saved login as it was, when the login fails', async () => {
    const { env, treeAfter } = mailEnv({
      typed: ['trin', 'wrong'],
      answers: { ok: false, error: 'login_failed' },
    });

    const result = await mail.execute(env, ['login'], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual(['mail: login failed for trin@emailit.io']);
    expect(exitCodeOf(result)).toBe(1);
    expect(readAs(treeAfter(), 'user', ALICE_RC)).toEqual({ ok: true, content: NEO_MAILRC });
  });

  it.each(['host_unreachable', 'network_error'] as const)(
    'writes nothing when the inbox comes back %s',
    async (error) => {
      const { env, treeAfter } = mailEnv({
        tree: boxWith({}),
        typed: ['neo', 's3cret'],
        answers: { ok: false, error },
      });

      const result = await mail.execute(env, ['login'], NO_FLAGS);

      expect(linesOf(result, 'error')).toEqual(['mail: cannot reach emailit.io']);
      expect(readAs(treeAfter(), 'user', ALICE_RC).ok).toBe(false);
    },
  );

  it('asks nobody, and writes nothing, from a box with no network', async () => {
    const { env, asked, treeAfter } = mailEnv({
      tree: boxWith({}),
      typed: ['neo', 's3cret'],
      connectivity: buildColdStartConnectivity(PLAYER_KEY),
    });

    const result = await mail.execute(env, ['login'], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual(['mail: cannot reach emailit.io']);
    expect(asked).toEqual([]);
    expect(readAs(treeAfter(), 'user', ALICE_RC).ok).toBe(false);
  });

  it('asks nobody when the home cannot take the file, and leaves no login', async () => {
    const shutHome = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory({}, { owner: 'root', perms: ROOT_DIR }),
      }),
    });
    const { env, asked } = mailEnv({ tree: shutHome, typed: ['neo', 's3cret'] });

    const result = await mail.execute(env, ['login'], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual([
      `mail: can't create '${ALICE_RC}': Permission denied`,
    ]);
    expect(exitCodeOf(result)).toBe(1);
    expect(asked).toEqual([]);
  });

  it('says what the box said when it turns the write down, and claims no login', async () => {
    const { env } = mailEnv({ tree: boxWith({}), typed: ['neo', 's3cret'], refuses: 'write' });

    const result = await mail.execute(env, ['login'], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual([`mail: can't create '${ALICE_RC}': I/O error`]);
    expect(linesOf(result, 'text')).toEqual([]);
  });

  it('prints its usage when given anything more', async () => {
    const { env, prompted } = mailEnv({ typed: ['neo', 's3cret'] });

    const result = await mail.execute(env, ['login', 'neo'], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual([USAGE]);
    expect(prompted).toEqual([]);
  });
});

describe('mail logout — the login taken off the box', () => {
  it('deletes ~/.mailrc and says nothing', async () => {
    const { env, treeAfter } = mailEnv();

    const result = await mail.execute(env, ['logout'], NO_FLAGS);

    expect(result).toEqual({ kind: 'sync', lines: [], exitCode: 0 });
    expect(readAs(treeAfter(), 'user', ALICE_RC)).toEqual({ ok: false, error: 'not_found' });
  });

  it('asks emailit.io nothing: there is no session there to end', async () => {
    const { env, asked } = mailEnv();

    await mail.execute(env, ['logout'], NO_FLAGS);

    expect(asked).toEqual([]);
  });

  it('says so when the user has no ~/.mailrc', async () => {
    const { env } = mailEnv({ tree: boxWith({}) });

    const result = await mail.execute(env, ['logout'], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual(['mail: not logged in']);
    expect(exitCodeOf(result)).toBe(1);
  });

  it('says what the box said when it turns the removal down', async () => {
    const { env, treeAfter } = mailEnv({ refuses: 'remove' });

    const result = await mail.execute(env, ['logout'], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual([`mail: can't remove '${ALICE_RC}': I/O error`]);
    expect(readAs(treeAfter(), 'user', ALICE_RC).ok).toBe(true);
  });

  it('prints its usage when given anything more', async () => {
    const { env, treeAfter } = mailEnv();

    const result = await mail.execute(env, ['logout', 'now'], NO_FLAGS);

    expect(linesOf(result, 'error')).toEqual([USAGE]);
    expect(readAs(treeAfter(), 'user', ALICE_RC).ok).toBe(true);
  });
});

describe('mail from a script', () => {
  const scriptOn = (env: CommandEnv) =>
    buildCommandContext(env, new Map([[mail.name, mail]]), () => undefined);

  it('hands the list back to the script', async () => {
    const { env } = mailEnv();

    const listed = await scriptOn(env).mail();

    expect([...listed]).toEqual([
      'N    1  noreply@emailit.io      Oct 15 09:12  Welcome to emailit.io',
    ]);
    expect(listed.exitCode).toBe(0);
  });

  it('hands a message back to the script, and has it marked read like a typed one', async () => {
    const { env, opensAsked } = mailEnv();

    const read = await scriptOn(env).mail('read', 1);

    expect([...read].slice(0, 1)).toEqual(['From: noreply@emailit.io']);
    expect(opensAsked).toEqual([{ login: { handle: 'neo', password: 's3cret' }, number: 1 }]);
  });

  it('never logs in from a script, so a script can never guess a password', async () => {
    const { env, prompted, asked } = mailEnv({ tree: boxWith({}), typed: ['neo', 's3cret'] });

    await expect(scriptOn(env).mail('login')).rejects.toThrow('mail: login is interactive');
    expect(prompted).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('never logs out from a script', async () => {
    const { env, treeAfter } = mailEnv();

    await expect(scriptOn(env).mail('logout')).rejects.toThrow('mail: logout is interactive');
    expect(readAs(treeAfter(), 'user', ALICE_RC).ok).toBe(true);
  });
});

describe('mail on a shell with no terminal behind it', () => {
  it('cannot log in, because the password prompt has nobody to ask', () => {
    expect(mail.withoutTty).toBeTypeOf('function');
    const needsTerminal = mail.withoutTty as Exclude<typeof mail.withoutTty, string | undefined>;

    expect(needsTerminal(['login'], NO_FLAGS)).toBe('mail: login needs a terminal');
  });

  it.each([[[]], [['read', '1']], [['logout']]])('still runs %o, which asks nothing', (args) => {
    const needsTerminal = mail.withoutTty as Exclude<typeof mail.withoutTty, string | undefined>;

    expect(needsTerminal(args, NO_FLAGS)).toBeUndefined();
  });
});

describe('mail — what the manual promises', () => {
  it('names the forms the usage line names', () => {
    expect(mail.manual?.synopsis).toBe('mail [read <n>] | login | logout');
  });

  it('offers the subcommands mail has, for completion after `mail `', () => {
    expect(mail.manual?.arguments?.[0]?.values).toEqual(['read', 'login', 'logout']);
  });

  it('says the login is the file, kept in plain text, and readable by whoever can read it', () => {
    const description = mail.manual?.description ?? '';

    expect(description).toContain(
      'login asks for an address and a password and saves them, in plain text, to ~/.mailrc',
    );
    expect(description).toContain('whoever can read that file can read the mail');
    expect(description).toContain('logout deletes ~/.mailrc');
    expect(description).toContain('read and the list work from a script; login and logout do not');
  });

  it('shows examples that each run as a mail with a saved login runs them', async () => {
    const shown = (mail.manual?.examples ?? [])
      .map((example) => example.command.split(' '))
      .filter(([command]) => command === 'mail');
    expect(shown.map(([, subcommand]) => subcommand ?? '')).toEqual([
      'login',
      '',
      'read',
      'logout',
    ]);

    for (const [, ...args] of shown) {
      const { env } = mailEnv({ typed: ['neo', 's3cret'] });

      const result = await mail.execute(env, args, NO_FLAGS);

      expect(exitCodeOf(result), args.join(' ')).toBe(0);
    }
  });
});
