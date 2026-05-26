/**
 * Permission walker. SHARED CLIENT + SERVER — this module is imported by
 * both the UI's L2-equivalent client-side filter and the server's
 * `/api/patches` handler. Allow/deny is byte-identical by construction.
 *
 * Rules:
 *
 * - `root` userType: always allowed.
 * - For lower tiers, the walker checks Unix-style mode bits against the
 *   `tier` of the file's owner:
 *     - If the caller's tier matches the owner's tier → use OWNER bits.
 *     - Else if the caller's tier matches the file's group tier → use GROUP bits.
 *     - Else → use OTHER bits.
 * - Reading a path requires `execute` on every parent + `read` on the target.
 * - Writing a path requires `execute` on every parent + `write` on the target.
 *
 * The `tier` of an owner string is derived by `ownerTier()` below. This is
 * the spike's simplification of "Unix uid → user model"; can be refined
 * later (e.g. with named user → tier maps) without changing call sites.
 */

import type { UserType } from '../types';
import type { FilePermissions } from './types';

export type WalkResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: WalkDenyReason };

export type WalkDenyReason =
  | 'parent_not_traversable'
  | 'target_unreadable'
  | 'target_unwritable';

/** Tier of a file owner. Used to pick which mode-bit triplet applies. */
export const ownerTier = (owner: string): UserType => {
  if (owner === 'root') return 'root';
  if (owner === 'nobody' || owner === 'www-data') return 'guest';
  return 'user';
};

type Op = 'read' | 'write' | 'execute';

const OP_BIT: Record<Op, number> = { read: 4, write: 2, execute: 1 };

const SHIFT_OWNER = 6;
const SHIFT_GROUP = 3;
const SHIFT_OTHER = 0;

/** Pick which triplet (owner / group / other) applies for this caller. */
const pickShift = (caller: UserType, perms: FilePermissions): number => {
  if (ownerTier(perms.owner) === caller) return SHIFT_OWNER;
  if (ownerTier(perms.group) === caller) return SHIFT_GROUP;
  return SHIFT_OTHER;
};

const hasBit = (caller: UserType, perms: FilePermissions, op: Op): boolean => {
  const shift = pickShift(caller, perms);
  return (perms.mode & (OP_BIT[op] << shift)) !== 0;
};

const ALLOWED: WalkResult = { allowed: true };

/** Can `userType` read `target`, given the chain of parent directories? */
export const canRead = (
  userType: UserType,
  target: FilePermissions | null,
  parentChain: readonly FilePermissions[],
): WalkResult => {
  if (userType === 'root') return ALLOWED;

  for (const parent of parentChain) {
    if (!hasBit(userType, parent, 'execute')) {
      return { allowed: false, reason: 'parent_not_traversable' };
    }
  }

  // Leaf-only fallback — if there's no projection entry for the target,
  // permit. L2 (server) enforces only on paths that have ever been touched.
  if (target === null) return ALLOWED;

  if (!hasBit(userType, target, 'read')) {
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

  for (const parent of parentChain) {
    if (!hasBit(userType, parent, 'execute')) {
      return { allowed: false, reason: 'parent_not_traversable' };
    }
  }

  if (target === null) return ALLOWED;

  if (!hasBit(userType, target, 'write')) {
    return { allowed: false, reason: 'target_unwritable' };
  }

  return ALLOWED;
};
