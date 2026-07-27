import { describe, expect, it } from 'vitest';
import { generateHomeLan } from './generateHomeLan';
import { assignHomeNetwork } from '../network/homeNetwork';
import { seedApGatewayHostname, seedInnerGatewayHostname } from './routerFs';

/**
 * `generateHomeLan` is the pure topology generator behind `nmap <subnet>`. Given an
 * ESSID it derives the access point's LAN: the gateway at `.1`, an inner gateway, a
 * switch, and sibling machines. It takes no identity — the population belongs to the
 * network, so every occupant of an AP sees the same machines at the same addresses.
 * (That two DIFFERENT occupants agree is proved where a viewer still exists to vary:
 * the scan handler, the host-identity resolver, and the id reverse-lookup.)
 *
 * It places no player. An occupant's own address is a server-issued lease, and this
 * is a pure function with no view of the lease store; the own-view caller adds the
 * player at the address its interface actually holds.
 */

const ESSID = 'BEAN-THERE-WIFI';

// Captured from the seeded generator (see golden test below). Pins the edge gateway
// at .1, the inner gateway (a second router) at .85, the switch (a second inner
// gateway) at .213, and the full sibling population. Nothing is held vacant: with one
// shared population there is no per-viewer address to reserve, and the lease allocator
// is what keeps an occupant off these octets.
const GOLDEN_HOSTS = [
  { ip: '192.168.29.1', hostname: 'vpn-gw', kind: 'router' },
  { ip: '192.168.29.28', hostname: 'desktop-28', kind: 'machine' },
  { ip: '192.168.29.74', hostname: 'laptop-74', kind: 'machine' },
  { ip: '192.168.29.85', hostname: 'core-rtr', kind: 'router' },
  { ip: '192.168.29.87', hostname: 'tablet-87', kind: 'machine' },
  { ip: '192.168.29.149', hostname: 'tablet-149', kind: 'machine' },
  { ip: '192.168.29.154', hostname: 'laptop-154', kind: 'machine' },
  { ip: '192.168.29.164', hostname: 'desktop-164', kind: 'machine' },
  { ip: '192.168.29.187', hostname: 'tablet-187', kind: 'machine' },
  { ip: '192.168.29.213', hostname: 'pfsense01', kind: 'switch' },
  { ip: '192.168.29.229', hostname: 'iphone-229', kind: 'machine' },
];

const octetOf = (ip: string): number => Number(ip.split('.')[3]);

