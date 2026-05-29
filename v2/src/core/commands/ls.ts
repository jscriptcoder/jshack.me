/**
 * ls — list directory contents.
 *
 * Flags (per-command stacking enabled; `-la` ≡ `-l -a`):
 *   -a  Include hidden entries (names starting with `.`) AND surface the
 *       synthetic `.` (current dir) and `..` (parent dir) rows.
 *   -l  Long format: one row per entry as
 *       `<type><perms9> <owner> <size> <name>` (no mtime column — v2 has
 *       no mtime concept). Size is `content.length` for files; the Unix
 *       convention `4096` for directories.
 *
 * Tier-truthful 9-char perms mapping (Option A, agreed in slice-3 ACs):
 *   triplet 1: 'root'  rwx        — what root-tier sees
 *   triplet 2: 'user'  rwx        — what user-tier sees
 *   triplet 3: 'guest' rwx        — what guest-tier sees
 * NOT Unix owner/group/other. Reading the string tells you exactly which
 * tier can do what, which matches how v2's `FilePermissions` model works.
 *
 * Behavior (no-flag baseline preserved from slice 2):
 * - No arg: lists `env.fs.cwd()`.
 * - One arg: resolves relative against cwd, then dispatches on `fs.list`:
 *   - directory → entries filtered + sorted; emits one line per entry.
 *   - file (not_a_directory) → echoes the input path (or long-format row
 *     when -l), exit 0.
 *   - missing → `ls: cannot access '<arg>': No such file or directory`, exit 2.
 *   - unreadable → `ls: cannot open directory '<arg>': Permission denied`, exit 2.
 *
 * Error messages preserve the ORIGINAL arg (`ls nope` → `'nope'`, not the
 * resolved abs path), matching real ls output.
 */

import type { AbsPath, UserType } from '../types';
import type { Command, CommandEnv, CommandResult } from './types';
import type { FileNode } from '../filesystem/types';
import { dirname, resolveAbsPath } from '../filesystem/path';

const isHidden = (name: string): boolean => name.startsWith('.');

const TIERS_ORDERED: readonly UserType[] = ['root', 'user', 'guest'];

const formatPermsString = (node: FileNode): string => {
  const typeChar = node.kind === 'directory' ? 'd' : '-';
  const triplets = TIERS_ORDERED.map((tier) => {
    const r = node.perms.read.includes(tier) ? 'r' : '-';
    const w = node.perms.write.includes(tier) ? 'w' : '-';
    const x = node.perms.execute.includes(tier) ? 'x' : '-';
    return `${r}${w}${x}`;
  });
  return `${typeChar}${triplets.join('')}`;
};

const sizeOf = (node: FileNode): number => (node.kind === 'directory' ? 4096 : node.content.length);

const formatLongLine = (name: string, node: FileNode): string =>
  `${formatPermsString(node)} ${node.owner} ${sizeOf(node)} ${name}`;

type Entry = { readonly name: string; readonly node: FileNode };

/** Compare two strings as code-point sequences — matches the default
 *  `Array#sort()` behavior used in slice 2's no-flag path. */
const byName = (a: Entry, b: Entry): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

const buildDirEntries = (
  env: CommandEnv,
  target: AbsPath,
  names: readonly string[],
  showHidden: boolean,
): readonly Entry[] => {
  const filtered = showHidden ? names : names.filter((name) => !isHidden(name));
  const real: Entry[] = filtered.flatMap((name) => {
    const node = env.fs.stat(resolveAbsPath(target, name));
    return node === null ? [] : [{ name, node }];
  });

  if (!showHidden) return [...real].sort(byName);

  // -a → prepend the synthetic `.` (this dir) and `..` (its parent).
  // dirname('/') === '/', so `..` of root is the root itself — matches
  // real ls behavior on /.
  const synthetic: Entry[] = [];
  const dotNode = env.fs.stat(target);
  if (dotNode !== null) synthetic.push({ name: '.', node: dotNode });
  const parentNode = env.fs.stat(dirname(target));
  if (parentNode !== null) synthetic.push({ name: '..', node: parentNode });
  return [...synthetic, ...real].sort(byName);
};

const renderEntry = (entry: Entry, longFormat: boolean): string =>
  longFormat ? formatLongLine(entry.name, entry.node) : entry.name;

const execute = async (
  env: CommandEnv,
  args: readonly string[],
  flags: ReadonlyMap<string, string | true>,
): Promise<CommandResult> => {
  const showHidden = flags.get('-a') === true;
  const longFormat = flags.get('-l') === true;

  const rawArg = args[0];
  const target = rawArg === undefined ? env.fs.cwd() : resolveAbsPath(env.fs.cwd(), rawArg);
  const messageTarget = rawArg ?? target;

  const listing = env.fs.list(target);

  if (listing.ok) {
    const entries = buildDirEntries(env, target, listing.entries, showHidden);
    return {
      kind: 'sync',
      lines: entries.map((entry) => ({ kind: 'text', content: renderEntry(entry, longFormat) })),
      exitCode: 0,
    };
  }

  if (listing.error === 'not_a_directory') {
    // File target. With -l, render the long-format row; otherwise echo
    // the input path (matches real `ls /etc/passwd` vs `ls -l /etc/passwd`).
    if (longFormat) {
      const node = env.fs.stat(target);
      if (node !== null) {
        return {
          kind: 'sync',
          lines: [{ kind: 'text', content: formatLongLine(messageTarget, node) }],
          exitCode: 0,
        };
      }
    }
    return {
      kind: 'sync',
      lines: [{ kind: 'text', content: messageTarget }],
      exitCode: 0,
    };
  }

  const errorContent =
    listing.error === 'not_found'
      ? `ls: cannot access '${messageTarget}': No such file or directory`
      : `ls: cannot open directory '${messageTarget}': Permission denied`;

  return {
    kind: 'sync',
    lines: [{ kind: 'error', content: errorContent }],
    exitCode: 2,
  };
};

export const ls: Command = {
  name: 'ls',
  description: 'List directory contents',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  flags: { '-a': 'boolean', '-l': 'boolean' },
  stacking: true,
  manual: {
    synopsis: 'ls [-a] [-l] [path]',
    description:
      'List the contents of the named directory (or the current directory if no argument is given). With -a, hidden entries (names starting with `.`) plus the synthetic `.` and `..` are included. With -l, each row is rendered in long format: <type><perms9> <owner> <size> <name>. Flags can be stacked (-la == -l -a).',
    arguments: [
      {
        name: '-a',
        description: 'Include hidden entries (names starting with `.`) and the synthetic . and ..',
      },
      {
        name: '-l',
        description: 'Long format: <type><perms9> <owner> <size> <name>',
      },
      {
        name: 'path',
        description: 'Directory (or file) to list; defaults to the current directory',
      },
    ],
    examples: [
      { command: 'ls', description: 'List the current directory' },
      { command: 'ls -a', description: 'List including hidden entries' },
      { command: 'ls -l /etc', description: 'Long-format listing of /etc' },
      { command: 'ls -la sub', description: 'Long format, including hidden entries, of sub' },
    ],
  },
  execute,
};
