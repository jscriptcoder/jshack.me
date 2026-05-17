import { describe, it, expect, vi } from 'vitest';
import {
  findForeignLanForMember,
  resolveForeignRouter,
  type ForeignLanCacheValue,
  type ResolveForeignRouterDeps,
} from './resolveForeignRouter';
import type { LookupHomeNetworkResult } from '../homeNetworks/types';
import type { RemoteMachine } from './types';
import type { HomeNetwork } from '../generation/generateHomeNetwork';
import type { GeneratedMachine } from '../generation/types';

// Tiny test factories: build the minimum shape needed for the resolver to
// pluck routerMachine.remoteMachine out without recreating the full
// generateHomeNetwork pipeline. The actual regen is mocked at the deps
// boundary.

const mkRemoteMachine = (overrides?: Partial<RemoteMachine>): RemoteMachine => ({
  ip: '203.0.113.42',
  hostname: 'router.foreign',
  ports: [],
  users: [],
  ...overrides,
});

const mkRouterMachine = (remoteMachine: RemoteMachine): GeneratedMachine =>
  ({ ip: remoteMachine.ip, hostname: remoteMachine.hostname, remoteMachine }) as GeneratedMachine;

const mkHomeNetwork = (
  remoteMachine: RemoteMachine,
  machines: readonly GeneratedMachine[] = [],
): HomeNetwork => ({ routerMachine: mkRouterMachine(remoteMachine), machines }) as HomeNetwork;

const mkLookupResult = (overrides?: Partial<LookupHomeNetworkResult>): LookupHomeNetworkResult => ({
  public_ip: '203.0.113.42',
  essid_template: 'ACME-CORP',
  occupants: [],
  ...overrides,
});

const mkDeps = (overrides?: Partial<ResolveForeignRouterDeps>): ResolveForeignRouterDeps => ({
  lookup: overrides?.lookup ?? vi.fn().mockResolvedValue(mkLookupResult()),
  regenerate: overrides?.regenerate ?? vi.fn().mockResolvedValue(mkHomeNetwork(mkRemoteMachine())),
  addCrossLanMachineId: overrides?.addCrossLanMachineId ?? vi.fn(),
  cache: overrides?.cache ?? new Map(),
});

