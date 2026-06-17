/**
 * materializeWorkstationFs — rebuild a registered foreign workstation's REAL tree
 * the way every cross-player server path needs it: the shared generator's baseline
 * (decision D6) with the machine's persisted patch journal replayed over it (the
 * shared `materializeMachineFs` step).
 *
 * This is the ONE materialize the cross-player READ (`resolveCrossPlayerFs`), the
 * public SCAN (`resolvePublicScan` — for the workstation behind a forward), and the
 * public SSH gate (`authCreateSessionPublic`) share, so they agree on what A's box
 * looks like — including whether a `/boot` tombstone has bricked it (Story 4, slice
 * 4). The server is the only party that can do this: a cross-player caller holds
 * neither A's seed nor A's patch rows.
 */

import {
  buildRegisteredWorkstationFs,
  type RegistryWorkstation,
} from '../patches/remoteWritePermission';
import { materializeMachineFs, type OwnerPatchRow } from './materializeMachineFs';
import type { Directory } from '../filesystem/types';

// Re-exported so the many call sites that read the journal-row shape keep importing
// it from here (its historical home); the canonical definition now lives with the
// shared replay step.
export type { OwnerPatchRow };

/** Rebuild A's REAL box: the shared generator's baseline (D6) with the machine's
 *  persisted patch journal replayed over it. */
export const materializeWorkstationFs = (
  registry: RegistryWorkstation,
  patches: readonly OwnerPatchRow[] | null,
): Directory => materializeMachineFs(buildRegisteredWorkstationFs(registry), patches);
