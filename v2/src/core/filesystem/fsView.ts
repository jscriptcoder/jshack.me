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
import { canRead } from './walker';
import type { FsListResult, FsReadResult, FsView } from '../commands/types';

type Resolved = {
  /** The node at the path, or null if any segment is missing or a
   *  non-directory was traversed. */
  readonly node: FileNode | null;
  /** Perms of each ancestor directory (excluding the target) — the parent
   *  chain the walker checks for traversability. */
  readonly parents: readonly FilePermissions[];
};

const segmentsOf = (path: AbsPath): readonly string[] =>
  path.split('/').filter((segment) => segment !== '');

/** Walk `segments` from `node`, accumulating each traversed directory's perms
 *  into `parents`. A single pass yields both the leaf and its parent chain. */
const walk = (
  node: FileNode,
  segments: readonly string[],
  parents: readonly FilePermissions[],
): Resolved => {
  const [head, ...rest] = segments;
  if (head === undefined) return { node, parents };
  if (node.kind !== 'directory') return { node: null, parents };
  const next = node.entries.get(head);
  if (next === undefined) return { node: null, parents };
  return walk(next, rest, [...parents, node.perms]);
};

export const createFsView = (
  tree: Directory,
  options: { readonly userType?: UserType; readonly cwd?: AbsPath } = {},
): FsView => {
  const userType = options.userType ?? 'user';
  const cwd = options.cwd ?? asAbsPath('/');

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

  return {
    cwd: () => cwd,
    read,
    list,
    stat: (path: AbsPath): FileNode | null => resolve(path).node,
    root: () => tree,
  };
};
