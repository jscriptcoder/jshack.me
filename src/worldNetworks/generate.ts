import type { MissionNetwork } from '../generation/types.js';
import type { WorldNetwork } from './types.js';

// Generator signature mirrors generateMissionNetwork(seed, usedIps?,
// options?) — see src/generation/generateMission.ts. We pin a fake
// allocator that returns the row's public_ip so generation is
// deterministic across players (same seed + same IP = same machines).
//
// Returning the full MissionNetwork (not just fileSystems) is the key
// correction vs the abandoned PR #83 — App.tsx needs machines /
// networkConfig / routerMachine / layers to feed NetworkProvider, not
// just the filesystems map.
type WorldNetworkGenerator = (
  seed: string,
  usedIps: ReadonlySet<string> | undefined,
  options: { readonly allocateIp: (kind: 'mission_instance') => Promise<string> },
) => Promise<MissionNetwork>;

// Generate full networks for every supplied world_networks row. The
// returned array preserves input order — this matters because callers
// may layer on themed UX (sort by theme, group, etc.) that shouldn't
// be silently shuffled by Promise settle order.
//
// Generator is injectable so unit tests don't run the heavy mission
// generator; production callers pass `generateMissionNetwork` from
// src/generation/generateMission.ts.
export const generateWorldNetworks = async (
  rows: ReadonlyArray<WorldNetwork>,
  generator: WorldNetworkGenerator,
): Promise<ReadonlyArray<MissionNetwork>> => {
  return Promise.all(
    rows.map((row) =>
      generator(row.seed, undefined, {
        allocateIp: async () => row.public_ip,
      }),
    ),
  );
};
