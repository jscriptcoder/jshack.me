import { describe, expect, it } from 'vitest';
import {
  buildColdStartConnectivity,
  isOnline,
  type ConnectivityState,
  type WirelessInterface,
} from '../core/network/interfaces';
import { assignHomeNetwork } from '../core/network/homeNetwork';
import type { WifiNetwork } from '../core/network/wifi';
import { CONNECTED_ESSID_KEY, persistConnection, restoreConnection } from './connectionPersistence';

/**
 * Connection persistence is the "survives a reload" half of nmcli: the
 * connected ESSID (and ONLY the ESSID — decision 7: persist achievements, not
 * tool-state) is mirrored to storage, and `startGame` rehydrates by re-deriving
 * the rest through the deterministic join seam. These functions are pure over an
 * injected storage, so a fake Map proves the round-trip without a browser.
 */

const PUBKEY = 'a'.repeat(64);

// Mirrors the Web Storage contract that matters here: values are coerced to
// strings (so a stray `setItem(key, null)` stores the literal "null", not null)
// and a missing key reads back as null. The coercion is load-bearing for
// mutation strength — it surfaces a write-instead-of-clear bug as a real value.
const fakeStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string): string | null => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string): void => {
      map.set(key, String(value));
    },
    removeItem: (key: string): void => {
      map.delete(key);
    },
  };
};

const wlan0Of = (state: ConnectivityState): WirelessInterface => {
  const iface = state.interfaces.get('wlan0');
  if (iface === undefined || iface.kind !== 'wireless') throw new Error('unreachable');
  return iface;
};

const crackableNet = (overrides: Partial<WifiNetwork> = {}): WifiNetwork => ({
  bssid: 'AA:BB:CC:DD:EE:01',
  essid: 'BEAN-THERE-WIFI',
  power: -45,
  channel: 6,
  encryption: 'WPA2',
  crackable: true,
  password: 'sunshine2024',
  ...overrides,
});

describe('persistConnection', () => {
  it('stores the ESSID when wlan0 is associated', () => {
    const storage = fakeStorage();
    const associated: WirelessInterface = {
      ...wlan0Of(buildColdStartConnectivity(PUBKEY)),
      association: { essid: 'BEAN-THERE-WIFI', bssid: 'AA:BB:CC:DD:EE:01' },
      ipv4: '192.168.5.20',
    };

    persistConnection(storage, associated);

    expect(storage.getItem(CONNECTED_ESSID_KEY)).toBe('BEAN-THERE-WIFI');
  });

  it('clears the stored ESSID when wlan0 has no association', () => {
    const storage = fakeStorage();
    storage.setItem(CONNECTED_ESSID_KEY, 'BEAN-THERE-WIFI');

    persistConnection(storage, wlan0Of(buildColdStartConnectivity(PUBKEY)));

    expect(storage.getItem(CONNECTED_ESSID_KEY)).toBeNull();
  });

  it('ignores a non-wireless interface', () => {
    const storage = fakeStorage();
    storage.setItem(CONNECTED_ESSID_KEY, 'BEAN-THERE-WIFI');
    const eth0 = buildColdStartConnectivity(PUBKEY).interfaces.get('eth0')!;

    persistConnection(storage, eth0);

    // An eth0 mutation must not touch the WiFi connection key.
    expect(storage.getItem(CONNECTED_ESSID_KEY)).toBe('BEAN-THERE-WIFI');
  });
});

describe('restoreConnection', () => {
  it('rehydrates wlan0 from a stored ESSID, re-deriving the IP through the join seam', () => {
    const storage = fakeStorage();
    storage.setItem(CONNECTED_ESSID_KEY, 'BEAN-THERE-WIFI');
    const cold = buildColdStartConnectivity(PUBKEY);
    const wifi = [crackableNet()];

    const restored = restoreConnection(storage, cold, wifi, PUBKEY);

    const wlan0 = wlan0Of(restored);
    expect(wlan0.association).toEqual({ essid: 'BEAN-THERE-WIFI', bssid: 'AA:BB:CC:DD:EE:01' });
    // The IP is re-derived deterministically — identical to a fresh join.
    expect(wlan0.ipv4).toBe(assignHomeNetwork(PUBKEY, 'BEAN-THERE-WIFI').localIp);
    expect(isOnline(restored)).toBe(true);
  });

  it('returns the cold state unchanged when nothing is stored', () => {
    const storage = fakeStorage();
    const cold = buildColdStartConnectivity(PUBKEY);

    const restored = restoreConnection(storage, cold, [crackableNet()], PUBKEY);

    expect(restored).toBe(cold);
    expect(isOnline(restored)).toBe(false);
  });

  it('stays offline when the stored ESSID is no longer in range', () => {
    const storage = fakeStorage();
    storage.setItem(CONNECTED_ESSID_KEY, 'GONE-WIFI');
    const cold = buildColdStartConnectivity(PUBKEY);

    const restored = restoreConnection(storage, cold, [crackableNet()], PUBKEY);

    expect(restored).toBe(cold);
    expect(isOnline(restored)).toBe(false);
  });
});
