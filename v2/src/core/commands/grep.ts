/**
 * grep — search file contents for a regex pattern (case-insensitive).
 *
 * Modes:
 * - File target: read + filter + emit matching lines verbatim.
 * - Directory target: recursive walk; emit `<filepath>:<line>` for each
 *   match. Sort by filepath alphabetically. Binary files and
 *   permission-denied files/dirs silently skipped — no error, no exit
 *   code change.
 * - Stdin (no path arg): iterate stdin lines, emit matches verbatim.
 *   A path arg always wins over stdin (matches legacy `fnShell`).
 *
 * Flags:
 * - `-l` files-with-matches mode: in any of the above, switch output
 *   to filepaths (deduped, sorted) instead of matching-line content.
 *   With stdin, emits `(standard input)` if any line matched.
 *
 * Pattern is `new RegExp(raw, 'i')` — case-insensitive, supports full
 * regex syntax. Invalid regex emits an error + exit 2.
 *
 * Exit codes (POSIX):
 *   0 — at least one match
 *   1 — no matches (or binary skip)
 *   2 — error (missing args, missing file, perm denied on the target,
 *       invalid regex). Note: perm denied DURING recursion is silent.
 *
 * Legacy contract (preserved): single-quoted path in error messages,
 * `grep: usage: grep <pattern> <path> [-l]` for missing args. See
 * `feedback-v2-match-legacy-command-interface`.
 */

import type { AbsPath } from '../types';
import type { Command, CommandEnv, CommandResult, FsReadResult } from './types';
import { resolveAbsPath } from '../filesystem/path';
import { walkTree } from '../filesystem/walkTree';
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

/** Matches across all readable non-binary files under `dir`. Directories
 *  contribute nothing of their own — they are where the walk goes, not what it
 *  reports — and an unreadable file is skipped in silence, so a sweep over a
 *  mixed tree still answers for the part it can read. Alphabetical at each
 *  level, which yields a filepath-sorted result. */
const walkAndSearch = (env: CommandEnv, dir: AbsPath, pattern: RegExp): readonly Match[] =>
  walkTree(env.fs, dir, (childPath, node) => {
    if (node.kind === 'directory') return [];

    const readResult = env.fs.read(childPath);
    if (!readResult.ok) return [];
    if (isBinary(readResult.content)) return [];

    return matchesInFile(readResult.content, pattern).map((line) => ({
      filepath: childPath,
      line,
    }));
  });

const grepStdin = async (
  stdin: AsyncIterable<string>,
  pattern: RegExp,
): Promise<readonly string[]> => {
  const matched: string[] = [];
  for await (const line of stdin) {
    if (pattern.test(line)) matched.push(line);
  }
  return matched;
};

const textResult = (contents: readonly string[]): CommandResult => ({
  kind: 'sync',
  lines: contents.map((content) => ({ kind: 'text', content })),
  exitCode: contents.length > 0 ? 0 : 1,
});

const execute = async (
  env: CommandEnv,
  args: readonly string[],
  flags: ReadonlyMap<string, string | true>,
): Promise<CommandResult> => {
  if (args.length === 0) return errorResult(USAGE, 2);

  const [rawPattern, pathArg] = args;
  const pattern = compilePattern(rawPattern);
  if (pattern === null) {
    return errorResult(`grep: invalid regex: '${rawPattern}'`, 2);
  }

  const dashL = flags.get('-l') === true;

  // No path arg: stdin path. A path arg ALWAYS wins over stdin (matches
  // legacy `fnShell`); we only reach the stdin branch when args is just
  // the pattern.
  if (pathArg === undefined) {
    if (env.stdin === undefined) return errorResult(USAGE, 2);
    const stdinMatches = await grepStdin(env.stdin, pattern);
    if (dashL) {
      return textResult(stdinMatches.length > 0 ? ['(standard input)'] : []);
    }
    return textResult(stdinMatches);
  }

  const target = resolveAbsPath(env.fs.cwd(), pathArg);
  const readResult = env.fs.read(target);

  if (!readResult.ok) {
    if (readResult.error === 'is_directory') {
      const walkMatches = walkAndSearch(env, target, pattern);
      if (dashL) {
        const uniquePaths = [...new Set(walkMatches.map(({ filepath }) => filepath))];
        return textResult(uniquePaths);
      }
      return textResult(walkMatches.map(({ filepath, line }) => `${filepath}:${line}`));
    }
    return errorResult(formatReadError(pathArg, readResult.error), 2);
  }

  if (isBinary(readResult.content)) {
    return { kind: 'sync', lines: [], exitCode: 1 };
  }

  const fileMatches = matchesInFile(readResult.content, pattern);
  if (dashL) {
    return textResult(fileMatches.length > 0 ? [target] : []);
  }
  return textResult(fileMatches);
};

export const grep: Command = {
  name: 'grep',
  description: 'Search file contents for a pattern',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  flags: { '-l': 'boolean' },
  manual: {
    synopsis: 'grep <pattern> [path] [-l]',
    description:
      'Search for lines matching a case-insensitive regex pattern. With a file target, prints matching lines verbatim. With a directory target, recursively walks the tree and prints `<filepath>:<line>` for each match, sorted by filepath. Binary files and permission-denied files/dirs are silently skipped during recursion. With no path at all, reads stdin, so it can sit downstream of a pipe.',
    arguments: [
      {
        name: 'pattern',
        description: 'Case-insensitive regular expression to match',
        required: true,
      },
      {
        name: 'path',
        description: 'File or directory to search; with none, read stdin',
        required: false,
      },
      {
        name: '-l',
        description: 'Print only the names of files containing a match (deduped, sorted)',
      },
    ],
    examples: [
      {
        command: 'grep root /etc/passwd',
        description: 'Print lines containing "root" in the password file',
      },
      {
        command: 'grep root /etc',
        description: 'Recursively search /etc, printing <filepath>:<line> per match',
      },
      { command: 'grep "pa.sword" notes.txt', description: 'Search with a regex pattern' },
    ],
  },
  execute,
};
