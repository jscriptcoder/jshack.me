import { describe, expect, it } from 'vitest';
import {
  buildDeepHostFs,
  generateDeepLayer,
  seedNetworkDepth,
  type FrontingGateway,
} from './generateDeepLayer';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { buildRemoteHostFs } from './remoteHostFs';
import type { DrawnRole } from './machineRole';
import { roleOfHostname } from './pools/hostnames';
import { computeDeepGatewayId } from '../identity/router';
import { readOpenPorts } from '../services/pidfile';

/**
 * `generateDeepLayer` is the deeper-layer counterpart of `generateHomeLan`: behind
 * an inner gateway it hangs a hidden `10.x.y.0/24` segment. It is pure + deterministic
 * from `(essid, frontingGateway)`, so the same world re-rolls identically every reload —
 * and identically for every occupant of that access point. The addressing stays cleanly
 * separate from the home `192.168.x` LAN. The layer is keyed by the gateway that FRONTS
 * it (its machine_id), so every gateway in a chain fronts its own distinct segment. A layer fronted by a router also hangs a CHILD
 * gateway — the door to the next layer down; a switch forwards nothing, so it fronts no
 * child.
 */

const ESSID = 'BEAN-THERE-WIFI';
const ROUTER_GW: FrontingGateway = { machineId: 'inner-gw-aaaa1111', kind: 'router' };
const SWITCH_GW: FrontingGateway = { machineId: 'switch-bbbb2222', kind: 'switch' };

const octetOf = (ip: string): number => Number(ip.split('.')[3]);

