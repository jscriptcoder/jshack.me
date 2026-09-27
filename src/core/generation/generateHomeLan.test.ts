import { describe, expect, it } from 'vitest';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { assignHomeNetwork } from '../network/homeNetwork';
import { seedApGatewayHostname, seedInnerGatewayHostname } from './gatewayHostname';
import { DRAWN_ROLES, machineRole } from './machineRole';
import { HOSTNAME_PREFIXES, roleOfHostname } from './pools/hostnames';
import { ESSID_CATALOG } from './pools/essidCatalog';
import { publisherSite } from './publisher';

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
//
// This reads as somebody's flat, which is what it is: four personal devices, a NAS,
// a couple of web boxes and a video recorder. NAMES here are expected to move when the
// roles or their pools change — the addresses beside them are not, and are pinned
// separately so updating this literal cannot quietly re-bless a drifted octet.
const GOLDEN_HOSTS = [
  { ip: '192.168.29.1', hostname: 'vpn-gw', kind: 'router' },
  { ip: '192.168.29.28', hostname: 'desktop-28', kind: 'machine' },
  { ip: '192.168.29.74', hostname: 'laptop-74', kind: 'machine' },
  { ip: '192.168.29.85', hostname: 'core-rtr', kind: 'router' },
  { ip: '192.168.29.87', hostname: 'backup-87', kind: 'machine' },
  { ip: '192.168.29.149', hostname: 'tablet-149', kind: 'machine' },
  { ip: '192.168.29.154', hostname: 'www-154', kind: 'machine' },
  { ip: '192.168.29.164', hostname: 'desktop-164', kind: 'machine' },
  { ip: '192.168.29.187', hostname: 'nvr-187', kind: 'machine' },
  { ip: '192.168.29.213', hostname: 'pfsense01', kind: 'switch' },
  { ip: '192.168.29.229', hostname: 'nginx-229', kind: 'machine' },
];

const octetOf = (ip: string): number => Number(ip.split('.')[3]);

/** `cam-31` → `cam`. Machines are named `<prefix>-<octet>`; gateways are not. */
const prefixOf = (hostname: string): string => hostname.slice(0, hostname.lastIndexOf('-'));

const machinesOf = (essid: string): readonly LanHost[] =>
  generateHomeLan(essid).hosts.filter((host) => host.kind === 'machine');

// Enough networks that every role's pool is actually drawn from. The eight pinned
// above hold ~47 machines between them, and the rarest roles are a few percent —
// so a name pool could be emptied and no name would change.
const NAMING_SAMPLE: readonly string[] = Array.from(
  { length: 60 },
  (_unused, index) => `ROLE-SAMPLE-${index}`,
);

const sampledMachines = (): readonly { essid: string; host: LanHost }[] =>
  NAMING_SAMPLE.flatMap((essid) => machinesOf(essid).map((host) => ({ essid, host })));

