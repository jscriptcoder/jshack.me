import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { generateHomeNetwork, type HomeNetwork } from '../generation/generateHomeNetwork';
import { lookupHomeNetwork } from '../homeNetworks/lookupClient';
import { listOccupants } from '../homeNetworks/listOccupants';
import { getIdentity } from '../identity';
import type { OccupantSummary } from '../homeNetworks/types';
import type { FileNode } from '../filesystem/types';
import { isPublicIpv4 } from './isPublicIpv4';

// Session-scoped cache of regenerated foreign home networks plus the
// single async resolver. The cache key is the foreign network's public IP.
// Refs hold the cache so concurrent ensureForeignReachable calls observe
// each other's writes without waiting for a re-render; a version counter
// in useState forces re-renders so consumers' derived selectors refresh
// after each cache mutation.
//
// Why a new context (vs augmenting useHomeNetworks): own-home flows go
// through HomeNetworksContext (joinHomeNetwork, slot allocation, occupant
// persistence). Foreign networks are READ-ONLY from this client's
// perspective — we never join them, we just regenerate their topology
// from the server-stored seed. Separating the concerns keeps each
// context's lifecycle and tests narrow.
//
// Discards on page reload (no IndexedDB persistence) — refs reset, cache
// rebuilds on first cross-LAN touch.

type ForeignEntry = {
  readonly network: HomeNetwork;
  readonly occupants: readonly OccupantSummary[];
};

type ForeignNetworksContextValue = {
  // All foreign networks cached this session, in insertion order.
  readonly foreignNetworks: readonly HomeNetwork[];
  // Flattened occupants across all cached foreign networks.
  readonly foreignLanOccupants: readonly OccupantSummary[];
  // Merged base filesystems across all cached foreign networks, keyed
  // by machine_id. Consumed by FileSystemProvider so cross-LAN reads
  // resolve against the regenerated tree.
  readonly foreignFileSystems: Readonly<Record<string, FileNode>>;
  // Deduped hostnames of foreign LAN occupants. Folded into the
  // FileSystem subscription keyset so cross-LAN workstation patches
  // stream over Realtime.
  readonly foreignLanOccupantHostnames: readonly string[];
  // Idempotent loader for a foreign network. Returns null when:
  //   - publicIp is not a public IPv4 (RFC1918, loopback, link-local,
  //     CGNAT, multicast, reserved, malformed)
  //   - publicIp matches the player's OWN active home public IP (no
  //     foreign load needed — own state is already loaded)
  //   - the server returns 404 (no home_networks row for this IP)
  //
  // Otherwise: lookups + regenerates + caches the foreign HomeNetwork
  // and returns it.
  readonly ensureForeignReachable: (publicIp: string) => Promise<HomeNetwork | null>;
};

const ForeignNetworksContext = createContext<ForeignNetworksContextValue | null>(null);

export const useForeignNetworks = (): ForeignNetworksContextValue => {
  const ctx = useContext(ForeignNetworksContext);
  if (!ctx) {
    throw new Error('useForeignNetworks must be used within a ForeignNetworksProvider');
  }
  return ctx;
};

type ForeignNetworksProviderProps = {
  // The player's own active home network's public IP. Used to
  // short-circuit ensureForeignReachable so the resolver never fires
  // on the player's own LAN — that data is already loaded through
  // HomeNetworksContext. Null when the player isn't connected to a
  // home network.
  readonly ownActiveHomePublicIp: string | null;
  readonly children: ReactNode;
};

export const ForeignNetworksProvider = ({
  ownActiveHomePublicIp,
  children,
}: ForeignNetworksProviderProps) => {
  // Cache mutated synchronously inside ensureForeignReachable; version
  // bumps trigger consumer re-renders so derived selectors refresh.
  const cacheRef = useRef<Map<string, ForeignEntry>>(new Map());
  // Tracks in-flight resolutions so concurrent calls for the same IP
  // coalesce into a single server round-trip + regen + occupant fetch.
  const inFlightRef = useRef<Map<string, Promise<HomeNetwork | null>>>(new Map());
  const [version, setVersion] = useState(0);

  const ensureForeignReachable = useCallback(
    async (publicIp: string): Promise<HomeNetwork | null> => {
      if (!isPublicIpv4(publicIp)) return null;
      if (publicIp === ownActiveHomePublicIp) return null;

      const cached = cacheRef.current.get(publicIp);
      if (cached) return cached.network;

      const inFlight = inFlightRef.current.get(publicIp);
      if (inFlight) return inFlight;

      const promise = (async (): Promise<HomeNetwork | null> => {
        try {
          const lookupResult = await lookupHomeNetwork(getIdentity(), publicIp);
          if (lookupResult === null) return null;

          // Regen + occupants in parallel — independent server fetches.
          const [network, occupants] = await Promise.all([
            generateHomeNetwork({
              seed: lookupResult.seed,
              essid: lookupResult.essid_template,
              routerPublicIp: lookupResult.public_ip,
            }),
            listOccupants(lookupResult.public_ip),
          ]);

          cacheRef.current.set(publicIp, { network, occupants });
          setVersion((v) => v + 1);
          return network;
        } catch (error) {
          console.error('[foreignNetworks] resolver failed for', publicIp, error);
          return null;
        } finally {
          inFlightRef.current.delete(publicIp);
        }
      })();

      inFlightRef.current.set(publicIp, promise);
      return promise;
    },
    [ownActiveHomePublicIp],
  );

  const value = useMemo<ForeignNetworksContextValue>(() => {
    const entries = Array.from(cacheRef.current.values());
    const foreignNetworks = entries.map((entry) => entry.network);
    const foreignLanOccupants = entries.flatMap((entry) => [...entry.occupants]);
    const foreignFileSystems = entries.reduce<Record<string, FileNode>>(
      (acc, entry) => ({ ...acc, ...entry.network.fileSystems }),
      {},
    );
    const foreignLanOccupantHostnames = Array.from(
      new Set(foreignLanOccupants.map((occupant) => occupant.hostname)),
    );
    return {
      foreignNetworks,
      foreignLanOccupants,
      foreignFileSystems,
      foreignLanOccupantHostnames,
      ensureForeignReachable,
    };
    // version is the cache-mutation tracker — recompute on every bump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureForeignReachable, version]);

  return (
    <ForeignNetworksContext.Provider value={value}>{children}</ForeignNetworksContext.Provider>
  );
};