describe('generateDeepLayer', () => {
  it('names deep NPCs for their roles, so the world does not flatten as you go in', () => {
    // The layers behind an inner gateway are where somebody is hunting a box worth
    // finding, so they must not be the one part of the world that still reads as a
    // bag of phones. Sampled across gateways because a role is a property of the
    // world: one deep layer holds one box, and one box proves nothing about a mix.
    const deepHosts = Array.from(
      { length: 40 },
      (_unused, index) =>
        generateDeepLayer(ESSID, { machineId: `inner-gw-${index}`, kind: 'router' }).host,
    );
    const rolesFound = new Set(deepHosts.map((host) => roleOfHostname(host.hostname)));

    expect(rolesFound.has(undefined)).toBe(false);
    expect(rolesFound.size).toBeGreaterThan(1);
  });

  it('gives a deep box the services its NAME promises, not the ones its address would roll', () => {
    // A deep NPC is named from its FRONTING GATEWAY's stream, which nothing
    // downstream of the generator can see. Re-deriving the role from `(essid, ip)`
    // instead of reading it off the name would hand a deep `www-179` the flat rate
    // — the name a player just read off the scan contradicted by the ports behind
    // it. Sampled across gateways, because one deep layer holds one box.
    const deepHosts = Array.from(
      { length: 200 },
      (_unused, index) =>
        generateDeepLayer(ESSID, { machineId: `inner-gw-${index}`, kind: 'router' }).host,
    );
    const servingRate = (role: DrawnRole): number => {
      const named = deepHosts.filter((host) => roleOfHostname(host.hostname) === role);
      const serving = named.filter((host) =>
        readOpenPorts(buildDeepHostFs(ESSID, host)).some(({ service }) => service === 'http'),
      );
      return serving.length / named.length;
    };

    // 34 of 38 webserver-named deep hosts publish, against 15 of 60 phones. Under a
    // role re-derived from the address both would sit at the flat rate.
    expect(servingRate('webserver')).toBeGreaterThan(0.8);
    expect(servingRate('workstation')).toBeLessThan(0.45);
  });
  it('keeps the deep NPC named for its address as the home LAN does', () => {
    const deep = generateDeepLayer(ESSID, ROUTER_GW);
    const prefix = deep.host.hostname.slice(0, deep.host.hostname.lastIndexOf('-'));

    expect(deep.host.hostname).toBe(`${prefix}-${octetOf(deep.host.ip)}`);
  });

  it('is deterministic for the same network and fronting gateway', () => {
    expect(generateDeepLayer(ESSID, ROUTER_GW)).toEqual(
      generateDeepLayer(ESSID, ROUTER_GW),
    );
  });

  it('addresses the deep layer as a 10.x /24, distinct from the home 192.168 /24', () => {
    const home = generateHomeLan(ESSID);
    const deep = generateDeepLayer(ESSID, ROUTER_GW);

    expect(deep.subnet.startsWith('10.')).toBe(true);
    expect(deep.subnet.split('.')).toHaveLength(3);
    expect(deep.subnet).not.toBe(home.subnet);
  });

  it('hangs one NPC machine off the deep layer, on the deep subnet and not at .1', () => {
    const deep = generateDeepLayer(ESSID, ROUTER_GW);
    const octet = octetOf(deep.host.ip);

    expect(deep.host.kind).toBe('machine');
    expect(deep.host.ip.startsWith(`${deep.subnet}.`)).toBe(true);
    expect(octet).not.toBe(1);
    // A `<role prefix>-<octet>` name (like the home siblings) — its identity on the
    // LAN, which seeds the host's machine_id.
    expect(deep.host.hostname).toMatch(new RegExp(`-${octet}$`));
  });

  it('varies the deep subnet by FRONTING gateway (the gateway machine_id is the seed)', () => {
    // Two gateways front two DISTINCT segments — the rule that lets a chain stay
    // disjoint layer to layer.
    expect(generateDeepLayer(ESSID, ROUTER_GW).subnet).not.toBe(
      generateDeepLayer(ESSID, SWITCH_GW).subnet,
    );
  });

  it('varies the deep subnet by essid', () => {
    expect(generateDeepLayer(ESSID, ROUTER_GW).subnet).not.toBe(
      generateDeepLayer('OTHER-WIFI', ROUTER_GW).subnet,
    );
  });

  it('produces a byte-stable golden deep layer for a known fronting router', () => {
    // A pinned golden so an octet-offset or address-separator mutation shifts a value
    // and fails here deterministically — the relationship assertions above can't. The
    // child's `kind` is the seeded value for this fixture (a switch at the ~0.33 rate),
    // so a mutated kind-seed namespace also shifts it and fails here.
    expect(generateDeepLayer(ESSID, ROUTER_GW)).toEqual({
      subnet: '10.252.148',
      host: { ip: '10.252.148.179', hostname: 'speaker-179', kind: 'machine' },
      childGateway: { ip: '10.252.148.160', hostname: 'core-rtr-160', kind: 'switch' },
    });
  });
});

describe('generateDeepLayer — the child gateway (chain door)', () => {
  it('hangs a child GATEWAY behind a ROUTER, at a stable octet ≠ NPC ≠ .1', () => {
    const deep = generateDeepLayer(ESSID, ROUTER_GW);
    const child = deep.childGateway;

    expect(child).not.toBeNull();
    if (child === null) return;
    // A gateway device (router OR switch — its kind is seeded); never an NPC machine.
    expect(child.kind === 'router' || child.kind === 'switch').toBe(true);
    expect(child.ip.startsWith(`${deep.subnet}.`)).toBe(true);
    const childOctet = octetOf(child.ip);
    expect(childOctet).not.toBe(1);
    expect(childOctet).not.toBe(octetOf(deep.host.ip));
    // A router-pool name, like the home inner gateways.
    expect(child.hostname).toMatch(new RegExp(`-${childOctet}$`));
  });

  it('hangs NO child gateway behind a SWITCH — a switch forwards nothing', () => {
    expect(generateDeepLayer(ESSID, SWITCH_GW).childGateway).toBeNull();
  });

  it('is deterministic — the same fronting router yields the same child gateway', () => {
    expect(generateDeepLayer(ESSID, ROUTER_GW).childGateway).toEqual(
      generateDeepLayer(ESSID, ROUTER_GW).childGateway,
    );
  });
});

