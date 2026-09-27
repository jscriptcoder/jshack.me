/**
 * tail — print the last lines of a file or of piped input.
 *
 * Behavior:
 * - Prints the last 10 lines, or the last N with `-n N`. Input shorter than
 *   that prints whole.
 * - Reads one file, or the piped input when no file is named. A line is a line
 *   as `cat` shows it: the newline that ends a file does not start another one.
 * - There is no `-f`: nothing in the game appends to a log while you watch.
 *
 * Exit codes:
 *   0 — printed
 *   1 — a bad `-n`, a missing or extra operand, or a file that cannot be read
 */

import type { Command, CommandEnv, CommandResult } from './types.js';
import { readFileOrStdin } from './contentHelpers.js';

const DEFAULT_LINE_COUNT = 10;

/** Digits only: `Number()` would also take `-1`, `1e3` and `0x10`. */
const WHOLE_NUMBER = /^\d+$/;

const refuse = (error: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: error }],
  exitCode: 1,
});

const execute = async (
  env: CommandEnv,
  args: readonly string[],
  flags: ReadonlyMap<string, string | true>,
): Promise<CommandResult> => {
  const countFlag = flags.get('-n');
  if (typeof countFlag === 'string' && !WHOLE_NUMBER.test(countFlag)) {
    return refuse(`tail: invalid number of lines: '${countFlag}'`);
  }
  const count = typeof countFlag === 'string' ? Number(countFlag) : DEFAULT_LINE_COUNT;
  const source = await readFileOrStdin(env, args, 'tail');
  if (!source.ok) return refuse(source.error);
  // `slice(-0)` is the whole array, so zero lines needs its own answer.
  const kept = count === 0 ? [] : source.lines.slice(-count);
  return {
    kind: 'sync',
    lines: kept.map((line) => ({ kind: 'text', content: line })),
    exitCode: 0,
  };
};

export const tail: Command = {
  name: 'tail',
  description: 'Print the last lines of a file',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  flags: { '-n': 'string' },
  manual: {
    synopsis: 'tail [-n N] [file]',
    description:
      'Print the last 10 lines of a file, or the last N with -n. With no file, read the piped input. Input shorter than that prints whole.',
    arguments: [
      { name: '-n N', description: 'Print the last N lines instead of 10' },
      { name: 'file', description: 'The one file to read; with none, read the piped input' },
    ],
    examples: [
      { command: 'tail /var/log/auth.log', description: 'Show the last 10 lines of the auth log' },
      {
        command: 'grep Failed /var/log/auth.log | tail -n 5',
        description: 'Show the five most recent failed logins',
      },
    ],
  },
  execute,
};
