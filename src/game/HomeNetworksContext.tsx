import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { generateWifiNetworks } from '../generation/generateWifi';
import { generateHomeNetwork, type HomeNetwork } from '../generation/generateHomeNetwork';
import { joinHomeNetwork } from '../homeNetworks/client';
import { getIdentity } from '../identity';
import type { WifiConnection } from '../network/wifiTypes';

// React Context for cracked-WiFi home networks. The cache lives in a ref
// (mutated synchronously) so concurrent ensureJoined calls observe each
// other's writes without waiting for a re-render. A version counter in
// useState forces re-renders so consumers (activeNetwork lookup,
// joinedNetworks array) see the latest cache state.
//
// Why a context (vs the previous bare useHomeNetworks hook): the join
// flow is triggered from nmcli (deep in the Terminal tree) but the
// resolved active network is consumed at App.tsx (above Terminal). A
// shared cache requires either context or a module-level singleton —
// context wins for testability and React-native re-render semantics.
//
// Why ref + version (vs useState<Map>): state-based caches make
// ensureJoined's closure capture a stale empty Map between sequential
// awaits, causing redundant joinHomeNetwork calls.

type HomeNetworksContextValue = {
  // Network the player is currently connected to via WiFi (cache lookup
  // by connectedWifi.essid). Null when not connected, or when the cache
  // hasn't materialized this essid yet.
  readonly activeNetwork: HomeNetwork | null;
  // All home networks the player has joined this session — used by the
  // mission-network generator's collision-avoidance (each home network's
  // public IP is taken).
  readonly joinedNetworks: readonly HomeNetwork[];
  // Idempotent: returns the cached network if already joined; otherwise
  // calls /api/join-home-network, generates the topology with the server-
  // assigned slot/hostname, caches, and returns. Throws on unknown essid
  // or server error.
  readonly ensureJoined: (essid: string) => Promise<HomeNetwork>;
};

const HomeNetworksContext = createContext<HomeNetworksContextValue | null>(null);

export const useHomeNetworks = (): HomeNetworksContextValue => {
  const ctx = useContext(HomeNetworksContext);
  if (!ctx) {
    throw new Error('useHomeNetworks must be used within a HomeNetworksProvider');
  }
  return ctx;
};

type HomeNetworksProviderProps = {
  readonly gameSeed: string | null;
  readonly workstationPrefix: string | null;
  readonly connectedWifi: WifiConnection | null;
  readonly children: ReactNode;
};

export const HomeNetworksProvider = ({
  gameSeed,
  workstationPrefix,
  connectedWifi,
  children,
}: HomeNetworksProviderProps) => {
  const wifiNetworks = useMemo(() => (gameSeed ? generateWifiNetworks(gameSeed) : []), [gameSeed]);

  // Cache mutated synchronously inside ensureJoined; version increments
  // bump consumers' useMemo so derived values (activeNetwork,
  // joinedNetworks) refresh on each cache write.
  const cacheRef = useRef<Map<string, HomeNetwork>>(new Map());
  const [version, setVersion] = useState(0);
  // Tracks in-flight ensureJoined promises so concurrent calls for the
  // same essid coalesce into a single server round-trip.
  const inFlightRef = useRef<Map<string, Promise<HomeNetwork>>>(new Map());

  const ensureJoined = useCallback(
    async (essid: string): Promise<HomeNetwork> => {
      const cached = cacheRef.current.get(essid);
      if (cached) return cached;

      const inFlight = inFlightRef.current.get(essid);
      if (inFlight) return inFlight;

      const wifi = wifiNetworks.find((w) => w.essid === essid);
      if (!wifi || !wifi.tier) {
        throw new Error(`ensureJoined: unknown crackable WiFi "${essid}"`);
      }
      if (!workstationPrefix) {
        throw new Error('ensureJoined: workstationPrefix is required');
      }

      const promise = (async () => {
        try {
          const result = await joinHomeNetwork(getIdentity(), {
            essid_template: essid,
            density_tier: wifi.tier!,
            workstation_prefix: workstationPrefix,
          });
          const network = await generateHomeNetwork({
            seed: result.network_seed,
            essid,
            slotIp: result.lan_ip,
            hostname: result.hostname,
          });
          cacheRef.current.set(essid, network);
          setVersion((v) => v + 1);
          return network;
        } finally {
          inFlightRef.current.delete(essid);
        }
      })();

      inFlightRef.current.set(essid, promise);
      return promise;
    },
    [wifiNetworks, workstationPrefix],
  );

  // Rehydration: when connectedWifi is restored from storage on page load,
  // or set by another tab via cross-tab sync, materialize the home network
  // automatically so activeNetwork resolves without an explicit ensureJoined.
  useEffect(() => {
    if (!connectedWifi) return;
    if (cacheRef.current.has(connectedWifi.essid)) return;
    void ensureJoined(connectedWifi.essid).catch((err: unknown) => {
      console.error('[HomeNetworksContext] rehydration ensureJoined failed:', err);
    });
  }, [connectedWifi, ensureJoined]);

  const value = useMemo<HomeNetworksContextValue>(
    () => ({
      activeNetwork: connectedWifi ? (cacheRef.current.get(connectedWifi.essid) ?? null) : null,
      joinedNetworks: Array.from(cacheRef.current.values()),
      ensureJoined,
    }),
    // version is the cache-mutation tracker — bump it to refresh derived values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connectedWifi, ensureJoined, version],
  );

  return <HomeNetworksContext.Provider value={value}>{children}</HomeNetworksContext.Provider>;
};
