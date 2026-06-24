import { describe, expect, it } from 'vitest';
import { buildDeepHostFs, generateDeepLayer, type FrontingGateway } from './generateDeepLayer';
import { generateHomeLan } from './generateHomeLan';
import { buildRemoteHostFs } from './remoteHostFs';
import { readOpenPorts } from '../services/pidfile';

/**
 * `generateDeepLayer` is the deeper-layer counterpart of `generateHomeLan`: behind
 * an inner gateway it hangs a hidden `10.x.y.0/24` segment. It is pure + deterministic
 * from `(pubkey, essid, frontingGateway)`, so the same world re-rolls identically every
 * reload, and the addressing stays cleanly separate from the home `192.168.x` LAN. The
 * layer is keyed by the gateway that FRONTS it (its machine_id), so every gateway in a
 * chain fronts its own distinct segment. A layer fronted by a router also hangs a CHILD
 * gateway — the door to the next layer down; a switch forwards nothing, so it fronts no
 * child.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const ROUTER_GW: FrontingGateway = { machineId: 'inner-gw-aaaa1111', kind: 'router' };
const SWITCH_GW: FrontingGateway = { machineId: 'switch-bbbb2222', kind: 'switch' };

const octetOf = (ip: string): number => Number(ip.split('.')[3]);

describe('generateDeepLayer', () => {
  it('is deterministic for the same identity, essid, and fronting gateway', () => {
    expect(generateDeepLayer(PUBKEY, ESSID, ROUTER_GW)).toEqual(
      generateDeepLayer(PUBKEY, ESSID, ROUTER_GW),
    );
  });

  it('addresses the deep layer as a 10.x /24, distinct from the home 192.168 /24', () => {
    const home = generateHomeLan(PUBKEY, ESSID);
    const deep = generateDeepLayer(PUBKEY, ESSID, ROUTER_GW);

    expect(deep.subnet.startsWith('10.')).toBe(true);
    expect(deep.subnet.split('.')).toHaveLength(3);
    expect(deep.subnet).not.toBe(home.subnet);
  });

  it('hangs one NPC machine off the deep layer, on the deep subnet and not at .1', () => {
    const deep = generateDeepLayer(PUBKEY, ESSID, ROUTER_GW);
    const octet = octetOf(deep.host.ip);

    expect(deep.host.kind).toBe('machine');
    expect(deep.host.ip.startsWith(`${deep.subnet}.`)).toBe(true);
    expect(octet).not.toBe(1);
    // A DHCP-style `<device>-<octet>` name (like the home siblings) — its identity on
    // the LAN, which seeds the host's machine_id.
    expect(deep.host.hostname).toMatch(new RegExp(`-${octet}$`));
  });

  it('varies the deep subnet by FRONTING gateway (the gateway machine_id is the seed)', () => {
    // Two gateways front two DISTINCT segments — the rule that lets a chain stay
    // disjoint layer to layer.
    expect(generateDeepLayer(PUBKEY, ESSID, ROUTER_GW).subnet).not.toBe(
      generateDeepLayer(PUBKEY, ESSID, SWITCH_GW).subnet,
    );
  });

  it('varies the deep subnet by essid', () => {
    expect(generateDeepLayer(PUBKEY, ESSID, ROUTER_GW).subnet).not.toBe(
      generateDeepLayer(PUBKEY, 'OTHER-WIFI', ROUTER_GW).subnet,
    );
  });

  it('produces a byte-stable golden deep layer for a known fronting router', () => {
    // A pinned golden so an octet-offset or address-separator mutation shifts a value
    // and fails here deterministically — the relationship assertions above can't.
    expect(generateDeepLayer(PUBKEY, ESSID, ROUTER_GW)).toEqual({
      subnet: '10.109.8',
      host: { ip: '10.109.8.63', hostname: 'tablet-63', kind: 'machine' },
      childGateway: { ip: '10.109.8.178', hostname: 'mikrotik01-178', kind: 'router' },
    });
  });
});

describe('generateDeepLayer — the child gateway (chain door)', () => {
  it('hangs a child gateway (kind router) behind a ROUTER, at a stable octet ≠ NPC ≠ .1', () => {
    const deep = generateDeepLayer(PUBKEY, ESSID, ROUTER_GW);
    const child = deep.childGateway;

    expect(child).not.toBeNull();
    if (child === null) return;
    expect(child.kind).toBe('router');
    expect(child.ip.startsWith(`${deep.subnet}.`)).toBe(true);
    const childOctet = octetOf(child.ip);
    expect(childOctet).not.toBe(1);
    expect(childOctet).not.toBe(octetOf(deep.host.ip));
    // A router-pool name, like the home inner gateways.
    expect(child.hostname).toMatch(new RegExp(`-${childOctet}$`));
  });

  it('hangs NO child gateway behind a SWITCH — a switch forwards nothing', () => {
    expect(generateDeepLayer(PUBKEY, ESSID, SWITCH_GW).childGateway).toBeNull();
  });

  it('is deterministic — the same fronting router yields the same child gateway', () => {
    expect(generateDeepLayer(PUBKEY, ESSID, ROUTER_GW).childGateway).toEqual(
      generateDeepLayer(PUBKEY, ESSID, ROUTER_GW).childGateway,
    );
  });
});

describe('buildDeepHostFs', () => {
  it('forces sshd:22 onto a deep host whose generated services would otherwise omit it', () => {
    // The reliability guarantee is the FORCED pidfile, not the probabilistic catalog
    // roll: prove it on a deep host whose RAW NPC FS does not serve :22, so a deep host
    // is always a reachable target regardless of how its services rolled.
    const deepHostWithoutRawSsh = Array.from({ length: 19 }, (_unused, index) => index + 2)
      .map((octet) => generateDeepLayer(PUBKEY, ESSID, { machineId: `inner-gw-${octet}`, kind: 'router' }).host)
      .find(
        (host) =>
          !readOpenPorts(buildRemoteHostFs(PUBKEY, ESSID, host)).some(
            (openPort) => openPort.port === 22,
          ),
      );
    expect(deepHostWithoutRawSsh).toBeDefined();
    if (deepHostWithoutRawSsh === undefined) return;

    const ports = readOpenPorts(buildDeepHostFs(PUBKEY, ESSID, deepHostWithoutRawSsh));

    expect(ports.some((openPort) => openPort.port === 22 && openPort.service === 'ssh')).toBe(true);
  });

  it('carries the NPC box skeleton — a populated /etc/passwd for a later login', () => {
    const deep = generateDeepLayer(PUBKEY, ESSID, ROUTER_GW);

    const fs = buildDeepHostFs(PUBKEY, ESSID, deep.host);
    const etc = fs.entries.get('etc');
    const passwd = etc?.kind === 'directory' ? etc.entries.get('passwd') : undefined;

    expect(passwd?.kind === 'file' ? passwd.content : '').toContain('root:');
  });
});
