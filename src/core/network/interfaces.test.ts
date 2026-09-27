import { describe, expect, it } from 'vitest';
import { asPlayerKeyHex } from '../types';
import {
  buildColdStartConnectivity,
  isOnline,
  type ConnectivityState,
  type NetworkInterface,
} from './interfaces';

/**
 * The connectivity model is the seeded cold-start snapshot of the player's
 * workstation NICs, plus the `isOnline` predicate the whole arc gates on. Tests
 * pin the cold-start shapes (a player who just booted is offline: `lo` up,
 * `wlan0` up but unassociated, `eth0` down), MAC determinism (same identity →
 * same NICs), and the online rule (`online` = any non-loopback iface has an IP).
 */

const PUBKEY = asPlayerKeyHex('a'.repeat(64));

const ifaceByName = (state: ConnectivityState, name: string): NetworkInterface => {
  const iface = state.interfaces.get(name);
  if (iface === undefined) throw new Error(`interface ${name} missing from state`);
  return iface;
};

describe('buildColdStartConnectivity', () => {
  it('starts loopback up on 127.0.0.1', () => {
    const lo = ifaceByName(buildColdStartConnectivity(PUBKEY), 'lo');
    expect(lo).toMatchObject({ kind: 'loopback', name: 'lo', up: true, ipv4: '127.0.0.1' });
  });

  it('starts eth0 down with no address', () => {
    const eth0 = ifaceByName(buildColdStartConnectivity(PUBKEY), 'eth0');
    expect(eth0).toMatchObject({ kind: 'ethernet', name: 'eth0', up: false, ipv4: null });
  });

  it('starts wlan0 up but unassociated, monitor off, no address', () => {
    const wlan0 = ifaceByName(buildColdStartConnectivity(PUBKEY), 'wlan0');
    expect(wlan0).toMatchObject({
      kind: 'wireless',
      name: 'wlan0',
      up: true,
      monitorMode: false,
      association: null,
      ipv4: null,
    });
  });

  it('orders interfaces lo, eth0, wlan0', () => {
    const names = [...buildColdStartConnectivity(PUBKEY).interfaces.keys()];
    expect(names).toEqual(['lo', 'eth0', 'wlan0']);
  });

  it('seeds NIC MACs deterministically from the identity', () => {
    const first = buildColdStartConnectivity(PUBKEY);
    const second = buildColdStartConnectivity(PUBKEY);
    expect(ifaceByName(first, 'eth0')).toEqual(ifaceByName(second, 'eth0'));
    expect(ifaceByName(first, 'wlan0')).toEqual(ifaceByName(second, 'wlan0'));
  });

  it('gives different identities different NIC MACs', () => {
    const mine = buildColdStartConnectivity(PUBKEY);
    const theirs = buildColdStartConnectivity(asPlayerKeyHex('b'.repeat(64)));
    const macOf = (state: ConnectivityState, name: string): string => {
      const iface = ifaceByName(state, name);
      if (iface.kind === 'loopback') throw new Error('loopback has no MAC');
      return iface.mac;
    };
    expect(macOf(mine, 'eth0')).not.toBe(macOf(theirs, 'eth0'));
  });

  it('gives eth0 and wlan0 distinct, well-formed locally-administered MACs', () => {
    const state = buildColdStartConnectivity(PUBKEY);
    const eth0 = ifaceByName(state, 'eth0');
    const wlan0 = ifaceByName(state, 'wlan0');
    if (eth0.kind === 'loopback' || wlan0.kind === 'loopback') throw new Error('unreachable');
    const macPattern = /^02(:[0-9a-f]{2}){5}$/;
    expect(eth0.mac).toMatch(macPattern);
    expect(wlan0.mac).toMatch(macPattern);
    expect(eth0.mac).not.toBe(wlan0.mac);
  });

  it('locks the seeded MAC wire format (pins seed + octet rendering)', () => {
    const eth0 = ifaceByName(buildColdStartConnectivity(PUBKEY), 'eth0');
    if (eth0.kind === 'loopback') throw new Error('unreachable');
    expect(eth0.mac).toBe(KNOWN_ETH0_MAC);
  });
});

describe('isOnline', () => {
  it('is false at cold start (only loopback has an address)', () => {
    expect(isOnline(buildColdStartConnectivity(PUBKEY))).toBe(false);
  });

  it('is true once a non-loopback interface has an address', () => {
    const cold = buildColdStartConnectivity(PUBKEY);
    const wlan0 = ifaceByName(cold, 'wlan0');
    if (wlan0.kind !== 'wireless') throw new Error('unreachable');
    const online: ConnectivityState = {
      interfaces: new Map(cold.interfaces).set('wlan0', {
        ...wlan0,
        association: { essid: 'HomeWiFi', bssid: 'AA:BB:CC:DD:EE:FF' },
        ipv4: '192.168.1.37',
      }),
    };
    expect(isOnline(online)).toBe(true);
  });

  it('stays false when loopback is the only addressed interface', () => {
    // A hand-built state with ONLY lo carrying an address must not read online —
    // guards against an `isOnline` that forgets to exclude loopback.
    const lo = ifaceByName(buildColdStartConnectivity(PUBKEY), 'lo');
    const loOnly: ConnectivityState = { interfaces: new Map([['lo', lo]]) };
    expect(isOnline(loOnly)).toBe(false);
  });
});

// Locked after observing the real generator output for the all-'a' pubkey.
// A real lock (hard-coded literal), not derived from the generator — any
// mutation to the seed string or octet formatting breaks it.
const KNOWN_ETH0_MAC = '02:2f:dd:2c:28:a6';