describe('generateDeepLayer — the child gateway kind is seeded (router/switch variety)', () => {
  // A spread of distinct fronting routers to exercise the per-gateway kind seed. Each
  // fronts its own layer, so its child gateway's kind is drawn independently.
  const frontingRouters: readonly FrontingGateway[] = Array.from({ length: 300 }, (_unused, index) => ({
    machineId: `inner-gw-${index}`,
    kind: 'router',
  }));
  const childKinds: readonly LanHost['kind'][] = frontingRouters
    .map((gateway) => generateDeepLayer(ESSID, gateway).childGateway)
    .filter((child): child is LanHost => child !== null)
    .map((child) => child.kind);

  it('seeds BOTH router and switch children across fronting gateways', () => {
    // The variety the slice exists for: a deep child gateway is no longer always a router.
    expect(childKinds).toContain('router');
    expect(childKinds).toContain('switch');
  });

  it('makes switches roughly a third of deep child gateways', () => {
    // Pins the ~0.33 mix: an all-router (prob→0) or all-switch (prob→1) mutation is
    // already caught above; this rejects a flipped (>) or doubled (~0.5+) probability.
    const switchCount = childKinds.filter((kind) => kind === 'switch').length;
    const fraction = switchCount / childKinds.length;
    expect(fraction).toBeGreaterThan(0.2);
    expect(fraction).toBeLessThan(0.45);
  });

  it('re-rolls the same child kind for the same fronting gateway (reload-stable)', () => {
    const gateway = frontingRouters[0];
    expect(generateDeepLayer(ESSID, gateway).childGateway?.kind).toBe(
      generateDeepLayer(ESSID, gateway).childGateway?.kind,
    );
  });

  it('keys the kind on the fronting gateway — the switch/router split varies by parent', () => {
    // A mutation that drops the parent machine_id from the kind seed would pin one kind
    // for every layer; seeing both kinds across distinct parents proves the parent is in
    // the seed (and the determinism test above proves it is stable per parent).
    expect(new Set(childKinds).size).toBeGreaterThan(1);
  });
});

describe('generateDeepLayer — a seeded switch child truncates the chain', () => {
  it('a switch child fronts no further gateway, but still fronts its own NPC layer', () => {
    // Find a fronting router whose child seeds as a switch, then confirm that switch —
    // used as a fronting gateway in turn — hangs no child of its own even with
    // hangsChild:true. So a switch seeded mid-chain ENDS the chain (depth is a max), while
    // still fronting a recon-only NPC layer.
    const switchParent = Array.from({ length: 300 }, (_unused, index) => ({
      machineId: `inner-gw-${index}`,
      kind: 'router' as const,
    })).find(
      (gateway) => generateDeepLayer(ESSID, gateway).childGateway?.kind === 'switch',
    );
    expect(switchParent).toBeDefined();
    if (switchParent === undefined) return;

    const switchChild = generateDeepLayer(ESSID, switchParent).childGateway;
    expect(switchChild?.kind).toBe('switch');
    if (switchChild === null || switchChild === undefined) return;

    const switchAsFronting: FrontingGateway = {
      machineId: computeDeepGatewayId(
        switchParent.machineId,
        Number(switchChild.ip.split('.')[3]),
      ),
      kind: switchChild.kind,
    };
    const below = generateDeepLayer(ESSID, switchAsFronting, { hangsChild: true });

    expect(below.childGateway).toBeNull();
    expect(below.host.kind).toBe('machine');
  });
});

