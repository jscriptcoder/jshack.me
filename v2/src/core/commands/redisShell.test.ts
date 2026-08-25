import { describe, expect, it, vi } from 'vitest';
import { runRedisLine } from './redisShell';
import { mockCommandEnv, mockRedisApi } from '../../test/factories/commandEnv';
import type { CommandResult, RedisApi, RedisStatementResult } from './types';

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

  it('says what each verb it lists is for, not merely that it exists', async () => {
    const listed = linesOf(await runRedisLine(shellEnv(), 'help', CONNECTION));

    // A synopsis with nothing beside it is a word the player still has to guess at.
    const rows = listed.split('\n').slice(1);
    const described = rows.map((row) =>
      row.trim().replace(/^(KEYS \[pattern\]|GET <key>|DBSIZE|exit \/ quit)\s*/, ''),
    );

    expect(rows).toHaveLength(4);
    // Each row led with one of the four synopses above — the replace found it — and
    // what remains is a sentence rather than the rest of an unrecognised row.
    expect(described.every((description) => description.split(' ').length >= 3)).toBe(true);
  });

  it('lists no verb the store cannot answer yet', async () => {
    const listed = linesOf(await runRedisLine(shellEnv(), 'help', CONNECTION));

    // A list is a promise. SET and DEL arrive with the slice that lands them, and a
    // player who reads them here goes hunting for a syntax that does not exist.
    expect(listed).not.toContain('SET');
    expect(listed).not.toContain('DEL');
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