describe('generateHomeLan', () => {
  it('sits on the same /24 the join issues addresses on', () => {
    // The generated population and the leased occupants have to land on ONE subnet,
    // or an occupant would never appear in the scan of the LAN it joined.
    const lan = generateHomeLan(ESSID);
    const { localIp } = assignHomeNetwork('a'.repeat(64), ESSID);

    expect(lan.subnet).toBe(localIp.split('.').slice(0, 3).join('.'));
  });

  it('places the gateway at .1 as a router, ahead of every other host', () => {
    const lan = generateHomeLan(ESSID);

    expect(lan.hosts[0]).toEqual({
      ip: `${lan.subnet}.1`,
      hostname: seedApGatewayHostname(ESSID),
      kind: 'router',
    });
  });

  it('names the .1 router with its ESSID-seeded hostname, not a generic "gateway"', () => {
    // The gateway is just another machine with a real name — seeded from the ESSID,
    // so it is the same name for every occupant and cross-player log lines can
    // identify it without knowing who was looking.
    const router = generateHomeLan(ESSID).hosts.find((host) => host.kind === 'router');

    expect(router?.hostname).toBe(seedApGatewayHostname(ESSID));
    expect(router?.hostname).not.toBe('gateway');
  });

  it('holds no octet vacant — every host octet is drawn from the full 2..254 pool', () => {
    // While the population was per-viewer it kept a hole at the viewer's derived octet
    // so a lease had somewhere to land. One shared population has no viewer to reserve
    // for; the allocator excludes these octets instead, which is the only direction
    // that works when the NPCs are the same for everybody.
    for (let seed = 0; seed < 50; seed += 1) {
      const lan = generateHomeLan(`NET-${seed}`);

      for (const host of lan.hosts) {
        expect(octetOf(host.ip)).toBeGreaterThanOrEqual(1);
        expect(octetOf(host.ip)).toBeLessThanOrEqual(254);
      }
    }
  });

  it('populates the LAN with 3 to 8 sibling machine hosts for any ESSID', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const lan = generateHomeLan(`NET-${seed}`);
      // Siblings are the machine hosts; the two routers (edge `.1` + inner gateway)
      // and the switch are excluded by kind.
      const siblingCount = lan.hosts.filter((host) => host.kind === 'machine').length;

      expect(siblingCount).toBeGreaterThanOrEqual(3);
      expect(siblingCount).toBeLessThanOrEqual(8);
    }
  });

  it('exposes a second router — the inner gateway — distinct from the .1 edge router', () => {
    const routerOctets = generateHomeLan(ESSID)
      .hosts.filter((host) => host.kind === 'router')
      .map((router) => octetOf(router.ip));

    expect(routerOctets).toContain(1); // the edge gateway sits at .1
    expect(routerOctets).toHaveLength(2); // edge + exactly one inner gateway
    expect(routerOctets.filter((octet) => octet !== 1)).toHaveLength(1);
  });

  it('names the inner gateway and the switch from the ESSID and their octet', () => {
    // Their names are part of the shared box, not of the viewer: two occupants must
    // meet the same router under the same name at the same address.
    const lan = generateHomeLan(ESSID);
    const inner = lan.hosts.find((host) => host.kind === 'router' && octetOf(host.ip) !== 1)!;
    const device = lan.hosts.find((host) => host.kind === 'switch')!;

    expect(inner.hostname).toBe(seedInnerGatewayHostname(ESSID, octetOf(inner.ip)));
    expect(device.hostname).toBe(seedInnerGatewayHostname(ESSID, octetOf(device.ip)));
  });

  it('seeds the inner gateway at a unique octet — not .1, not a sibling', () => {
    const lan = generateHomeLan(ESSID);
    const inner = lan.hosts.find((host) => host.kind === 'router' && octetOf(host.ip) !== 1);
    const machineOctets = lan.hosts
      .filter((host) => host.kind === 'machine')
      .map((host) => octetOf(host.ip));

    expect(inner).toBeDefined();
    expect(octetOf(inner!.ip)).not.toBe(1);
    expect(machineOctets).not.toContain(octetOf(inner!.ip));
  });

  it('exposes a switch — a second inner gateway — distinct from the routers and siblings', () => {
    const lan = generateHomeLan(ESSID);
    const switches = lan.hosts.filter((host) => host.kind === 'switch');
    expect(switches).toHaveLength(1);

    const switchOctet = octetOf(switches[0]!.ip);
    const routerOctets = lan.hosts
      .filter((host) => host.kind === 'router')
      .map((host) => octetOf(host.ip));
    const siblingOctets = lan.hosts
      .filter((host) => host.kind === 'machine')
      .map((host) => octetOf(host.ip));

    expect(switchOctet).not.toBe(1);
    expect(routerOctets).not.toContain(switchOctet);
    expect(siblingOctets).not.toContain(switchOctet);
  });

  it('assigns every host a unique last octet', () => {
    const octets = generateHomeLan(ESSID).hosts.map((host) => octetOf(host.ip));

    expect(new Set(octets).size).toBe(octets.length);
  });

  it('never places a sibling on the gateway (.1)', () => {
    const lan = generateHomeLan(ESSID);

    for (const sibling of lan.hosts.filter((host) => host.ip !== `${lan.subnet}.1`)) {
      expect(octetOf(sibling.ip)).not.toBe(1);
    }
  });

  it('marks the gateways as routers and the switch as its own kind — every other host is a machine', () => {
    const lan = generateHomeLan(ESSID);

    expect(lan.hosts.filter((host) => host.kind === 'router')).toContainEqual({
      ip: `${lan.subnet}.1`,
      hostname: seedApGatewayHostname(ESSID),
      kind: 'router',
    });
    const ordinary = lan.hosts.filter((host) => host.kind !== 'router' && host.kind !== 'switch');
    expect(ordinary.every((host) => host.kind === 'machine')).toBe(true);
  });

  it('returns hosts sorted ascending by last octet', () => {
    const octets = generateHomeLan(ESSID).hosts.map((host) => octetOf(host.ip));

    expect(octets).toEqual([...octets].sort((left, right) => left - right));
  });

  it('generates a different LAN per ESSID', () => {
    // The ESSID is now the ONLY thing the population varies on, so it had better
    // vary on it — otherwise every access point in the game would be one network.
    expect(generateHomeLan('BEAN-THERE-WIFI')).not.toEqual(generateHomeLan('ABSTERGO-NET'));
  });

  it('is deterministic for the same ESSID (golden)', () => {
    const first = generateHomeLan(ESSID);

    expect(generateHomeLan(ESSID)).toEqual(first);
    expect(first.subnet).toBe('192.168.29');
    expect(first.hosts).toEqual(GOLDEN_HOSTS);
  });
});
