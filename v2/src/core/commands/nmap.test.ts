import { describe, expect, it } from 'vitest';
import { nmap } from './nmap';
import { commandRegistry } from './registry';
import type { CommandResult } from './types';
import {
  mockCommandEnv,
  mockIdentity,
  mockNetworkView,
  mockNetworkViewFromConnectivity,
} from '../../test/factories/commandEnv';
import { assignHomeNetwork } from '../network/homeNetwork';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { asPlayerKeyHex } from '../types';

/**
 * `nmap <subnet>` host-discovery (generator epic, Story 2, Slice 1). Online on a
 * home LAN, it streams the gateway (.1, router) and the player's own host. While
 * offline — or before `apt install nmap` — it errors and lists nothing.
 */

const PUBKEY = 'a'.repeat(64);

/** A connectivity state with wlan0 associated + addressed (online on `essid`),
 *  re-deriving the same LAN IP the player would actually have been issued. */
const onlineConnectivity = (essid: string): ConnectivityState => {
  const cold = buildColdStartConnectivity(PUBKEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0 in cold start');
  const { localIp } = assignHomeNetwork(PUBKEY, essid);
  const connected = { ...wlan0, association: { essid, bssid: 'AA:BB:CC:DD:EE:FF' }, ipv4: localIp };
  return { interfaces: new Map(cold.interfaces).set('wlan0', connected) };
};

const onlineEnv = (essid = 'BEAN-THERE-WIFI') =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkViewFromConnectivity(onlineConnectivity(essid)),
  });

const drain = async (result: CommandResult): Promise<{ text: string; exitCode: number }> => {
  if (result.kind !== 'async') throw new Error('expected async result');
  const lines: string[] = [];
  for await (const line of result.lines) lines.push(line.content);
  return { text: lines.join('\n'), exitCode: await result.exitCode() };
};

describe('nmap', () => {
  it('reports command-not-found with an apt hint before install (registry gate)', async () => {
    // The default mock FS has no /usr/bin/nmap, so the binary gate fires first.
    const gated = commandRegistry.get('nmap');
    if (gated === undefined) throw new Error('nmap not registered');

    const result = await gated.execute(mockCommandEnv(), ['192.168.0.0/24'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(127);
    expect(result.lines[0]?.content).toContain('apt install nmap');
  });

  it('refuses to scan while offline even if wlan0 looks associated (isOnline is the gate)', async () => {
    // Force offline while presenting a fully associated + addressed wlan0: only
    // the isOnline() gate can reject this, proving it is not bypassed.
    const conn = onlineConnectivity('BEAN-THERE-WIFI');
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkView({ isOnline: () => false, interfaces: () => [...conn.interfaces.values()] }),
    });

    const result = await nmap.execute(env, ['192.168.188.0/24'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.kind).toBe('error');
    expect(result.lines[0]?.content).toContain('unreachable');
  });

  it('errors when online but no wlan0 interface is present', async () => {
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkView({ isOnline: () => true, interfaces: () => [] }),
    });

    const result = await nmap.execute(env, ['192.168.188.0/24'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content).toContain('unreachable');
  });

  it('errors when online but wlan0 is not associated with a network', async () => {
    // wlan0 exists but carries no association ⇒ no ESSID ⇒ no LAN to derive.
    const cold = buildColdStartConnectivity(PUBKEY);
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkView({ isOnline: () => true, interfaces: () => [...cold.interfaces.values()] }),
    });

    const result = await nmap.execute(env, ['192.168.188.0/24'], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content).toContain('unreachable');
  });

  it('requires a subnet argument', async () => {
    const result = await nmap.execute(onlineEnv(), [], new Map());
    if (result.kind !== 'sync') throw new Error('expected sync result');

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]?.content.toLowerCase()).toContain('usage');
  });

  it('lists the gateway (.1 router) and the player host while online', async () => {
    const { text, exitCode } = await drain(
      await nmap.execute(onlineEnv(), ['192.168.188.0/24'], new Map()),
    );

    expect(exitCode).toBe(0);
    // Gateway at .1, rendered as a router.
    expect(text).toContain('192.168.188.1');
    expect(text).toContain('router');
    // The player's own host (assignHomeNetwork golden for this identity+ESSID).
    expect(text).toContain('192.168.188.154');
    expect(text).toContain('iphone-154');
    // Both hosts reported up (gateway + self).
    expect(text).toContain('2 hosts up');
  });

  it('renders the scanned /24 subnet in the banner', async () => {
    const { text } = await drain(await nmap.execute(onlineEnv(), ['192.168.188.0/24'], new Map()));

    expect(text).toContain('192.168.188.0/24');
  });
});
