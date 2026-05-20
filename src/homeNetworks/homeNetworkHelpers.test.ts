import { describe, it, expect, vi } from 'vitest';
import {
  buildGatewayCanonicalIpMap,
  buildResolveTargetMachineId,
  computePlayerHostname,
  deriveHostnameSuffix,
  displayPromptHostname,
  isOnLayer0,
  isOwnWorkstation,
  occupantAwareReadNode,
  parseWorkstationId,
  targetMachineIdFor,
} from './homeNetworkHelpers';
import { generateIdentity } from '../identity/identity';
import type { OccupantSummary } from './types';
import type { HomeNetwork } from '../generation/generateHomeNetwork';
import type { GeneratedMachine, SubnetLayer } from '../generation/types';

describe('deriveHostnameSuffix', () => {
  it('returns the same suffix for the same player key (stable)', () => {
    const key = 'ed25519:abc123';
    expect(deriveHostnameSuffix(key)).toBe(deriveHostnameSuffix(key));
  });

  it('returns different suffixes for different player keys', () => {
    const a = deriveHostnameSuffix('ed25519:player-a');
    const b = deriveHostnameSuffix('ed25519:player-b');
    expect(a).not.toBe(b);
  });

  it('returns an 8-character lowercase hex string', () => {
    const suffix = deriveHostnameSuffix('ed25519:any-key');
    expect(suffix).toMatch(/^[0-9a-f]{8}$/);
  });

  it('produces a valid suffix for an empty key', () => {
    // Should not throw or return empty — the suffix is still well-formed
    // even when the input is degenerate. Hashing handles arbitrary input.
    expect(deriveHostnameSuffix('')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('distributes suffixes across the hex space', () => {
    // Sanity check that we're not collapsing to a constant — sample 100
    // distinct keys and require all 100 to be distinct (8 hex / 4B space
    // makes any collision in 100 samples vanishingly unlikely).
    const suffixes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      suffixes.add(deriveHostnameSuffix(`ed25519:key-${i}`));
    }
    expect(suffixes.size).toBe(100);
  });
});

describe('computePlayerHostname', () => {
  it('returns workstationName followed by a dash and the identity-derived suffix', () => {
    const identity = generateIdentity();
    const expectedSuffix = deriveHostnameSuffix(`ed25519:${identity.publicKeyHex}`);
    expect(computePlayerHostname('skylab', identity)).toBe(`skylab-${expectedSuffix}`);
  });

  it('matches the format /^.+-[0-9a-f]{8}$/', () => {
    const identity = generateIdentity();
    expect(computePlayerHostname('mainframe', identity)).toMatch(/^mainframe-[0-9a-f]{8}$/);
  });

  it('returns the same hostname for the same (workstationName, identity)', () => {
    const identity = generateIdentity();
    expect(computePlayerHostname('rocket', identity)).toBe(
      computePlayerHostname('rocket', identity),
    );
  });

  it('returns different suffixes for different identities (same prefix)', () => {
    const a = generateIdentity();
    const b = generateIdentity();
    expect(computePlayerHostname('skylab', a)).not.toBe(computePlayerHostname('skylab', b));
  });

  it('preserves the workstationName prefix verbatim', () => {
    const identity = generateIdentity();
    const hostname = computePlayerHostname('weird-name-with-dashes', identity);
    expect(hostname.startsWith('weird-name-with-dashes-')).toBe(true);
  });
});

describe('isOwnWorkstation', () => {
  it('returns true when the machine_id matches the own hostname exactly', () => {
    expect(isOwnWorkstation('skylab-aabbccdd', 'skylab-aabbccdd')).toBe(true);
  });

  it('returns false for a remote workstation hostname (different identity suffix)', () => {
    // Two players on the same LAN with the same workstation_name but
    // different identities — the suffix disambiguates so isOwnWorkstation
    // correctly distinguishes self from other.
    expect(isOwnWorkstation('skylab-bbccdd11', 'skylab-aabbccdd')).toBe(false);
  });

  it('returns false for a mission machine IP', () => {
    expect(isOwnWorkstation('192.168.50.42', 'skylab-aabbccdd')).toBe(false);
  });

  it('returns false for the literal "localhost" string', () => {
    // Critical: the legacy literal must not satisfy "is own workstation".
    // This is the entire point of eliminating localhost as a machine_id —
    // any storage operation that tries to key under 'localhost' is a bug.
    expect(isOwnWorkstation('localhost', 'skylab-aabbccdd')).toBe(false);
  });

  it('returns false when comparing two different host-octet IPs', () => {
    expect(isOwnWorkstation('10.0.0.42', '10.0.0.43')).toBe(false);
  });

  it('returns false for empty machineId against a real hostname', () => {
    expect(isOwnWorkstation('', 'skylab-aabbccdd')).toBe(false);
  });
});

describe('displayPromptHostname', () => {
  it('strips an 8-hex suffix off the end of a workstation hostname', () => {
    expect(displayPromptHostname('skylab-aabbccdd')).toBe('skylab');
  });

  it('leaves dashes inside the workstation name intact, only strips the final suffix', () => {
    expect(displayPromptHostname('my-workstation-aabbccdd')).toBe('my-workstation');
  });

  it('passes through hostnames without an 8-hex suffix unchanged', () => {
    // Mission/router hostnames don't carry the suffix — they're not
    // workstation_ids. Don't mangle them.
    expect(displayPromptHostname('db01')).toBe('db01');
    expect(displayPromptHostname('router')).toBe('router');
  });

  it('does NOT strip a 4-hex tail (too short to be a workstation_id suffix)', () => {
    // The suffix is required to be exactly 8 hex chars. A 4-hex tail
    // matches the OLD format pre-bump; the new code should leave it alone
    // (it's not a valid workstation_id in the new model).
    expect(displayPromptHostname('skylab-9k3a')).toBe('skylab-9k3a');
  });

  it('does NOT strip a 16-hex tail (too long to be a workstation_id suffix)', () => {
    expect(displayPromptHostname('skylab-aabbccdd11223344')).toBe('skylab-aabbccdd11223344');
  });

  it('does NOT strip a non-hex tail with the right length', () => {
    // `-zzzzzzzz` is 8 chars but not hex — not a workstation_id suffix.
    expect(displayPromptHostname('skylab-zzzzzzzz')).toBe('skylab-zzzzzzzz');
  });

  it('returns an empty string when the input is empty', () => {
    expect(displayPromptHostname('')).toBe('');
  });

  it('strips uppercase hex too? — no, only lowercase (workstation_id is canonically lowercase)', () => {
    // The suffix-generating function (deriveHostnameSuffix) returns
    // lowercase hex, so uppercase tails are by definition not from the
    // suffix path. Leave them alone.
    expect(displayPromptHostname('skylab-AABBCCDD')).toBe('skylab-AABBCCDD');
  });
});

describe('targetMachineIdFor', () => {
  const occupant = (overrides: Partial<OccupantSummary> = {}): OccupantSummary => ({
    network_id: '203.0.113.42',
    lan_ip: '.42',
    hostname: 'rocket-bbccdd11',
    ...overrides,
  });

  it('translates a LAN IP that matches an occupant slot to the occupant hostname', () => {
    // Player A targets B's workstation at 10.0.0.42; the LAN's subnet is
    // 10.0.0; occupant.lan_ip is .42. Helper resolves to B's hostname so
    // any patches A writes land under B's canonical workstation_id.
    expect(
      targetMachineIdFor('10.0.0.42', [occupant({ lan_ip: '.42' })], '10.0.0', null, 'me-aabbccdd'),
    ).toBe('rocket-bbccdd11');
  });

  it('returns the targetIp unchanged when no occupant has a matching LAN IP', () => {
    // Mission machines, world machines, router IPs — none of these are
    // occupants. They keep their literal IP as the machine_id.
    expect(
      targetMachineIdFor(
        '192.168.1.50',
        [occupant({ lan_ip: '.42' })],
        '192.168.1',
        null,
        'me-aabbccdd',
      ),
    ).toBe('192.168.1.50');
  });

  it("returns ownHostname when targetIp matches the player's own LAN IP", () => {
    // The player targeting their own LAN IP (e.g., to test reachability)
    // should resolve to their own workstation_id, not be treated as an
    // unknown remote.
    expect(targetMachineIdFor('10.0.0.99', [], '10.0.0', '10.0.0.99', 'me-aabbccdd')).toBe(
      'me-aabbccdd',
    );
  });

  it('selects the right occupant when multiple share the LAN', () => {
    const occupants = [
      occupant({ lan_ip: '.42', hostname: 'first-aaaaaaaa' }),
      occupant({ lan_ip: '.99', hostname: 'second-bbbbbbbb' }),
      occupant({ lan_ip: '.187', hostname: 'third-cccccccc' }),
    ];
    expect(targetMachineIdFor('10.0.0.99', occupants, '10.0.0', null, 'me')).toBe(
      'second-bbbbbbbb',
    );
  });

  it('does NOT match an occupant when targetIp is on a different subnet than the active LAN', () => {
    // Different subnets must not collide. A `.42` host octet on
    // 10.0.0.0/24 is a different physical machine than `.42` on
    // 192.168.1.0/24 even if both share the same occupant.lan_ip.
    // The activeSubnet param disambiguates.
    const occupants = [occupant({ lan_ip: '.42', hostname: 'rocket-aabbccdd' })];
    expect(targetMachineIdFor('10.0.0.42', occupants, '10.0.0', null, 'me')).toBe(
      'rocket-aabbccdd',
    );
    // Same lan_ip but the targetIp is on a different /24 — no match.
    expect(targetMachineIdFor('192.168.1.42', occupants, '10.0.0', null, 'me')).toBe(
      '192.168.1.42',
    );
  });

  it('returns the targetIp unchanged when lanOccupants is empty', () => {
    expect(targetMachineIdFor('10.0.0.42', [], '10.0.0', null, 'me-aabbccdd')).toBe('10.0.0.42');
  });

  it('returns the targetIp unchanged when targetIp has no dots (defensive)', () => {
    // Pathological / unparseable targetIp falls through cleanly rather
    // than throwing.
    expect(
      targetMachineIdFor('localhost', [occupant({ lan_ip: '.42' })], '10.0.0', null, 'me-aabbccdd'),
    ).toBe('localhost');
  });

  it('treats ownLanIp=null as "no own slot" — never matches', () => {
    expect(targetMachineIdFor('10.0.0.99', [], '10.0.0', null, 'me')).toBe('10.0.0.99');
  });

  it('treats activeSubnet=null as "no active LAN" — never matches an occupant', () => {
    // Player not connected to any home network — even if lanOccupants is
    // somehow non-empty, no translation happens.
    expect(
      targetMachineIdFor('10.0.0.42', [occupant({ lan_ip: '.42' })], null, null, 'me-aabbccdd'),
    ).toBe('10.0.0.42');
  });

  describe('gateway-alias canonicalization', () => {
    // Gateways (home router + inner-layer switch/router) serve on TWO
    // IPs locally: their canonical primary IP and their .1 LAN-side
    // alias. Players addressing the .1 alias should land on the same
    // storage key as players addressing the primary IP. Without
    // canonicalization, writes via .1 land under machine_id=".1" while
    // cross-LAN subscribers (who only know the primary IP) query a
    // different patches row and never observe the edit.

    it("translates the home router's .1 LAN alias to its canonical primary IP", () => {
      const aliasMap = new Map<string, string>([['10.0.0.1', '45.0.0.1']]);
      expect(targetMachineIdFor('10.0.0.1', [], '10.0.0', null, 'me-aabbccdd', aliasMap)).toBe(
        '45.0.0.1',
      );
    });

    it("translates an inner-layer gateway's .1 alias to its primary IP", () => {
      // Multi-layer topology: the inner gateway's primary IP is on
      // layer 0 (e.g. 10.0.0.50), but it's reachable from the inner
      // subnet at .1. Writes to the inner .1 must canonicalize to the
      // gateway's primary IP — same hygiene as the home router.
      const aliasMap = new Map<string, string>([
        ['10.0.0.1', '45.0.0.1'],
        ['10.0.1.1', '10.0.0.50'],
      ]);
      expect(targetMachineIdFor('10.0.1.1', [], '10.0.0', null, 'me-aabbccdd', aliasMap)).toBe(
        '10.0.0.50',
      );
    });

    it('preserves ownLanIp precedence over the gateway translation when they collide', () => {
      // Pathological case: a player whose ownLanIp happens to equal a
      // gateway alias IP. Shouldn't happen with the DHCP slot allocator
      // (occupants get host octets in a range that excludes .1), but
      // the precedence is pinned so a future allocator change can't
      // silently break self-targeting.
      const aliasMap = new Map<string, string>([['10.0.0.1', '45.0.0.1']]);
      expect(
        targetMachineIdFor('10.0.0.1', [], '10.0.0', '10.0.0.1', 'me-aabbccdd', aliasMap),
      ).toBe('me-aabbccdd');
    });

    it('does NOT translate an IP that is not in the gateway alias map', () => {
      // The gateway translation must match by exact IP equality, not
      // "looks like a .1". An IP outside the map falls through to the
      // occupant search (if applicable) or the passthrough branch.
      const aliasMap = new Map<string, string>([['10.0.0.1', '45.0.0.1']]);
      expect(targetMachineIdFor('192.168.1.1', [], '10.0.0', null, 'me-aabbccdd', aliasMap)).toBe(
        '192.168.1.1',
      );
    });

    it('preserves occupant translation for non-alias IPs when both an occupant and the gateway map are present', () => {
      // The gateway translation must not shadow occupant translation
      // for non-alias IPs on the same LAN. A player addressing another
      // occupant's slot (e.g. .42) still resolves to that occupant's
      // hostname even when the alias map is supplied.
      const aliasMap = new Map<string, string>([['10.0.0.1', '45.0.0.1']]);
      expect(
        targetMachineIdFor(
          '10.0.0.42',
          [occupant({ lan_ip: '.42', hostname: 'rocket-bbccdd11' })],
          '10.0.0',
          null,
          'me-aabbccdd',
          aliasMap,
        ),
      ).toBe('rocket-bbccdd11');
    });

    it('falls through to legacy behavior when the gateway alias map is omitted', () => {
      // Backward-compatible default: callers that don't supply the map
      // still see the pre-fix passthrough behavior for .1 alias IPs.
      // Keeps existing tests + transitional non-home-network call sites
      // working while wiring rolls out incrementally.
      expect(targetMachineIdFor('10.0.0.1', [], '10.0.0', null, 'me-aabbccdd')).toBe('10.0.0.1');
    });

    it('falls through to legacy behavior when the gateway alias map is empty', () => {
      // Explicit empty map (no gateways) behaves the same as omitting
      // the parameter — no translation happens.
      const aliasMap = new Map<string, string>();
      expect(targetMachineIdFor('10.0.0.1', [], '10.0.0', null, 'me-aabbccdd', aliasMap)).toBe(
        '10.0.0.1',
      );
    });
  });

  describe('foreign-occupant translation', () => {
    // After the cross-LAN trilogy (PRs #151-#155), foreign HomeNetworks
    // materialize client-side and their occupants (other players on
    // someone else's LAN) are addressable via the foreign LAN IP. The
    // resolver must translate that foreign LAN IP to the foreign
    // workstation_id so auth envelopes land on the correct storage key.
    // Precedence: ownLanIp > gateway-alias > own-LAN occupant > foreign
    // occupant > passthrough — foreign sits at the bottom so a
    // pathological IP collision can't shadow an own-LAN match.

    it("translates a foreign LAN IP to the foreign occupant's workstation_id", () => {
      const foreignMap = new Map([
        [
          '192.168.1.42',
          {
            workstationId: 'glider-eeff0011',
            networkId: '198.51.100.20',
            layer0Subnet: '192.168.1',
          },
        ],
      ]);
      expect(
        targetMachineIdFor(
          '192.168.1.42',
          [],
          '10.0.0',
          null,
          'me-aabbccdd',
          undefined,
          foreignMap,
        ),
      ).toBe('glider-eeff0011');
    });

    it('returns the targetIp unchanged when no foreign occupant matches', () => {
      const foreignMap = new Map([
        [
          '192.168.1.42',
          {
            workstationId: 'glider-eeff0011',
            networkId: '198.51.100.20',
            layer0Subnet: '192.168.1',
          },
        ],
      ]);
      expect(
        targetMachineIdFor(
          '192.168.1.99',
          [],
          '10.0.0',
          null,
          'me-aabbccdd',
          undefined,
          foreignMap,
        ),
      ).toBe('192.168.1.99');
    });

    it('preserves ownLanIp precedence over the foreign translation when they collide', () => {
      // Pathological: a foreign occupant whose full IP happens to equal
      // the player's own LAN IP. Own-machine targeting must always win.
      const foreignMap = new Map([
        [
          '10.0.0.99',
          {
            workstationId: 'glider-eeff0011',
            networkId: '198.51.100.20',
            layer0Subnet: '10.0.0',
          },
        ],
      ]);
      expect(
        targetMachineIdFor(
          '10.0.0.99',
          [],
          '10.0.0',
          '10.0.0.99',
          'me-aabbccdd',
          undefined,
          foreignMap,
        ),
      ).toBe('me-aabbccdd');
    });

    it('preserves gateway-alias precedence over the foreign translation when they collide', () => {
      // Pathological: a foreign occupant at the same IP as a gateway
      // alias. Gateway translation must still win because the IP is a
      // canonical address path with a known mapping, not a peer slot.
      const aliasMap = new Map<string, string>([['10.0.0.1', '45.0.0.1']]);
      const foreignMap = new Map([
        [
          '10.0.0.1',
          {
            workstationId: 'glider-eeff0011',
            networkId: '198.51.100.20',
            layer0Subnet: '10.0.0',
          },
        ],
      ]);
      expect(
        targetMachineIdFor('10.0.0.1', [], '10.0.0', null, 'me-aabbccdd', aliasMap, foreignMap),
      ).toBe('45.0.0.1');
    });

    it('preserves own-LAN occupant precedence over the foreign translation in a same-subnet collision', () => {
      // Two LANs both use 10.0.0.0/24 (the generator allows this); an
      // own-LAN occupant and a foreign occupant happen to share the
      // same .42 slot. Own-LAN wins because the player's interactive
      // context is rooted in their own LAN's broadcast scope.
      const occupants = [occupant({ lan_ip: '.42', hostname: 'own-lan-aaaaaaaa' })];
      const foreignMap = new Map([
        [
          '10.0.0.42',
          {
            workstationId: 'foreign-lan-bbbbbbbb',
            networkId: '198.51.100.20',
            layer0Subnet: '10.0.0',
          },
        ],
      ]);
      expect(
        targetMachineIdFor(
          '10.0.0.42',
          occupants,
          '10.0.0',
          null,
          'me-aabbccdd',
          undefined,
          foreignMap,
        ),
      ).toBe('own-lan-aaaaaaaa');
    });

    it('translates the foreign IP when the player has no active LAN at all', () => {
      // Player not connected to any home network — activeSubnet is null,
      // so the own-LAN branch never fires. Foreign translation still
      // applies. Mirrors the "I'm at home with no WiFi but still want to
      // reach a previously-touched foreign network" case (unlikely but
      // consistent).
      const foreignMap = new Map([
        [
          '192.168.1.42',
          {
            workstationId: 'glider-eeff0011',
            networkId: '198.51.100.20',
            layer0Subnet: '192.168.1',
          },
        ],
      ]);
      expect(
        targetMachineIdFor('192.168.1.42', [], null, null, 'me-aabbccdd', undefined, foreignMap),
      ).toBe('glider-eeff0011');
    });

    it('falls through to legacy behavior when the foreign map is omitted', () => {
      // Backward-compatible: callers that don't supply the foreign map
      // see the pre-extension passthrough behavior for off-LAN IPs.
      expect(targetMachineIdFor('192.168.1.42', [], '10.0.0', null, 'me-aabbccdd')).toBe(
        '192.168.1.42',
      );
    });

    it('falls through to legacy behavior when the foreign map is empty', () => {
      // Explicit empty map (no foreign networks loaded yet) behaves the
      // same as omitting the parameter.
      const foreignMap = new Map();
      expect(
        targetMachineIdFor(
          '192.168.1.42',
          [],
          '10.0.0',
          null,
          'me-aabbccdd',
          undefined,
          foreignMap,
        ),
      ).toBe('192.168.1.42');
    });
  });
});

describe('occupantAwareReadNode', () => {
  const occupant = (overrides: Partial<OccupantSummary> = {}): OccupantSummary => ({
    network_id: '203.0.113.42',
    lan_ip: '.42',
    hostname: 'rocket-bbccdd11',
    ...overrides,
  });

  it('translates an occupant LAN IP to the occupant hostname before delegating to the inner reader', () => {
    // Read symmetry with the write path: the network-rendering code
    // looks up pid files by machine.ip (the LAN IP), but cross-player
    // patches land under the occupant's canonical workstation_id. The
    // wrapper converts the IP to the hostname so reads find the patches
    // writes left.
    const inner = vi.fn((id: string, _path: string, _cwd: string) =>
      id === 'rocket-bbccdd11' ? 'PID-CONTENT' : null,
    );
    const wrapped = occupantAwareReadNode(
      inner,
      [occupant({ lan_ip: '.42' })],
      '10.0.0',
      null,
      'me-aabbccdd',
    );

    expect(wrapped('10.0.0.42', '/var/run/sshd.pid', '/')).toBe('PID-CONTENT');
    expect(inner).toHaveBeenCalledWith('rocket-bbccdd11', '/var/run/sshd.pid', '/');
  });

  it('passes non-occupant IPs (gateway, mission, off-LAN) through unchanged', () => {
    const inner = vi.fn().mockReturnValue(null);
    const wrapped = occupantAwareReadNode(
      inner,
      [occupant({ lan_ip: '.42' })],
      '10.0.0',
      null,
      'me-aabbccdd',
    );

    wrapped('10.0.0.1', '/etc/iptables/rules.v4', '/');
    expect(inner).toHaveBeenCalledWith('10.0.0.1', '/etc/iptables/rules.v4', '/');
  });

  it('forwards path and cwd unchanged across translation', () => {
    // The translation only rewrites the machine_id; path and cwd must
    // pass through verbatim (caller's path resolution semantics rely on
    // it).
    const inner = vi.fn().mockReturnValue(null);
    const wrapped = occupantAwareReadNode(
      inner,
      [occupant({ lan_ip: '.42' })],
      '10.0.0',
      null,
      'me-aabbccdd',
    );

    wrapped('10.0.0.42', '/etc/passwd', '/home/alice');
    expect(inner).toHaveBeenCalledWith('rocket-bbccdd11', '/etc/passwd', '/home/alice');
  });

  it("reads via the canonical primary IP when called with a gateway's .1 alias", () => {
    // Symmetric read-side counterpart to the write-side translation in
    // useNetworkCommands/Terminal. Players addressing the home router's
    // .1 alias for a read (e.g., cat /etc/iptables/rules.v4 from inside
    // the router shell) need the wrapped reader to fetch from the
    // canonical primary IP storage key — otherwise reads miss writes
    // that the new write-path canonicalization (Steps 4 + 5) routes to
    // the public IP.
    const inner = vi.fn((id: string, _path: string, _cwd: string) =>
      id === '45.0.0.1' ? 'IPTABLES-CONTENT' : null,
    );
    const aliasMap = new Map<string, string>([['10.0.0.1', '45.0.0.1']]);
    const wrapped = occupantAwareReadNode(inner, [], '10.0.0', null, 'me-aabbccdd', aliasMap);

    expect(wrapped('10.0.0.1', '/etc/iptables/rules.v4', '/')).toBe('IPTABLES-CONTENT');
    expect(inner).toHaveBeenCalledWith('45.0.0.1', '/etc/iptables/rules.v4', '/');
  });
});

// Shared factories used by buildGatewayCanonicalIpMap and
// buildResolveTargetMachineId tests. Inline copies of the
// network/networkUtils.test.ts factories — kept duplicated here so the
// homeNetworks helpers stay JSX-free (cross-module value imports from
// networkUtils transitively pull SessionContext.tsx).

const createGeneratedMachineFixture = (
  overrides: Partial<GeneratedMachine> = {},
): GeneratedMachine => ({
  ip: '10.0.0.1',
  hostname: 'test-machine',
  role: 'workstation',
  accessVariant: 'ssh',
  remoteMachine: { ip: '10.0.0.1', hostname: 'test-machine', ports: [], users: [] },
  ...overrides,
});

const createSubnetLayerFixture = (overrides: Partial<SubnetLayer> = {}): SubnetLayer => ({
  subnet: '10.0.0',
  gateway: createGeneratedMachineFixture({ ip: '10.0.0.50', hostname: 'gw', role: 'router' }),
  gatewayType: 'router',
  entryVariant: 'ssh',
  machines: [],
  isForwarded: false,
  ...overrides,
});

const createHomeNetworkFixture = (overrides: Partial<HomeNetwork> = {}): HomeNetwork => ({
  essid: 'TEST-WIFI',
  localhostIp: '10.0.0.100',
  router: { publicIp: '45.0.0.1', hostname: 'router01', internalIp: '10.0.0.1' },
  routerMachine: createGeneratedMachineFixture({
    ip: '45.0.0.1',
    hostname: 'router01',
    role: 'router',
  }),
  entryPoint: '10.0.0.10',
  entryVariant: 'ssh',
  machines: [],
  layers: [createSubnetLayerFixture({ subnet: '10.0.0' })],
  networkConfig: { machineConfigs: {} },
  fileSystems: {},
  difficulty: 'easy',
  ...overrides,
});

describe('buildGatewayCanonicalIpMap', () => {
  // Maps each gateway's .1 LAN-side alias to its canonical primary IP.
  // The home router is the load-bearing case: its primary IP is the
  // public IP, distinct from the .1 alias. Inner gateways may have a
  // primary IP that already equals .1, producing a harmless self-loop.

  it('returns an empty map when the input array is empty', () => {
    expect(buildGatewayCanonicalIpMap([]).size).toBe(0);
  });

  it("maps the home router's .1 alias to its canonical primary (public) IP", () => {
    // The home router serves on TWO IPs locally: its public IP (WAN) and
    // its .1 LAN-side alias. Players addressing the .1 alias must land
    // on the public IP storage key — the canonical key cross-LAN
    // subscribers query against.
    const home = createHomeNetworkFixture();

    const map = buildGatewayCanonicalIpMap([home]);

    expect(map.get('10.0.0.1')).toBe('45.0.0.1');
  });

  it("maps an inner-layer gateway's .1 alias to its primary IP", () => {
    // Multi-layer topology (medium/hard home networks). The inner
    // gateway has a primary IP on layer 0 (e.g. 10.0.0.50) and a .1
    // alias on its own inner subnet. Same storage hygiene rationale as
    // the home router, scaled to every gateway.
    const innerGateway = createGeneratedMachineFixture({ ip: '10.0.0.50', role: 'router' });
    const home = createHomeNetworkFixture({
      layers: [
        createSubnetLayerFixture({ subnet: '10.0.0' }),
        createSubnetLayerFixture({ subnet: '10.0.1', gateway: innerGateway }),
      ],
    });

    const map = buildGatewayCanonicalIpMap([home]);

    expect(map.get('10.0.1.1')).toBe('10.0.0.50');
  });

  it('includes BOTH the home-router alias and inner-gateway aliases in one map', () => {
    // Callers thread a single map through targetMachineIdFor — every
    // gateway on the active home network must be in the same map.
    const innerGateway = createGeneratedMachineFixture({ ip: '10.0.0.50', role: 'router' });
    const home = createHomeNetworkFixture({
      layers: [
        createSubnetLayerFixture({ subnet: '10.0.0' }),
        createSubnetLayerFixture({ subnet: '10.0.1', gateway: innerGateway }),
      ],
    });

    const map = buildGatewayCanonicalIpMap([home]);

    expect(map.size).toBe(2);
    expect(map.get('10.0.0.1')).toBe('45.0.0.1');
    expect(map.get('10.0.1.1')).toBe('10.0.0.50');
  });

  it('unions aliases across multiple home networks', () => {
    // Cross-LAN: when foreign home networks are cached locally, each
    // contributes its own gateway .1 → canonical-IP entries. The merged
    // map drives gateway canonicalization across own + foreign networks
    // uniformly.
    const own = createHomeNetworkFixture({
      router: { publicIp: '45.0.0.1', hostname: 'own', internalIp: '10.0.0.1' },
      routerMachine: createGeneratedMachineFixture({ ip: '45.0.0.1', role: 'router' }),
      layers: [createSubnetLayerFixture({ subnet: '10.0.0' })],
    });
    const foreign = createHomeNetworkFixture({
      router: { publicIp: '162.174.39.103', hostname: 'foreign', internalIp: '192.168.1.1' },
      routerMachine: createGeneratedMachineFixture({ ip: '162.174.39.103', role: 'router' }),
      layers: [createSubnetLayerFixture({ subnet: '192.168.1' })],
    });

    const map = buildGatewayCanonicalIpMap([own, foreign]);

    expect(map.size).toBe(2);
    expect(map.get('10.0.0.1')).toBe('45.0.0.1');
    expect(map.get('192.168.1.1')).toBe('162.174.39.103');
  });
});

describe('buildResolveTargetMachineId', () => {
  // Shared composition used by both useNetworkCommands and Terminal —
  // takes the current home-network state and returns a resolver that
  // hides the targetMachineIdFor parameter plumbing from the call
  // sites. Both writers and the parallel read-side wrap (logFs, etc.)
  // call the same resolver so cross-player writes/reads agree on the
  // canonical storage key.

  const createHomeNetwork = createHomeNetworkFixture;

  const buildOccupant = (overrides: Partial<OccupantSummary> = {}): OccupantSummary => ({
    network_id: '45.0.0.1',
    lan_ip: '.42',
    hostname: 'rocket-bbccdd11',
    ...overrides,
  });

  it("translates a LAN occupant's IP to that occupant's hostname", () => {
    // Most common cross-player write: A addressing B's LAN IP must
    // route patches to B's canonical workstation_id storage key.
    const home = createHomeNetwork();
    const resolve = buildResolveTargetMachineId(home, [buildOccupant()], 'me-aabbccdd');

    expect(resolve('10.0.0.42')).toBe('rocket-bbccdd11');
  });

  it("translates the home router's .1 LAN alias to its canonical primary IP", () => {
    // The gateway-alias canonicalization end-to-end: the home router's
    // .1 IP (10.0.0.1 by factory default) maps to the router's primary
    // IP (45.0.0.1 by factory default) so writes via either land in
    // the same patches row.
    const home = createHomeNetwork();
    const resolve = buildResolveTargetMachineId(home, [], 'me-aabbccdd');

    expect(resolve('10.0.0.1')).toBe('45.0.0.1');
  });

  it("returns ownHostname when targetIp matches the player's ownLanIp", () => {
    // Self-targeting (e.g., player targeting their own LAN IP) routes
    // to their own canonical workstation_id, not their LAN IP.
    const home = createHomeNetwork({ localhostIp: '10.0.0.99' });
    const resolve = buildResolveTargetMachineId(home, [], 'me-aabbccdd');

    expect(resolve('10.0.0.99')).toBe('me-aabbccdd');
  });

  it('passes IPs outside the active LAN through unchanged', () => {
    // Mission machines, world machines, and arbitrary off-LAN IPs
    // keep their literal IP as the machine_id.
    const home = createHomeNetwork();
    const resolve = buildResolveTargetMachineId(home, [buildOccupant()], 'me-aabbccdd');

    expect(resolve('203.0.113.50')).toBe('203.0.113.50');
  });

  it('passes the input through unchanged when no active home network is connected', () => {
    // No WiFi connected — no active LAN, no gateway aliases. The
    // resolver behaves like the legacy passthrough for every input.
    const resolveNull = buildResolveTargetMachineId(null, [], 'me-aabbccdd');
    expect(resolveNull('10.0.0.1')).toBe('10.0.0.1');
    expect(resolveNull('10.0.0.42')).toBe('10.0.0.42');

    const resolveUndef = buildResolveTargetMachineId(undefined, [], 'me-aabbccdd');
    expect(resolveUndef('10.0.0.1')).toBe('10.0.0.1');
  });

  it("resolves the router's .1 alias and its canonical primary IP to the SAME machine_id", () => {
    // Round-trip contract — load-bearing for cross-LAN observation.
    // A write addressed at the .1 alias must land in the SAME patches
    // row as a read addressed at the canonical primary IP, otherwise
    // cross-LAN subscribers (who only know the primary IP) never
    // observe the LAN-side write. Both the write path
    // (useNetworkCommands.logFs) and the read path (occupantAwareReadNode
    // wraps + Terminal) call the same resolver, so verifying both
    // inputs map to one output codifies the contract end-to-end.
    const home = createHomeNetwork();
    const resolve = buildResolveTargetMachineId(home, [], 'me-aabbccdd');

    const viaAlias = resolve('10.0.0.1');
    const viaPrimary = resolve('45.0.0.1');

    expect(viaAlias).toBe(viaPrimary);
    expect(viaAlias).toBe('45.0.0.1');
  });

  describe('foreign network threading', () => {
    // Foreign networks + occupants thread through buildResolveTargetMachineId
    // so the curried resolver translates foreign LAN IPs to foreign
    // workstation_ids. Call sites pass useForeignNetworks state directly
    // — the resolver hides the foreignLanOccupantMap construction.

    const createForeignNetwork = (publicIp: string, subnet: string): HomeNetwork =>
      createHomeNetwork({
        router: { publicIp, hostname: `r-${publicIp}`, internalIp: `${subnet}.1` },
        routerMachine: createGeneratedMachineFixture({
          ip: publicIp,
          hostname: `r-${publicIp}`,
          role: 'router',
        }),
        layers: [createSubnetLayerFixture({ subnet })],
      });

    it("translates a foreign LAN IP to the foreign occupant's workstation_id", () => {
      const own = createHomeNetwork();
      const foreign = createForeignNetwork('198.51.100.20', '192.168.1');
      const foreignOccupants: readonly OccupantSummary[] = [
        { network_id: '198.51.100.20', lan_ip: '.77', hostname: 'glider-eeff0011' },
      ];
      const resolve = buildResolveTargetMachineId(
        own,
        [],
        'me-aabbccdd',
        [foreign],
        foreignOccupants,
      );

      expect(resolve('192.168.1.77')).toBe('glider-eeff0011');
    });

    it("returns own-LAN occupant's hostname when targetIp is on own LAN even with foreign inputs", () => {
      // Foreign threading must not shadow own-LAN translation.
      const own = createHomeNetwork();
      const foreign = createForeignNetwork('198.51.100.20', '192.168.1');
      const resolve = buildResolveTargetMachineId(
        own,
        [buildOccupant({ lan_ip: '.42', hostname: 'own-aaaaaaaa' })],
        'me-aabbccdd',
        [foreign],
        [{ network_id: '198.51.100.20', lan_ip: '.77', hostname: 'glider-eeff0011' }],
      );

      expect(resolve('10.0.0.42')).toBe('own-aaaaaaaa');
    });

    it('passes IPs that match no foreign occupant through unchanged', () => {
      const own = createHomeNetwork();
      const foreign = createForeignNetwork('198.51.100.20', '192.168.1');
      const resolve = buildResolveTargetMachineId(
        own,
        [],
        'me-aabbccdd',
        [foreign],
        [{ network_id: '198.51.100.20', lan_ip: '.77', hostname: 'glider-eeff0011' }],
      );

      // Foreign network IP but no occupant at .99
      expect(resolve('192.168.1.99')).toBe('192.168.1.99');
      // Completely unknown IP
      expect(resolve('203.0.113.50')).toBe('203.0.113.50');
    });

    it('translates the foreign LAN IP even when no own home network is connected', () => {
      const foreign = createForeignNetwork('198.51.100.20', '192.168.1');
      const resolve = buildResolveTargetMachineId(
        null,
        [],
        'me-aabbccdd',
        [foreign],
        [{ network_id: '198.51.100.20', lan_ip: '.77', hostname: 'glider-eeff0011' }],
      );

      expect(resolve('192.168.1.77')).toBe('glider-eeff0011');
    });

    it('falls through to legacy behavior when foreign inputs are omitted', () => {
      const own = createHomeNetwork();
      const resolve = buildResolveTargetMachineId(own, [], 'me-aabbccdd');

      // No foreign inputs → off-LAN IPs pass through unchanged.
      expect(resolve('192.168.1.77')).toBe('192.168.1.77');
    });

    it('falls through to legacy behavior when foreign inputs are empty arrays', () => {
      const own = createHomeNetwork();
      const resolve = buildResolveTargetMachineId(own, [], 'me-aabbccdd', [], []);

      expect(resolve('192.168.1.77')).toBe('192.168.1.77');
    });
  });
});

// Used by getBaseFs handler to detect workstation_id machine_ids and
// reject anything else (IPv4, mission IDs, world IDs) with 400
// unsupported_machine_type. The suffix length (8 hex) and character
// class (lowercase hex only) are load-bearing — same as
// deriveHostnameSuffix's invariants.
describe('parseWorkstationId', () => {
  it('extracts name and suffix from a single-segment workstation_id', () => {
    expect(parseWorkstationId('omen-4a3b1c2d')).toEqual({
      name: 'omen',
      suffix: '4a3b1c2d',
    });
  });

  it('treats the LAST 8 hex chars as the suffix (multi-hyphen names)', () => {
    expect(parseWorkstationId('skylab-prime-deadbeef')).toEqual({
      name: 'skylab-prime',
      suffix: 'deadbeef',
    });
  });

  it('returns undefined for an IPv4 address', () => {
    expect(parseWorkstationId('192.168.1.50')).toBeUndefined();
  });

  it('returns undefined for a name with no suffix', () => {
    expect(parseWorkstationId('omen')).toBeUndefined();
  });

  it('returns undefined for a 4-hex (wrong length) suffix', () => {
    expect(parseWorkstationId('omen-1234')).toBeUndefined();
  });

  it('returns undefined for a suffix with non-hex chars', () => {
    expect(parseWorkstationId('omen-XYZGHIJK')).toBeUndefined();
  });

  it('returns undefined for an uppercase-hex suffix (deriveHostnameSuffix is lowercase)', () => {
    expect(parseWorkstationId('omen-DEADBEEF')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(parseWorkstationId('')).toBeUndefined();
  });

  it('returns undefined for just a suffix (no name segment before the dash)', () => {
    expect(parseWorkstationId('-deadbeef')).toBeUndefined();
  });

  it('roundtrips with computeWorkstationId for any (name, playerKey)', () => {
    const id = computePlayerHostname('rocket', {
      publicKeyHex: '0123456789abcdef',
    } as Parameters<typeof computePlayerHostname>[1]);
    const parsed = parseWorkstationId(id);
    expect(parsed?.name).toBe('rocket');
    expect(parsed?.suffix).toMatch(/^[0-9a-f]{8}$/);
    // Reconstructed must match the original.
    expect(`${parsed?.name}-${parsed?.suffix}`).toBe(id);
  });
});

describe('isOnLayer0', () => {
  // Used by NetworkContext to decide whether a machine the player SSH'd
  // into should see LAN-occupant workstations. Layer-0 machines (router
  // internal alias, NPC home machines on the LAN, inner-gateway's
  // layer-0-facing interface) all share broadcast scope with workstations.
  // Inner-layer machines (behind a switch/router on a different subnet)
  // don't.

  const SUBNET = '172.29.209';
  const ROUTER_PUBLIC = '51.146.70.192';

  it('returns true for the home router via its public IP', () => {
    expect(isOnLayer0(ROUTER_PUBLIC, SUBNET, ROUTER_PUBLIC)).toBe(true);
  });

  it('returns true for the home router via its layer-0 internal alias (.1)', () => {
    expect(isOnLayer0('172.29.209.1', SUBNET, ROUTER_PUBLIC)).toBe(true);
  });

  it('returns true for NPC home machines on the layer-0 subnet', () => {
    expect(isOnLayer0('172.29.209.50', SUBNET, ROUTER_PUBLIC)).toBe(true);
  });

  it("returns true for an inner gateway's layer-0-facing interface", () => {
    // opnsense at 172.29.209.168 with its other interface on layer 1 — when
    // the player SSHs to its layer-0 IP, they're on the LAN.
    expect(isOnLayer0('172.29.209.168', SUBNET, ROUTER_PUBLIC)).toBe(true);
  });

  it('returns false for an inner-layer subnet IP', () => {
    // layer 1: 172.26.218.0/24 — behind opnsense. No broadcast scope to layer 0.
    expect(isOnLayer0('172.26.218.50', SUBNET, ROUTER_PUBLIC)).toBe(false);
  });

  it('returns false for a deeper-layer IP', () => {
    // layer 2: 192.168.156.0/24 — behind mikrotik01.
    expect(isOnLayer0('192.168.156.10', SUBNET, ROUTER_PUBLIC)).toBe(false);
  });

  it('returns false for a mission/world public IP unrelated to home', () => {
    expect(isOnLayer0('203.0.113.42', SUBNET, ROUTER_PUBLIC)).toBe(false);
  });

  it('does NOT false-positive on a prefix collision', () => {
    // Subnet "172.29.20" vs IP "172.29.209.1" — must NOT match. Anchored
    // boundary at the dot prevents the substring overlap.
    expect(isOnLayer0('172.29.209.1', '172.29.20', ROUTER_PUBLIC)).toBe(false);
  });

  it('returns false when both subnet and public IP are unknown', () => {
    expect(isOnLayer0('172.29.209.1', null, null)).toBe(false);
  });

  it('still matches router public IP even when subnet is unknown', () => {
    // Edge case: a player SSH'd via public IP before home network fully loaded.
    expect(isOnLayer0(ROUTER_PUBLIC, null, ROUTER_PUBLIC)).toBe(true);
  });

  it('still matches subnet even when public IP is unknown', () => {
    expect(isOnLayer0('172.29.209.50', SUBNET, null)).toBe(true);
  });
});
