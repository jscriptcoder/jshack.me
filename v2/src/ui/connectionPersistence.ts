/**
 * Connection persistence — the "survives a reload" half of the WiFi arc.
 *
 * Decision 7 (grill-me): persist achievements, not tool-state, and persist the
 * minimum + re-derive. So we store ONLY the connected ESSID; `wlan0`'s monitor
 * flag is transient (resets to off on load), and the assigned IP is re-derived
 * on startup through the deterministic `assignHomeNetwork` seam. Storing one
 * string is enough to come back online.
 *
 * Both functions take an injected `Storage`-like object (not `localStorage`
 * directly) so the round-trip is pure and unit-testable with a fake map. The UI
 * (`ui/state`) supplies the real `localStorage`.
 */

import { assignHomeNetwork } from '../core/network/homeNetwork';
import type { ConnectivityState, NetworkInterface } from '../core/network/interfaces';
import type { WifiNetwork } from '../core/network/wifi';

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
};

/**
 * Rehydrate the connection on startup. If a connected ESSID is stored and that
 * AP is still in range, re-derive its address through the join seam and return
 * a connectivity state with `wlan0` associated; otherwise return the cold state
 * untouched (offline). The stored ESSID is trusted — the password was already
 * proven when the player originally connected, so no re-validation here.
 */
export const restoreConnection = (
  storage: StorageLike,
  cold: ConnectivityState,
  wifi: readonly WifiNetwork[],
  seedPubkeyHex: string,
): ConnectivityState => {
  const essid = storage.getItem(CONNECTED_ESSID_KEY);
  if (essid === null) return cold;

  const network = wifi.find((candidate) => candidate.essid === essid);
  const wlan0 = cold.interfaces.get('wlan0');
  if (network === undefined || wlan0 === undefined || wlan0.kind !== 'wireless') return cold;

  const { localIp } = assignHomeNetwork(seedPubkeyHex, essid);
  const connected: NetworkInterface = {
    ...wlan0,
    association: { essid, bssid: network.bssid },
    ipv4: localIp,
  };
  return { interfaces: new Map(cold.interfaces).set('wlan0', connected) };
};
