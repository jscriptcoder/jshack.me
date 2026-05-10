import type { FileNode } from './types';
import type { UserType } from '../session/types';
import { canExecute, canRead } from './permissionWalker';

// Tier-2 walker filter for the cross-player base FS endpoint (PR 6 of
// plans/cross-player-base-fs-replication.md).
//
// Walks a regenerated + projection-overlaid FileNode tree and drops
// every node the caller's userType cannot reach in-game. Two rules,
// applied recursively:
//
//   1. File: drop if userType not in target.read.
//   2. Directory: drop the WHOLE subtree if userType cannot traverse
//      (target.execute). Otherwise recurse into children, filtering
//      each. The directory survives even with zero surviving children
//      — Unix-style "ls'able dir, just empty here."
//
// Returns null when the root node itself fails its access check —
// the caller treats that as "no FS to merge" and should not store
// anything under that machine_id locally.
//
// Root userType never fails; canRead/canExecute return allowed for
// 'root' regardless of the target list. Mirrors the in-game "root
// can read anything" gameplay invariant — same rule the patch read
// filter uses, same module powers it.
//
// parentChain is empty everywhere we call canRead/canExecute below
// because each recursive level has already validated its own ancestors
// — by the time we descend into a directory, that directory's traverse
// check passed at the previous level. The walker's parentChain is for
// when a SINGLE call needs to validate ancestors; we're walking
// top-down and validating one step at a time.

export const filterFileNodeForRead = (
  node: FileNode,
  userType: UserType,
): FileNode | null => {
  if (node.type === 'file') {
    const decision = canRead({ userType, target: node.permissions, parentChain: [] });
    return decision.allowed ? node : null;
  }

  // Directory — must be traversable by userType, else drop the subtree.
  const traverse = canExecute({ userType, target: node.permissions, parentChain: [] });
  if (!traverse.allowed) return null;

  if (!node.children) return node;

  const filteredChildren: Record<string, FileNode> = {};
  for (const [name, child] of Object.entries(node.children)) {
    const filtered = filterFileNodeForRead(child, userType);
    if (filtered !== null) {
      filteredChildren[name] = filtered;
    }
  }
  return { ...node, children: filteredChildren };
};
