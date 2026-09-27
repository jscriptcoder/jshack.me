/**
 * head — print the first lines of a file or of piped input.
 *
 * Behavior:
 * - Prints the first 10 lines, or the first N with `-n N`. Input shorter than
 *   that prints whole.
 * - Reads one file, or the piped input when no file is named. A line is a line
 *   as `cat` shows it: the newline that ends a file does not start another one.
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
    return refuse(`head: invalid number of lines: '${countFlag}'`);
  }
  const count = typeof countFlag === 'string' ? Number(countFlag) : DEFAULT_LINE_COUNT;
  const source = await readFileOrStdin(env, args, 'head');
  if (!source.ok) return refuse(source.error);
  return {
    kind: 'sync',
    lines: source.lines.slice(0, count).map((line) => ({ kind: 'text', content: line })),
    exitCode: 0,
  };
};

export const head: Command = {
  name: 'head',
  description: 'Print the first lines of a file',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  flags: { '-n': 'string' },
  manual: {
    synopsis: 'head [-n N] [file]',
    description:
      'Print the first 10 lines of a file, or the first N with -n. With no file, read the piped input. Input shorter than that prints whole.',
    arguments: [
      { name: '-n N', description: 'Print the first N lines instead of 10' },
      { name: 'file', description: 'The one file to read; with none, read the piped input' },
    ],
    examples: [
      { command: 'head -n 2 /etc/passwd', description: 'Show the first two accounts' },
      {
        command: 'grep Accepted /var/log/auth.log | head -n 1',
        description: 'Show the earliest login that got in',
      },
    ],
  },
  execute,
};
