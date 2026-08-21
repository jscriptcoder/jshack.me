import { describe, expect, it, vi } from 'vitest';
import { runMysqlLine } from './mysqlShell';
import { mockCommandEnv, mockMysqlApi } from '../../test/factories/commandEnv';
import type { CommandResult, MysqlApi } from './types';

/**
 * The `mysql>` prompt. Two claims live here and they pull in opposite directions:
 * a line typed at this prompt must never reach the outer shell, and the player
 * must always be able to get back out to it.
 */

const shellEnv = (over: Partial<MysqlApi> = {}) =>
  mockCommandEnv({ mysql: mockMysqlApi(over) });

const sync = (result: CommandResult) => {
  if (result.kind !== 'sync') throw new Error('expected a sync result');
  return result;
};

const linesOf = (result: CommandResult): string =>
  sync(result)
    .lines.map((line) => line.content)
    .join('\n');

describe('the mysql sub-shell', () => {
  it('hands the terminal back on quit', async () => {
    const leave = vi.fn();

    const result = await runMysqlLine(shellEnv({ leave }), 'quit');

    expect(leave).toHaveBeenCalled();
    expect(linesOf(result)).toBe('Bye');
    expect(sync(result).exitCode).toBe(0);
  });

  it('takes exit as the same word, in any case and with or without a semicolon', async () => {
    // Parsed AHEAD of any verb table, which is why these need no semicolon and can
    // never come back as unsupported syntax. A player who has to guess the exact
    // spelling of the way out is trapped at a prompt that reaches nothing.
    for (const typed of ['exit', 'EXIT', 'quit;', 'Quit ;', '  exit  ']) {
      const leave = vi.fn();

      const result = await runMysqlLine(shellEnv({ leave }), typed);

      expect(leave, typed).toHaveBeenCalled();
      expect(linesOf(result), typed).toBe('Bye');
    }
  });

  it('refuses an outer shell command instead of running it', async () => {
    const leave = vi.fn();

    const result = await runMysqlLine(shellEnv({ leave }), 'cat /etc/passwd');

    // The whole point of the sub-shell. `cat` here would read the box the player is
    // STANDING on while they believe they are addressing the database — and this
    // door reaches no filesystem at all, so there is no reading to be done either way.
    expect(linesOf(result)).toBe(
      'ERROR: Unsupported SQL syntax. This MySQL instance supports basic queries only.',
    );
    expect(sync(result).exitCode).toBe(1);
    // A refusal that also dropped the connection would turn every typo into a logout.
    expect(leave).not.toHaveBeenCalled();
  });

  it('says nothing back to a bare Enter', async () => {
    const leave = vi.fn();

    const result = await runMysqlLine(shellEnv({ leave }), '   ');

    // Not a mistake, so not an error — and emphatically not a way out.
    expect(sync(result).lines).toEqual([]);
    expect(sync(result).exitCode).toBe(0);
    expect(leave).not.toHaveBeenCalled();
  });
});
