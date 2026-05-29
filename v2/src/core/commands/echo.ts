/**
 * echo — output positional arguments joined by single spaces, one line.
 *
 * Behavior:
 * - Joins all positional args with `' '` and emits exactly one text line.
 * - With no args, emits one empty line (real `echo`'s default).
 * - Empty-string positionals (from quoted `""`) are preserved, producing
 *   the expected adjacent spaces — `echo "a" "" "b"` → `a  b`.
 *
 * No flags yet. POSIX `echo -n` (suppress newline) and `-e` (interpret
 * escapes) are deferred until a player needs them.
 */

import type { Command, CommandEnv, CommandResult } from './types';

const execute = async (
  _env: CommandEnv,
  args: readonly string[],
  _flags: ReadonlyMap<string, string | true>,
): Promise<CommandResult> => {
  return {
    kind: 'sync',
    lines: [{ kind: 'text', content: args.join(' ') }],
    exitCode: 0,
  };
};

export const echo: Command = {
  name: 'echo',
  description: 'Output positional arguments joined by spaces',
  category: 'general',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'echo [arg...]',
    description:
      'Output each argument to stdout, joined by single spaces, followed by a newline. Empty positionals (from quoted "") are preserved.',
    arguments: [
      {
        name: 'arg',
        description: 'Text to print; multiple arguments are joined by single spaces',
      },
    ],
    examples: [
      { command: 'echo hello world', description: 'Print two words separated by a space' },
      { command: 'echo "hello world"', description: 'Print a single double-quoted argument' },
      { command: "echo 'with spaces'", description: 'Print a single-quoted argument verbatim' },
    ],
  },
  execute,
};
