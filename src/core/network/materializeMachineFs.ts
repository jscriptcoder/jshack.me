/**
 * materializeMachineFs — the shared "rebuild a machine's REAL tree" step every
 * cross-player server path leans on: a generated base FS with the machine's
 * persisted patch journal replayed over it, every writer's rows ordered
 * chronologically (D1–D3) so the latest write to each path wins.
 *
 * The workstation and the router differ ONLY in how their base is built (owner
 * workstation identity vs router identity), so each composes this with its own
 * base builder — one replay path, no drift in how a journal becomes a tree.
 */

import { applyPatches, type Patch } from '../filesystem/applyPatches';
import { orderPatchesForReplay } from '../patches/orderPatchesForReplay';
import type { Directory, FilePermissions } from '../filesystem/types';

/** One of a machine's persisted patch rows — the same shape `/api/patches` reads,
 *  mapped into a client `Patch` for replay. After the shared-journal flip these are
 *  the MACHINE's rows (every writer's), carrying the SERVER `updated_at` +
 *  `writer_key` so they replay in chronological order. */
export type OwnerPatchRow = {
  readonly path: string;
  readonly content: string | null;
  readonly owner: string;
  readonly permissions: FilePermissions | null;
  readonly node_type: 'file' | 'directory' | null;
  readonly updated_at: string;
  readonly writer_key: string;
};

const rowToPatch = (row: OwnerPatchRow): Patch => ({
  path: row.path,
  content: row.content,
  owner: row.owner,
  ...(row.permissions ? { permissions: row.permissions } : {}),
  ...(row.node_type ? { nodeType: row.node_type } : {}),
});

/** Replay a machine's ordered journal over its generated `base` tree. */
export const materializeMachineFs = (
  base: Directory,
  patches: readonly OwnerPatchRow[] | null,
): Directory => applyPatches(base, orderPatchesForReplay(patches ?? []).map(rowToPatch));
