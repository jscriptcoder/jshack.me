import { describe, expect, it } from 'vitest';
import { buildDeepHostFs, deepLayerIndexForGateway, generateDeepLayer } from './generateDeepLayer';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { buildRemoteHostFs } from './remoteHostFs';
import { readOpenPorts } from '../services/pidfile';

/**
 * `generateDeepLayer` is the deeper-layer counterpart of `generateHomeLan`: behind
 * an inner gateway it hangs a hidden `10.x.y.0/24` segment with one reachable NPC
 * machine. It is pure + deterministic from `(pubkey, essid, layerIndex)`, so the
 * same world re-rolls identically every reload, and the addressing stays cleanly
 * separate from the home `192.168.x` LAN.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const DEEP_INDEX = 2;

describe('generateDeepLayer', () => {
  it('is deterministic for the same identity, essid, and layer index', () => {
    expect(generateDeepLayer(PUBKEY, ESSID, DEEP_INDEX)).toEqual(
      generateDeepLayer(PUBKEY, ESSID, DEEP_INDEX),
    );
  });

  it('addresses the deep layer as a 10.x /24, distinct from the home 192.168 /24', () => {
    const home = generateHomeLan(PUBKEY, ESSID);
    const deep = generateDeepLayer(PUBKEY, ESSID, DEEP_INDEX);

    expect(deep.subnet.startsWith('10.')).toBe(true);
    expect(deep.subnet.split('.')).toHaveLength(3);
    expect(deep.subnet).not.toBe(home.subnet);
  });

  it('hangs one NPC machine off the deep layer, on the deep subnet and not at .1', () => {
    const deep = generateDeepLayer(PUBKEY, ESSID, DEEP_INDEX);
    const octet = Number(deep.host.ip.split('.')[3]);

    expect(deep.host.kind).toBe('machine');
    expect(deep.host.ip.startsWith(`${deep.subnet}.`)).toBe(true);
    expect(octet).not.toBe(1);
    // A DHCP-style `<device>-<octet>` name (like the home siblings) — its identity on
    // the LAN, which seeds the host's machine_id.
    expect(deep.host.hostname).toMatch(new RegExp(`-${octet}$`));
  });

  it('varies the deep subnet by layer index (the index is part of the seed)', () => {
    expect(generateDeepLayer(PUBKEY, ESSID, 2).subnet).not.toBe(
      generateDeepLayer(PUBKEY, ESSID, 3).subnet,
    );
  });

  it('varies the deep subnet by essid', () => {
    expect(generateDeepLayer(PUBKEY, ESSID, DEEP_INDEX).subnet).not.toBe(
      generateDeepLayer(PUBKEY, 'OTHER-WIFI', DEEP_INDEX).subnet,
    );
  });
});

describe('deepLayerIndexForGateway', () => {
  const lan = generateHomeLan(PUBKEY, ESSID);
  const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);
  const findKind = (kind: LanHost['kind'], predicate: (host: LanHost) => boolean = () => true): LanHost => {
    const host = lan.hosts.find((candidate) => candidate.kind === kind && predicate(candidate));
    if (host === undefined) throw new Error(`no ${kind} on the golden LAN`);
    return host;
  };

  it('maps a router inner gateway to the base deep-layer index (2)', () => {
    const innerRouter = findKind('router', (host) => octetOf(host) !== 1);

    expect(deepLayerIndexForGateway(innerRouter)).toBe(2);
  });

  it('maps a switch inner gateway to the next deep-layer index (3) — its OWN segment', () => {
    const innerSwitch = findKind('switch');

    expect(deepLayerIndexForGateway(innerSwitch)).toBe(3);
  });

  it('fronts the switch onto a deep /24 distinct from the router’s', () => {
    const innerRouter = findKind('router', (host) => octetOf(host) !== 1);
    const innerSwitch = findKind('switch');

    const routerDeep = generateDeepLayer(PUBKEY, ESSID, deepLayerIndexForGateway(innerRouter));
    const switchDeep = generateDeepLayer(PUBKEY, ESSID, deepLayerIndexForGateway(innerSwitch));

    expect(switchDeep.subnet).not.toBe(routerDeep.subnet);
  });
});

describe('buildDeepHostFs', () => {
  it('forces sshd:22 onto a deep host whose generated services would otherwise omit it', () => {
    // The reliability guarantee is the FORCED pidfile, not the probabilistic catalog
    // roll: prove it on a deep host whose RAW NPC FS does not serve :22, so a deep host
    // is always a reachable target regardless of how its services rolled.
    const deepHostWithoutRawSsh = Array.from({ length: 19 }, (_unused, index) => index + 2)
      .map((layerIndex) => generateDeepLayer(PUBKEY, ESSID, layerIndex).host)
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
    const deep = generateDeepLayer(PUBKEY, ESSID, DEEP_INDEX);

    const fs = buildDeepHostFs(PUBKEY, ESSID, deep.host);
    const etc = fs.entries.get('etc');
    const passwd = etc?.kind === 'directory' ? etc.entries.get('passwd') : undefined;

    expect(passwd?.kind === 'file' ? passwd.content : '').toContain('root:');
  });
});
