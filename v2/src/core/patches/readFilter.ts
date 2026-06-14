/**
 * The cross-player READ filter (Story 2, slice 2c — tier 2).
 *
 * D1 (cross-player hops are SERVER-served): the server materializes the owner's
 * box (regenerated baseline + the owner's persisted patches) and must return a
 * tree pruned to exactly what the CALLER's tier may read — because the HTTP
 * response IS the threat surface (`project_read_path_privacy_gap`): anything left
 * in the body is visible to DevTools/curl regardless of how the UI renders it.
 *
 * Pruning reuses the shared permission walker (`canRead`, the same allow/deny the
 * write path enforces) so client and server can't drift: a node survives iff every
 * ancestor directory is traversable for the tier AND the node itself is readable.
 * A dropped directory takes its whole subtree with it. `root` reads everything
 * (the walker short-circuits), so a root caller gets the tree back unchanged.
 *
 * Tier 1 (owner → unfiltered) and tier 3 (no session → externally-observable
 * allowlist) land in slice 2d; this module is the active-session walker tier.
 */

import { canRead } from '../filesystem/walker';
import type { Directory, FileNode, FilePermissions } from '../filesystem/types';
import type { UserType } from '../types';

/** Filter one directory's entries for `userType`, recursing into surviving
 *  subdirectories. `parentChain` is every ancestor's perms from root down to this
 *  directory's parent — the chain the walker checks for traversability. */
const filterDir = (
  directory: Directory,
  userType: UserType,
  parentChain: readonly FilePermissions[],
): Directory => {
  const chain = [...parentChain, directory.perms];
  const entries = new Map<string, FileNode>(
    [...directory.entries]
      .filter(([, node]) => canRead(userType, node.perms, chain).allowed)
      .map(([name, node]) => [
        name,
        node.kind === 'directory' ? filterDir(node, userType, chain) : node,
      ]),
  );
  return { ...directory, entries };
};

/** Prune `tree` to the nodes `userType` may read, server-side, before it leaves
 *  over the wire. Pure: the input tree is never mutated. */
export const filterTreeForRead = (tree: Directory, userType: UserType): Directory =>
  filterDir(tree, userType, []);
