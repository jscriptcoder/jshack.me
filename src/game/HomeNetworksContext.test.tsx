import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import type { WifiConnection } from '../network/wifiTypes';
import type { WifiNetwork } from '../network/wifiNetworks';
import type { HomeNetwork } from '../generation/generateHomeNetwork';
import type { JoinResult } from '../homeNetworks/types';

// --- Module mocks ---

vi.mock('../homeNetworks/client', () => ({
  joinHomeNetwork: vi.fn(),
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

vi.mock('../generation/generateWifi', () => ({
  generateWifiNetworks: vi.fn(),
}));

vi.mock('../identity', () => ({
  getIdentity: () => ({
    privateKey: new Uint8Array(32),
    publicKey: new Uint8Array(32),
    publicKeyHex: 'aa'.repeat(32),
  }),
}));

import { joinHomeNetwork as mockedJoinHomeNetwork } from '../homeNetworks/client';
import { generateHomeNetwork as mockedGenerateHomeNetwork } from '../generation/generateHomeNetwork';
import { generateWifiNetworks as mockedGenerateWifiNetworks } from '../generation/generateWifi';
import { HomeNetworksProvider, useHomeNetworks } from './HomeNetworksContext';

// --- Helpers ---

const sampleWifi = (overrides: Partial<WifiNetwork> = {}): WifiNetwork => ({
  bssid: 'AA:BB:CC:DD:EE:FF',
  essid: 'ACME-CORP',
  power: -45,
  channel: 6,
  encryption: 'WPA2',
  crackable: true,
  password: 'secret',
  tier: 'crowded',
  ...overrides,
});

const sampleJoinResult = (overrides: Partial<JoinResult> = {}): JoinResult => ({
  public_ip: '203.0.113.42',
  lan_ip: '.187',
  hostname: 'skylab-9k3',
  network_seed: 'home-203.0.113.42',
  ...overrides,
});

const sampleHomeNetwork = (overrides: Partial<HomeNetwork> = {}): HomeNetwork =>
  ({
    essid: 'ACME-CORP',
    localhostIp: '10.0.0.187',
    hostname: 'skylab-9k3',
    machines: [],
    layers: [],
    networkConfig: { machineConfigs: {} },
    fileSystems: {},
    router: { publicIp: '203.0.113.42', hostname: 'router', internalIp: '10.0.0.1' },
    routerMachine: {} as HomeNetwork['routerMachine'],
    entryPoint: '10.0.0.2',
    entryVariant: 'ssh',
    difficulty: 'easy',
    ...overrides,
  }) as HomeNetwork;

const wrapper = (props: {
  readonly gameSeed: string | null;
  readonly workstationPrefix: string | null;
  readonly connectedWifi: WifiConnection | null;
}) => {
  return ({ children }: { children: ReactNode }) => (
    <HomeNetworksProvider
      gameSeed={props.gameSeed}
      workstationPrefix={props.workstationPrefix}
      connectedWifi={props.connectedWifi}
    >
      {children}
    </HomeNetworksProvider>
  );
};

describe('HomeNetworksContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockedGenerateWifiNetworks).mockReturnValue([sampleWifi()]);
    vi.mocked(mockedJoinHomeNetwork).mockResolvedValue(sampleJoinResult());
    vi.mocked(mockedGenerateHomeNetwork).mockResolvedValue(sampleHomeNetwork());
  });

  it('returns null activeNetwork when no WiFi is connected', () => {
    const { result } = renderHook(() => useHomeNetworks(), {
      wrapper: wrapper({ gameSeed: 'g', workstationPrefix: 'skylab', connectedWifi: null }),
    });
    expect(result.current.activeNetwork).toBeNull();
    expect(result.current.joinedNetworks).toEqual([]);
  });

  it('ensureJoined returns the materialized HomeNetwork for a known crackable essid', async () => {
    const { result } = renderHook(() => useHomeNetworks(), {
      wrapper: wrapper({ gameSeed: 'g', workstationPrefix: 'skylab', connectedWifi: null }),
    });

    let network: HomeNetwork | null = null;
    await act(async () => {
      network = await result.current.ensureJoined('ACME-CORP');
    });

    expect(network).not.toBeNull();
    expect(network!.essid).toBe('ACME-CORP');
    expect(network!.hostname).toBe('skylab-9k3');
    expect(mockedJoinHomeNetwork).toHaveBeenCalledOnce();
  });

  it('caches the result — second ensureJoined for the same essid does not call the server again', async () => {
    const { result } = renderHook(() => useHomeNetworks(), {
      wrapper: wrapper({ gameSeed: 'g', workstationPrefix: 'skylab', connectedWifi: null }),
    });

    await act(async () => {
      await result.current.ensureJoined('ACME-CORP');
      await result.current.ensureJoined('ACME-CORP');
    });

    expect(mockedJoinHomeNetwork).toHaveBeenCalledOnce();
    expect(mockedGenerateHomeNetwork).toHaveBeenCalledOnce();
  });

  it('materializes separate networks for different essids', async () => {
    vi.mocked(mockedGenerateWifiNetworks).mockReturnValue([
      sampleWifi({ essid: 'ACME-CORP' }),
      sampleWifi({ essid: 'GLOBEX-NET', tier: 'shared' }),
    ]);
    vi.mocked(mockedJoinHomeNetwork)
      .mockResolvedValueOnce(sampleJoinResult({ public_ip: '203.0.113.42' }))
      .mockResolvedValueOnce(sampleJoinResult({ public_ip: '203.0.113.43' }));
    vi.mocked(mockedGenerateHomeNetwork)
      .mockResolvedValueOnce(sampleHomeNetwork({ essid: 'ACME-CORP' }))
      .mockResolvedValueOnce(sampleHomeNetwork({ essid: 'GLOBEX-NET' }));

    const { result } = renderHook(() => useHomeNetworks(), {
      wrapper: wrapper({ gameSeed: 'g', workstationPrefix: 'skylab', connectedWifi: null }),
    });

    await act(async () => {
      await result.current.ensureJoined('ACME-CORP');
      await result.current.ensureJoined('GLOBEX-NET');
    });

    expect(mockedJoinHomeNetwork).toHaveBeenCalledTimes(2);
    expect(result.current.joinedNetworks.length).toBe(2);
  });

  it('exposes the right activeNetwork once connectedWifi is set and the cache materializes', async () => {
    const { result } = renderHook(() => useHomeNetworks(), {
      wrapper: wrapper({
        gameSeed: 'g',
        workstationPrefix: 'skylab',
        connectedWifi: { essid: 'ACME-CORP', bssid: 'AA:BB:CC:DD:EE:FF' },
      }),
    });

    // Rehydration effect kicks off ensureJoined; activeNetwork resolves once the cache fills.
    await waitFor(() => {
      expect(result.current.activeNetwork).not.toBeNull();
    });
    expect(result.current.activeNetwork!.essid).toBe('ACME-CORP');
  });

  it('rehydrates the active network when connectedWifi is set on mount (e.g., page refresh)', async () => {
    const { result } = renderHook(() => useHomeNetworks(), {
      wrapper: wrapper({
        gameSeed: 'g',
        workstationPrefix: 'skylab',
        connectedWifi: { essid: 'ACME-CORP', bssid: 'AA:BB:CC:DD:EE:FF' },
      }),
    });

    // The provider's effect should kick off ensureJoined on mount
    await waitFor(() => {
      expect(result.current.activeNetwork).not.toBeNull();
    });
    expect(mockedJoinHomeNetwork).toHaveBeenCalledOnce();
  });

  it('throws when ensureJoined is called for an essid not in the WiFi catalog', async () => {
    vi.mocked(mockedGenerateWifiNetworks).mockReturnValue([sampleWifi({ essid: 'ACME-CORP' })]);

    const { result } = renderHook(() => useHomeNetworks(), {
      wrapper: wrapper({ gameSeed: 'g', workstationPrefix: 'skylab', connectedWifi: null }),
    });

    await expect(
      act(async () => {
        await result.current.ensureJoined('UNKNOWN-WIFI');
      }),
    ).rejects.toThrow();
  });

  it('passes the correct density_tier from the WiFi catalog to joinHomeNetwork', async () => {
    vi.mocked(mockedGenerateWifiNetworks).mockReturnValue([
      sampleWifi({ essid: 'SOLO-NET', tier: 'solo' }),
    ]);

    const { result } = renderHook(() => useHomeNetworks(), {
      wrapper: wrapper({ gameSeed: 'g', workstationPrefix: 'mainframe', connectedWifi: null }),
    });

    await act(async () => {
      await result.current.ensureJoined('SOLO-NET');
    });

    expect(mockedJoinHomeNetwork).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        essid_template: 'SOLO-NET',
        density_tier: 'solo',
        workstation_prefix: 'mainframe',
      }),
    );
  });
});
