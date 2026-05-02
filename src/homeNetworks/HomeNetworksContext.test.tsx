import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import type { WifiConnection } from '../network/wifiTypes';
import type { WifiNetwork } from '../network/wifiNetworks';
import type { HomeNetwork } from '../generation/generateHomeNetwork';
import type { JoinResult, OccupantSummary } from './types';

// --- Module mocks ---

vi.mock('./client', () => ({
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

vi.mock('./listOccupants', () => ({
  listOccupants: vi.fn(),
}));

vi.mock('./realtime', () => ({
  subscribeToNetworkOccupants: vi.fn(),
}));

vi.mock('../patchRegistry/realtime', () => ({
  getRealtimeClient: vi.fn(),
}));

import { joinHomeNetwork as mockedJoinHomeNetwork } from './client';
import { generateHomeNetwork as mockedGenerateHomeNetwork } from '../generation/generateHomeNetwork';
import { generateWifiNetworks as mockedGenerateWifiNetworks } from '../generation/generateWifi';
import { listOccupants as mockedListOccupants } from './listOccupants';
import { subscribeToNetworkOccupants as mockedSubscribeToNetworkOccupants } from './realtime';
import { getRealtimeClient as mockedGetRealtimeClient } from '../patchRegistry/realtime';
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
    // Default: no realtime client (env vars missing). Tests that exercise
    // the live-occupants path override per-case.
    vi.mocked(mockedGetRealtimeClient).mockReturnValue(null);
    vi.mocked(mockedSubscribeToNetworkOccupants).mockReturnValue(() => {});
    vi.mocked(mockedListOccupants).mockResolvedValue([]);
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

  // -----------------------------------------------------------------------
  // Live LAN occupants via Realtime hint broadcasts
  //
  // Each occupant join publishes `{ network_id, originator_key }` on
  // `occupants:<network_id>`. Subscribed clients refetch via listOccupants.
  // Self-skip on originatorKey === own player_key (own join already
  // updated local state via the post-joinHomeNetwork flow).
  // -----------------------------------------------------------------------

  describe('live occupants via hint broadcasts', () => {
    type Hint = { readonly networkId: string; readonly originatorKey: string };
    type SubscribeCall = readonly [unknown, string, (hint: Hint) => void];

    // Identity mock pubkey is 'aa'.repeat(32). Server prefixes with
    // 'ed25519:' when storing player_key on the row + when broadcasting.
    // These keys appear ONLY in Realtime hint payloads (originator_key) —
    // the occupant ROW shape no longer carries player_key.
    const OWN_KEY = 'ed25519:' + 'aa'.repeat(32);
    const OTHER_KEY = 'ed25519:' + 'bb'.repeat(32);

    // Other-player occupant fixture. Hostname differs from the player's
    // own (`computePlayerHostname('skylab', mockIdentity)` would yield
    // `skylab-<own suffix>`, distinct from `mainframe-1a2`), so the
    // hostname-based self-filter keeps this row.
    const otherOccupant = (overrides: Partial<OccupantSummary> = {}): OccupantSummary => ({
      network_id: '203.0.113.42',
      lan_ip: '.42',
      hostname: 'mainframe-1a2',
      ...overrides,
    });

    it('does NOT subscribe when getRealtimeClient returns null (env vars missing)', async () => {
      vi.mocked(mockedGetRealtimeClient).mockReturnValue(null);
      const { result } = renderHook(() => useHomeNetworks(), {
        wrapper: wrapper({
          gameSeed: 'g',
          workstationPrefix: 'skylab',
          connectedWifi: { essid: 'ACME-CORP', bssid: 'AA:BB:CC:DD:EE:FF' },
        }),
      });
      await waitFor(() => expect(result.current.activeNetwork).not.toBeNull());

      expect(mockedSubscribeToNetworkOccupants).not.toHaveBeenCalled();
    });

    it('does NOT subscribe when there is no active network', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(mockedGetRealtimeClient).mockReturnValue({} as any);
      renderHook(() => useHomeNetworks(), {
        wrapper: wrapper({ gameSeed: 'g', workstationPrefix: 'skylab', connectedWifi: null }),
      });
      // Yield a microtask so any subscription-effect would have fired.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(mockedSubscribeToNetworkOccupants).not.toHaveBeenCalled();
    });

    it('subscribes to occupants:<network_id> once the active network resolves', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fakeClient = { id: 'fake' } as any;
      vi.mocked(mockedGetRealtimeClient).mockReturnValue(fakeClient);

      const { result } = renderHook(() => useHomeNetworks(), {
        wrapper: wrapper({
          gameSeed: 'g',
          workstationPrefix: 'skylab',
          connectedWifi: { essid: 'ACME-CORP', bssid: 'AA:BB:CC:DD:EE:FF' },
        }),
      });
      await waitFor(() => expect(result.current.activeNetwork).not.toBeNull());

      await waitFor(() => {
        expect(mockedSubscribeToNetworkOccupants).toHaveBeenCalled();
      });
      const call = vi.mocked(mockedSubscribeToNetworkOccupants).mock
        .calls[0] as unknown as SubscribeCall;
      expect(call[0]).toBe(fakeClient);
      expect(call[1]).toBe('203.0.113.42');
    });

    it('triggers refetch on inbound hint from another player and updates lanOccupants', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(mockedGetRealtimeClient).mockReturnValue({} as any);
      let capturedOnHint: ((hint: Hint) => void) | null = null;
      vi.mocked(mockedSubscribeToNetworkOccupants).mockImplementation(
        (_client, _networkId, onHint) => {
          capturedOnHint = onHint as (hint: Hint) => void;
          return () => {};
        },
      );
      // Initial listOccupants on connect: empty. Hint-driven refetch
      // returns one other occupant.
      vi.mocked(mockedListOccupants)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([otherOccupant()]);

      const { result } = renderHook(() => useHomeNetworks(), {
        wrapper: wrapper({
          gameSeed: 'g',
          workstationPrefix: 'skylab',
          connectedWifi: { essid: 'ACME-CORP', bssid: 'AA:BB:CC:DD:EE:FF' },
        }),
      });
      await waitFor(() => expect(result.current.activeNetwork).not.toBeNull());
      await waitFor(() => expect(capturedOnHint).not.toBeNull());

      // Hint from another player.
      act(() => {
        capturedOnHint!({ networkId: '203.0.113.42', originatorKey: OTHER_KEY });
      });

      // Refetch fires after debounce window; lanOccupants updates.
      await waitFor(
        () => {
          expect(result.current.lanOccupants).toEqual([otherOccupant()]);
        },
        { timeout: 1500 },
      );
    });

    it('skips refetch when hint originatorKey matches own player_key (self-induced echo)', async () => {
      // Self-skip: own join was already materialized locally via the
      // post-joinHomeNetwork flow. A redundant refetch here would burn
      // an anon SELECT for nothing.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(mockedGetRealtimeClient).mockReturnValue({} as any);
      let capturedOnHint: ((hint: Hint) => void) | null = null;
      vi.mocked(mockedSubscribeToNetworkOccupants).mockImplementation(
        (_client, _networkId, onHint) => {
          capturedOnHint = onHint as (hint: Hint) => void;
          return () => {};
        },
      );

      const { result } = renderHook(() => useHomeNetworks(), {
        wrapper: wrapper({
          gameSeed: 'g',
          workstationPrefix: 'skylab',
          connectedWifi: { essid: 'ACME-CORP', bssid: 'AA:BB:CC:DD:EE:FF' },
        }),
      });
      await waitFor(() => expect(result.current.activeNetwork).not.toBeNull());
      await waitFor(() => expect(capturedOnHint).not.toBeNull());
      const callsAfterConnect = vi.mocked(mockedListOccupants).mock.calls.length;

      // Hint with own pubkey — should be a no-op.
      act(() => {
        capturedOnHint!({ networkId: '203.0.113.42', originatorKey: OWN_KEY });
      });

      // Wait well past the debounce window. No refetch should fire.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(vi.mocked(mockedListOccupants).mock.calls.length).toBe(callsAfterConnect);
    });

    it('unsubscribes when the active network changes / unmounts', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(mockedGetRealtimeClient).mockReturnValue({} as any);
      const unsubscribe = vi.fn();
      vi.mocked(mockedSubscribeToNetworkOccupants).mockReturnValue(unsubscribe);

      const { result, unmount } = renderHook(() => useHomeNetworks(), {
        wrapper: wrapper({
          gameSeed: 'g',
          workstationPrefix: 'skylab',
          connectedWifi: { essid: 'ACME-CORP', bssid: 'AA:BB:CC:DD:EE:FF' },
        }),
      });
      await waitFor(() => expect(result.current.activeNetwork).not.toBeNull());
      await waitFor(() => expect(mockedSubscribeToNetworkOccupants).toHaveBeenCalled());

      unmount();
      expect(unsubscribe).toHaveBeenCalled();
    });
  });
});
