/**
 * find — search a tree for entries whose name matches a glob.
 *
 * `find <path> <pattern> [user]`, positional rather than real find's `-name`,
 * so it reads like the rest of this shell's tools.
 *
 * Where the search may go is `walkTree`'s rule, not this command's: it descends
 * only where `list` succeeds, so a result never names anything from behind a
 * door the session cannot open.
 *
 * The optional owner narrows what is reported and never widens where the walk
 * goes. Owner is a display label — the permission walker does not read it — so
 * a filter that steered the search would be granting reach on the strength of
 * a string anyone can type.
 */

import type { AbsPath } from '../types';
import type { Command, CommandEnv, CommandResult, FsListResult } from './types';
import type { FileNode } from '../filesystem/types';
import { basename, resolveAbsPath } from '../filesystem/path';
import { walkTree } from '../filesystem/walkTree';

const USAGE = 'find: usage: find <path> <pattern> [user]';

type ListError = Extract<FsListResult, { readonly ok: false }>['error'];

/** `permission_denied` is excluded at the type level rather than handled: a
 *  directory the session cannot enter yields nothing wherever the walk meets
 *  it, and the start path is not a special case. Narrowing here makes that a
 *  compile-time fact instead of a branch somebody can quietly add. */
const formatStartError = (target: string, error: Exclude<ListError, 'permission_denied'>): string => {
  switch (error) {
    case 'not_found':
      return `find: '${target}': No such file or directory`;
    case 'not_a_directory':
      return `find: '${target}': Not a directory`;
  }
};

/** What an entry must satisfy to be reported. Neither field affects where the
 *  walk may go. */
type Filter = {
  readonly pattern: RegExp;
  readonly owner: string | undefined;
};

/** Translate a shell glob to an anchored RegExp. Escape first, expand second:
 *  the other order feeds `*` and `?` to the escaper and loses them. Anchored
 *  because a glob describes a whole name — an unanchored `*.txt` would match
 *  `notes.txt.bak`. */
const globToRegex = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withWildcards = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${withWildcards}$`);
};

/** What one entry contributes to the report. A directory carries a trailing
 *  `/` so a player reading the output knows what to `cat` and what to `cd`
 *  into; `walkTree` puts it ahead of the entries beneath it. */
const reportIfMatching =
  (filter: Filter) =>
  (path: AbsPath, node: FileNode): readonly string[] => {
    const matches =
      filter.pattern.test(basename(path)) &&
      (filter.owner === undefined || node.owner === filter.owner);
    if (!matches) return [];
    return [node.kind === 'directory' ? `${path}/` : path];
  };

const execute = async (env: CommandEnv, args: readonly string[]): Promise<CommandResult> => {
  const [startArg, patternArg, ownerArg] = args;
  if (startArg === undefined || patternArg === undefined) {
    return { kind: 'sync', lines: [{ kind: 'error', content: USAGE }], exitCode: 1 };
  }

  const startPath = resolveAbsPath(env.fs.cwd(), startArg);
  const start = env.fs.list(startPath);
  if (!start.ok && start.error !== 'permission_denied') {
    // Reported as the player typed it, not as it resolved: a mistyped
    // relative path should read as their typo, not as the shell being
    // somewhere unexpected.
    return {
      kind: 'sync',
      lines: [{ kind: 'error', content: formatStartError(startArg, start.error) }],
      exitCode: 1,
    };
  }

  const matches = walkTree(
    env.fs,
    startPath,
    reportIfMatching({ pattern: globToRegex(patternArg), owner: ownerArg }),
  );

  return {
    kind: 'sync',
    lines: matches.map((content) => ({ kind: 'text', content })),
    exitCode: 0,
  };
};

export const find: Command = {
  name: 'find',
  description: 'Search for files and directories by name',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'find <path> <pattern> [user]',
    description:
      'Recursively search a directory for entries whose NAME matches a glob pattern. * stands for any run of characters and ? for exactly one; every other character matches itself, so *.txt does not match axtxt. Results are absolute paths, alphabetical within each directory, with a trailing / on directories. Directories the session cannot enter are skipped in silence, so a result never names anything from behind a door you cannot open. With no match the search still succeeds.',
    arguments: [
      {
        name: 'path',
        description: 'Directory to search from (use . for the current directory)',
        required: true,
      },
      {
        name: 'pattern',
        description: 'Glob matched against each entry name: * is any run, ? is one character',
        required: true,
      },
      {
        name: 'user',
        description: 'Keep only entries owned by this user; it narrows results, never widens them',
        required: false,
      },
    ],
    examples: [
      { command: 'find . passwd', description: 'Find every entry named passwd, from here down' },
      { command: 'find / "*.conf"', description: 'Find configuration files anywhere on the box' },
      { command: 'find /home "*" alice', description: 'List everything alice owns under /home' },
      {
        command: 'find / "*.log" | grep var',
        description: 'Narrow one search with another',
      },
    ],
  },
  execute,
};
