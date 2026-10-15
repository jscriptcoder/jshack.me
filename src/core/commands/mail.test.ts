import { describe, expect, it } from 'vitest';
import { mail } from './mail.js';
import { buildDirectory, buildFile } from '../../test/factories/filesystem.js';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockNetworkViewFromConnectivity,
  mockSession,
} from '../../test/factories/commandEnv.js';
import { HOME_DIR, ROOT_DIR } from '../generation/baseFs.js';
import { assignHomeNetwork } from '../network/homeNetwork.js';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces.js';
import { APT_PACKAGES } from '../packages/aptPackages.js';
import { asAbsPath, type UserType } from '../types.js';
import type { CommandEnv, CommandResult, InboxMessage, InboxResult, MailLogin } from './types.js';
import type { Directory } from '../filesystem/types.js';

const NO_FLAGS = new Map<string, string | true>();
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

/** A shell on `tree` as alice (or `userType`), online unless told otherwise, and an
 *  emailit.io that answers every inbox with `answers` and keeps every login it was
 *  asked with. */
const mailEnv = (
  options: {
    readonly tree?: Directory;
    readonly userType?: UserType;
    readonly connectivity?: ConnectivityState;
    readonly answers?: InboxResult;
  } = {},
): { readonly env: CommandEnv; readonly asked: readonly MailLogin[] } => {
  const asked: MailLogin[] = [];
  const userType = options.userType ?? 'user';
  const env = mockCommandEnv({
    fs: mockFsViewFromTree(options.tree ?? boxWith({ aliceRc: NEO_MAILRC }), {
      userType,
      cwd: asAbsPath('/'),
    }),
    session: mockSession({ username: userType === 'root' ? 'root' : 'alice', userType }),
    network: mockNetworkViewFromConnectivity(options.connectivity ?? joinedConnectivity()),
    mail: {
      inbox: async (login) => {
        asked.push(login);
        return options.answers ?? { ok: true, messages: [message()] };
      },
    },
  });
  return { env, asked };
};

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

    expect(linesOf(result, 'error')).toEqual(['mail: usage: mail']);
    expect(asked).toEqual([]);
  });
});

describe('mail — where it can run', () => {
  it('comes with mailutils, which apt installs', () => {
    expect(mail.availability).toEqual({ kind: 'installed-package', packageName: 'mailutils' });
    expect(APT_PACKAGES.find((entry) => entry.name === 'mailutils')?.binaries).toEqual(['mail']);
  });
});
