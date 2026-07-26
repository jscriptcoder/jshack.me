/**
 * Connection persistence — the "survives a reload" half of the WiFi arc.
 *
 * Persist achievements, not tool-state, and persist the minimum. So we store the
 * connected ESSID and nothing about the radio — `wlan0`'s monitor flag is transient
 * (resets to off on load). The player's ADDRESS on that network is not re-derived
 * here: it is a server-issued lease, remembered separately by `lanLeaseCache`, and
 * both halves must be present to come back online.
 *
 * Both functions take an injected `Storage`-like object (not `localStorage`
 * directly) so the round-trip is pure and unit-testable with a fake map. The UI
 * (`ui/state`) supplies the real `localStorage`.
 */

import { lanLeaseCacheIn } from '../core/network/lanLeaseCache';
import type { ConnectivityState, NetworkInterface } from '../core/network/interfaces';
import { bssidFromEssid } from '../core/network/wifi';

export const CONNECTED_ESSID_KEY = 'jshack:connected-essid';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Mirror `wlan0`'s current association into storage. Called on every `wlan0`
 * mutation (`env.setInterface`), so the stored ESSID always tracks the live
 * connection: associated ⇒ store the ESSID, disconnected ⇒ clear it. Non-
 * wireless interfaces never touch the key.
 */
export const persistConnection = (storage: StorageLike, iface: NetworkInterface): void => {
  if (iface.kind !== 'wireless') return;
  const essid = iface.association?.essid ?? null;
  if (essid === null) {
    storage.removeItem(CONNECTED_ESSID_KEY);
    return;
  }
  storage.setItem(CONNECTED_ESSID_KEY, essid);
  // Remember the address this network put us on, so a reload restores it without a
  // round-trip. This is the ONE writer of that memory: every path that addresses
  // wlan0 goes through here, so none of them can forget. Disconnecting deliberately
  // does NOT erase it — the lease outlives the disconnect server-side, and forgetting
  // it here is what would force a reconnect to depend on a reachable server.
  if (iface.ipv4 !== null) lanLeaseCacheIn(storage).remember(essid, iface.ipv4);
};

/**
 * Rehydrate the connection on startup. If a connected ESSID is stored AND we still
 * remember the address that network leased us, return a connectivity state with
 * `wlan0` associated; otherwise return the cold state untouched (offline). The
 * stored ESSID is trusted (the password was proven when the player originally
 * connected), and restore is deliberately INDEPENDENT of the current scan list:
 * scans re-roll per `airdump`, so a connected AP need not appear in the latest roll
 * — looking it up there would drop the player offline on a reload that happened to
 * re-roll past the connected network.
 *
 * The BSSID is still re-derived from the ESSID (it belongs to the AP, not the
 * player), but the ADDRESS is recalled rather than computed: it is a server-issued
 * lease, and for a player the server relocated off a contested octet no local
 * derivation reproduces it. A stored ESSID with no remembered lease means we hold no
 * address on that network, so the player comes back disconnected and rejoins through
 * the server — never silently occupying an address that may be someone else's.
 */
export const restoreConnection = (
  storage: StorageLike,
  cold: ConnectivityState,
): ConnectivityState => {
  const essid = storage.getItem(CONNECTED_ESSID_KEY);
  if (essid === null) return cold;

  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') return cold;

  const localIp = lanLeaseCacheIn(storage).recall(essid);
  if (localIp === null) return cold;

  const connected: NetworkInterface = {
    ...wlan0,
    association: { essid, bssid: bssidFromEssid(essid) },
    ipv4: localIp,
  };
  return { interfaces: new Map(cold.interfaces).set('wlan0', connected) };
};
