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

import type { Command, CommandEnv, CommandResult, TerminalLine } from '../types';
import { resolveAbsPath } from '../../filesystem/path';

const collectStdin = async (stdin: AsyncIterable<string>): Promise<TerminalLine[]> => {
  const lines: TerminalLine[] = [];
  for await (const line of stdin) {
    lines.push({ kind: 'text', content: line });
  }
  return lines;
};

const execute = async (
  env: CommandEnv,
  args: readonly string[],
): Promise<CommandResult> => {
  // No args: piped stdin if present, else error.
  if (args.length === 0) {
    if (env.stdin) {
      const lines = await collectStdin(env.stdin);
      return { kind: 'sync', lines, exitCode: 0 };
    }
    return {
      kind: 'sync',
      lines: [{ kind: 'error', content: 'cat: missing file operand' }],
      exitCode: 1,
    };
  }

  const lines: TerminalLine[] = [];
  let exitCode = 0;

  for (const arg of args) {
    const path = resolveAbsPath(env.fs.cwd(), arg);
    const result = env.fs.read(path);

    if (!result.ok) {
      const message =
        result.error === 'not_found'
          ? `cat: ${arg}: No such file or directory`
          : result.error === 'is_directory'
            ? `cat: ${arg}: Is a directory`
            : `cat: ${arg}: Permission denied`;
      lines.push({ kind: 'error', content: message });
      exitCode = 1;
      continue;
    }

    // Split on newline, drop the trailing empty line if the file ends with \n.
    const fileLines = result.content.split('\n');
    if (fileLines.length > 0 && fileLines[fileLines.length - 1] === '') {
      fileLines.pop();
    }
    for (const fileLine of fileLines) {
      lines.push({ kind: 'text', content: fileLine });
    }
  }

  return { kind: 'sync', lines, exitCode };
};

export const cat: Command = {
  name: 'cat',
  description: 'Concatenate and print files',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'cat [file...]',
    description:
      'Print the contents of each file to stdout in order. With no file argument, read from stdin.',
    examples: ['cat /etc/passwd', 'cat file1 file2 | grep root', 'echo hello | cat'],
  },
  execute,
};