describe('generateDeepLayer — terminal pin (hangsChild)', () => {
  it('hangs a child gateway by default — a router-fronted layer continues the chain', () => {
    // The default preserves the shipped behavior: a router fronts a layer WITH a child.
    expect(generateDeepLayer(ESSID, ROUTER_GW).childGateway).not.toBeNull();
    expect(
      generateDeepLayer(ESSID, ROUTER_GW, { hangsChild: true }).childGateway,
    ).not.toBeNull();
  });

  it('hangs NO child gateway when the layer is terminal (hangsChild false), even behind a router', () => {
    // A deep gateway fronts a TERMINAL layer — the chain stops, capping its depth.
    expect(
      generateDeepLayer(ESSID, ROUTER_GW, { hangsChild: false }).childGateway,
    ).toBeNull();
  });

  it('keeps the NPC byte-stable whether or not the layer is terminal (depth-independent host)', () => {
    // Only the child gateway is suppressed by the terminal pin; the subnet + NPC are
    // identical, so flipping depth never re-rolls the reachable host.
    const withChild = generateDeepLayer(ESSID, ROUTER_GW, { hangsChild: true });
    const terminal = generateDeepLayer(ESSID, ROUTER_GW, { hangsChild: false });

    expect(terminal.subnet).toBe(withChild.subnet);
    expect(terminal.host).toEqual(withChild.host);
  });
});

describe('seedNetworkDepth', () => {
  // A spread of networks to exercise the distribution, mirroring the range checks the
  // other seed seams use.
  const essids = Array.from({ length: 48 }, (_unused, index) => `WIFI-${index}`);

  it('is deterministic / reload-stable for one network', () => {
    expect(seedNetworkDepth(ESSID)).toBe(seedNetworkDepth(ESSID));
  });

  it('every network gets a depth in 1..3 (≥1, so no access point is playground-less)', () => {
    essids.forEach((essid) => {
      const depth = seedNetworkDepth(essid);
      expect(depth).toBeGreaterThanOrEqual(1);
      expect(depth).toBeLessThanOrEqual(3);
    });
  });

  it('spans the full 1..3 range across networks — the shallowest and deepest both occur', () => {
    // Pins both bounds: a max off-by-one would never reach 3, a min off-by-one would
    // drop 1 (or admit 0). Seeing both proves the range ends are live.
    const depths = new Set(essids.map((essid) => seedNetworkDepth(essid)));
    expect(depths.has(1)).toBe(true);
    expect(depths.has(3)).toBe(true);
  });

  it('varies by network — the chain is not one fixed depth everywhere', () => {
    // A mutation that drops the essid from the seed would pin one depth for every access
    // point; seeing more than one distinct value proves the essid is in the seed.
    expect(new Set(essids.map((essid) => seedNetworkDepth(essid))).size).toBeGreaterThan(1);
  });

  it('pins a byte-stable golden depth for a known network', () => {
    // Captured from the seeded generator and hardcoded so a mutated namespace string or
    // range bound shifts this value and fails here deterministically.
    expect(seedNetworkDepth(ESSID)).toBe(3);
  });
});

describe('buildDeepHostFs', () => {
  it('forces sshd:22 onto a deep host whose generated services would otherwise omit it', () => {
    // The reliability guarantee is the FORCED pidfile, not the probabilistic catalog
    // roll: prove it on a deep host whose RAW NPC FS does not serve :22, so a deep host
    // is always a reachable target regardless of how its services rolled.
    const deepHostWithoutRawSsh = Array.from({ length: 19 }, (_unused, index) => index + 2)
      .map((octet) => generateDeepLayer(ESSID, { machineId: `inner-gw-${octet}`, kind: 'router' }).host)
      .find(
        (host) =>
          !readOpenPorts(buildRemoteHostFs(ESSID, host)).some(
            (openPort) => openPort.port === 22,
          ),
      );
    expect(deepHostWithoutRawSsh).toBeDefined();
    if (deepHostWithoutRawSsh === undefined) return;

    const ports = readOpenPorts(buildDeepHostFs(ESSID, deepHostWithoutRawSsh));

    expect(ports.some((openPort) => openPort.port === 22 && openPort.service === 'ssh')).toBe(true);
  });

  it('carries the NPC box skeleton — a populated /etc/passwd for a later login', () => {
    const deep = generateDeepLayer(ESSID, ROUTER_GW);

    const fs = buildDeepHostFs(ESSID, deep.host);
    const etc = fs.entries.get('etc');
    const passwd = etc?.kind === 'directory' ? etc.entries.get('passwd') : undefined;

    expect(passwd?.kind === 'file' ? passwd.content : '').toContain('root:');
  });
});
