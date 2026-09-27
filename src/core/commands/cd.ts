/**
 * cd — change the shell's working directory.
 *
 * Validates the target via `env.fs.list` (which discriminates `not_found`,
 * `not_a_directory`, and `permission_denied` in one call), then mutates the
 * UI's cwd signal via `env.setCwd`. Failures preserve the original cwd.
 *
 * Error messages preserve the ORIGINAL arg (`cd nope` says "nope", not the
 * resolved `/home/alice/nope`), matching real bash output.
 *
 * With no arg, jumps to the session's home: `/root` for root-tier sessions,
 * `/home/${username}` otherwise. (Tilde expansion / $HOME / `cd -` deferred.)
 *
 * Permission note: validation uses `fs.list`, which requires READ on the
 * target dir. Real bash only needs EXECUTE on the dir — so cd here is
 * slightly stricter than POSIX. Acceptable for v2: the seed has read+execute
 * paired on all traversable dirs.
 */

import type { Command, CommandEnv, CommandResult, FsListResult } from './types';
import { resolveAbsPath } from '../filesystem/path';
import { homeDirectory } from '../sessions/homeDirectory';

type FsListError = Extract<FsListResult, { readonly ok: false }>['error'];

/** Mirror cat.ts's `formatReadError` shape: exhaustive switch so adding a
 *  new `FsListError` variant is a tsc error here, not a silent fallthrough. */
const formatListError = (target: string, error: FsListError): string => {
  switch (error) {
    case 'not_found':
      return `cd: ${target}: No such file or directory`;
    case 'not_a_directory':
      return `cd: ${target}: Not a directory`;
    case 'permission_denied':
      return `cd: ${target}: Permission denied`;
  }
};

const execute = async (env: CommandEnv, args: readonly string[]): Promise<CommandResult> => {
  if (args.length > 1) {
    return {
      kind: 'sync',
      lines: [{ kind: 'error', content: 'cd: too many arguments' }],
      exitCode: 1,
    };
  }

  const rawArg = args[0];
  const target =
    rawArg === undefined ? homeDirectory(env.session) : resolveAbsPath(env.fs.cwd(), rawArg);
  const messageTarget = rawArg ?? target;

  const listing = env.fs.list(target);
  if (!listing.ok) {
    return {
      kind: 'sync',
      lines: [{ kind: 'error', content: formatListError(messageTarget, listing.error) }],
      exitCode: 1,
    };
  }

  env.setCwd(target);
  return { kind: 'sync', lines: [], exitCode: 0 };
};

export const cd: Command = {
  name: 'cd',
  description: 'Change the shell working directory',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'cd [dir]',
    description:
      "Change the current shell working directory. With no argument, cd jumps to the session user's home directory (/root for root, /home/${user} otherwise).",
    arguments: [
      {
        name: 'dir',
        description: 'Directory to change into; defaults to the session user’s home',
      },
    ],
    examples: [
      { command: 'cd /tmp', description: 'Change to the /tmp directory' },
      { command: 'cd', description: 'Return to your home directory' },
      { command: 'cd ..', description: 'Move up to the parent directory' },
    ],
  },
  execute,
};
