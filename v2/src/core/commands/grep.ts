/**
 * grep — search file contents for a regex pattern (case-insensitive).
 *
 * Slice 1 scope: single-file mode only.
 * - `grep <pattern> <path>` reads the file, filters lines by the regex,
 *   emits each match as a text line.
 * - Pattern is `new RegExp(raw, 'i')` — case-insensitive, supports full
 *   regex syntax (e.g. `.` matches any char, `[abc]` is a char class).
 *   Invalid regex emits an error line + exit 2.
 * - Binary files (content starting with the ELF magic `\x7fELF`) are
 *   silently skipped: no output, exit 1 (treated like no-match).
 *
 * Exit codes (POSIX):
 *   0 — at least one match
 *   1 — no matches (or binary skip)
 *   2 — error (missing args, missing file, perm denied, invalid regex)
 *
 * Slice 2 will replace the placeholder "Is a directory" error with a
 * recursive walk. Slice 3 will add stdin + the `-l` flag.
 *
 * Legacy contract (preserved): single-quoted path in error messages,
 * `grep: usage: grep <pattern> <path> [-l]` for missing args. See
 * `feedback-v2-match-legacy-command-interface`.
 */

import type {
  Command,
  CommandEnv,
  CommandResult,
  FsReadResult,
  TerminalLine,
} from './types';
import { resolveAbsPath } from '../filesystem/path';
import { splitContentLines } from './contentHelpers';

const USAGE = 'grep: usage: grep <pattern> <path> [-l]';

/** ELF magic — content with this prefix is treated as binary and skipped. */
const ELF_MAGIC = '\x7fELF';

type FsReadError = Extract<FsReadResult, { readonly ok: false }>['error'];

const formatReadError = (target: string, error: FsReadError): string => {
  switch (error) {
    case 'not_found':
      return `grep: '${target}': No such file or directory`;
    case 'permission_denied':
      return `grep: '${target}': Permission denied`;
    case 'is_directory':
      return `grep: '${target}': Is a directory`;
  }
};

const isBinary = (content: string): boolean => content.startsWith(ELF_MAGIC);

const compilePattern = (raw: string): RegExp | null => {
  try {
    return new RegExp(raw, 'i');
  } catch {
    return null;
  }
};

const errorResult = (message: string, exitCode: number): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: message }],
  exitCode,
});

const execute = async (
  env: CommandEnv,
  args: readonly string[],
): Promise<CommandResult> => {
  if (args.length < 2) return errorResult(USAGE, 2);

  const [rawPattern, pathArg] = args;
  const pattern = compilePattern(rawPattern);
  if (pattern === null) {
    return errorResult(`grep: invalid regex: '${rawPattern}'`, 2);
  }

  const target = resolveAbsPath(env.fs.cwd(), pathArg);
  const readResult = env.fs.read(target);
  if (!readResult.ok) {
    return errorResult(formatReadError(pathArg, readResult.error), 2);
  }

  if (isBinary(readResult.content)) {
    return { kind: 'sync', lines: [], exitCode: 1 };
  }

  const matched: TerminalLine[] = splitContentLines(readResult.content)
    .filter((line) => pattern.test(line))
    .map((line) => ({ kind: 'text', content: line }));

  return {
    kind: 'sync',
    lines: matched,
    exitCode: matched.length > 0 ? 0 : 1,
  };
};

export const grep: Command = {
  name: 'grep',
  description: 'Search file contents for a pattern',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'grep <pattern> <path> [-l]',
    description:
      'Search for lines matching a case-insensitive regex pattern. With a file target, prints matching lines verbatim. Binary files are silently skipped. (Slice 2 will add directory recursion; Slice 3 will add stdin support and the -l flag.)',
    examples: ['grep root /etc/passwd', 'grep "pa.sword" notes.txt'],
  },
  execute,
};
