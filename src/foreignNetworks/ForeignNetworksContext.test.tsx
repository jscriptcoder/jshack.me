import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { HomeNetwork } from '../generation/generateHomeNetwork';
import type { HomeNetworkLookupResult, OccupantSummary } from '../homeNetworks/types';
import type { FileNode } from '../filesystem/types';

// --- Module mocks ---

vi.mock('../homeNetworks/lookupClient', () => ({
  lookupHomeNetwork: vi.fn(),
}));

vi.mock('../generation/generateHomeNetwork', async () => {
  const actual = await vi.importActual<typeof import('../generation/generateHomeNetwork')>(
    '../generation/generateHomeNetwork',
  );
  return {
    ...actual,
    generateHomeNetwork: vi.fn(),
  };
});

vi.mock('../homeNetworks/listOccupants', () => ({
  listOccupants: vi.fn(),
}));

vi.mock('../identity', () => ({
  getIdentity: () => ({
    privateKey: new Uint8Array(32),
    publicKey: new Uint8Array(32),
    publicKeyHex: 'aa'.repeat(32),
  }),
}));

import { lookupHomeNetwork as mockedLookupHomeNetwork } from '../homeNetworks/lookupClient';
import { generateHomeNetwork as mockedGenerateHomeNetwork } from '../generation/generateHomeNetwork';
import { listOccupants as mockedListOccupants } from '../homeNetworks/listOccupants';
import { ForeignNetworksProvider, useForeignNetworks } from './ForeignNetworksContext';

// --- Helpers ---

const sampleLookupResult = (
  overrides: Partial<HomeNetworkLookupResult> = {},
): HomeNetworkLookupResult => ({
  public_ip: '162.174.39.103',
  essid_template: 'ACME-CORP',
  density_tier: 'crowded',
  max_slots: 8,
  seed: 'home-162.174.39.103',
  ...overrides,
});

const sampleDir = (name = 'root'): FileNode => ({
  name,
  type: 'directory',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  children: {},
});

const sampleHomeNetwork = (overrides: Partial<HomeNetwork> = {}): HomeNetwork =>
  ({
    essid: 'ACME-CORP',
    localhostIp: '192.168.0.42',
    router: {
      publicIp: '162.174.39.103',
      hostname: 'router-foo',
      internalIp: '192.168.0.1',
    },
    routerMachine: { ip: '162.174.39.103' },
    entryPoint: '162.174.39.103',
    entryVariant: 'single_layer',
    machines: [],
    layers: [],
    networkConfig: { machineConfigs: {} },
    fileSystems: {
      '162.174.39.103': sampleDir(),
      '192.168.0.1': sampleDir(),
    },
    difficulty: 'easy',
    ...overrides,
  }) as HomeNetwork;

const sampleOccupant = (overrides: Partial<OccupantSummary> = {}): OccupantSummary => ({
  network_id: '162.174.39.103',
  lan_ip: '.42',
  hostname: 'skylab-9k3',
  ...overrides,
});

const mkWrapper = (ownActiveHomePublicIp: string | null = null) => {
  return ({ children }: { children: ReactNode }) => (
    <ForeignNetworksProvider ownActiveHomePublicIp={ownActiveHomePublicIp}>
      {children}
    </ForeignNetworksProvider>
  );
};

