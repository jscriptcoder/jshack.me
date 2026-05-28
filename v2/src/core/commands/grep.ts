/**
 * grep — search file contents for a regex pattern (case-insensitive).
 *
 * Modes:
 * - File target: read + filter + emit matching lines verbatim (slice 1).
 * - Directory target: recursive walk; emit `<filepath>:<line>` for each
 *   match (slice 2). Sort by filepath alphabetically. Binary files and
 *   permission-denied files/dirs silently skipped — no error, no exit
 *   code change.
 *
 * Pattern is `new RegExp(raw, 'i')` — case-insensitive, supports full
 * regex syntax (e.g. `.` matches any char, `[abc]` is a char class).
 * Invalid regex emits an error line + exit 2.
 *
 * Binary files (content starting with the ELF magic `\x7fELF`) are
 * silently skipped: no output, exit 1 in single-file mode; contribute
 * nothing to walk results in recursive mode.
 *
 * Exit codes (POSIX):
 *   0 — at least one match
 *   1 — no matches (or binary skip)
 *   2 — error (missing args, missing file, perm denied on the target,
 *       invalid regex). Note: perm denied DURING recursion is silent.
 *
 * Slice 3 will add stdin + the `-l` flag.
 *
 * Legacy contract (preserved): single-quoted path in error messages,
 * `grep: usage: grep <pattern> <path> [-l]` for missing args. See
 * `feedback-v2-match-legacy-command-interface`.
 */

import type { AbsPath } from '../types';
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
/** `is_directory` is intercepted upstream by the recursion branch in
 *  execute — it never reaches formatReadError. Narrowing the param type
 *  makes that invariant load-bearing at compile time. */
type FormattableReadError = Exclude<FsReadError, 'is_directory'>;

const formatReadError = (target: string, error: FormattableReadError): string => {
  switch (error) {
    case 'not_found':
      return `grep: '${target}': No such file or directory`;
    case 'permission_denied':
      return `grep: '${target}': Permission denied`;
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

type Match = {
  readonly filepath: AbsPath;
  readonly line: string;
};

const matchesInFile = (content: string, pattern: RegExp): readonly string[] =>
  splitContentLines(content).filter((line) => pattern.test(line));

/** Recursively walk `dir`, returning matches across all readable
 *  non-binary files. Permission-denied dirs and files are silently
 *  skipped — no error surfaces. Children at each level are visited
 *  in alphabetical order, which yields a filepath-sorted result. */
const walkAndSearch = (
  env: CommandEnv,
  dir: AbsPath,
  pattern: RegExp,
): readonly Match[] => {
  const listing = env.fs.list(dir);
  if (!listing.ok) return [];

  const sortedNames = [...listing.entries].sort();

  return sortedNames.flatMap((name) => {
    const childPath = resolveAbsPath(dir, name);
    const node = env.fs.stat(childPath);
    if (node === null) return [];

    if (node.kind === 'directory') {
      return walkAndSearch(env, childPath, pattern);
    }

    const readResult = env.fs.read(childPath);
    if (!readResult.ok) return [];
    if (isBinary(readResult.content)) return [];

    return matchesInFile(readResult.content, pattern).map((line) => ({
      filepath: childPath,
      line,
    }));
  });
};

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
    if (readResult.error === 'is_directory') {
      const walkMatches = walkAndSearch(env, target, pattern);
      const lines: TerminalLine[] = walkMatches.map(({ filepath, line }) => ({
        kind: 'text',
        content: `${filepath}:${line}`,
      }));
      return {
        kind: 'sync',
        lines,
        exitCode: walkMatches.length > 0 ? 0 : 1,
      };
    }
    return errorResult(formatReadError(pathArg, readResult.error), 2);
  }

  if (isBinary(readResult.content)) {
    return { kind: 'sync', lines: [], exitCode: 1 };
  }

  const matched: TerminalLine[] = matchesInFile(readResult.content, pattern).map(
    (line) => ({ kind: 'text', content: line }),
  );

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
      'Search for lines matching a case-insensitive regex pattern. With a file target, prints matching lines verbatim. With a directory target, recursively walks the tree and prints `<filepath>:<line>` for each match, sorted by filepath. Binary files and permission-denied files/dirs are silently skipped during recursion. (Slice 3 will add stdin support and the -l flag.)',
    examples: ['grep root /etc/passwd', 'grep root /etc', 'grep "pa.sword" notes.txt'],
  },
  execute,
};
