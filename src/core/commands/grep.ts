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
 * - `-c` count mode: print how many lines matched instead of the lines.
 *   A directory prints `<filepath>:<count>` for every file it searched,
 *   zeros included, as GNU grep does. `-l` wins over `-c`, also as GNU.
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

import type { AbsPath } from '../types.js';
import type { Command, CommandEnv, CommandResult, FsReadResult } from './types.js';
import { resolveAbsPath } from '../filesystem/path.js';
import { walkTree } from '../filesystem/walkTree.js';
import { splitContentLines } from './contentHelpers.js';

const USAGE = 'grep: usage: grep <pattern> <path> [-l] [-c]';

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

type FileMatches = {
  readonly filepath: AbsPath;
  readonly lines: readonly string[];
};

const matchesInFile = (content: string, pattern: RegExp): readonly string[] =>
  splitContentLines(content).filter((line) => pattern.test(line));

/** One entry per readable non-binary file under `dir`, holding its matching
 *  lines — none for a file that has no match, which `-c` still reports.
 *  Directories contribute nothing of their own — they are where the walk goes,
 *  not what it reports — and an unreadable file is skipped in silence, so a
 *  sweep over a mixed tree still answers for the part it can read. Alphabetical
 *  at each level, which yields a filepath-sorted result. */
const walkAndSearch = (env: CommandEnv, dir: AbsPath, pattern: RegExp): readonly FileMatches[] =>
  walkTree(env.fs, dir, (childPath, node) => {
    if (node.kind === 'directory') return [];

    const readResult = env.fs.read(childPath);
    if (!readResult.ok) return [];
    if (isBinary(readResult.content)) return [];

    return [{ filepath: childPath, lines: matchesInFile(readResult.content, pattern) }];
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

/** Exit 0 only when something matched — a `-c` that prints `0` still exits 1. */
const textResult = (
  contents: readonly string[],
  matched: boolean = contents.length > 0,
): CommandResult => ({
  kind: 'sync',
  lines: contents.map((content) => ({ kind: 'text', content })),
  exitCode: matched ? 0 : 1,
});

const countResult = (count: number): CommandResult => textResult([String(count)], count > 0);

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
  const dashC = flags.get('-c') === true;

  // No path arg: stdin path. A path arg ALWAYS wins over stdin (matches
  // legacy `fnShell`); we only reach the stdin branch when args is just
  // the pattern.
  if (pathArg === undefined) {
    if (env.stdin === undefined) return errorResult(USAGE, 2);
    const stdinMatches = await grepStdin(env.stdin, pattern);
    if (dashL) {
      return textResult(stdinMatches.length > 0 ? ['(standard input)'] : []);
    }
    if (dashC) return countResult(stdinMatches.length);
    return textResult(stdinMatches);
  }

  const target = resolveAbsPath(env.fs.cwd(), pathArg);
  const readResult = env.fs.read(target);

  if (!readResult.ok) {
    if (readResult.error === 'is_directory') {
      const searched = walkAndSearch(env, target, pattern);
      const matchedFiles = searched.filter(({ lines }) => lines.length > 0);
      if (dashL) {
        return textResult(matchedFiles.map(({ filepath }) => filepath));
      }
      if (dashC) {
        return textResult(
          searched.map(({ filepath, lines }) => `${filepath}:${lines.length}`),
          matchedFiles.length > 0,
        );
      }
      return textResult(
        matchedFiles.flatMap(({ filepath, lines }) => lines.map((line) => `${filepath}:${line}`)),
      );
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
  if (dashC) return countResult(fileMatches.length);
  return textResult(fileMatches);
};

export const grep: Command = {
  name: 'grep',
  description: 'Search file contents for a pattern',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  flags: { '-l': 'boolean', '-c': 'boolean' },
  manual: {
    synopsis: 'grep <pattern> [path] [-l] [-c]',
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
      {
        name: '-c',
        description: 'Print how many lines matched instead of the lines; per file in a directory',
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
      { command: 'grep -c Failed /var/log/auth.log', description: 'Count the failed logins' },
    ],
  },
  execute,
};
