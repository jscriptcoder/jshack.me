/**
 * applyPatches — materialize a player's current view of ONE machine by
 * replaying its patch journal over a regenerated base filesystem.
 *
 * Pure and immutable: every operation returns a fresh `Directory`; the base
 * tree is never mutated. Patches are folded left-to-right, so the journal's
 * order is the resolution order (last write wins for a given path).
 *
 * Patch kinds (mirrors the legacy semantics, single-machine flavour):
 *   - `nodeType: 'directory'`  → create an empty directory; NO-OP if anything
 *     already exists at the path, so replaying a `mkdir` never clobbers files
 *     added under it later.
 *   - `content: null`          → deletion marker: remove the node at the path.
 *   - `content: string`        → file upsert: update an existing file's content
 *     (preserving owner/perms unless the patch supplies new perms), or create a
 *     new file. Missing intermediate directories are scaffolded as
 *     world-traversable dirs.
 *
 * Production patches always carry explicit `permissions` (the write commands
 * stamp them); the `default*Permissions` fallbacks only guard a malformed or
 * permission-less patch so it still materializes with sane defaults.
 */

import type { Directory, FileNode, FilePermissions } from './types';
import { defaultDirectoryPermissions, defaultFilePermissions } from './defaultPermissions';

/** Client-side patch shape. The adapter maps server rows (snake_case JSONB)
 *  into this; `applyPatches` and the write commands speak this shape. */
export type Patch = {
  /** Absolute path on the machine the patch belongs to. */
  readonly path: string;
  /** `null` = deletion marker; otherwise the file's content. Directory
   *  patches carry `null` too — they are distinguished by `nodeType`. */
  readonly content: string | null;
  readonly owner: string;
  readonly permissions?: FilePermissions;
  /** Defaults to `'file'` when absent. */
  readonly nodeType?: 'file' | 'directory';
};

const segmentsOf = (path: string): readonly string[] =>
  path.split('/').filter((segment) => segment !== '');

/** Intermediate directories created implicitly when a deep path is inserted
 *  and its parents don't exist yet — world-traversable, root-writable. */
const scaffoldDir = (): Directory => ({
  kind: 'directory',
  owner: 'root',
  perms: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root', 'user', 'guest'] },
  entries: new Map(),
});

const withEntry = (dir: Directory, name: string, child: FileNode): Directory => ({
  ...dir,
  entries: new Map(dir.entries).set(name, child),
});

const withoutEntry = (dir: Directory, name: string): Directory => {
  const entries = new Map(dir.entries);
  entries.delete(name);
  return { ...dir, entries };
};

const nodeAt = (dir: Directory, segments: readonly string[]): FileNode | null => {
  const [head, ...rest] = segments;
  if (head === undefined) return dir;
  const next = dir.entries.get(head);
  if (next === undefined) return null;
  if (rest.length === 0) return next;
  if (next.kind !== 'directory') return null;
  return nodeAt(next, rest);
};

/** Insert `node` at `segments`, scaffolding any missing parent directories. */
const insertNode = (dir: Directory, segments: readonly string[], node: FileNode): Directory => {
  const [head, ...rest] = segments;
  if (head === undefined) return dir;
  if (rest.length === 0) return withEntry(dir, head, node);
  const existing = dir.entries.get(head);
  const child = existing !== undefined && existing.kind === 'directory' ? existing : scaffoldDir();
  return withEntry(dir, head, insertNode(child, rest, node));
};

/** Remove the node at `segments`. No-op if any segment is missing. */
const removeNode = (dir: Directory, segments: readonly string[]): Directory => {
  const [head, ...rest] = segments;
  if (head === undefined) return dir;
  const existing = dir.entries.get(head);
  if (existing === undefined) return dir;
  if (rest.length === 0) return withoutEntry(dir, head);
  if (existing.kind !== 'directory') return dir;
  return withEntry(dir, head, removeNode(existing, rest));
};

const applyOne = (tree: Directory, patch: Patch): Directory => {
  const segments = segmentsOf(patch.path);

  if (patch.nodeType === 'directory') {
    const existingDir = nodeAt(tree, segments);
    if (existingDir !== null) {
      // A directory that is already here plus a patch naming permissions is a
      // chmod: a directory carries no content, so there is nothing to compose
      // and the row is exact. Entries and owner are kept — a permission change
      // is not a re-creation, and emptying the node would lose a whole subtree.
      // A row with no permissions is a `mkdir` that lost its race, and mkdir
      // refuses a directory that exists, so it changes nothing.
      return patch.permissions === undefined || existingDir.kind !== 'directory'
        ? tree
        : insertNode(tree, segments, { ...existingDir, perms: patch.permissions });
    }
    const newDir: Directory = {
      kind: 'directory',
      owner: patch.owner,
      perms: patch.permissions ?? defaultDirectoryPermissions('user'),
      entries: new Map(),
    };
    return insertNode(tree, segments, newDir);
  }

  if (patch.content === null) {
    return removeNode(tree, segments);
  }

  const content = patch.content;
  const existing = nodeAt(tree, segments);
  if (existing !== null && existing.kind === 'file') {
    const updated: FileNode = {
      ...existing,
      content,
      ...(patch.permissions ? { perms: patch.permissions } : {}),
    };
    return insertNode(tree, segments, updated);
  }

  const newFile: FileNode = {
    kind: 'file',
    content,
    owner: patch.owner,
    perms: patch.permissions ?? defaultFilePermissions('user'),
  };
  return insertNode(tree, segments, newFile);
};

export const applyPatches = (base: Directory, patches: readonly Patch[]): Directory =>
  patches.reduce(applyOne, base);
