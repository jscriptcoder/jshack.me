import { describe, expect, it, vi } from 'vitest';
import { runRedisLine } from './redisShell';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockNetworkViewFromConnectivity,
  mockRedisApi,
} from '../../test/factories/commandEnv';
import { buildWorkstationBaseFs } from '../generation/workstationFs';
import { applyPatches } from '../filesystem/applyPatches';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { assignHomeNetwork } from '../network/homeNetwork';
import { ownStore } from '../redis/ownStore';
import { DATADIR_OWNER, DATADIR_PATH, storeIn } from '../redis/datadir';
import { DATADIR_FILE } from '../generation/baseFs';
import { REDIS_LOG_PATH } from '../logging/redisLog';
import { formatPidfileContent, pidfilePath, PIDFILE_PERMISSIONS } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { asAbsPath, asPlayerKeyHex, type AbsPath } from '../types';
import type { Directory } from '../filesystem/types';
import type {
  CommandResult,
  FsView,
  RedisApi,
  RedisConnection,
  RedisStatementResult,
} from './types';

/**
 * The `redis> ` prompt. The same three claims the database prompt holds, pulling the
 * same way: a line typed here must never reach the outer shell, the player must always
 * be able to get back out, and everything else is the store's to answer rather than
 * this client's to guess at.
 *
 * Less is decided locally here than at `mysql>`, and deliberately: an unknown verb is
 * NOT recognised as unknown by this client. It is sent, because a prompt that answered
 * its own spelling mistakes would keep politely correcting a player whose box has
 * already gone dark. Every line making the trip is what makes the eviction discoverable
 * at all — there is no session row to be told about it.
 */

const CONNECTION = {
  essid: 'BEAN-THERE-WIFI',
  targetIp: '192.168.1.31',
  port: 6379,
  sourceIp: '192.168.1.50',
} as const;

const answered = (output: readonly string[], failed = false): RedisStatementResult => ({
  kind: 'answered',
  output,
  failed,
});

const shellEnv = (over: Partial<RedisApi> = {}) => mockCommandEnv({ redis: mockRedisApi(over) });

const sync = (result: CommandResult) => {
  if (result.kind !== 'sync') throw new Error('expected a sync result');
  return result;
};

const linesOf = (result: CommandResult): string =>
  sync(result)
    .lines.map((line) => line.content)
    .join('\n');

