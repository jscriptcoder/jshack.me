import { generateHomeNetwork } from '../generation/generateHomeNetwork';
import { flattenFileSystemsToRows, type MachineFsRow } from './flattenFileNode';

// Server-side base-FS backfill for a home network. Given the seed +
// pre-allocated public IP from the home_networks row, regenerate the
// network deterministically and produce one MachineFsRow per FileNode
// in every machine's filesystem (including the router and any internal
// gateway aliases under .1).
//
// The result is a single rows array suitable for `bulkInsertMachineFs`.
// Idempotent on the DB side via the (machine_id, path) primary key —
// callers use ON CONFLICT DO NOTHING so existing patches (which dual-
// wrote at upsert time) keep their values and only base-FS rows that
// don't already exist get inserted.
//
// essid is a placeholder ('regen-only') because it doesn't influence
// the BASE FS structure — it only appears in player-facing connection
// metadata, not the per-machine FS contents the L2 walker cares about.
// Same with slotIp / hostname (those are per-occupant overlays).
//
// This function powers two callers:
//   - The post-create hook in api/join-home-network.ts, which fills
//     machine_filesystems immediately after the home_networks row lands.
//   - The one-time backfill script (scripts/backfillHomeNetworkBaseFs.ts)
//     that walks every existing home_networks row.
//
// World networks (findit.io, playground) need an analogous helper —
// deferred to a follow-up PR per the L2 plan's Step 7 modest extension.
// Mission machines need server-side mission_instances first; that work
// is captured in plans/l2-patch-validation.md as a deferred follow-up.

export type RegenHomeNetworkInput = {
  readonly seed: string;
  readonly publicIp: string;
};

export const regenHomeNetworkRows = async (
  input: RegenHomeNetworkInput,
): Promise<readonly MachineFsRow[]> => {
  const network = await generateHomeNetwork({
    seed: input.seed,
    essid: 'regen-only',
    routerPublicIp: input.publicIp,
  });
  return flattenFileSystemsToRows(network.fileSystems);
};
