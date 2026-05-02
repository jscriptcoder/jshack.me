import type { MissionNetwork } from '../generation/types.js';
import type { WorldNetwork } from './types.js';

// Generator context passed to every themed generator. allocateIp is
// pinned per-row to return that row's public_ip — so generation is
// deterministic across players (same seed + same IP = same machines).
// allRows is the full list of world_networks rows so generators that
// aggregate (e.g., findit.io's index builder) can read peer metadata.
export type ThemedGeneratorContext = {
  readonly allocateIp: (kind: 'mission_instance') => Promise<string>;
  readonly allRows: ReadonlyArray<WorldNetwork>;
};

// Theme-aware generator signature. Each themed network type ships a
// function of this shape. The default (mission-network-shaped) wrapper
// in themedNetworks/generators/registry.ts adapts the legacy
// generateMissionNetwork to it.
export type ThemedGenerator = (
  row: WorldNetwork,
  ctx: ThemedGeneratorContext,
) => Promise<MissionNetwork>;

// Generate full networks for every supplied world_networks row,
// dispatching on row.theme via the supplied selector. Order preserved
// so callers that layer themed UX (sort by theme, group, etc.) aren't
// silently shuffled by Promise settle order.
//
// `selectGenerator` is injectable so unit tests don't run the heavy
// mission generator; production callers pass the registry's selector
// from src/themedNetworks/generators/registry.ts.
export const generateWorldNetworks = async (
  rows: ReadonlyArray<WorldNetwork>,
  selectGenerator: (theme: string) => ThemedGenerator,
): Promise<ReadonlyArray<MissionNetwork>> => {
  return Promise.all(
    rows.map((row) =>
      selectGenerator(row.theme)(row, {
        allocateIp: async () => row.public_ip,
        allRows: rows,
      }),
    ),
  );
};