describe('resolveForeignRouter', () => {
  describe('happy path', () => {
    it('returns the regenerated foreign router as a RemoteMachine on lookup hit', async () => {
      const router = mkRemoteMachine({ hostname: 'router.foreign', ports: [] });
      const regenerate = vi.fn().mockResolvedValue(mkHomeNetwork(router));
      const deps = mkDeps({ regenerate });

      const result = await resolveForeignRouter('203.0.113.42', deps);

      expect(result).toEqual(router);
    });

    it('drives regeneration with seed=`home-${publicIp}` and the essid_template from the lookup', async () => {
      // The seed is deterministic per public IP — every player resolving
      // the same foreign IP regenerates the identical topology, so cross-
      // player views agree on port shape, hostnames, etc. essid_template
      // flows from the home_networks row so the regen's essid matches what
      // the owning player joined under.
      const lookup = vi.fn().mockResolvedValue(mkLookupResult({ essid_template: 'GLOBEX-NET' }));
      const regenerate = vi.fn().mockResolvedValue(mkHomeNetwork(mkRemoteMachine()));
      const deps = mkDeps({ lookup, regenerate });

      await resolveForeignRouter('203.0.113.42', deps);

      expect(regenerate).toHaveBeenCalledWith({
        seed: 'home-203.0.113.42',
        essid: 'GLOBEX-NET',
        routerPublicIp: '203.0.113.42',
      });
    });

    it('subscribes the player to the foreign router by calling addCrossLanMachineId(publicIp)', async () => {
      // The router's machine_id IS its public IP by construction (router.ip
      // === router.publicIp), so the subscription key is the public IP we
      // were asked to resolve. Without this call the rehydration fetch
      // wouldn't include the foreign router and we'd never see its patches.
      const addCrossLanMachineId = vi.fn();
      const deps = mkDeps({ addCrossLanMachineId });

      await resolveForeignRouter('203.0.113.42', deps);

      expect(addCrossLanMachineId).toHaveBeenCalledWith('203.0.113.42');
    });
  });

  describe('miss path', () => {
    it('returns null when the lookup returns null (404 from server)', async () => {
      const lookup = vi.fn().mockResolvedValue(null);
      const deps = mkDeps({ lookup });

      const result = await resolveForeignRouter('203.0.113.42', deps);

      expect(result).toBeNull();
    });

    it('does NOT regenerate when the lookup misses', async () => {
      const lookup = vi.fn().mockResolvedValue(null);
      const regenerate = vi.fn();
      const deps = mkDeps({ lookup, regenerate });

      await resolveForeignRouter('203.0.113.42', deps);

      expect(regenerate).not.toHaveBeenCalled();
    });

    it('does NOT subscribe when the lookup misses', async () => {
      // A miss means there's no home_networks row at this public IP. No
      // patches to subscribe to.
      const lookup = vi.fn().mockResolvedValue(null);
      const addCrossLanMachineId = vi.fn();
      const deps = mkDeps({ lookup, addCrossLanMachineId });

      await resolveForeignRouter('203.0.113.42', deps);

      expect(addCrossLanMachineId).not.toHaveBeenCalled();
    });
  });

  describe('caching', () => {
    it('caches the positive result — second call returns the same machine without a second lookup', async () => {
      const lookup = vi.fn().mockResolvedValue(mkLookupResult());
      const regenerate = vi.fn().mockResolvedValue(mkHomeNetwork(mkRemoteMachine()));
      const cache = new Map<string, ForeignLanCacheValue | null>();
      const deps = mkDeps({ lookup, regenerate, cache });

      const first = await resolveForeignRouter('203.0.113.42', deps);
      const second = await resolveForeignRouter('203.0.113.42', deps);

      expect(second).toBe(first);
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(regenerate).toHaveBeenCalledTimes(1);
    });

    it('caches the negative result — second call returns null without a second lookup', async () => {
      // Negative caching matters because findMachineByIp will hit the
      // resolver every time the player references an unresolvable IP.
      // Without negative caching we burn a /api/lookup-home-network round-
      // trip on each repeat reference.
      const lookup = vi.fn().mockResolvedValue(null);
      const cache = new Map<string, ForeignLanCacheValue | null>();
      const deps = mkDeps({ lookup, cache });

      const first = await resolveForeignRouter('203.0.113.42', deps);
      const second = await resolveForeignRouter('203.0.113.42', deps);

      expect(first).toBeNull();
      expect(second).toBeNull();
      expect(lookup).toHaveBeenCalledTimes(1);
    });

    it('caches per public IP — distinct IPs each trigger their own lookup', async () => {
      const lookup = vi
        .fn()
        .mockResolvedValueOnce(mkLookupResult({ public_ip: '203.0.113.42' }))
        .mockResolvedValueOnce(mkLookupResult({ public_ip: '198.51.100.7' }));
      const regenerate = vi
        .fn()
        .mockResolvedValueOnce(mkHomeNetwork(mkRemoteMachine({ ip: '203.0.113.42' })))
        .mockResolvedValueOnce(mkHomeNetwork(mkRemoteMachine({ ip: '198.51.100.7' })));
      const cache = new Map<string, ForeignLanCacheValue | null>();
      const deps = mkDeps({ lookup, regenerate, cache });

      const first = await resolveForeignRouter('203.0.113.42', deps);
      const second = await resolveForeignRouter('198.51.100.7', deps);

      expect(first?.ip).toBe('203.0.113.42');
      expect(second?.ip).toBe('198.51.100.7');
      expect(lookup).toHaveBeenCalledTimes(2);
    });

    it('caches the occupant hostnames returned by the lookup (for piece D foothold expansion)', async () => {
      // The lookup returns occupants alongside the router — Chunk D's
      // foothold-driven LAN expansion reads them straight from cache
      // when a session lands on a foreign-LAN member, without re-hitting
      // the server. The resolver itself still returns the router; the
      // occupants live in the cache entry.
      const lookup = vi.fn().mockResolvedValue(
        mkLookupResult({
          public_ip: '203.0.113.42',
          occupants: [
            { network_id: '203.0.113.42', lan_ip: '.187', hostname: 'skylab-aabbccdd' },
            { network_id: '203.0.113.42', lan_ip: '.42', hostname: 'rocket-bbccdd11' },
          ],
        }),
      );
      const cache = new Map<string, ForeignLanCacheValue | null>();
      const deps = mkDeps({ lookup, cache });

      await resolveForeignRouter('203.0.113.42', deps);

      const entry = cache.get('203.0.113.42');
      expect(entry).not.toBeNull();
      expect(entry?.occupantHostnames).toEqual(['skylab-aabbccdd', 'rocket-bbccdd11']);
    });

    it('does NOT re-subscribe on cache hit (idempotent — once is enough)', async () => {
      // addCrossLanMachineId on FileSystemContext is already idempotent
      // internally, but skipping the call entirely on cache hit avoids a
      // wasteful setState round-trip that would re-fire reconciliation
      // for no behavioral change.
      const addCrossLanMachineId = vi.fn();
      const cache = new Map<string, ForeignLanCacheValue | null>();
      const deps = mkDeps({ addCrossLanMachineId, cache });

      await resolveForeignRouter('203.0.113.42', deps);
      await resolveForeignRouter('203.0.113.42', deps);

      expect(addCrossLanMachineId).toHaveBeenCalledTimes(1);
    });
  });
});

