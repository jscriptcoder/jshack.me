/**
 * ls — list directory contents.
 *
 * Behavior:
 * - No arg: lists `env.fs.cwd()`.
 * - One arg: resolves relative against cwd, then dispatches on `fs.list`:
 *   - directory → entries filtered (non-hidden) + sorted alphabetically;
 *     emits one text line per entry. Empty dir → no lines.
 *   - file (not_a_directory) → echoes the input path, exit 0 (matches real ls).
 *   - missing → `ls: cannot access '<arg>': No such file or directory`, exit 2.
 *   - unreadable → `ls: cannot open directory '<arg>': Permission denied`, exit 2.
 *
 * Error messages preserve the ORIGINAL arg (`ls nope` → `'nope'`, not the
 * resolved abs path), matching real ls output.
 *
 * Permission note: ls requires read on the target dir (which is what
 * `fs.list` checks). Multi-arg with `<arg>:` headers is deferred.
 */

import type { Command, CommandEnv, CommandResult } from './types';
import { resolveAbsPath } from '../filesystem/path';

const isHidden = (name: string): boolean => name.startsWith('.');

const execute = async (
  env: CommandEnv,
  args: readonly string[],
): Promise<CommandResult> => {
  const rawArg = args[0];
  const target = rawArg === undefined ? env.fs.cwd() : resolveAbsPath(env.fs.cwd(), rawArg);
  const messageTarget = rawArg ?? target;

  const listing = env.fs.list(target);

  if (listing.ok) {
    const entries = [...listing.entries].filter((name) => !isHidden(name)).sort();
    return {
      kind: 'sync',
      lines: entries.map((name) => ({ kind: 'text', content: name })),
      exitCode: 0,
    };
  }

  if (listing.error === 'not_a_directory') {
    // File target — real ls echoes the input path. Exit 0 (the file exists).
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
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'ls [path]',
    description:
      'List the contents of the named directory (or the current directory if no argument is given). Hidden entries (names starting with `.`) are omitted.',
    examples: ['ls', 'ls /etc', 'ls sub'],
  },
  execute,
};