// The address layout each of these ESSIDs generates, captured from the seeded
// generator. Deliberately holds octets ONLY — see the test that consumes it.
const GOLDEN_OCTETS: Readonly<Record<string, readonly number[]>> = {
  'BEAN-THERE-WIFI': [1, 28, 74, 85, 87, 149, 154, 164, 187, 213, 229],
  'SHINRA-5G': [1, 27, 28, 56, 101, 124, 152, 154, 199, 227],
  'ACME-CORP': [1, 40, 52, 62, 138, 192, 221, 223],
  'WEYLAND-NET': [1, 114, 150, 166, 168, 178, 195, 205],
  'CRACK-ME-WIFI': [1, 49, 78, 102, 123, 244],
  'HYDRA-CRACK-WIFI': [1, 4, 181, 236, 238, 248],
  'FETCH-LOG-WIFI': [1, 13, 39, 66, 82, 86, 98, 118, 136, 208, 234],
  'TYRELL-NET': [1, 34, 42, 86, 122, 139, 177, 186, 194, 207, 235],
};

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

  it('names every machine from the pool of the role it actually holds', () => {
    // The name is the ONLY thing a subnet sweep tells a player about what a box is
    // for — the scan's third column reports kind, which stays structural, and the
    // ports need a second scan to see. So a name that disagreed with the role would
    // not be cosmetic: it would be the world lying in the one place a player reads
    // before deciding what to touch.
    const mismatched = sampledMachines()
      .filter(
        ({ essid, host }) =>
          !HOSTNAME_PREFIXES[machineRole(essid, host.ip)].includes(prefixOf(host.hostname)),
      )
      .map(({ essid, host }) => `${essid} ${host.hostname}`);

    expect(mismatched).toEqual([]);
  });

  it('draws from every role pool in that sample, so none goes unchecked', () => {
    // Without this the test above is only as good as its sample: the rarest roles are
    // a few percent each, so a pool nothing draws from could be emptied silently and
    // every assertion would still hold.
    const rolesSeen = new Set(sampledMachines().map(({ essid, host }) => machineRole(essid, host.ip)));

    expect(DRAWN_ROLES.filter((role) => !rolesSeen.has(role))).toEqual([]);
  });

  it('gives every machine a name and not a bare address', () => {
    // A prefix that agrees with an EMPTY pool still agrees with it. `-31` and
    // `undefined-31` are both consistent and both wrong.
    const nameless = sampledMachines()
      .filter(({ host }) => !/^[a-z][a-z0-9]*$/.test(prefixOf(host.hostname)))
      .map(({ essid, host }) => `${essid} ${host.hostname}`);

    expect(nameless).toEqual([]);
  });

  it('holds only well-formed names in every pool, drawn or not', () => {
    // The generated-name check above can only see prefixes the sample happens to
    // draw, and a pool entry nothing drew could be anything at all. Stated here it
    // also covers names added later that today's weights make rare.
    const malformed = DRAWN_ROLES.flatMap((role) =>
      HOSTNAME_PREFIXES[role]
        .filter((prefix) => !/^[a-z][a-z0-9]*$/.test(prefix))
        .map((prefix) => `${role}: "${prefix}"`),
    );

    expect(malformed).toEqual([]);
  });

  it('gives no two roles a name in common, so a prefix names one thing', () => {
    // Reading a box off its name only works while the reading is unambiguous. A
    // `db` that could also be a camera would make the whole scheme decorative.
    const shared = DRAWN_ROLES.flatMap((role) =>
      HOSTNAME_PREFIXES[role]
        .filter((prefix) =>
          DRAWN_ROLES.some((other) => other !== role && HOSTNAME_PREFIXES[other].includes(prefix)),
        )
        .map((prefix) => `${prefix} (${role})`),
    );

    expect(shared).toEqual([]);
  });

  it('names plugs, locks, recorders and baby monitors among the devices, and draws each', () => {
    // A home or office network holds more than cameras and thermostats. Each of these
    // must read back as a device and actually turn up on some network, or a player
    // would never meet one.
    const deviceNames = ['plug', 'lock', 'nvr', 'babycam'];
    const drawnPrefixes = new Set(sampledMachines().map(({ host }) => prefixOf(host.hostname)));

    expect(deviceNames.map((name) => roleOfHostname(`${name}-12`))).toEqual(
      deviceNames.map(() => 'iot'),
    );
    expect(deviceNames.filter((name) => !drawnPrefixes.has(name))).toEqual([]);
  });

  it('reads no role off a name without the octet, even one that starts like a prefix', () => {
    // Players name their own workstations freely. A box a player calls `nas1` is
    // theirs, not a file server, and must not grow a file server's services.
    expect(roleOfHostname('nas1')).toBeUndefined();
    expect(roleOfHostname('nas-1')).toBe('fileserver');
  });

  it('keeps the octet in the name, so a name still says where the box is', () => {
    const misplaced = sampledMachines()
      .filter(({ host }) => host.hostname !== `${prefixOf(host.hostname)}-${octetOf(host.ip)}`)
      .map(({ essid, host }) => `${essid} ${host.hostname} at .${octetOf(host.ip)}`);

    expect(misplaced).toEqual([]);
  });

  it('keeps every host octet fixed, whatever the hosts end up being called', () => {
    // The lease allocator excludes these octets when it issues an occupant an
    // address, deriving the excluded set from this very generator. So an octet that
    // MOVES hands an occupant an address an NPC already holds — which deletes that
    // machine from every occupant's view and orphans whatever has been written to
    // it. Renaming hosts is allowed; re-addressing them is not.
    //
    // Pinned APART from the golden above, and without hostnames, so that a
    // deliberate rename can update the names there without silently re-blessing an
    // address that drifted along with them. Eight ESSIDs because the sibling count
    // is itself drawn (3..8), so one network exercises one shape of the draw.
    const layout = Object.fromEntries(
      Object.keys(GOLDEN_OCTETS).map((essid) => [
        essid,
        generateHomeLan(essid).hosts.map((host) => octetOf(host.ip)),
      ]),
    );

    expect(layout).toEqual(GOLDEN_OCTETS);
  });
});

describe('generateHomeLan for an institution that publishes a website', () => {
  const publishers = ESSID_CATALOG.filter((entry) => publisherSite(entry.essid) !== undefined).map(
    (entry) => entry.essid,
  );
  const others = ESSID_CATALOG.filter((entry) => publisherSite(entry.essid) === undefined).map(
    (entry) => entry.essid,
  );

  /** The machines whose name does not come from the role drawn for their address. */
  const renamedOn = (essid: string): readonly LanHost[] =>
    machinesOf(essid).filter(
      (host) => !HOSTNAME_PREFIXES[machineRole(essid, host.ip)].includes(prefixOf(host.hostname)),
    );

  const drewAWebserver = (essid: string): boolean =>
    machinesOf(essid).some((host) => machineRole(essid, host.ip) === 'webserver');

  it('always has a webserver to serve the site from', () => {
    const withoutOne = publishers.filter(
      (essid) => !machinesOf(essid).some((host) => roleOfHostname(host.hostname) === 'webserver'),
    );

    expect(withoutOne).toEqual([]);
  });

  it('puts the site on the lowest-addressed machine when none of them drew the webserver role', () => {
    const needingOne = publishers.filter((essid) => !drewAWebserver(essid));

    // Without a publisher that drew no webserver of its own, nothing here would
    // prove the one that is made.
    expect(needingOne).not.toEqual([]);
    for (const essid of needingOne) {
      const [lowest] = machinesOf(essid);
      expect(renamedOn(essid)).toEqual([lowest]);
      expect(roleOfHostname(lowest?.hostname ?? '')).toBe('webserver');
    }
  });

  it('leaves a publisher that drew its own webserver exactly as drawn', () => {
    const alreadyServing = publishers.filter(drewAWebserver);

    expect(alreadyServing).not.toEqual([]);
    for (const essid of alreadyServing) expect(renamedOn(essid)).toEqual([]);
  });

  it('leaves every network that publishes nothing exactly as drawn', () => {
    const withoutWebserver = others.filter((essid) => !drewAWebserver(essid));

    expect(withoutWebserver).not.toEqual([]);
    for (const essid of others) expect(renamedOn(essid)).toEqual([]);
  });
});
