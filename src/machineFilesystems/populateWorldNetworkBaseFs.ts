import { flattenFileSystemsToRows, type MachineFsRow } from './flattenFileNode';
import type { WorldNetwork } from '../worldNetworks/types';
import type { ThemedGenerator } from '../worldNetworks/generate';

// Server-side base-FS backfill for a world network. Mirror of
// regenHomeNetworkRows for the world_networks table — given a row and
// the full rows list, dispatch to the row's themed generator and flatten
// the resulting fileSystems into one MachineFsRow per FileNode.
//
// allRows is forwarded verbatim into the generator context because some
// themed generators aggregate from peer rows (findit.io's index.json is
// built from every row's search_metadata + public_domain). Callers must
// pass a consistent snapshot for every per-row regen in a single backfill
// pass — taking it once at the top of the script and reusing it keeps
// findit.io's index identical across regen calls within the run.
//
// allocateIp ignores its `kind` argument and returns the row's pinned
// public_ip, mirroring the production wiring in src/worldNetworks/generate
// where world_networks rows have a fixed IP. Real allocation is handled
// at row-creation time (migration), not at regen time.
//
// selectGenerator is injected so unit tests don't need to load the real
// registry (which pulls in heavy mission-generation code). Production
// callers pass `selectGenerator` from src/themedNetworks/generators/registry.
//
// Idempotency lives at the DB layer via the (machine_id, path) primary
// key + ON CONFLICT DO NOTHING in the bulk-insert wiring. The helper
// itself is pure regen — same inputs always produce the same rows.

export type RegenWorldNetworkInput = {
  readonly row: WorldNetwork;
  readonly allRows: ReadonlyArray<WorldNetwork>;
  readonly selectGenerator: (theme: string) => ThemedGenerator;
};

export const regenWorldNetworkRows = async (
  input: RegenWorldNetworkInput,
): Promise<readonly MachineFsRow[]> => {
  const generator = input.selectGenerator(input.row.theme);
  const network = await generator(input.row, {
    allocateIp: async () => input.row.public_ip,
    allRows: input.allRows,
  });
  return flattenFileSystemsToRows(network.fileSystems);
};
