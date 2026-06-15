/**
 * materializeWorkstationFs — rebuild a registered foreign workstation's REAL tree
 * the way every cross-player server path needs it: the shared generator's
 * baseline (decision D6) with the machine's persisted patch journal replayed over
 * it — every writer's rows, ordered chronologically (D1–D3) so the latest write
 * to each path wins.
 *
 * This is the ONE materialize the cross-player READ (`resolveCrossPlayerFs`), the
 * public SCAN (`resolvePublicScan`), and the public SSH gate
 * (`authCreateSessionPublic`) share, so they agree on what A's box looks like —
 * including whether a `/boot` tombstone has bricked it (Story 4, slice 4). The
 * server is the only party that can do this: a cross-player caller holds neither
 * A's seed nor A's patch rows.
 */

import { applyPatches, type Patch } from '../filesystem/applyPatches';
import { orderPatchesForReplay } from '../patches/orderPatchesForReplay';
import {
  buildRegisteredWorkstationFs,
  type RegistryWorkstation,
} from '../patches/remoteWritePermission';
import type { Directory, FilePermissions } from '../filesystem/types';

/** One of the machine's persisted patch rows on the target — the same shape
 *  `/api/patches` reads, mapped into a client `Patch` for replay. After the
 *  shared-journal flip these are the MACHINE's rows (every writer's), carrying the
 *  SERVER `updated_at` + `writer_key` so they replay in chronological order. */
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

/** Rebuild A's REAL box: the shared generator's baseline (D6) with the machine's
 *  persisted patch journal replayed over it — every writer's rows, ordered
 *  chronologically (D1–D3) so the latest write to each path wins. */
export const materializeWorkstationFs = (
  registry: RegistryWorkstation,
  patches: readonly OwnerPatchRow[] | null,
): Directory =>
  applyPatches(
    buildRegisteredWorkstationFs(registry),
    orderPatchesForReplay(patches ?? []).map(rowToPatch),
  );
