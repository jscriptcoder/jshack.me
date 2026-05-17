import type { LookupHomeNetworkResult } from '../homeNetworks/types';
import type { GenerateHomeNetworkParams, HomeNetwork } from '../generation/generateHomeNetwork';
import type { GeneratedMachine } from '../generation/types';
import type { RemoteMachine } from './types';

// Cache entry shape for piece-2b lazy subscription. Stores the regenerated
// router RemoteMachine (callers' return value), the LAN's occupant
// hostnames (Chunk D foothold expansion), and the LAN's internal NPC
// machines (Chunk D2 cross-LAN forward synthesis). Without
// internalMachines, the mergeForeignRouterForwards helper would have
// nothing to project NPC-target forwards against; occupant-target
// forwards fall back to the well-known-port service map.
export type ForeignLanCacheValue = {
  readonly router: RemoteMachine;
  readonly occupantHostnames: readonly string[];
  readonly internalMachines: readonly GeneratedMachine[];
};

// Pure-ish resolver for piece-2b lazy subscription: given a foreign public
// IP, asks the server for the home_networks row, regenerates the foreign
// router locally (deterministic from the public IP via seed=`home-${ip}`),
// caches the result alongside the occupant hostnames, and subscribes the
// player to the router's patch stream so cross-player iptables / port
// edits propagate live.
//
// Cache stores `ForeignLanCacheValue | null` keyed by public IP. null is
// the negative-cache marker — distinguishes "looked up, doesn't exist"
// from "never tried" (no key). Negative caching matters because once C2
// landed, every findMachineByIpAsync call for an unresolvable foreign
// IP would otherwise burn a round-trip.
//
// Subscription is fire-once: addCrossLanMachineId is idempotent at the
// FileSystemContext layer, but skipping the call entirely on cache hit
// avoids a wasteful setState round-trip.

export type ResolveForeignRouterDeps = {
  readonly lookup: (publicIp: string) => Promise<LookupHomeNetworkResult | null>;
  readonly regenerate: (params: GenerateHomeNetworkParams) => Promise<HomeNetwork>;
  readonly addCrossLanMachineId: (machineId: string) => void;
  readonly cache: Map<string, ForeignLanCacheValue | null>;
};

export const resolveForeignRouter = async (
  publicIp: string,
  deps: ResolveForeignRouterDeps,
): Promise<RemoteMachine | null> => {
  if (deps.cache.has(publicIp)) {
    const cached = deps.cache.get(publicIp);
    return cached?.router ?? null;
  }

  const lookupResult = await deps.lookup(publicIp);
  if (lookupResult === null) {
    deps.cache.set(publicIp, null);
    return null;
  }

  const homeNetwork = await deps.regenerate({
    seed: `home-${publicIp}`,
    essid: lookupResult.essid_template,
    routerPublicIp: publicIp,
  });

  const router = homeNetwork.routerMachine.remoteMachine;
  const occupantHostnames = lookupResult.occupants.map((occupant) => occupant.hostname);
  deps.cache.set(publicIp, {
    router,
    occupantHostnames,
    internalMachines: homeNetwork.machines,
  });
  deps.addCrossLanMachineId(publicIp);

  return router;
};

// Reverse-index lookup over the foreign-LAN cache: given a machineId
// (workstation_id for an occupant, public IP for a router), find which
// cached entry contains it. Used by the foothold-expansion effect — when
// a session lands on a foreign-LAN member, the caller fans the LAN's
// occupantHostnames out via addCrossLanMachineId so cross-player
// visibility on the foothold LAN matches same-LAN visibility.
//
// Returns null when no entry matches; negative-cache (null value) entries
// are skipped without dereferencing.
export const findForeignLanForMember = (
  machineId: string,
  cache: ReadonlyMap<string, ForeignLanCacheValue | null>,
): ForeignLanCacheValue | null => {
  for (const entry of cache.values()) {
    if (!entry) continue;
    if (entry.router.ip === machineId) return entry;
    if (entry.occupantHostnames.includes(machineId)) return entry;
  }
  return null;
};
