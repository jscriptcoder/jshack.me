import { describe, expect, it } from 'vitest';
import { generateHomeLan } from './generateHomeLan';
import { assignHomeNetwork } from '../network/homeNetwork';

/**
 * `generateHomeLan` is the pure topology generator behind `nmap <subnet>`. Given
 * the player's identity + the ESSID they're connected to, it derives the LAN
 * they sit on: the gateway at `.1` and the player's own host (Slice 1 — sibling
 * hosts arrive in Slice 2). It reuses `assignHomeNetwork` so the subnet it
 * reports always matches the address the player was actually issued.
 */

const PUBKEY = 'a'.repeat(64);

// Captured from the seeded generator (see golden test below). Pins the gateway,
// the player's own host, and the full sibling population for a fixed identity.
const GOLDEN_HOSTS = [
  { ip: '192.168.188.1', hostname: 'gateway', kind: 'router' },
  { ip: '192.168.188.25', hostname: 'desktop-25', kind: 'machine' },
  { ip: '192.168.188.70', hostname: 'workstation-70', kind: 'machine' },
  { ip: '192.168.188.154', hostname: 'iphone-154', kind: 'machine' },
  { ip: '192.168.188.209', hostname: 'android-209', kind: 'machine' },
  { ip: '192.168.188.245', hostname: 'iphone-245', kind: 'machine' },
];

describe('generateHomeLan', () => {
  it('derives the subnet from the player’s own assignment', () => {
    const lan = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI');
    const { localIp } = assignHomeNetwork(PUBKEY, 'BEAN-THERE-WIFI');

    expect(lan.subnet).toBe(localIp.split('.').slice(0, 3).join('.'));
  });

  it('places the gateway at .1 as a router, ahead of the player host', () => {
    const lan = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI');

    // Gateway is first (octet .1 sorts ahead of the player's host octet >= 2).
    expect(lan.hosts[0]).toEqual({ ip: `${lan.subnet}.1`, hostname: 'gateway', kind: 'router' });
  });

  it('includes the player’s own host with its assigned hostname', () => {
    const lan = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI');
    const { localIp, hostname } = assignHomeNetwork(PUBKEY, 'BEAN-THERE-WIFI');

    const self = lan.hosts.find((host) => host.ip === localIp);
    expect(self).toEqual({ ip: localIp, hostname, kind: 'machine' });
  });

  it('populates the LAN with 3 to 8 sibling hosts for any identity/ESSID', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const lan = generateHomeLan('a'.repeat(64), `NET-${seed}`);
      const siblingCount = lan.hosts.length - 2; // minus the gateway and self

      expect(siblingCount).toBeGreaterThanOrEqual(3);
      expect(siblingCount).toBeLessThanOrEqual(8);
    }
  });

  it('assigns every host a unique last octet', () => {
    const octets = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI').hosts.map((host) =>
      Number(host.ip.split('.')[3]),
    );

    expect(new Set(octets).size).toBe(octets.length);
  });

  it('never places a sibling on the gateway (.1) or the player’s own octet', () => {
    const lan = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI');
    const { localIp } = assignHomeNetwork(PUBKEY, 'BEAN-THERE-WIFI');
    const selfOctet = Number(localIp.split('.')[3]);

    const siblings = lan.hosts.filter(
      (host) => host.ip !== localIp && host.ip !== `${lan.subnet}.1`,
    );
    for (const sibling of siblings) {
      const octet = Number(sibling.ip.split('.')[3]);
      expect(octet).not.toBe(1);
      expect(octet).not.toBe(selfOctet);
    }
  });

  it('marks every sibling as a machine — only the gateway is a router', () => {
    const lan = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI');
    const routers = lan.hosts.filter((host) => host.kind === 'router');

    expect(routers).toEqual([{ ip: `${lan.subnet}.1`, hostname: 'gateway', kind: 'router' }]);
  });

  it('returns hosts sorted ascending by last octet', () => {
    const octets = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI').hosts.map((host) =>
      Number(host.ip.split('.')[3]),
    );

    expect(octets).toEqual([...octets].sort((left, right) => left - right));
  });

  it('generates a different LAN per identity', () => {
    const alice = generateHomeLan('a'.repeat(64), 'BEAN-THERE-WIFI');
    const bob = generateHomeLan('b'.repeat(64), 'BEAN-THERE-WIFI');

    expect(bob).not.toEqual(alice);
  });

  it('is deterministic for the same identity + ESSID (golden)', () => {
    // Pinned to the assignHomeNetwork golden (192.168.188.154 / iphone-154)
    // plus the seeded sibling population.
    const first = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI');

    expect(generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI')).toEqual(first);
    expect(first.subnet).toBe('192.168.188');
    expect(first.hosts).toEqual(GOLDEN_HOSTS);
  });
});
