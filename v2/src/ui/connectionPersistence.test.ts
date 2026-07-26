import { describe, expect, it } from 'vitest';
import {
  buildColdStartConnectivity,
  isOnline,
  type ConnectivityState,
  type WirelessInterface,
} from '../core/network/interfaces';
import { assignHomeNetwork } from '../core/network/homeNetwork';
import { bssidFromEssid } from '../core/network/wifi';
import { CONNECTED_ESSID_KEY, persistConnection, restoreConnection } from './connectionPersistence';
import { lanLeaseCacheIn } from '../core/network/lanLeaseCache';

/**
 * Connection persistence is the "survives a reload" half of nmcli: the connected
 * ESSID and the address that network put us on are mirrored to storage, and
 * `startGame` rehydrates from both. The address is REMEMBERED rather than re-derived
 * — it is a server-issued lease — so a stored ESSID with no remembered address comes
 * back offline. These functions are pure over an injected storage, so a fake Map
 * proves the round-trip without a browser.
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
  it('rehydrates wlan0 from a stored ESSID at the address that network LEASED it', () => {
    const storage = fakeStorage();
    storage.setItem(CONNECTED_ESSID_KEY, 'BEAN-THERE-WIFI');
    // The address the server issued on the last successful join — for a relocated
    // player this is one no local derivation can reproduce.
    lanLeaseCacheIn(storage).remember('BEAN-THERE-WIFI', '192.168.29.213');
    const cold = buildColdStartConnectivity(PUBKEY);

    const restored = restoreConnection(storage, cold);

    const wlan0 = wlan0Of(restored);
    // The BSSID is still re-derived from the ESSID alone (it is the AP's, not the
    // player's); the address is recalled, because it was never ours to compute.
    expect(wlan0.association).toEqual({
      essid: 'BEAN-THERE-WIFI',
      bssid: bssidFromEssid('BEAN-THERE-WIFI'),
    });
    expect(wlan0.ipv4).toBe('192.168.29.213');
    expect(wlan0.ipv4).not.toBe(assignHomeNetwork(PUBKEY, 'BEAN-THERE-WIFI').localIp);
    expect(isOnline(restored)).toBe(true);
  });

  it('remembers a separate address per network, so reconnecting picks the right one', () => {
    const storage = fakeStorage();
    const cold = buildColdStartConnectivity(PUBKEY);
    const wlan0 = wlan0Of(cold);

    // Connect to one network, then another: each join addresses wlan0, and every
    // wlan0 change is mirrored here.
    persistConnection(storage, {
      ...wlan0,
      association: { essid: 'CAFE-WIFI', bssid: bssidFromEssid('CAFE-WIFI') },
      ipv4: '192.168.7.11',
    });
    persistConnection(storage, {
      ...wlan0,
      association: { essid: 'HOTEL-WIFI', bssid: bssidFromEssid('HOTEL-WIFI') },
      ipv4: '192.168.9.44',
    });

    // Reconnecting to the FIRST network must return its address, not the address the
    // second one issued — a player holds one lease per network, not one overall.
    storage.setItem(CONNECTED_ESSID_KEY, 'CAFE-WIFI');
    expect(wlan0Of(restoreConnection(storage, cold)).ipv4).toBe('192.168.7.11');
    storage.setItem(CONNECTED_ESSID_KEY, 'HOTEL-WIFI');
    expect(wlan0Of(restoreConnection(storage, cold)).ipv4).toBe('192.168.9.44');
  });

  it('stays offline when the stored ESSID has no remembered lease', () => {
    const storage = fakeStorage();
    storage.setItem(CONNECTED_ESSID_KEY, 'BEAN-THERE-WIFI');
    const cold = buildColdStartConnectivity(PUBKEY);

    const restored = restoreConnection(storage, cold);

    // An ESSID with no cached lease is a network we hold no address on. Deriving one
    // is what the lease replaced, so the player comes back DISCONNECTED and reconnects
    // through the server rather than silently occupying someone else's address.
    expect(restored).toBe(cold);
    expect(isOnline(restored)).toBe(false);
  });

  it('returns the cold state unchanged when nothing is stored', () => {
    const storage = fakeStorage();
    const cold = buildColdStartConnectivity(PUBKEY);

    const restored = restoreConnection(storage, cold);

    expect(restored).toBe(cold);
    expect(isOnline(restored)).toBe(false);
  });

  it('restores a connected ESSID even when no scan list would contain it', () => {
    const storage = fakeStorage();
    storage.setItem(CONNECTED_ESSID_KEY, 'GONE-WIFI');
    lanLeaseCacheIn(storage).remember('GONE-WIFI', '192.168.25.69');
    const cold = buildColdStartConnectivity(PUBKEY);

    // A re-rolled scan need not contain the connected ESSID; restore re-derives
    // the BSSID from the ESSID rather than looking it up, so it never drops the
    // player offline just because the AP isn't in the latest roll.
    const restored = restoreConnection(storage, cold);

    const wlan0 = wlan0Of(restored);
    expect(wlan0.association).toEqual({
      essid: 'GONE-WIFI',
      bssid: bssidFromEssid('GONE-WIFI'),
    });
    expect(wlan0.ipv4).toBe('192.168.25.69');
    expect(isOnline(restored)).toBe(true);
  });
});
