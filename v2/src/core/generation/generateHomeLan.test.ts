import { describe, expect, it } from 'vitest';
import { generateHomeLan } from './generateHomeLan';
import { assignHomeNetwork } from '../network/homeNetwork';
import { seedApGatewayHostname } from './routerFs';

/**
 * `generateHomeLan` is the pure topology generator behind `nmap <subnet>`. Given
 * the player's identity + the ESSID they're connected to, it derives the LAN
 * they sit on: the gateway at `.1` and the player's own host (Slice 1 — sibling
 * hosts arrive in Slice 2). It reuses `assignHomeNetwork` so the subnet it
 * reports always matches the address the player was actually issued.
 */

const PUBKEY = 'a'.repeat(64);

// Captured from the seeded generator (see golden test below). Pins the edge
// gateway at .1, the inner gateway (a second router) at .25, the switch (a
// second inner gateway) at .80, and the full sibling population for a fixed
// identity. The player is NOT here — it is placed by the own-view caller at its
// leased address — and .188, this identity's preferred octet, is the vacancy the
// generator holds open for that lease.
const GOLDEN_HOSTS = [
  { ip: '192.168.29.1', hostname: 'vpn-gw', kind: 'router' },
  { ip: '192.168.29.25', hostname: 'fw-dmz', kind: 'router' },
  { ip: '192.168.29.30', hostname: 'tablet-30', kind: 'machine' },
  { ip: '192.168.29.70', hostname: 'workstation-70', kind: 'machine' },
  { ip: '192.168.29.80', hostname: 'vpn-gw', kind: 'switch' },
  { ip: '192.168.29.209', hostname: 'android-209', kind: 'machine' },
  { ip: '192.168.29.245', hostname: 'iphone-245', kind: 'machine' },
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
    expect(lan.hosts[0]).toEqual({
      ip: `${lan.subnet}.1`,
      hostname: seedApGatewayHostname('BEAN-THERE-WIFI'),
      kind: 'router',
    });
  });

  it('names the .1 router with its owner-seeded hostname, not a generic "gateway"', () => {
    // The gateway is just another machine with a real name — seeded from the ESSID,
    // so it is the same name for every occupant and cross-player log lines can
    // identify it without knowing who was looking.
    const router = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI').hosts.find(
      (host) => host.kind === 'router',
    );
    expect(router?.hostname).toBe(seedApGatewayHostname('BEAN-THERE-WIFI'));
    expect(router?.hostname).not.toBe('gateway');
  });

  it('does not place the player, and leaves its preferred octet vacant for the lease', () => {
    const lan = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI');
    const { localIp } = assignHomeNetwork(PUBKEY, 'BEAN-THERE-WIFI');

    // A player's address is a server-issued LEASE; this generator is a pure
    // identity+ESSID function that cannot read one, so it places NPC filler only and
    // the own-view caller adds the player at the address it actually holds. The
    // preferred octet is still held vacant — the allocator offers it first, so an NPC
    // squatting it would displace nearly every player from its own address.
    expect(lan.hosts.find((host) => host.ip === localIp)).toBeUndefined();
  });

  it('populates the LAN with 3 to 8 sibling machine hosts for any identity/ESSID', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const essid = `NET-${seed}`;
      const lan = generateHomeLan('a'.repeat(64), essid);
      const { localIp } = assignHomeNetwork('a'.repeat(64), essid);
      // Siblings are the machine hosts other than the player's own box; the two
      // routers (edge `.1` + inner gateway) are excluded by kind.
      const siblingCount = lan.hosts.filter(
        (host) => host.kind === 'machine' && host.ip !== localIp,
      ).length;

      expect(siblingCount).toBeGreaterThanOrEqual(3);
      expect(siblingCount).toBeLessThanOrEqual(8);
    }
  });

  it('exposes a second router — the inner gateway — distinct from the .1 edge router', () => {
    const lan = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI');
    const routerOctets = lan.hosts
      .filter((host) => host.kind === 'router')
      .map((router) => Number(router.ip.split('.')[3]));

    expect(routerOctets).toContain(1); // the edge gateway sits at .1
    expect(routerOctets).toHaveLength(2); // edge + exactly one inner gateway
    expect(routerOctets.filter((octet) => octet !== 1)).toHaveLength(1);
  });

  it('seeds the inner gateway at a unique octet — not .1, not self, not a sibling', () => {
    const lan = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI');
    const { localIp } = assignHomeNetwork(PUBKEY, 'BEAN-THERE-WIFI');
    const selfOctet = Number(localIp.split('.')[3]);

    const inner = lan.hosts.find(
      (host) => host.kind === 'router' && host.ip !== `${lan.subnet}.1`,
    );
    const machineOctets = lan.hosts
      .filter((host) => host.kind === 'machine' && host.ip !== localIp)
      .map((host) => Number(host.ip.split('.')[3]));

    expect(inner).toBeDefined();
    const innerOctet = Number(inner?.ip.split('.')[3]);
    expect(innerOctet).not.toBe(1);
    expect(innerOctet).not.toBe(selfOctet);
    expect(machineOctets).not.toContain(innerOctet);
  });

  it('places the inner gateway deterministically for the same identity + ESSID', () => {
    const innerIp = (essid: string): string | undefined => {
      const lan = generateHomeLan(PUBKEY, essid);
      return lan.hosts.find(
        (host) => host.kind === 'router' && host.ip !== `${lan.subnet}.1`,
      )?.ip;
    };

    expect(innerIp('BEAN-THERE-WIFI')).toBeDefined();
    expect(innerIp('BEAN-THERE-WIFI')).toBe(innerIp('BEAN-THERE-WIFI'));
  });

  it('exposes a switch — a second inner gateway — distinct from the routers, self, and siblings', () => {
    const lan = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI');
    const { localIp } = assignHomeNetwork(PUBKEY, 'BEAN-THERE-WIFI');
    const selfOctet = Number(localIp.split('.')[3]);

    const switches = lan.hosts.filter((host) => host.kind === 'switch');
    expect(switches).toHaveLength(1);

    const switchOctet = Number(switches[0]!.ip.split('.')[3]);
    const routerOctets = lan.hosts
      .filter((host) => host.kind === 'router')
      .map((host) => Number(host.ip.split('.')[3]));
    const siblingOctets = lan.hosts
      .filter((host) => host.kind === 'machine' && host.ip !== localIp)
      .map((host) => Number(host.ip.split('.')[3]));

    expect(switchOctet).not.toBe(1);
    expect(switchOctet).not.toBe(selfOctet);
    expect(routerOctets).not.toContain(switchOctet);
    expect(siblingOctets).not.toContain(switchOctet);
  });

  it('places the switch deterministically for the same identity + ESSID', () => {
    const switchIp = (essid: string): string | undefined =>
      generateHomeLan(PUBKEY, essid).hosts.find((host) => host.kind === 'switch')?.ip;

    expect(switchIp('BEAN-THERE-WIFI')).toBeDefined();
    expect(switchIp('BEAN-THERE-WIFI')).toBe(switchIp('BEAN-THERE-WIFI'));
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

  it('marks the gateways as routers and the switch as its own kind — every other host is a machine', () => {
    const lan = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI');

    // The edge gateway keeps its owner-seeded name at .1; the inner gateway is a
    // second router elsewhere on the LAN; the switch is a distinct device kind.
    // Everything that is neither a gateway nor the switch is a machine.
    expect(lan.hosts.filter((host) => host.kind === 'router')).toContainEqual({
      ip: `${lan.subnet}.1`,
      hostname: seedApGatewayHostname('BEAN-THERE-WIFI'),
      kind: 'router',
    });
    const ordinary = lan.hosts.filter((host) => host.kind !== 'router' && host.kind !== 'switch');
    expect(ordinary.every((host) => host.kind === 'machine')).toBe(true);
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
    // Pinned to the assignHomeNetwork golden (192.168.29.188 / iphone-188; the
    // /24 is ESSID-seeded) plus the seeded sibling population.
    const first = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI');

    expect(generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI')).toEqual(first);
    expect(first.subnet).toBe('192.168.29');
    expect(first.hosts).toEqual(GOLDEN_HOSTS);
  });
});
