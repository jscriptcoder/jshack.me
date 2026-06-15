/**
 * createFsView — build a read-only `FsView` over a static `Directory` tree,
 * enforcing tier permissions through the shared `walker`.
 *
 * This is the single FsView builder used by BOTH the UI (production, over a
 * seeded/patched tree) and the test factory (`mockFsViewFromTree` re-exports
 * it). One implementation means no drift between what tests prove and what
 * ships — the same reason the walker itself is a single shared module.
 *
 * Writes are NOT here: mutation routes through `PatchApi`, never the view.
 */

import { asAbsPath, type AbsPath, type UserType } from '../types';
import type { Directory, FileNode, FilePermissions } from './types';
import { canRead, canWrite, type WalkResult } from './walker';
import type { FsListResult, FsReadResult, FsView } from '../commands/types';

type Resolved = {
  /** The node at the path, or null if any segment is missing or a
   *  non-directory was traversed. */
  readonly node: FileNode | null;
  /** Perms of each ancestor directory (excluding the target) — the parent
   *  chain the walker checks for traversability. */
  readonly parents: readonly FilePermissions[];
  /** When `node` is null because the FINAL segment is absent, the directory the
   *  entry would be created IN (its container) — so a create can be gated by the
   *  container's write+execute, not permitted by the null-target leaf-fallback.
   *  Null when the node exists or a deeper ancestor is missing (no container to
   *  create in). */
  readonly container: FilePermissions | null;
};

const segmentsOf = (path: AbsPath): readonly string[] =>
  path.split('/').filter((segment) => segment !== '');

/** Walk `segments` from `node`, accumulating each traversed directory's perms
 *  into `parents`. A single pass yields the leaf, its parent chain, and — when
 *  the leaf is absent — the directory it would be created in. */
const walk = (
  node: FileNode,
  segments: readonly string[],
  parents: readonly FilePermissions[],
): Resolved => {
  const [head, ...rest] = segments;
  if (head === undefined) return { node, parents, container: null };
  if (node.kind !== 'directory') return { node: null, parents, container: null };
  const next = node.entries.get(head);
  if (next === undefined) {
    // The walk stops here. If `head` was the FINAL segment, `node` is the
    // directory a create would target; a deeper miss has no direct container.
    return { node: null, parents, container: rest.length === 0 ? node.perms : null };
  }
  return walk(next, rest, [...parents, node.perms]);
};

export const createFsView = (
  tree: Directory,
  options: {
    readonly userType?: UserType;
    /** Static cwd (constant) or reader function for dynamic cwd (signal-backed
     *  in the UI). The reader form lets `cd` mutate cwd without rebuilding
     *  the view. Both forms collapse to a getter internally. */
    readonly cwd?: AbsPath | (() => AbsPath);
  } = {},
): FsView => {
  const userType = options.userType ?? 'user';
  /** Normalize `cwd` option (static or reader) to a single getter the view
   *  closes over. Using an IIFE captures the narrowed `AbsPath` binding so
   *  the returned arrow doesn't reference the still-union `options.cwd`. */
  const cwdGetter: () => AbsPath = (() => {
    if (typeof options.cwd === 'function') return options.cwd;
    const fixed = options.cwd ?? asAbsPath('/');
    return () => fixed;
  })();

  const resolve = (path: AbsPath): Resolved => walk(tree, segmentsOf(path), []);

  const read = (path: AbsPath): FsReadResult => {
    const { node, parents } = resolve(path);
    if (node === null) return { ok: false, error: 'not_found' };
    if (node.kind === 'directory') return { ok: false, error: 'is_directory' };
    if (!canRead(userType, node.perms, parents).allowed) {
      return { ok: false, error: 'permission_denied' };
    }
    return { ok: true, content: node.content };
  };

  const list = (path: AbsPath): FsListResult => {
    const { node, parents } = resolve(path);
    if (node === null) return { ok: false, error: 'not_found' };
    if (node.kind !== 'directory') return { ok: false, error: 'not_a_directory' };
    if (!canRead(userType, node.perms, parents).allowed) {
      return { ok: false, error: 'permission_denied' };
    }
    return { ok: true, entries: [...node.entries.keys()] };
  };

  const checkWrite = (path: AbsPath): WalkResult => {
    const { node, parents, container } = resolve(path);
    // Overwriting an existing node: write on the node itself + traversable
    // ancestors (Unix: modifying a file needs write on the FILE).
    if (node !== null) return canWrite(userType, node.perms, parents);
    // Creating a new entry: write + execute on the CONTAINING dir (Unix: adding
    // an entry needs write on the DIR). Pass the container as both the target
    // (its write bit) and the deepest parent (its execute bit). A deeper-missing
    // path has no container → there is nowhere to create it.
    if (container === null) return { allowed: false, reason: 'parent_not_traversable' };
    return canWrite(userType, container, [...parents, container]);
  };

  return {
    cwd: () => cwdGetter(),
    read,
    list,
    stat: (path: AbsPath): FileNode | null => resolve(path).node,
    canWrite: checkWrite,
    root: () => tree,
  };
};
