/**
 * FS tree wire codec (Story 2, slice 2c).
 *
 * A cross-player read is SERVER-served (decision D1): the server materializes the
 * owner's box, filters it for the reader's tier (`filterTreeForRead`), and ships
 * the resulting `Directory` back. But `Directory.entries` is a `Map`, and
 * `JSON.stringify(new Map())` is `{}` — JSON has no Map, so every entry would
 * silently vanish on the wire. This codec converts the tree to a plain-object form
 * before transport and rebuilds the Maps on the far side.
 *
 * File nodes are already JSON-safe (string content + plain perms/metadata), so they
 * pass through untouched; only directories need their `entries` Map flattened to a
 * record. Pure and symmetric: `deserializeTree(serializeTree(t))` deep-equals `t`.
 */

import type { Directory, FileEntry, FileNode } from './types';

/** A directory whose `entries` Map has been flattened to a plain record so JSON
 *  preserves it. Files serialize as-is. */
export type SerializedDirectory = {
  readonly kind: 'directory';
  readonly owner: string;
  readonly perms: Directory['perms'];
  readonly entries: Readonly<Record<string, SerializedNode>>;
};

export type SerializedNode = FileEntry | SerializedDirectory;

const serializeNode = (node: FileNode): SerializedNode =>
  node.kind === 'file' ? node : serializeTree(node);

/** Convert a live `Directory` (Map entries) into its JSON-safe wire form. */
export const serializeTree = (tree: Directory): SerializedDirectory => ({
  kind: 'directory',
  owner: tree.owner,
  perms: tree.perms,
  entries: Object.fromEntries(
    [...tree.entries].map(([name, child]) => [name, serializeNode(child)]),
  ),
});

const deserializeNode = (node: SerializedNode): FileNode =>
  node.kind === 'file' ? node : deserializeTree(node);

/** Rebuild a live `Directory` (Map entries) from its JSON-safe wire form. */
export const deserializeTree = (node: SerializedDirectory): Directory => ({
  kind: 'directory',
  owner: node.owner,
  perms: node.perms,
  entries: new Map(Object.entries(node.entries).map(([name, child]) => [name, deserializeNode(child)])),
});
