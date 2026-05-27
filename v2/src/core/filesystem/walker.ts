/**
 * Permission walker. SHARED CLIENT + SERVER — this module is imported by
 * both the UI's L2-equivalent client-side filter and the server's
 * `/api/patches` handler. Allow/deny is byte-identical by construction.
 *
 * Rules:
 *
 * - `root` userType always passes.
 * - Reading or writing a path requires `execute` on every parent
 *   directory + the relevant operation on the target.
 * - Permission check: `target.perms[op].includes(userType)`.
 *
 * The walker does NOT read the `owner` field. Owner is a label for
 * display (`ls -l`); permissions are tier-based by the arrays.
 */

import type { UserType } from '../types';
import type { FilePermissions } from './types';

export type WalkResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: WalkDenyReason };

export type WalkDenyReason = 'parent_not_traversable' | 'target_unreadable' | 'target_unwritable';

const ALLOWED: WalkResult = { allowed: true };

/** Can `userType` read `target`, given the chain of parent directories? */
export const canRead = (
  userType: UserType,
  target: FilePermissions | null,
  parentChain: readonly FilePermissions[],
): WalkResult => {
  if (userType === 'root') return ALLOWED;

  if (!parentChain.every((parent) => parent.execute.includes(userType))) {
    return { allowed: false, reason: 'parent_not_traversable' };
  }

  // Leaf-only fallback — if there's no projection entry for the target,
  // permit. L2 (server) enforces only on paths that have ever been touched.
  if (target === null) return ALLOWED;

  if (!target.read.includes(userType)) {
    return { allowed: false, reason: 'target_unreadable' };
  }

  return ALLOWED;
};

/** Can `userType` write `target`, given the chain of parent directories? */
export const canWrite = (
  userType: UserType,
  target: FilePermissions | null,
  parentChain: readonly FilePermissions[],
): WalkResult => {
  if (userType === 'root') return ALLOWED;

  if (!parentChain.every((parent) => parent.execute.includes(userType))) {
    return { allowed: false, reason: 'parent_not_traversable' };
  }

  if (target === null) return ALLOWED;

  if (!target.write.includes(userType)) {
    return { allowed: false, reason: 'target_unwritable' };
  }

  return ALLOWED;
};