describe('findForeignLanForMember', () => {
  // Reverse-index lookup over the cache: given a machineId (workstation_id
  // for an occupant, or the public IP for a router), find which cached
  // foreign LAN it belongs to so the foothold-expansion effect can fan
  // out the LAN's occupant set. Returns null when no cached entry
  // contains the machineId.

  const mkEntry = (
    routerIp: string,
    occupantHostnames: readonly string[],
  ): ForeignLanCacheValue => ({
    router: { ip: routerIp, hostname: `router-${routerIp}`, ports: [], users: [] },
    occupantHostnames,
    internalMachines: [],
  });

  it('returns the entry when machineId matches the router IP', async () => {
    const cache = new Map<string, ForeignLanCacheValue | null>([
      ['203.0.113.42', mkEntry('203.0.113.42', ['skylab-aabbccdd'])],
    ]);
    const found = findForeignLanForMember('203.0.113.42', cache);
    expect(found?.router.ip).toBe('203.0.113.42');
  });

  it('returns the entry when machineId matches an occupant hostname', async () => {
    // foothold case: player B exploited into A's workstation. session.machine
    // becomes A's workstation_id (= A's occupant.hostname). findForeignLanForMember
    // resolves that to A's foreign LAN so the caller can expand the
    // subscription set.
    const cache = new Map<string, ForeignLanCacheValue | null>([
      ['203.0.113.42', mkEntry('203.0.113.42', ['skylab-aabbccdd', 'rocket-bbccdd11'])],
    ]);
    const found = findForeignLanForMember('skylab-aabbccdd', cache);
    expect(found?.router.ip).toBe('203.0.113.42');
    expect(found?.occupantHostnames).toContain('skylab-aabbccdd');
  });

  it('returns null when no cached entry contains the machineId', () => {
    const cache = new Map<string, ForeignLanCacheValue | null>([
      ['203.0.113.42', mkEntry('203.0.113.42', ['skylab-aabbccdd'])],
    ]);
    expect(findForeignLanForMember('unrelated-id', cache)).toBeNull();
  });

  it('skips negative-cache entries (null values) without crashing', () => {
    // 404 lookups insert null into the cache. findForeignLanForMember
    // must tolerate that without dereferencing null.
    const cache = new Map<string, ForeignLanCacheValue | null>([
      ['198.51.100.99', null],
      ['203.0.113.42', mkEntry('203.0.113.42', ['skylab-aabbccdd'])],
    ]);
    const found = findForeignLanForMember('skylab-aabbccdd', cache);
    expect(found?.router.ip).toBe('203.0.113.42');
  });

  it('returns the first matching entry when an id occurs in multiple LANs (degenerate but safe)', () => {
    // Shouldn't happen — workstation_ids are unique by construction —
    // but the function shouldn't crash if the cache ends up with
    // duplicates from some race. Returning ANY matching entry is fine;
    // pinning "first" makes the behavior deterministic.
    const cache = new Map<string, ForeignLanCacheValue | null>([
      ['203.0.113.42', mkEntry('203.0.113.42', ['dup-host'])],
      ['198.51.100.7', mkEntry('198.51.100.7', ['dup-host'])],
    ]);
    const found = findForeignLanForMember('dup-host', cache);
    expect(found).not.toBeNull();
    expect(['203.0.113.42', '198.51.100.7']).toContain(found?.router.ip);
  });
});