describe('leaving the store sub-shell', () => {
  it('hands the terminal back on quit, without asking the store', async () => {
    const leave = vi.fn();
    const run = vi.fn();

    const result = await runRedisLine(shellEnv({ leave, run }), 'quit', CONNECTION);

    expect(leave).toHaveBeenCalled();
    // Nothing to say. The real client says nothing, legacy said nothing, and the
    // prompt changing back is the feedback — a farewell this tool does not have would
    // be the door imitating the wrong neighbour.
    expect(sync(result).lines).toEqual([]);
    expect(sync(result).exitCode).toBe(0);
    // The way out belongs to the client. A player whose box has gone dark must still
    // be able to get back to their shell.
    expect(run).not.toHaveBeenCalled();
  });

  it('takes exit as the same word, in any case and however it is spaced', async () => {
    for (const typed of ['exit', 'EXIT', 'Quit', '  exit  ', 'QUIT']) {
      const leave = vi.fn();
      const run = vi.fn();

      const result = await runRedisLine(shellEnv({ leave, run }), typed, CONNECTION);

      expect(leave, typed).toHaveBeenCalled();
      expect(run, typed).not.toHaveBeenCalled();
      expect(sync(result).lines, typed).toEqual([]);
    }
  });

  it('does not take a line that merely CONTAINS quit as the way out', async () => {
    // Both ends of the anchor. A key called `myexit` must not drop the connection, and
    // neither must a typo like `quitt` — one costs the player their place, the other
    // silently swallows a statement they meant to send.
    for (const typed of ['GET sess:exit', 'KEYS *quit', 'GET myexit', 'quitting', 'exitcode']) {
      const leave = vi.fn();
      const run = vi.fn(async () => answered(['(nil)']));

      await runRedisLine(shellEnv({ leave, run }), typed, CONNECTION);

      // A key whose name happens to end in `exit` is a key, and dropping the player's
      // connection because they asked for it would be the prompt reading their mail.
      expect(leave, typed).not.toHaveBeenCalled();
      expect(run, typed).toHaveBeenCalled();
    }
  });

  it('says nothing back to a bare Enter, and stays where it is', async () => {
    const leave = vi.fn();
    const run = vi.fn();

    const result = await runRedisLine(shellEnv({ leave, run }), '   ', CONNECTION);

    expect(sync(result).lines).toEqual([]);
    expect(leave).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});

describe('what the prompt answers for itself', () => {
  it('lists the verbs it accepts without asking the store', async () => {
    const run = vi.fn();

    const result = await runRedisLine(shellEnv({ run }), 'help', CONNECTION);

    const listed = linesOf(result);
    expect(listed).toContain('KEYS');
    expect(listed).toContain('GET');
    expect(listed).toContain('DBSIZE');
    expect(listed).toContain('exit');
    expect(run).not.toHaveBeenCalled();
  });

  it('does not take a line that merely CONTAINS help as the verb list', async () => {
    for (const typed of ['GET conf:help', 'helpme']) {
      const run = vi.fn(async () => answered(['(nil)']));

      await runRedisLine(shellEnv({ run }), typed, CONNECTION);

      expect(run, typed).toHaveBeenCalled();
    }
  });

  it('draws the verb list as ordinary output, not as a failure', async () => {
    const result = await runRedisLine(shellEnv(), 'help', CONNECTION);

    expect(sync(result).lines.every((line) => line.kind === 'text')).toBe(true);
    expect(sync(result).exitCode).toBe(0);
  });

  /** Every synopsis the list is expected to carry, longest-first where one could be
   *  read as the start of another. Named once, because two tests below both need to
   *  find where a row's verb ends and its description begins. */
  const VERB_SYNOPSES = [
    'AUTH <password>',
    'KEYS [pattern]',
    'GET <key>',
    'SET <key> <value>',
    'DEL <key>',
    'DBSIZE',
    'exit / quit',
  ];

  it('says what each verb it lists is for, not merely that it exists', async () => {
    const listed = linesOf(await runRedisLine(shellEnv(), 'help', CONNECTION));

    // A synopsis with nothing beside it is a word the player still has to guess at.
    const rows = listed.split('\n').slice(1);
    const described = rows.map((row) =>
      row
        .trim()
        .replace(
          /^(AUTH <password>|KEYS \[pattern\]|GET <key>|SET <key> <value>|DEL <key>|DBSIZE|exit \/ quit)\s*/,
          '',
        ),
    );

    expect(rows).toHaveLength(7);
    // Each row led with one of the five synopses above — the replace found it — and
    // what remains is a sentence rather than the rest of an unrecognised row.
    expect(described.every((description) => description.split(' ').length >= 3)).toBe(true);
  });

  it('lists the verbs that change a store, now that the store takes them', async () => {
    const listed = linesOf(await runRedisLine(shellEnv(), 'help', CONNECTION));

    // A list is a promise, and it is now one the door keeps: a player who reads SET
    // here can type it. It was deliberately absent while the store could only be read.
    expect(listed).toContain('SET <key> <value>');
    expect(listed).toContain('DEL <key>');
  });

  it('states the quoting rule where a player will need it', async () => {
    const listed = linesOf(await runRedisLine(shellEnv(), 'help', CONNECTION));

    // The half of SET's syntax a player cannot guess. A row promising a bare
    // multi-word value would contradict the door, which refuses one — the two sides of
    // one rule, where each is defensible alone and only the pair is wrong.
    const setRow = listed.split('\n').find((line) => line.includes('SET <key> <value>')) ?? '';
    expect(setRow.toLowerCase()).toContain('quot');
  });

  it('starts every description in one column, however long the longest verb has become', async () => {
    const listed = linesOf(await runRedisLine(shellEnv(), 'help', CONNECTION));
    const rows = listed.split('\n').slice(1);

    // Deliberately not measured by looking for a run of spaces: the longest synopsis
    // has exactly ONE space after it, so a rule like that reports the widest row as
    // ragged when it is the row every other row is padded to match. The column is where
    // a description begins once its own verb and the padding behind it are taken off.
    const columnOf = (row: string): number => {
      const synopsis = VERB_SYNOPSES.find((candidate) => row.trimStart().startsWith(candidate));
      const afterVerb = row.indexOf(synopsis ?? '') + (synopsis ?? '').length;
      const padded = row.slice(afterVerb);
      return afterVerb + (padded.length - padded.trimStart().length);
    };

    expect(rows.every((row) => VERB_SYNOPSES.some((verb) => row.trimStart().startsWith(verb)))).toBe(
      true,
    );
    expect(new Set(rows.map(columnOf)).size).toBe(1);
  });
});

describe('everything else, which is the store to answer', () => {
  it('sends the line exactly as typed, with the whole held connection', async () => {
    const run = vi.fn(async () => answered(['(integer) 12']));

    await runRedisLine(shellEnv({ run }), '  KEYS sess:*  ', CONNECTION);

    // Verbatim, spacing and all: the server parses it, so trimming here would be this
    // client deciding what the daemon was asked.
    expect(run).toHaveBeenCalledWith({ ...CONNECTION, statement: '  KEYS sess:*  ' });
  });

  it('prints what came back, and calls a failure a failure', async () => {
    const failing = await runRedisLine(
      shellEnv({ run: async () => answered(['(error) ERR unknown command \'ls\''], true) }),
      'ls',
      CONNECTION,
    );

    expect(sync(failing).lines).toEqual([
      { kind: 'error', content: "(error) ERR unknown command 'ls'" },
    ]);
    expect(sync(failing).exitCode).toBe(1);
  });

  it('prints an answer as ordinary text, one line per line', async () => {
    const listed = await runRedisLine(
      shellEnv({ run: async () => answered(['1) "sess:aa"', '2) "sess:bb"']) }),
      'KEYS *',
      CONNECTION,
    );

    expect(sync(listed).lines).toEqual([
      { kind: 'text', content: '1) "sess:aa"' },
      { kind: 'text', content: '2) "sess:bb"' },
    ]);
    expect(sync(listed).exitCode).toBe(0);
  });

  it('does not recognise its own verbs — even KEYS makes the trip', async () => {
    const run = vi.fn(async () => answered(['(empty list or set)']));

    await runRedisLine(shellEnv({ run }), 'DBSIZE', CONNECTION);

    // The whole eviction mechanism rests on this. A client that answered DBSIZE from
    // memory would leave a player typing at a box that stopped answering an hour ago.
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('a store that stopped answering', () => {
  it('closes the prompt on the next statement and says the connection went', async () => {
    const leave = vi.fn();

    const result = await runRedisLine(
      shellEnv({ leave, run: async () => ({ kind: 'lost' }) }),
      'KEYS *',
      CONNECTION,
    );

    expect(leave).toHaveBeenCalled();
    expect(sync(result).lines).toEqual([
      { kind: 'error', content: 'Error: Server closed the connection' },
    ]);
    expect(sync(result).exitCode).toBe(1);
  });

  it('prints no farewell when the box is what left', async () => {
    const result = await runRedisLine(
      shellEnv({ run: async () => ({ kind: 'lost' }) }),
      'KEYS *',
      CONNECTION,
    );

    // A quit is the player leaving; this is the box leaving. Saying goodbye for it
    // would read as though they had chosen to go.
    expect(linesOf(result)).not.toContain('Bye');
  });
});

/**
 * Holding what the store let you in with.
 *
 * There is no session row anywhere, so being past a store's lock is not a state the
 * server keeps — it is a password that rides on every statement. The prompt is the only
 * thing that remembers it, and it learns it the same way the player does: by sending an
 * `AUTH` and being told the daemon accepted it. It never judges one itself.
 */
describe('holding a store secret', () => {
  const LOCKED = { ...CONNECTION, password: 'sunshine' } as const;

  it('sends the password it is holding with every statement', async () => {
    const run = vi.fn(async () => answered(['(integer) 2']));

    await runRedisLine(shellEnv({ run }), 'DBSIZE', LOCKED);

    // Re-sent rather than remembered: a store whose secret changed under this
    // connection refuses the very next line, which is the whole eviction mechanism.
    expect(run).toHaveBeenCalledWith({ ...LOCKED, statement: 'DBSIZE' });
  });

  it('holds the password once the daemon accepts an AUTH', async () => {
    const enter = vi.fn();
    const run = vi.fn(async () => answered(['OK']));

    await runRedisLine(shellEnv({ enter, run }), 'AUTH sunshine', CONNECTION);

    // The line still made the trip and the box still judged it. What the client adds is
    // remembering what was accepted.
    expect(run).toHaveBeenCalledWith({ ...CONNECTION, statement: 'AUTH sunshine' });
    expect(enter).toHaveBeenCalledWith({ ...CONNECTION, password: 'sunshine' });
  });

  it('holds nothing when the daemon refused the password', async () => {
    const enter = vi.fn();
    const run = vi.fn(async () => answered(['(error) ERR invalid password'], true));

    const result = await runRedisLine(shellEnv({ enter, run }), 'AUTH guesswork', CONNECTION);

    expect(linesOf(result)).toBe('(error) ERR invalid password');
    expect(enter).not.toHaveBeenCalled();
  });

  it('holds nothing when the box is gone, however the line was spelled', async () => {
    const enter = vi.fn();
    const leave = vi.fn();
    const run = vi.fn(async (): Promise<RedisStatementResult> => ({ kind: 'lost' }));

    await runRedisLine(shellEnv({ enter, leave, run }), 'AUTH sunshine', CONNECTION);

    // A daemon that died mid-connection must not leave the prompt believing it is in.
    expect(enter).not.toHaveBeenCalled();
    expect(leave).toHaveBeenCalled();
  });

  it('replaces the password it was already holding when a second AUTH is accepted', async () => {
    const enter = vi.fn();
    const run = vi.fn(async () => answered(['OK']));

    await runRedisLine(shellEnv({ enter, run }), 'AUTH moonlight', LOCKED);

    expect(enter).toHaveBeenCalledWith({ ...LOCKED, password: 'moonlight' });
  });

  it('takes the verb in any case, and holds nothing for a line that only looks like one', async () => {
    const enter = vi.fn();
    const run = vi.fn(async () => answered(['OK']));
    const env = shellEnv({ enter, run });

    await runRedisLine(env, 'auth sunshine', CONNECTION);
    expect(enter).toHaveBeenCalledWith({ ...CONNECTION, password: 'sunshine' });

    enter.mockClear();
    // Not an AUTH the daemon could have accepted — whatever it answered, there is no
    // one password here to hold.
    for (const typed of ['AUTH', 'AUTHOR sunshine', 'GET AUTH']) {
      await runRedisLine(env, typed, CONNECTION);
      expect(enter, typed).not.toHaveBeenCalled();
    }
  });

  it('holds nothing for a line that merely CONTAINS an AUTH', async () => {
    const enter = vi.fn();
    const run = vi.fn(async () => answered(['OK']));
    const env = shellEnv({ enter, run });

    // Both ends of the anchor. A key whose name ends in `auth`, a verb that merely
    // starts with it, and a line the daemon answered OK for some other reason must none
    // of them leave this prompt believing it holds a password it never sent.
    for (const typed of ['GET conf:auth sunshine', 'XAUTH sunshine', 'GET AUTH sunshine']) {
      await runRedisLine(env, typed, CONNECTION);
      expect(enter, typed).not.toHaveBeenCalled();
    }
  });

  it('holds the password however the AUTH was spaced', async () => {
    const enter = vi.fn();
    const run = vi.fn(async () => answered(['OK']));

    // The daemon splits on whitespace and does not care how much of it there was, so a
    // prompt that only recognised a single space would drop a password the store had
    // just accepted.
    await runRedisLine(shellEnv({ enter, run }), 'AUTH   sunshine', CONNECTION);

    expect(enter).toHaveBeenCalledWith({ ...CONNECTION, password: 'sunshine' });
  });

  it('lists AUTH among the verbs it will carry', async () => {
    const result = await runRedisLine(shellEnv(), 'help', CONNECTION);

    expect(linesOf(result)).toContain('AUTH <password>');
  });
});


/**
 * Statements against the store on your OWN box.
 *
 * The prompt is the same prompt; what is behind it is decided here rather than over the
 * wire. Every answer comes from the same `runStatement` and the same log formatters the
 * server-side door uses, so the two vantages cannot drift on what a verb does, what
 * `NOAUTH` refuses, or which verbs leave a line.
 *
 * Everything is re-read per statement, and re-read from the MACHINE. A datadir edited in
 * another tab and a daemon stopped mid-prompt both bite on the next line — but so does a
 * key an occupant of this WiFi set a moment ago, and that one is the reason the reload
 * exists. Re-reading this client's own copy would answer the first two and quietly
 * overwrite the third.
 */
describe('the store on your own box', () => {
  const PUBKEY = 'a'.repeat(64);
  const ESSID = 'BEAN-THERE-WIFI';
  const CONFIG = { machineName: 'workstation', username: 'alice', rootPassword: 'hunter2' };
  const OWN_IP = assignHomeNetwork(PUBKEY, ESSID).localIp;

  /** The server door, deliberately unreachable. A statement against your own box that
   *  took the cross-network path would throw here rather than quietly pass. */
  const NOT_WIRED = () => {
    throw new Error('own-box redis statements must not reach the server');
  };

  /** One captured `patches.write`, with the owner the DAEMON stamped on it — which is
   *  the half of a write that says whose file it is once it lands. */
  type Write = {
    readonly path: string;
    readonly content: string | null;
    readonly owner?: string;
  };

  const onlineConnectivity = (): ConnectivityState => {
    const cold = buildColdStartConnectivity(PUBKEY);
    const wlan0 = cold.interfaces.get('wlan0');
    if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0');
    return {
      interfaces: new Map(cold.interfaces).set('wlan0', {
        ...wlan0,
        association: { essid: ESSID, bssid: 'AA:BB:CC:DD:EE:FF' },
        ipv4: OWN_IP,
      }),
    };
  };

  const BASE = buildWorkstationBaseFs(asPlayerKeyHex(PUBKEY), CONFIG);
  const STORE = ownStore({ ownerKeyHex: PUBKEY, hostname: CONFIG.machineName, fs: BASE });

  const boxWith = (store: unknown, port: number = SERVICE_CATALOG.redis.defaultPort): Directory =>
    applyPatches(BASE, [
      {
        path: DATADIR_PATH,
        content: store === null ? null : JSON.stringify(store),
        owner: DATADIR_OWNER,
        permissions: DATADIR_FILE,
      },
      {
        path: pidfilePath(SERVICE_CATALOG.redis),
        content: formatPidfileContent(SERVICE_CATALOG.redis, port),
        owner: 'root',
        permissions: PIDFILE_PERMISSIONS,
      },
    ]);

  const RUNNING = boxWith(STORE);

  /** A box whose machine has moved on from the copy this client walked in with — which
   *  is the ordinary state of a box somebody else can also write to. */
  const box = (held: Directory, machine: Directory = held) => {
    const of = (tree: Directory) =>
      mockFsViewFromTree(tree, { userType: 'root', cwd: () => asAbsPath('/') });
    return {
      cwd: () => asAbsPath('/'),
      read: (path: AbsPath) => of(held).read(path),
      list: (path: AbsPath) => of(held).list(path),
      stat: (path: AbsPath) => of(held).stat(path),
      canWrite: (path: AbsPath) => of(held).canWrite(path),
      root: () => held,
      reload: async () => of(machine),
    } satisfies FsView;
  };

  const ownEnv = (fs: FsView) => {
    const writes: Write[] = [];
    const env = mockCommandEnv({
      redis: mockRedisApi({ run: NOT_WIRED }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity()),
      hostname: CONFIG.machineName,
      fs,
      patches: {
        write: async (path, content, options) => {
          writes.push({ path, content, ...(options?.owner === undefined ? {} : { owner: options.owner }) });
          return { ok: true };
        },
        mkdir: async () => ({ ok: true }),
        setDirectoryPermissions: async () => ({ ok: true }),
        remove: async () => ({ ok: true }),
      },
    });
    return { env, writes };
  };

  /** The connection the prompt holds after `redis-cli 127.0.0.1` — its own box under the
   *  address it was leased, reached from loopback. */
  const OWN: RedisConnection = {
    essid: ESSID,
    targetIp: OWN_IP,
    port: SERVICE_CATALOG.redis.defaultPort,
    sourceIp: '127.0.0.1',
  };

  const datadirWrite = (writes: readonly Write[]) =>
    writes.find((write) => write.path === DATADIR_PATH);

  const logWrites = (writes: readonly Write[]) =>
    writes.filter((write) => write.path === REDIS_LOG_PATH);

  it('refuses every statement until the box own root password is given', async () => {
    // The lock is the password they chose for the box, so there is nothing to look up —
    // but the store still refuses first, exactly as a stranger's does.
    const { env } = ownEnv(box(RUNNING));

    const result = await runRedisLine(env, 'KEYS *', OWN);

    expect(linesOf(result)).toContain('NOAUTH Authentication required.');
    expect(sync(result).exitCode).toBe(1);
  });

  it('opens to the root password the player chose for the box', async () => {
    const { env, writes } = ownEnv(box(RUNNING));

    const result = await runRedisLine(env, `AUTH ${CONFIG.rootPassword}`, OWN);

    expect(sync(result).exitCode).toBe(0);
    // The attempt lands on the box's own log, accepted as an intruder's would be.
    expect(logWrites(writes).at(-1)?.content).toContain('authenticated successfully');
  });

  it('answers a read from the store, and leaves no line behind for it', async () => {
    // Reads are how a defender's own log stays a record of CHANGES. A `KEYS` that wrote
    // a line would bury an intruder's `SET` under the owner's own browsing.
    const { env, writes } = ownEnv(box(RUNNING));

    const result = await runRedisLine(env, 'DBSIZE', { ...OWN, password: CONFIG.rootPassword });

    expect(linesOf(result)).toContain(`${Object.keys(STORE.keys).length}`);
    expect(logWrites(writes)).toEqual([]);
    expect(datadirWrite(writes)).toBeUndefined();
  });

  it('writes a SET back as the DAEMON, whatever tier the shell is sitting at', async () => {
    // The datadir is root's file because redis runs as root. A rewrite inheriting the
    // shell's owner would hand the box's ordinary user the hash a sweep is meant to
    // have to work for.
    const { env, writes } = ownEnv(box(RUNNING));

    await runRedisLine(env, 'SET site:banner hello', { ...OWN, password: CONFIG.rootPassword });

    const written = datadirWrite(writes);
    expect(written?.owner).toBe(DATADIR_OWNER);
    expect(storeIn(applyPatches(RUNNING, [
      {
        path: DATADIR_PATH,
        content: written?.content ?? '',
        owner: DATADIR_OWNER,
        permissions: DATADIR_FILE,
      },
    ]))?.keys['site:banner']).toBe('hello');
    expect(logWrites(writes).at(-1)?.content).toContain('site:banner');
  });

  it('answers from the MACHINE, so a key an occupant set is already there', async () => {
    // Somebody else on this WiFi reached the daemon and set a key. Nothing pushed that
    // to this client, and the copy it is holding has never seen it.
    const theirs = { ...STORE, keys: { ...STORE.keys, 'their:key': 'their value' } };
    const { env } = ownEnv(box(RUNNING, boxWith(theirs)));

    const result = await runRedisLine(env, 'GET their:key', {
      ...OWN,
      password: CONFIG.rootPassword,
    });

    expect(linesOf(result)).toContain('their value');
  });

  it('does not REVERT an occupant write by composing the owner own SET from a stale copy', async () => {
    // The sharpest form of it: the owner's routine use of their own box must not erase
    // an intruder's edit. Composing the new store from what this client walked in
    // holding would write their key back out of existence with nothing on screen to say
    // so — the defender would be looking for evidence their own prompt deleted.
    const theirs = { ...STORE, keys: { ...STORE.keys, 'their:key': 'their value' } };
    const { env, writes } = ownEnv(box(RUNNING, boxWith(theirs)));

    await runRedisLine(env, 'SET mine:key mine', { ...OWN, password: CONFIG.rootPassword });

    const written = storeIn(applyPatches(RUNNING, [
      {
        path: DATADIR_PATH,
        content: datadirWrite(writes)?.content ?? '',
        owner: DATADIR_OWNER,
        permissions: DATADIR_FILE,
      },
    ]));
    expect(written?.keys['mine:key']).toBe('mine');
    expect(written?.keys['their:key']).toBe('their value');
  });

  it('drops the prompt when the store it changed could not be written back', async () => {
    // A write that could not be recorded is a write that did not happen. Answering OK
    // over one that never landed would show the player their old keys on the next line.
    const leave = vi.fn();
    const env = mockCommandEnv({
      redis: mockRedisApi({ run: NOT_WIRED, leave }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity()),
      hostname: CONFIG.machineName,
      fs: box(RUNNING),
      patches: {
        write: async (path) =>
          path === DATADIR_PATH ? { ok: false, error: 'network_error' } : { ok: true },
        mkdir: async () => ({ ok: true }),
        setDirectoryPermissions: async () => ({ ok: true }),
        remove: async () => ({ ok: true }),
      },
    });

    const result = await runRedisLine(env, 'SET mine:key mine', {
      ...OWN,
      password: CONFIG.rootPassword,
    });

    expect(leave).toHaveBeenCalled();
    expect(sync(result).exitCode).toBe(1);
  });

  it('drops the prompt when the daemon was stopped between two statements', async () => {
    const leave = vi.fn();
    const stopped = applyPatches(RUNNING, [
      {
        path: pidfilePath(SERVICE_CATALOG.redis),
        content: null,
        owner: 'root',
        permissions: PIDFILE_PERMISSIONS,
      },
    ]);
    const { env } = ownEnv(box(RUNNING, stopped));
    const evicting = mockCommandEnv({ ...env, redis: mockRedisApi({ run: NOT_WIRED, leave }) });

    const result = await runRedisLine(evicting, 'DBSIZE', {
      ...OWN,
      password: CONFIG.rootPassword,
    });

    expect(leave).toHaveBeenCalled();
    expect(sync(result).exitCode).toBe(1);
  });

  it('drops the prompt when root deleted the datadir between two statements', async () => {
    // Root's own file on root's own box: between two statements they can delete it,
    // truncate it, or paste something into it that is not a store.
    const leave = vi.fn();
    const { env } = ownEnv(box(RUNNING, boxWith(null)));
    const evicting = mockCommandEnv({ ...env, redis: mockRedisApi({ run: NOT_WIRED, leave }) });

    const result = await runRedisLine(evicting, 'DBSIZE', {
      ...OWN,
      password: CONFIG.rootPassword,
    });

    expect(leave).toHaveBeenCalled();
    expect(sync(result).exitCode).toBe(1);
  });
});
