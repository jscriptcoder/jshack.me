import { describe, expect, it, vi } from 'vitest';
import { runMysqlLine } from './mysqlShell';
import { mockCommandEnv, mockMysqlApi } from '../../test/factories/commandEnv';
import type { CommandResult, MysqlApi, MysqlStatementResult } from './types';

/**
 * The `mysql>` prompt. Three claims live here and they pull against each other:
 * a line typed at this prompt must never reach the outer shell, the player must
 * always be able to get back out to it, and everything else is the database's to
 * answer rather than this client's to guess at.
 *
 * The last of those is why so little is decided locally. `exit`, `quit` and `help`
 * are handled here because none of them needs a database; every other line is sent,
 * because only the server can see whether the table exists, whether the account may
 * read it, and whether the daemon is still running.
 */

const CONNECTION = {
  essid: 'BEAN-THERE-WIFI',
  targetIp: '192.168.1.31',
  username: 'app_rw',
  password: 'hunter-two',
  sourceIp: '192.168.1.50',
} as const;

const answered = (output: readonly string[], failed = false): MysqlStatementResult => ({
  kind: 'answered',
  output,
  failed,
});

const shellEnv = (over: Partial<MysqlApi> = {}) => mockCommandEnv({ mysql: mockMysqlApi(over) });

const sync = (result: CommandResult) => {
  if (result.kind !== 'sync') throw new Error('expected a sync result');
  return result;
};

const linesOf = (result: CommandResult): string =>
  sync(result)
    .lines.map((line) => line.content)
    .join('\n');

