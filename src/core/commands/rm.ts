/**
 * rm — remove files and directories on the current machine through the
 * server-backed `PatchApi`.
 *
 * Legacy interface parity (per `v2_match_legacy_command_interface`): the flag
 * set is `-r`/`-R` (recursive) and `-f` (force), short-flag stacking is on so
 * `-rf`/`-fr` work, and the error texts match legacy
 * (`rm: cannot remove '<arg>': <reason>`, `rm: missing operand`,
 * `rm: cannot remove root directory`). Error messages preserve the ORIGINAL
 * argument rather than the resolved absolute path.
 *
 * Semantics, gated against the live (patched) `fs` view BEFORE any write:
 *   - A missing target errors `No such file or directory`, unless `-f` (then a
 *     silent success). `-f` suppresses ONLY the not-found case — never a
 *     permission or is-a-directory error.
 *   - A directory without `-r` errors `Is a directory`.
 *   - Removal requires write permission on the CONTAINING directory (you unlink
 *     an entry from its parent), matching real UNIX + legacy.
 *   - A single deletion marker (`patches.remove`) is sufficient for `-r`: the
 *     patch journal's `removeNode` drops the whole subtree on replay.
 */

import type { Command, CommandEnv, CommandResult, PatchResult } from './types';
import { resolveAbsPath, dirname } from '../filesystem/path';

const PATCH_ERROR_MESSAGE: Record<Extract<PatchResult, { ok: false }>['error'], string> = {
  no_session: 'Permission denied',
  permission_denied: 'Permission denied',
  network_error: 'I/O error',
  modified_since_open: 'File changed on disk',
};

const cannotRemove = (target: string, reason: string): string =>
  `rm: cannot remove '${target}': ${reason}`;

/** Remove one path argument. Returns an error string, or null on success
 *  (including the forced no-op for a missing target). */
const removeOnePath = async (
  env: CommandEnv,
  rawArg: string,
  recursive: boolean,
  force: boolean,
): Promise<string | null> => {
  const resolved = resolveAbsPath(env.fs.cwd(), rawArg);
  if (resolved === '/') return 'rm: cannot remove root directory';

  const node = env.fs.stat(resolved);
  if (node === null) {
    return force ? null : cannotRemove(rawArg, 'No such file or directory');
  }
  if (node.kind === 'directory' && !recursive) {
    return cannotRemove(rawArg, 'Is a directory');
  }
  if (!env.fs.canWrite(dirname(resolved)).allowed) {
    return cannotRemove(rawArg, 'Permission denied');
  }

  const result = await env.patches.remove(resolved);
  if (!result.ok) return cannotRemove(rawArg, PATCH_ERROR_MESSAGE[result.error]);
  return null;
};

const execute = async (
  env: CommandEnv,
  args: readonly string[],
  flags: ReadonlyMap<string, string | true>,
): Promise<CommandResult> => {
  if (args.length === 0) {
    return {
      kind: 'sync',
      lines: [{ kind: 'error', content: 'rm: missing operand' }],
      exitCode: 1,
    };
  }

  const recursive = flags.get('-r') === true || flags.get('-R') === true;
  const force = flags.get('-f') === true;
  const errors: string[] = [];
  for (const rawArg of args) {
    const error = await removeOnePath(env, rawArg, recursive, force);
    if (error !== null) errors.push(error);
  }

  return {
    kind: 'sync',
    lines: errors.map((content) => ({ kind: 'error', content })),
    exitCode: errors.length === 0 ? 0 : 1,
  };
};

export const rm: Command = {
  name: 'rm',
  description: 'Remove files or directories',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  flags: { '-r': 'boolean', '-R': 'boolean', '-f': 'boolean' },
  stacking: true,
  manual: {
    synopsis: 'rm [-r] [-f] <path> [paths...]',
    description:
      'Remove files or directories. Directories require -r (or -R). Use -f to ignore nonexistent targets and suppress their errors. Removal needs write permission on the containing directory.',
    arguments: [
      {
        name: '-r',
        description: 'Remove directories and their contents recursively (also -R)',
      },
      { name: '-f', description: 'Ignore nonexistent targets and suppress their errors' },
      { name: 'path', description: 'One or more files or directories to remove', required: true },
    ],
    examples: [
      { command: 'rm notes.txt', description: 'Remove a single file' },
      { command: 'rm -r stash', description: 'Remove a directory and everything inside it' },
      {
        command: 'rm -rf /tmp/cache',
        description: 'Force-remove a directory, ignoring missing targets',
      },
      { command: 'rm a.txt b.txt', description: 'Remove several files at once' },
    ],
  },
  execute,
};