describe('ForeignNetworksContext', () => {
  beforeEach(() => {
    vi.mocked(mockedLookupHomeNetwork).mockReset();
    vi.mocked(mockedGenerateHomeNetwork).mockReset();
    vi.mocked(mockedListOccupants).mockReset();
  });

  describe('skeleton', () => {
    it('useForeignNetworks() throws when used outside a provider', () => {
      expect(() => renderHook(() => useForeignNetworks())).toThrow();
    });

    it('exposes empty state when no networks have been resolved', () => {
      const { result } = renderHook(() => useForeignNetworks(), { wrapper: mkWrapper() });
      expect(result.current.foreignNetworks).toEqual([]);
      expect(result.current.foreignLanOccupants).toEqual([]);
      expect(result.current.foreignFileSystems).toEqual({});
      expect(result.current.foreignLanOccupantHostnames).toEqual([]);
    });
  });

  describe('ensureForeignReachable short-circuits', () => {
    it('returns null for an RFC1918 input without any module call', async () => {
      const { result } = renderHook(() => useForeignNetworks(), { wrapper: mkWrapper() });

      let resolved: unknown;
      await act(async () => {
        resolved = await result.current.ensureForeignReachable('10.0.0.1');
      });

      expect(resolved).toBeNull();
      expect(mockedLookupHomeNetwork).not.toHaveBeenCalled();
      expect(mockedGenerateHomeNetwork).not.toHaveBeenCalled();
      expect(mockedListOccupants).not.toHaveBeenCalled();
    });

    it('returns null for the own active home public IP', async () => {
      const { result } = renderHook(() => useForeignNetworks(), {
        wrapper: mkWrapper('162.174.39.103'),
      });

      let resolved: unknown;
      await act(async () => {
        resolved = await result.current.ensureForeignReachable('162.174.39.103');
      });

      expect(resolved).toBeNull();
      expect(mockedLookupHomeNetwork).not.toHaveBeenCalled();
    });

    it('returns null for malformed input', async () => {
      const { result } = renderHook(() => useForeignNetworks(), { wrapper: mkWrapper() });

      let resolved: unknown;
      await act(async () => {
        resolved = await result.current.ensureForeignReachable('not-an-ip');
      });

      expect(resolved).toBeNull();
      expect(mockedLookupHomeNetwork).not.toHaveBeenCalled();
    });

    it('returns null for loopback', async () => {
      const { result } = renderHook(() => useForeignNetworks(), { wrapper: mkWrapper() });

      let resolved: unknown;
      await act(async () => {
        resolved = await result.current.ensureForeignReachable('127.0.0.1');
      });

      expect(resolved).toBeNull();
      expect(mockedLookupHomeNetwork).not.toHaveBeenCalled();
    });
  });

  describe('ensureForeignReachable happy path', () => {
    it('looks up + regenerates + fetches occupants + caches on first touch', async () => {
      const lookupResult = sampleLookupResult();
      const network = sampleHomeNetwork();
      const occupants = [sampleOccupant({ hostname: 'foo-aaaa' })];
      vi.mocked(mockedLookupHomeNetwork).mockResolvedValue(lookupResult);
      vi.mocked(mockedGenerateHomeNetwork).mockResolvedValue(network);
      vi.mocked(mockedListOccupants).mockResolvedValue(occupants);

      const { result } = renderHook(() => useForeignNetworks(), { wrapper: mkWrapper() });

      let resolved: HomeNetwork | null = null;
      await act(async () => {
        resolved = await result.current.ensureForeignReachable('162.174.39.103');
      });

      expect(resolved).toBe(network);
      expect(mockedLookupHomeNetwork).toHaveBeenCalledTimes(1);
      expect(mockedLookupHomeNetwork).toHaveBeenCalledWith(
        expect.objectContaining({ publicKeyHex: 'aa'.repeat(32) }),
        '162.174.39.103',
      );
      expect(mockedGenerateHomeNetwork).toHaveBeenCalledTimes(1);
      expect(mockedGenerateHomeNetwork).toHaveBeenCalledWith(
        expect.objectContaining({
          seed: 'home-162.174.39.103',
          essid: 'ACME-CORP',
          routerPublicIp: '162.174.39.103',
        }),
      );
      expect(mockedListOccupants).toHaveBeenCalledTimes(1);
      expect(mockedListOccupants).toHaveBeenCalledWith('162.174.39.103');

      // Derived selectors reflect the cached entry after the resolver
      // bumps the version counter.
      await waitFor(() => {
        expect(result.current.foreignNetworks).toEqual([network]);
        expect(result.current.foreignLanOccupants).toEqual(occupants);
        expect(result.current.foreignLanOccupantHostnames).toEqual(['foo-aaaa']);
        expect(result.current.foreignFileSystems).toEqual(network.fileSystems);
      });
    });

    it('returns the cached network on subsequent calls without re-invoking the lookup', async () => {
      const lookupResult = sampleLookupResult();
      const network = sampleHomeNetwork();
      vi.mocked(mockedLookupHomeNetwork).mockResolvedValue(lookupResult);
      vi.mocked(mockedGenerateHomeNetwork).mockResolvedValue(network);
      vi.mocked(mockedListOccupants).mockResolvedValue([]);

      const { result } = renderHook(() => useForeignNetworks(), { wrapper: mkWrapper() });

      let firstResolved: HomeNetwork | null = null;
      let secondResolved: HomeNetwork | null = null;
      await act(async () => {
        firstResolved = await result.current.ensureForeignReachable('162.174.39.103');
      });
      await act(async () => {
        secondResolved = await result.current.ensureForeignReachable('162.174.39.103');
      });

      expect(firstResolved).toBe(network);
      expect(secondResolved).toBe(network);
      expect(mockedLookupHomeNetwork).toHaveBeenCalledTimes(1);
      expect(mockedGenerateHomeNetwork).toHaveBeenCalledTimes(1);
      expect(mockedListOccupants).toHaveBeenCalledTimes(1);
    });

    it('coalesces concurrent calls for the same IP into a single lookup', async () => {
      const lookupResult = sampleLookupResult();
      const network = sampleHomeNetwork();
      vi.mocked(mockedLookupHomeNetwork).mockResolvedValue(lookupResult);
      vi.mocked(mockedGenerateHomeNetwork).mockResolvedValue(network);
      vi.mocked(mockedListOccupants).mockResolvedValue([]);

      const { result } = renderHook(() => useForeignNetworks(), { wrapper: mkWrapper() });

      const resolveds: Array<HomeNetwork | null> = [];
      await act(async () => {
        const [first, second, third] = await Promise.all([
          result.current.ensureForeignReachable('162.174.39.103'),
          result.current.ensureForeignReachable('162.174.39.103'),
          result.current.ensureForeignReachable('162.174.39.103'),
        ]);
        resolveds.push(first, second, third);
      });

      expect(resolveds[0]).toBe(network);
      expect(resolveds[1]).toBe(network);
      expect(resolveds[2]).toBe(network);
      expect(mockedLookupHomeNetwork).toHaveBeenCalledTimes(1);
    });

    it('returns null when the lookup returns null (404 not found) and caches nothing', async () => {
      vi.mocked(mockedLookupHomeNetwork).mockResolvedValue(null);

      const { result } = renderHook(() => useForeignNetworks(), { wrapper: mkWrapper() });

      let resolved: HomeNetwork | null = null;
      await act(async () => {
        resolved = await result.current.ensureForeignReachable('162.174.39.103');
      });

      expect(resolved).toBeNull();
      // Subsequent call should re-fetch (no cache entry written) so an
      // ephemeral 404 doesn't permanently poison the resolver for that IP.
      vi.mocked(mockedLookupHomeNetwork).mockResolvedValue(sampleLookupResult());
      vi.mocked(mockedGenerateHomeNetwork).mockResolvedValue(sampleHomeNetwork());
      vi.mocked(mockedListOccupants).mockResolvedValue([]);
      await act(async () => {
        resolved = await result.current.ensureForeignReachable('162.174.39.103');
      });
      expect(resolved).not.toBeNull();
      expect(mockedLookupHomeNetwork).toHaveBeenCalledTimes(2);
    });

    it('returns null and does not cache when generateHomeNetwork rejects', async () => {
      vi.mocked(mockedLookupHomeNetwork).mockResolvedValue(sampleLookupResult());
      vi.mocked(mockedGenerateHomeNetwork).mockRejectedValue(new Error('regen failed'));
      vi.mocked(mockedListOccupants).mockResolvedValue([]);

      const { result } = renderHook(() => useForeignNetworks(), { wrapper: mkWrapper() });

      let resolved: HomeNetwork | null = null;
      await act(async () => {
        resolved = await result.current.ensureForeignReachable('162.174.39.103');
      });

      expect(resolved).toBeNull();
      expect(result.current.foreignNetworks).toEqual([]);
    });

    it('caches under the public_ip key (multiple foreign networks coexist)', async () => {
      const networkA = sampleHomeNetwork({
        router: { publicIp: '162.174.39.103', hostname: 'a', internalIp: '192.168.0.1' },
        fileSystems: { '162.174.39.103': sampleDir(), '192.168.0.1': sampleDir() },
      });
      const networkB = sampleHomeNetwork({
        router: { publicIp: '203.0.113.50', hostname: 'b', internalIp: '10.0.0.1' },
        fileSystems: { '203.0.113.50': sampleDir(), '10.0.0.1': sampleDir() },
      });
      vi.mocked(mockedLookupHomeNetwork).mockImplementation(async (_id, publicIp) => ({
        public_ip: publicIp,
        essid_template: `essid-${publicIp}`,
        density_tier: 'crowded',
        max_slots: 8,
        seed: `home-${publicIp}`,
      }));
      vi.mocked(mockedGenerateHomeNetwork).mockImplementation(async (params) =>
        params.routerPublicIp === '162.174.39.103' ? networkA : networkB,
      );
      vi.mocked(mockedListOccupants).mockResolvedValue([]);

      const { result } = renderHook(() => useForeignNetworks(), { wrapper: mkWrapper() });

      await act(async () => {
        await result.current.ensureForeignReachable('162.174.39.103');
      });
      await act(async () => {
        await result.current.ensureForeignReachable('203.0.113.50');
      });

      await waitFor(() => {
        expect(result.current.foreignNetworks).toEqual([networkA, networkB]);
        expect(result.current.foreignFileSystems).toEqual({
          '162.174.39.103': networkA.fileSystems['162.174.39.103'],
          '192.168.0.1': networkA.fileSystems['192.168.0.1'],
          '203.0.113.50': networkB.fileSystems['203.0.113.50'],
          '10.0.0.1': networkB.fileSystems['10.0.0.1'],
        });
      });
    });

    it('dedups occupant hostnames across multiple foreign networks', async () => {
      const networkA = sampleHomeNetwork({
        router: { publicIp: '162.174.39.103', hostname: 'a', internalIp: '192.168.0.1' },
      });
      const networkB = sampleHomeNetwork({
        router: { publicIp: '203.0.113.50', hostname: 'b', internalIp: '10.0.0.1' },
      });
      vi.mocked(mockedLookupHomeNetwork).mockImplementation(async (_id, publicIp) => ({
        public_ip: publicIp,
        essid_template: 'shared',
        density_tier: 'crowded',
        max_slots: 8,
        seed: `home-${publicIp}`,
      }));
      vi.mocked(mockedGenerateHomeNetwork).mockImplementation(async (params) =>
        params.routerPublicIp === '162.174.39.103' ? networkA : networkB,
      );
      // Two networks, but both have the same occupant hostname (player
      // joined both LANs from the same workstation).
      vi.mocked(mockedListOccupants).mockResolvedValue([sampleOccupant({ hostname: 'dup-xxxx' })]);

      const { result } = renderHook(() => useForeignNetworks(), { wrapper: mkWrapper() });

      await act(async () => {
        await result.current.ensureForeignReachable('162.174.39.103');
      });
      await act(async () => {
        await result.current.ensureForeignReachable('203.0.113.50');
      });

      await waitFor(() => {
        expect(result.current.foreignLanOccupantHostnames).toEqual(['dup-xxxx']);
      });
    });
  });
});
