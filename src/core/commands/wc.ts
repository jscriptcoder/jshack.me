/**
 * wc — count the lines and words of a file or of piped input.
 *
 * Behavior:
 * - `-l` prints the line count, `-w` the word count; neither, or both, prints
 *   lines then words. There is no byte count, so the columns are always lines
 *   first — not GNU's lines, words, bytes.
 * - A named file's name follows the counts; piped input prints the bare counts.
 * - Reads one file, or the piped input when no file is named. A line is a line
 *   as `cat` shows it, so `a\nb\n` is 2 lines; a word is a run of anything but
 *   whitespace.
 *
 * Exit codes:
 *   0 — counted
 *   1 — a missing or extra operand, or a file that cannot be read
 */

import type { Command, CommandEnv, CommandResult } from './types';
import { readFileOrStdin } from './contentHelpers';

const countWords = (lines: readonly string[]): number =>
  lines.reduce(
    (total, line) => total + line.split(/\s+/).filter((word) => word !== '').length,
    0,
  );

const execute = async (
  env: CommandEnv,
  args: readonly string[],
  flags: ReadonlyMap<string, string | true>,
): Promise<CommandResult> => {
  const source = await readFileOrStdin(env, args, 'wc');
  if (!source.ok) {
    return { kind: 'sync', lines: [{ kind: 'error', content: source.error }], exitCode: 1 };
  }
  const wantsLines = flags.get('-l') === true;
  const wantsWords = flags.get('-w') === true;
  const neither = !wantsLines && !wantsWords;
  const [file] = args;
  const columns = [
    ...(wantsLines || neither ? [String(source.lines.length)] : []),
    ...(wantsWords || neither ? [String(countWords(source.lines))] : []),
    ...(file === undefined ? [] : [file]),
  ];
  return { kind: 'sync', lines: [{ kind: 'text', content: columns.join(' ') }], exitCode: 0 };
};

export const wc: Command = {
  name: 'wc',
  description: 'Count the lines and words of a file',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  flags: { '-l': 'boolean', '-w': 'boolean' },
  stacking: true,
  manual: {
    synopsis: 'wc [-lw] [file]',
    description:
      'Count the lines and words of a file. With no flag, print the line count then the word count — there is no byte column. With no file, count the piped input and print the bare numbers.',
    arguments: [
      { name: '-l', description: 'Print only the line count' },
      { name: '-w', description: 'Print only the word count' },
      { name: 'file', description: 'The one file to count; with none, count the piped input' },
    ],
    examples: [
      { command: 'wc /etc/passwd', description: 'Count the lines and words of the password file' },
      {
        command: 'grep Accepted /var/log/auth.log | wc -l',
        description: 'Count the logins that got in',
      },
    ],
  },
  execute,
};