describe('leaving the mysql sub-shell', () => {
  it('hands the terminal back on quit, without asking the database', async () => {
    const leave = vi.fn();
    const run = vi.fn();

    const result = await runMysqlLine(shellEnv({ leave, run }), 'quit', CONNECTION);

    expect(leave).toHaveBeenCalled();
    expect(linesOf(result)).toBe('Bye');
    expect(sync(result).exitCode).toBe(0);
    // The way out belongs to the client. A player whose box has gone dark must still
    // be able to get back to their shell.
    expect(run).not.toHaveBeenCalled();
  });

  it('takes exit as the same word, in any case and with or without a semicolon', async () => {
    // Parsed AHEAD of any verb table, which is why these need no semicolon and can
    // never come back as unsupported syntax. A player who has to guess the exact
    // spelling of the way out is trapped at a prompt that reaches nothing.
    for (const typed of ['exit', 'EXIT', 'quit;', 'Quit ;', '  exit  ']) {
      const leave = vi.fn();

      const result = await runMysqlLine(shellEnv({ leave }), typed, CONNECTION);

      expect(leave, typed).toHaveBeenCalled();
      expect(linesOf(result), typed).toBe('Bye');
    }
  });

  it('says nothing back to a bare Enter', async () => {
    const leave = vi.fn();
    const run = vi.fn();

    const result = await runMysqlLine(shellEnv({ leave, run }), '   ', CONNECTION);

    // Not a mistake, so not an error — emphatically not a way out, and not worth a
    // round trip either.
    expect(sync(result).lines).toEqual([]);
    expect(sync(result).exitCode).toBe(0);
    expect(leave).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});

describe('asking the database', () => {
  it('sends the statement with the whole held credential and prints what comes back', async () => {
    // The credential travels with every statement because no session row holds it.
    // A prompt that sent only the statement would be relying on a server-side
    // session that decision 8 deliberately never created.
    const run = vi.fn<MysqlApi['run']>(async () =>
      answered(['+----+', '| id |', '+----+', '1 row in set (0.00 sec)']),
    );

    const result = await runMysqlLine(shellEnv({ run }), 'SELECT id FROM users;', CONNECTION);

    expect(run).toHaveBeenCalledWith({ ...CONNECTION, statement: 'SELECT id FROM users;' });
    expect(linesOf(result)).toBe('+----+\n| id |\n+----+\n1 row in set (0.00 sec)');
    expect(sync(result).exitCode).toBe(0);
  });

  it('sends an outer shell command as SQL rather than running it', async () => {
    // The whole point of the sub-shell. `cat` here would read the box the player is
    // STANDING on while they believe they are addressing the database — and this
    // door reaches no filesystem at all, so there is nothing to read either way.
    const leave = vi.fn();
    const run = vi.fn<MysqlApi['run']>(async () =>
      answered(['ERROR: Unsupported SQL syntax. This MySQL instance supports basic queries only.'], true),
    );

    const result = await runMysqlLine(shellEnv({ leave, run }), 'cat /etc/passwd', CONNECTION);

    expect(run).toHaveBeenCalledWith({ ...CONNECTION, statement: 'cat /etc/passwd' });
    expect(linesOf(result)).toContain('Unsupported SQL syntax');
    // A refusal that also dropped the connection would turn every typo into a logout.
    expect(leave).not.toHaveBeenCalled();
  });

  it('renders a refused statement in the error colour and exits non-zero', async () => {
    const run = vi.fn<MysqlApi['run']>(async () =>
      answered(["ERROR 1142 (42000): DROP command denied to user 'app_rw'@'192.168.1.50'"], true),
    );

    const result = await runMysqlLine(shellEnv({ run }), 'DROP TABLE users', CONNECTION);

    expect(sync(result).lines.map((line) => line.kind)).toEqual(['error']);
    expect(sync(result).exitCode).toBe(1);
  });

  it('never sends the lines it can answer itself', async () => {
    const run = vi.fn();

    await runMysqlLine(shellEnv({ run }), 'help', CONNECTION);

    expect(run).not.toHaveBeenCalled();
  });
});

describe('when the connection is gone', () => {
  it('says the connection was lost, closes the prompt, and does not say Bye', async () => {
    // There is no push channel and no session row to invalidate, so a daemon stopped
    // mid-session can only be discovered by the next statement. Closing the prompt is
    // the honest response: one that answered every statement with the same error
    // would strand the player at a prompt that reaches nothing.
    const leave = vi.fn();
    const run = vi.fn<MysqlApi['run']>(async () => ({ kind: 'lost' }));

    const result = await runMysqlLine(shellEnv({ leave, run }), 'SHOW TABLES', CONNECTION);

    expect(linesOf(result)).toBe(
      'ERROR 2013 (HY000): Lost connection to MySQL server during query',
    );
    expect(sync(result).exitCode).toBe(1);
    expect(leave).toHaveBeenCalled();
    // An eviction is not a quit, and the difference is the whole signal.
    expect(linesOf(result)).not.toContain('Bye');
  });
});

describe('the help this door offers', () => {
  it('answers help with the verbs this door accepts, without leaving', async () => {
    const leave = vi.fn();

    const result = await runMysqlLine(shellEnv({ leave }), 'help', CONNECTION);

    const output = linesOf(result);
    expect(output.startsWith('Supported commands:')).toBe(true);
    // Every verb the parser accepts is named here, write verbs included. A door that
    // understands `UPDATE` and answers it with a permission denial does support it;
    // hiding it would send the player looking for a syntax they already have.
    for (const verb of [
      'SHOW TABLES',
      'DESCRIBE',
      'SELECT',
      'UPDATE',
      'DELETE',
      'DROP TABLE',
      'exit',
      'quit',
    ]) {
      expect(output, verb).toContain(verb);
    }
    expect(sync(result).exitCode).toBe(0);
    expect(leave).not.toHaveBeenCalled();
  });

  it('takes help in any case and with or without a semicolon', async () => {
    // Same rule as the way out: parsed ahead of the verb table, so a player who ends
    // it with a semicolon out of habit is not told their request was unsupported.
    for (const typed of ['help', 'HELP', 'help;', 'Help ;', '  help  ']) {
      const result = await runMysqlLine(shellEnv(), typed, CONNECTION);

      expect(linesOf(result), typed).toContain('Supported commands:');
      expect(sync(result).exitCode, typed).toBe(0);
    }
  });
});
