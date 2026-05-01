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
import { listOccupants } from '../homeNetworks/listOccupants';
import { subscribeToNetworkOccupants, type OccupantHint } from '../homeNetworks/realtime';
import { getRealtimeClient } from '../patchRegistry/realtime';
import type { OccupantSummary } from '../homeNetworks/types';
import { getIdentity } from '../identity';
import type { WifiConnection } from '../network/wifiTypes';

// Debounce window for hint-driven occupant refetches. Multiple hints
// arriving within this window coalesce into a single listOccupants
// SELECT. Mirrors HINT_REFETCH_DEBOUNCE_MS in FileSystemContext.
const OCCUPANT_HINT_DEBOUNCE_MS = 150;

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
  // Other players on the active LAN at the moment we connected
  // (excluding self). Fetched once when activeNetwork resolves; no
  // polling. Late-joiners require a reconnect to appear. Live updates
  // will land via the deferred Realtime subscription.
  readonly lanOccupants: readonly OccupantSummary[];
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
            // The server's allocator owns the canonical public IP and
            // stored it in home_networks.public_ip. Without this override,
            // the local PRNG would derive a different value than the
            // server's row, and home_network_occupants lookups (keyed on
            // network_id = public_ip) would miss with the wrong IP.
            routerPublicIp: result.public_ip,
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

  // Other-players-on-the-LAN fetch. Fires once per active network (on
  // connect, or when an existing cached network resolves). Self is
  // filtered out — the local player is implicit in the rendered network
  // view, not a discoverable peer.
  //
  // Live updates: subscribed to `occupants:<network_id>` Realtime
  // broadcast channel (subscription effect below). Each successful
  // server-side INSERT into home_network_occupants publishes a HINT
  // `{ network_id, originator_key }`; the hint handler refetches via
  // listOccupants for authoritative state. Self-skip on
  // originatorKey === own player_key (own join already updated local
  // state via the post-joinHomeNetwork flow).
  const [lanOccupants, setLanOccupants] = useState<readonly OccupantSummary[]>([]);

  // Active LAN network_id (the public_ip of the home network we're
  // currently connected to). Both the initial fetch and the hint
  // subscription depend on this; deriving once keeps the two effects
  // in sync.
  const activeNetworkId = useMemo(() => {
    const active = connectedWifi ? (cacheRef.current.get(connectedWifi.essid) ?? null) : null;
    return active?.router.publicIp ?? null;
    // version is the cache-mutation tracker — recompute when the active
    // network finishes materializing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedWifi, version]);

  const ownPlayerKey = useMemo(() => `ed25519:${getIdentity().publicKeyHex}`, []);

  // Refetch occupants for the active LAN. Filters self before storing.
  // Used both by the initial-on-connect fetch and the hint-driven
  // refetch (debounced).
  const refetchOccupants = useCallback(
    async (networkId: string): Promise<void> => {
      const occupants = await listOccupants(networkId);
      setLanOccupants(occupants.filter((o) => o.player_key !== ownPlayerKey));
    },
    [ownPlayerKey],
  );

  // Initial fetch on connect / active-network materialize.
  useEffect(() => {
    if (!activeNetworkId) {
      setLanOccupants([]);
      return;
    }
    let cancelled = false;
    void refetchOccupants(activeNetworkId).then(
      () => {},
      (err: unknown) => {
        if (cancelled) return;
        console.error('[HomeNetworksContext] initial occupants fetch failed:', err);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [activeNetworkId, refetchOccupants]);

  // Hint subscription: live occupant updates. See homeNetworks/realtime.ts
  // for the wire protocol and project_realtime_publish_authorization
  // memory for the threat model.
  const hintDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeNetworkId) return;
    const client = getRealtimeClient();
    if (!client) return;

    const handleHint = (hint: OccupantHint) => {
      // Self-skip: own join was already materialized locally via the
      // post-joinHomeNetwork flow + the initial-fetch effect above.
      // A redundant refetch here would burn an anon SELECT for nothing.
      // A forger spoofing originatorKey can suppress ONE refetch on the
      // victim's side; authentic hints from real writers (different
      // originatorKey) still trigger refetches. No data corruption,
      // bounded harm — same model as the patches hint flow.
      if (hint.originatorKey === ownPlayerKey) return;

      if (hintDebounceTimerRef.current !== null) {
        clearTimeout(hintDebounceTimerRef.current);
      }
      hintDebounceTimerRef.current = setTimeout(() => {
        hintDebounceTimerRef.current = null;
        void refetchOccupants(activeNetworkId).catch((err: unknown) => {
          console.error('[HomeNetworksContext] hint refetch failed:', err);
        });
      }, OCCUPANT_HINT_DEBOUNCE_MS);
    };

    const unsubscribe = subscribeToNetworkOccupants(client, activeNetworkId, handleHint);
    return () => {
      unsubscribe();
      if (hintDebounceTimerRef.current !== null) {
        clearTimeout(hintDebounceTimerRef.current);
        hintDebounceTimerRef.current = null;
      }
    };
  }, [activeNetworkId, ownPlayerKey, refetchOccupants]);

  const value = useMemo<HomeNetworksContextValue>(
    () => ({
      activeNetwork: connectedWifi ? (cacheRef.current.get(connectedWifi.essid) ?? null) : null,
      joinedNetworks: Array.from(cacheRef.current.values()),
      lanOccupants,
      ensureJoined,
    }),
    // version is the cache-mutation tracker — bump it to refresh derived values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connectedWifi, ensureJoined, version, lanOccupants],
  );

  return <HomeNetworksContext.Provider value={value}>{children}</HomeNetworksContext.Provider>;
};
