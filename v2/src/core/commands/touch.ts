/**
 * touch — create empty files on the current machine through the
 * server-backed `PatchApi`.
 *
 * There is no legacy `touch` to match (it never shipped in the v1 CLI), so the
 * interface follows GNU semantics, scoped to what the patch model supports:
 *   - An existing target (file OR directory) is a no-op success. Real `touch`
 *     bumps mtime here; the patch model doesn't track mtime, so the closest
 *     faithful behaviour is "do nothing, succeed" — and crucially NOT truncate
 *     an existing file (that's `>`'s job, not touch's).
 *   - A missing target is created as an empty file via `patches.write(path,'')`.
 *
 * Permission + shape checks run against the live (patched) `fs` view BEFORE any
 * write is issued, mirroring mkdir/redirect: the parent must exist, be a
 * directory, and be writable by the session tier. Error messages preserve the
 * ORIGINAL argument rather than the resolved absolute path.
 */

import type { Command, CommandEnv, CommandResult, PatchResult } from './types';
import { resolveAbsPath, dirname } from '../filesystem/path';

const PATCH_ERROR_MESSAGE: Record<Extract<PatchResult, { ok: false }>['error'], string> = {
  no_session: 'Permission denied',
  permission_denied: 'Permission denied',
  network_error: 'I/O error',
};

const cannotTouch = (target: string, reason: string): string =>
  `touch: cannot touch '${target}': ${reason}`;

/** Touch one path argument. Returns an error string, or null on success. */
const touchOnePath = async (env: CommandEnv, rawArg: string): Promise<string | null> => {
  const resolved = resolveAbsPath(env.fs.cwd(), rawArg);

  // Existing node (file or directory): a no-op success — never truncate.
  if (env.fs.stat(resolved) !== null) return null;

  const parent = dirname(resolved);
  const parentNode = env.fs.stat(parent);
  if (parentNode === null || parentNode.kind !== 'directory') {
    return cannotTouch(rawArg, 'No such file or directory');
  }
  if (!env.fs.canWrite(parent).allowed) {
    return cannotTouch(rawArg, 'Permission denied');
  }

  // Always a brand-new file (gated on absence above) → mark is_new so a later
  // `rm` deletes the row rather than leaving a tombstone.
  const result = await env.patches.write(resolved, '', { isNew: true });
  if (!result.ok) return cannotTouch(rawArg, PATCH_ERROR_MESSAGE[result.error]);
  return null;
};

const execute = async (env: CommandEnv, args: readonly string[]): Promise<CommandResult> => {
  if (args.length === 0) {
    return {
      kind: 'sync',
      lines: [{ kind: 'error', content: 'touch: missing file operand' }],
      exitCode: 1,
    };
  }

  const errors: string[] = [];
  for (const rawArg of args) {
    const error = await touchOnePath(env, rawArg);
    if (error !== null) errors.push(error);
  }

  return {
    kind: 'sync',
    lines: errors.map((content) => ({ kind: 'error', content })),
    exitCode: errors.length === 0 ? 0 : 1,
  };
};

export const touch: Command = {
  name: 'touch',
  description: 'Create empty files',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'touch <path> [paths...]',
    description:
      'Create one or more empty files. An existing target is left untouched (its content is preserved). The parent directory of each target must already exist and be writable.',
    examples: ['touch notes.txt', 'touch a.txt b.txt c.txt'],
  },
  execute,
};
