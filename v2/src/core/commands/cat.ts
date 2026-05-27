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

import type { Command, CommandEnv, CommandResult, FsReadResult, TerminalLine } from './types';
import { resolveAbsPath } from '../filesystem/path';

type FsReadError = Extract<FsReadResult, { readonly ok: false }>['error'];

const ERROR_MESSAGE: Record<FsReadError, (arg: string) => string> = {
  not_found: (arg) => `cat: ${arg}: No such file or directory`,
  is_directory: (arg) => `cat: ${arg}: Is a directory`,
  permission_denied: (arg) => `cat: ${arg}: Permission denied`,
};

const collectStdin = async (stdin: AsyncIterable<string>): Promise<readonly TerminalLine[]> => {
  const lines: TerminalLine[] = [];
  for await (const line of stdin) {
    lines.push({ kind: 'text', content: line });
  }
  return lines;
};

/** Split file content into output lines, dropping the trailing empty element
 *  that `split('\n')` yields for newline-terminated files (so a normal file
 *  doesn't print a spurious blank line at the end). */
const toContentLines = (content: string): readonly TerminalLine[] => {
  const segments = content.split('\n');
  const body =
    segments.length > 0 && segments[segments.length - 1] === '' ? segments.slice(0, -1) : segments;
  return body.map((line) => ({ kind: 'text', content: line }));
};

const readArg = (env: CommandEnv, arg: string): readonly TerminalLine[] => {
  const result = env.fs.read(resolveAbsPath(env.fs.cwd(), arg));
  if (!result.ok) {
    return [{ kind: 'error', content: ERROR_MESSAGE[result.error](arg) }];
  }
  return toContentLines(result.content);
};

const execute = async (env: CommandEnv, args: readonly string[]): Promise<CommandResult> => {
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
