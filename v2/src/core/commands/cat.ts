/**
 * cat — concatenate and print files.
 *
 * Behavior:
 * - With one or more file args, reads each and prints its content line by
 *   line. Errors per file are reported but do not abort subsequent args.
 * - With no args and a piped stdin, echoes stdin to output.
 * - With no args and no stdin, exits 1 with a usage hint.
 *
 * Exit codes:
 *   0 — every file read successfully
 *   1 — any file failed to read
 */

import type { Command, CommandEnv, CommandResult, TerminalLine } from './types';
import { resolveAbsPath } from '../filesystem/path';
import { formatReadError, toContentLines } from './fsReadHelpers';

const collectStdin = async (stdin: AsyncIterable<string>): Promise<readonly TerminalLine[]> => {
  const lines: TerminalLine[] = [];
  for await (const line of stdin) {
    lines.push({ kind: 'text', content: line });
  }
  return lines;
};

const readArg = (env: CommandEnv, arg: string): readonly TerminalLine[] => {
  const result = env.fs.read(resolveAbsPath(env.fs.cwd(), arg));
  if (!result.ok) {
    return [{ kind: 'error', content: formatReadError('cat', arg, result.error) }];
  }
  return toContentLines(result.content);
};

/** Prepend each text line with a GNU-`cat -n`-style 6-wide right-aligned
 *  counter and a tab. Errors pass through unchanged (real `cat -n` writes
 *  errors to stderr, which is unnumbered) and never advance the counter. */
const numberLines = (lines: readonly TerminalLine[]): readonly TerminalLine[] => {
  let counter = 1;
  return lines.map((line) => {
    if (line.kind !== 'text') return line;
    const numbered: TerminalLine = {
      kind: 'text',
      content: `${String(counter).padStart(6)}\t${line.content}`,
    };
    counter += 1;
    return numbered;
  });
};

/** Append `$` to each text line (GNU `cat -E`'s "show end of lines"). Error
 *  lines pass through clean — they're not part of stdout content. */
const suffixLineEnds = (lines: readonly TerminalLine[]): readonly TerminalLine[] =>
  lines.map((line) => (line.kind === 'text' ? { kind: 'text', content: `${line.content}$` } : line));

const execute = async (
  env: CommandEnv,
  args: readonly string[],
  flags: ReadonlyMap<string, string | true>,
): Promise<CommandResult> => {
  if (args.length === 0) {
    if (env.stdin) {
      return { kind: 'sync', lines: await collectStdin(env.stdin), exitCode: 0 };
    }
    return {
      kind: 'sync',
      lines: [{ kind: 'error', content: 'cat: missing file operand' }],
      exitCode: 1,
    };
  }

  const lines = args.flatMap((arg) => readArg(env, arg));
  const exitCode = lines.some((line) => line.kind === 'error') ? 1 : 0;
  // Compose in order: -E suffixes raw content, -n then numbers what's left.
  // Either order produces the same result (-n's tab boundary is unaffected
  // by -E's trailing `$`) — fixed here so the implementation is deterministic.
  const withSuffix = flags.get('-E') === true ? suffixLineEnds(lines) : lines;
  const finalLines = flags.get('-n') === true ? numberLines(withSuffix) : withSuffix;
  return { kind: 'sync', lines: finalLines, exitCode };
};

export const cat: Command = {
  name: 'cat',
  description: 'Concatenate and print files',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  flags: { '-n': 'boolean', '-E': 'boolean' },
  stacking: true,
  manual: {
    synopsis: 'cat [-nE] [file...]',
    description:
      'Print the contents of each file to stdout in order. With no file argument, read from stdin. -n numbers each output line starting at 1; -E suffixes each line with `$`. Flags may be combined (`cat -nE file` ≡ `cat -n -E file`).',
    examples: [
      'cat /etc/passwd',
      'cat -n notes.txt',
      'cat -nE config',
      'cat file1 file2 | grep root',
    ],
  },
  execute,
};
