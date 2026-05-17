import type { LookupHomeNetworkResult } from '../homeNetworks/types';
import type { GenerateHomeNetworkParams, HomeNetwork } from '../generation/generateHomeNetwork';
import type { RemoteMachine } from './types';

// Pure-ish resolver for piece-2b lazy subscription: given a foreign public
// IP, asks the server for the home_networks row, regenerates the foreign
// router locally (deterministic from the public IP via seed=`home-${ip}`),
// caches the result, and subscribes the player to the router's patch
// stream so cross-player iptables / port edits propagate live.
//
// Cache stores `RemoteMachine | null` keyed by public IP. null is the
// negative-cache marker — distinguishes "looked up, doesn't exist" from
// "never tried" (no key). Negative caching matters because once C2 lands,
// every findMachineByIp call for an unresolvable foreign IP would
// otherwise burn a round-trip.
//
// Subscription is fire-once: addCrossLanMachineId is idempotent at the
// FileSystemContext layer, but skipping the call entirely on cache hit
// avoids a wasteful setState round-trip.

export type ResolveForeignRouterDeps = {
  readonly lookup: (publicIp: string) => Promise<LookupHomeNetworkResult | null>;
  readonly regenerate: (params: GenerateHomeNetworkParams) => Promise<HomeNetwork>;
  readonly addCrossLanMachineId: (machineId: string) => void;
  readonly cache: Map<string, RemoteMachine | null>;
};

export const resolveForeignRouter = async (
  publicIp: string,
  deps: ResolveForeignRouterDeps,
): Promise<RemoteMachine | null> => {
  if (deps.cache.has(publicIp)) {
    return deps.cache.get(publicIp) ?? null;
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

  const remoteMachine = homeNetwork.routerMachine.remoteMachine;
  deps.cache.set(publicIp, remoteMachine);
  deps.addCrossLanMachineId(publicIp);

  return remoteMachine;
};
