/**
 * Shared content-processing helpers for commands that read file bytes.
 *
 * Per the "consolidate small related helpers" project rule, multiple small
 * helpers live in one topic file rather than file-per-helper.
 */

import type { CommandEnv, FsReadResult } from './types.js';
import { resolveAbsPath } from '../filesystem/path.js';

/** Split file content into lines, dropping the trailing empty segment that
 *  `split('\n')` yields for newline-terminated files. A normal file doesn't
 *  produce a spurious blank line at the end; a file with no trailing
 *  newline keeps its final line intact.
 *
 *  Consumers: cat (projects to TerminalLine), grep (filters strings). */
export const splitContentLines = (content: string): readonly string[] => {
  const segments = content.split('\n');
  return segments[segments.length - 1] === '' ? segments.slice(0, -1) : segments;
};

type FsReadError = Extract<FsReadResult, { readonly ok: false }>['error'];

const READ_ERROR_REASON: Readonly<Record<FsReadError, string>> = {
  not_found: 'No such file or directory',
  is_directory: 'Is a directory',
  permission_denied: 'Permission denied',
};

export type SourceLines =
  | { readonly ok: true; readonly lines: readonly string[] }
  | { readonly ok: false; readonly error: string };

const collectStdin = async (stdin: AsyncIterable<string>): Promise<readonly string[]> => {
  const lines: string[] = [];
  for await (const line of stdin) lines.push(line);
  return lines;
};

/** The lines of the one file named in `args`, or of the piped input when none
 *  is named — the input rule `head`, `tail` and `wc` share, refused in `cat`'s
 *  words under the command's own name. A file's lines are `splitContentLines`'
 *  lines; a pipe's are the lines its upstream stage printed. */
export const readFileOrStdin = async (
  env: CommandEnv,
  args: readonly string[],
  commandName: string,
): Promise<SourceLines> => {
  const [file, extra] = args;
  if (extra !== undefined) return { ok: false, error: `${commandName}: extra operand '${extra}'` };
  if (file === undefined) {
    if (env.stdin === undefined) return { ok: false, error: `${commandName}: missing file operand` };
    return { ok: true, lines: await collectStdin(env.stdin) };
  }
  const result = env.fs.read(resolveAbsPath(env.fs.cwd(), file));
  if (!result.ok) {
    return { ok: false, error: `${commandName}: ${file}: ${READ_ERROR_REASON[result.error]}` };
  }
  return { ok: true, lines: splitContentLines(result.content) };
};
