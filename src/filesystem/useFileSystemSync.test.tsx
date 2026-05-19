import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { FileSystemProvider, useFileSystem } from './FileSystemContext';
import type { FileNode } from './types';
import {
  TEST_HOSTNAME,
  mockSessionState,
  resetMockSession,
  baseLocalhost,
  wrap,
} from './testHelpers';

// Mock the patchRegistry client so tests don't hit the network and we can
// control the rehydration response per-test.
vi.mock('../patchRegistry/client', () => ({
  upsertPatch: vi.fn(),
  removePatch: vi.fn(),
  listPatchesForMachines: vi.fn(),
  clearOwnedPatches: vi.fn(),
  getBaseFs: vi.fn(),
}));

// Mock the realtime subscription module — tests inject a fake Supabase
// client (or null) and assert subscribe/unsubscribe behaviour without a
// live WebSocket.
vi.mock('../patchRegistry/realtime', () => ({
  getRealtimeClient: vi.fn(),
  subscribeToMachine: vi.fn(),
}));

import {
  upsertPatch as mockedUpsertPatch,
  removePatch as mockedRemovePatch,
  listPatchesForMachines as mockedListPatchesForMachines,
  getBaseFs as mockedGetBaseFs,
} from '../patchRegistry/client';
import {
  getRealtimeClient as mockedGetRealtimeClient,
  subscribeToMachine as mockedSubscribeToMachine,
} from '../patchRegistry/realtime';

// Mock identity singleton so we don't depend on browser localStorage.
vi.mock('../identity', () => ({
  getIdentity: () => ({
    privateKey: new Uint8Array(32),
    publicKey: new Uint8Array(32),
    publicKeyHex: 'aa'.repeat(32),
  }),
}));

// useSession reads from the shared mockSessionState container — tests
// mutate `.current` to simulate session changes. Lives in testHelpers
// so the new sync/mutations test files can share it.
vi.mock('../session/SessionContext', () => ({
  useSession: () => ({
    session: mockSessionState.current,
    hostname: TEST_HOSTNAME,
  }),
}));

describe('useFileSystemSync — rehydration, realtime, session-refetch', () => {
  beforeEach(() => {
    vi.mocked(mockedUpsertPatch).mockReset();
    vi.mocked(mockedRemovePatch).mockReset();
    vi.mocked(mockedListPatchesForMachines).mockReset();
    vi.mocked(mockedGetBaseFs).mockReset();
    vi.mocked(mockedGetRealtimeClient).mockReset();
    vi.mocked(mockedSubscribeToMachine).mockReset();
    vi.mocked(mockedUpsertPatch).mockResolvedValue(undefined);
    vi.mocked(mockedRemovePatch).mockResolvedValue(undefined);
    vi.mocked(mockedListPatchesForMachines).mockResolvedValue([]);
    vi.mocked(mockedGetBaseFs).mockResolvedValue(null);
    // Default: realtime client unavailable (most existing tests don't care
    // about subscriptions). Tests that exercise realtime override per-case.
    vi.mocked(mockedGetRealtimeClient).mockReturnValue(null);
    vi.mocked(mockedSubscribeToMachine).mockReturnValue(() => {});
    resetMockSession();
  });

  // -----------------------------------------------------------------------
  // Mount rehydration
  // -----------------------------------------------------------------------

  describe('mount rehydration', () => {
    it('calls listPatchesForMachines on mount', async () => {
      renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
    });

    it('passes only [localhost] when no home/mission filesystems supplied', async () => {
      renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
      const machineIds = vi.mocked(mockedListPatchesForMachines).mock.calls[0][1];
      expect(machineIds).toEqual([TEST_HOSTNAME]);
    });

    it('includes home filesystem keys in machine_ids when supplied', async () => {
      renderHook(() => useFileSystem(), {
        wrapper: wrap({
          homeFileSystems: { '192.168.1.50': baseLocalhost, '192.168.1.51': baseLocalhost },
        }),
      });
      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
      const machineIds = vi.mocked(mockedListPatchesForMachines).mock.calls[0][1];
      expect(machineIds).toEqual(
        expect.arrayContaining([TEST_HOSTNAME, '192.168.1.50', '192.168.1.51']),
      );
    });

    it('includes mission filesystem keys in machine_ids when supplied', async () => {
      renderHook(() => useFileSystem(), {
        wrapper: wrap({
          missionFileSystems: { '10.0.0.1': baseLocalhost, '10.0.0.2': baseLocalhost },
        }),
      });
      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
      const machineIds = vi.mocked(mockedListPatchesForMachines).mock.calls[0][1];
      expect(machineIds).toEqual(expect.arrayContaining([TEST_HOSTNAME, '10.0.0.1', '10.0.0.2']));
    });

    it('includes lan-occupant hostnames in machine_ids when supplied', async () => {
      // Cross-player visibility for sibling workstations on the same LAN:
      // each occupant.hostname IS that player's workstation_id, so folding
      // them into the keyset makes B's rehydration fetch ask for A's
      // workstation patches (sshd pid file, etc.) — without this, daemon
      // state changes are invisible cross-player and B's nmap can't see
      // A's open ports.
      renderHook(() => useFileSystem(), {
        wrapper: wrap({
          lanOccupantHostnames: ['mainframe-1a2b3c4d', 'rocket-bbccdd11'],
        }),
      });
      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
      const machineIds = vi.mocked(mockedListPatchesForMachines).mock.calls[0][1];
      expect(machineIds).toEqual(
        expect.arrayContaining([TEST_HOSTNAME, 'mainframe-1a2b3c4d', 'rocket-bbccdd11']),
      );
    });

    it('deduplicates machine_ids across home + mission', async () => {
      renderHook(() => useFileSystem(), {
        wrapper: wrap({
          homeFileSystems: { '10.0.0.1': baseLocalhost },
          missionFileSystems: { '10.0.0.1': baseLocalhost, '10.0.0.2': baseLocalhost },
        }),
      });
      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
      const machineIds = vi.mocked(mockedListPatchesForMachines).mock.calls[0][1];
      const counts: Record<string, number> = {};
      for (const id of machineIds) counts[id] = (counts[id] ?? 0) + 1;
      expect(counts['10.0.0.1']).toBe(1);
      expect(counts[TEST_HOSTNAME]).toBe(1);
    });

    it('extends machineIdsKey with foreignFileSystems keys', async () => {
      renderHook(() => useFileSystem(), {
        wrapper: wrap({
          foreignFileSystems: {
            '198.51.100.50': baseLocalhost,
            '192.0.2.100': baseLocalhost,
          },
        }),
      });
      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
      const machineIds = vi.mocked(mockedListPatchesForMachines).mock.calls[0][1];
      expect(machineIds).toEqual(
        expect.arrayContaining([TEST_HOSTNAME, '198.51.100.50', '192.0.2.100']),
      );
    });

    it('extends machineIdsKey with foreignLanOccupantHostnames', async () => {
      renderHook(() => useFileSystem(), {
        wrapper: wrap({
          foreignLanOccupantHostnames: ['skylab-9k3', 'rocket-bbccdd11'],
        }),
      });
      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
      const machineIds = vi.mocked(mockedListPatchesForMachines).mock.calls[0][1];
      expect(machineIds).toEqual(
        expect.arrayContaining([TEST_HOSTNAME, 'skylab-9k3', 'rocket-bbccdd11']),
      );
    });

    it('exposes foreignFileSystems[machine_id] as a readable layer in the merged fileSystem state', async () => {
      // Layering check: after mount, the merged fileSystems map MUST
      // contain the foreign network's base FS at the foreign machine_id.
      // Without this, downstream readers (findMachineByIp → getNode)
      // can't resolve cross-LAN reads.
      const foreignTree: FileNode = {
        ...baseLocalhost,
        children: {
          ...(baseLocalhost.children ?? {}),
          marker: {
            name: 'marker',
            type: 'file',
            owner: 'root',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: [],
            },
            content: 'foreign-marker',
          },
        },
      };
      const { result } = renderHook(() => useFileSystem(), {
        wrapper: wrap({
          foreignFileSystems: { '198.51.100.50': foreignTree },
        }),
      });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));
      const node = result.current.getNodeFromMachine('198.51.100.50', '/marker', '/');
      expect(node?.content).toBe('foreign-marker');
    });

    it('refetches with the new foreign keyset when foreignFileSystems changes mid-session', async () => {
      // First touch of a new foreign IP at runtime expands the keyset;
      // the rehydration useEffect's keyset-change branch must fire so
      // patches for the new foreign machines actually land in state.
      let setForeign: ((tree: Record<string, FileNode> | undefined) => void) | null = null;
      const Outer = ({ children }: { children: ReactNode }) => {
        const [foreign, setter] = useState<Record<string, FileNode> | undefined>(undefined);
        setForeign = setter;
        return (
          <FileSystemProvider localhostFileSystem={baseLocalhost} foreignFileSystems={foreign}>
            {children}
          </FileSystemProvider>
        );
      };

      const { result } = renderHook(() => useFileSystem(), { wrapper: Outer });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));
      const callsAfterInitial = vi.mocked(mockedListPatchesForMachines).mock.calls.length;

      act(() => {
        setForeign?.({ '198.51.100.50': baseLocalhost });
      });

      await waitFor(() => {
        expect(vi.mocked(mockedListPatchesForMachines).mock.calls.length).toBe(
          callsAfterInitial + 1,
        );
      });
      const lastCall = vi.mocked(mockedListPatchesForMachines).mock.calls.at(-1)!;
      expect(lastCall[1]).toEqual(expect.arrayContaining(['198.51.100.50']));
    });

    it('exposes isRehydrating: true initially, transitions to false after listPatchesForMachines resolves', async () => {
      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      expect(result.current.isRehydrating).toBe(true);
      await waitFor(() => {
        expect(result.current.isRehydrating).toBe(false);
      });
    });

    it('still sets isRehydrating: false when listPatchesForMachines rejects', async () => {
      vi.mocked(mockedListPatchesForMachines).mockRejectedValueOnce(new Error('network'));
      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => {
        expect(result.current.isRehydrating).toBe(false);
      });
    });

    it('applies multi-author patches in array order — last write wins on (machine_id, path) collision', async () => {
      // Server returns two rows for the same path written by different
      // players, ordered by updated_at ASC (the patch from B is newer).
      // applyPatches reduces in array order, so B's content overwrites A's.
      vi.mocked(mockedListPatchesForMachines).mockResolvedValueOnce([
        {
          machineId: TEST_HOSTNAME,
          path: '/tmp/base.txt',
          content: 'older from player A',
          owner: 'user',
        },
        {
          machineId: TEST_HOSTNAME,
          path: '/tmp/base.txt',
          content: 'newer from player B',
          owner: 'user',
        },
      ]);

      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      const node = result.current.getNode('/tmp/base.txt');
      expect(node?.content).toBe('newer from player B');
    });
  });

  // -----------------------------------------------------------------------
  // Mission/home transitions do NOT wipe patches
  //
  // Mission instances are permanent (project_multiplayer_mission_instances
  // memory) — once accepted, the seed retires but the instance and all
  // its patches persist forever. Home networks and world networks are
  // shared persistent infrastructure. Cross-player writes on shared
  // machines are part of the world. So a mission accept / abort, or
  // home-network async arrival on initial page load, must NOT trigger
  // any server-side patch cleanup. The only legitimate "wipe" left is
  // clearOwnedPatches, fired by `reset confirm` (player-initiated full
  // restart, scoped to localhost).
  // -----------------------------------------------------------------------

  describe('mission/home transition does NOT clear patches', () => {
    it('home network arriving async after initial mount does not call any clear', async () => {
      // This was the bug: mergedHomeFileSystems starts as {} on App
      // mount, then resolves to a populated object after useHomeNetworks
      // fetches. The mission useEffect's dep includes homeFileSystems, so
      // it re-fired and (under the old code) treated this as a "runtime
      // mission transition" and wiped non-localhost patches. Under the
      // new model, mission instances are permanent — nothing should be
      // wiped.
      let setHome: ((fs: Record<string, FileNode> | undefined) => void) | null = null;
      const Outer = ({ children }: { children: ReactNode }) => {
        const [home, setter] = useState<Record<string, FileNode> | undefined>(undefined);
        setHome = setter;
        return (
          <FileSystemProvider localhostFileSystem={baseLocalhost} homeFileSystems={home}>
            {children}
          </FileSystemProvider>
        );
      };
      const { result } = renderHook(() => useFileSystem(), { wrapper: Outer });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      act(() => {
        setHome?.({ '192.168.1.50': baseLocalhost });
      });

      // No clear of any kind — flushPendingPatches resolving immediately
      // is the proxy for "no in-flight POST was kicked off."
      await result.current.flushPendingPatches();
      expect(mockedRemovePatch).not.toHaveBeenCalled();
    });

    it('runtime mission accept does not wipe non-localhost patches (instances are permanent)', async () => {
      let setMissionEnabled: ((b: boolean) => void) | null = null;
      const Outer = ({ children }: { children: ReactNode }) => {
        const [enabled, setter] = useState(false);
        setMissionEnabled = setter;
        return (
          <FileSystemProvider
            localhostFileSystem={baseLocalhost}
            missionFileSystems={enabled ? { '10.0.0.1': baseLocalhost } : undefined}
          >
            {children}
          </FileSystemProvider>
        );
      };
      const { result } = renderHook(() => useFileSystem(), { wrapper: Outer });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      act(() => {
        setMissionEnabled?.(true);
      });

      await result.current.flushPendingPatches();
      expect(mockedRemovePatch).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Rehydration debounce — coalesces rapid keyset changes into one fetch
  //
  // During initial mount the keyset changes 2-3 times as different
  // providers resolve at different times (HomeNetworksContext +
  // WorldNetworks ~immediate; MissionProvider ~seconds later). Without
  // debouncing, each change spawns its own listPatchesForMachines round-
  // trip, with the early ones superseded almost immediately. The
  // debounce coalesces sub-window changes into a single fetch.
  // -----------------------------------------------------------------------

  describe('rehydration debounce', () => {
    it('coalesces rapid keyset changes during initial mount into a single fetch', async () => {
      // Outer wrapper toggles homeFileSystems shortly after mount —
      // mirrors HomeNetworksContext resolving async after the initial
      // (localhost-only) render. Without debounce, the localhost-only
      // fetch fires first, then the home-included fetch fires next;
      // with debounce, only the home-included fetch fires.
      let setHome: ((fs: Record<string, FileNode> | undefined) => void) | null = null;
      const Outer = ({ children }: { children: ReactNode }) => {
        const [home, setter] = useState<Record<string, FileNode> | undefined>(undefined);
        setHome = setter;
        return (
          <FileSystemProvider localhostFileSystem={baseLocalhost} homeFileSystems={home}>
            {children}
          </FileSystemProvider>
        );
      };

      const { result } = renderHook(() => useFileSystem(), { wrapper: Outer });
      // Update the home prop within the debounce window (well before 150ms).
      // setTimeout(0) yields to the microtask queue so React commits the
      // initial render's effects first; the keyset change happens before
      // the initial debounce timer fires.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
        setHome?.({ '192.168.1.50': baseLocalhost });
      });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      // Coalesced into one fetch — and that fetch covers the FULL keyset
      // (localhost + home), not just the initial localhost-only one.
      expect(mockedListPatchesForMachines).toHaveBeenCalledTimes(1);
      const machineIds = vi.mocked(mockedListPatchesForMachines).mock.calls[0][1];
      expect([...machineIds].sort()).toEqual(['192.168.1.50', TEST_HOSTNAME].sort());
    });

    it('keyset changes outside the debounce window each get their own fetch (mission load case)', async () => {
      // The mission state typically arrives well past the debounce window
      // (~3-4s after mount in production). That fetch is genuinely
      // separate — we couldn't have known to wait for it.
      let setMission: ((fs: Record<string, FileNode> | undefined) => void) | null = null;
      const Outer = ({ children }: { children: ReactNode }) => {
        const [mission, setter] = useState<Record<string, FileNode> | undefined>(undefined);
        setMission = setter;
        return (
          <FileSystemProvider localhostFileSystem={baseLocalhost} missionFileSystems={mission}>
            {children}
          </FileSystemProvider>
        );
      };

      const { result } = renderHook(() => useFileSystem(), { wrapper: Outer });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));
      const callsAfterInitial = vi.mocked(mockedListPatchesForMachines).mock.calls.length;

      // Mission filesystems arrive much later — outside the debounce
      // window. Should trigger a separate fetch.
      act(() => {
        setMission?.({ '10.0.0.42': baseLocalhost });
      });

      await waitFor(() => {
        expect(vi.mocked(mockedListPatchesForMachines).mock.calls.length).toBe(
          callsAfterInitial + 1,
        );
      });
      const lastCall = vi
        .mocked(mockedListPatchesForMachines)
        .mock.calls.at(-1) as readonly unknown[];
      expect([...(lastCall[1] as readonly string[])].sort()).toEqual(
        ['10.0.0.42', TEST_HOSTNAME].sort(),
      );
    });

    it('refetches with the new occupant set when lanOccupantHostnames changes (WiFi switch case)', async () => {
      // Switching WiFi mid-session rebuilds lanOccupants with a fresh set
      // (the active LAN's occupants), and the rehydration fetch must
      // ask the server for THE NEW set so we drop subscriptions for the
      // old LAN's players and pick up the new ones. Without
      // lanOccupantHostnames in machineIdsKey's useMemo deps, this
      // wouldn't fire — the keyset would freeze on the first occupant
      // snapshot.
      let setOccupants: ((ids: readonly string[] | undefined) => void) | null = null;
      const Outer = ({ children }: { children: ReactNode }) => {
        const [ids, setter] = useState<readonly string[] | undefined>(['mainframe-1a2b3c4d']);
        setOccupants = setter;
        return (
          <FileSystemProvider localhostFileSystem={baseLocalhost} lanOccupantHostnames={ids}>
            {children}
          </FileSystemProvider>
        );
      };

      const { result } = renderHook(() => useFileSystem(), { wrapper: Outer });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));
      const callsAfterInitial = vi.mocked(mockedListPatchesForMachines).mock.calls.length;

      act(() => {
        setOccupants?.(['rocket-bbccdd11']);
      });

      await waitFor(() => {
        expect(vi.mocked(mockedListPatchesForMachines).mock.calls.length).toBe(
          callsAfterInitial + 1,
        );
      });
      const lastCall = vi
        .mocked(mockedListPatchesForMachines)
        .mock.calls.at(-1) as readonly unknown[];
      const newIds = lastCall[1] as readonly string[];
      expect(newIds).toEqual(expect.arrayContaining([TEST_HOSTNAME, 'rocket-bbccdd11']));
      // Old occupant gone — proves the keyset rotated, didn't just grow.
      expect(newIds).not.toContain('mainframe-1a2b3c4d');
    });
  });

  // -----------------------------------------------------------------------
  // Race mitigation: local writes during rehydration window
  // -----------------------------------------------------------------------

  describe('rehydration race', () => {
    it('skips replacement when a local write happened before listPatchesForMachines resolved', async () => {
      // Defer the listPatchesForMachines resolution until we explicitly trigger it.
      let resolveListPatches!: (patches: never[]) => void;
      vi.mocked(mockedListPatchesForMachines).mockImplementationOnce(
        () =>
          new Promise<never[]>((resolve) => {
            resolveListPatches = resolve;
          }),
      );

      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      // Local write BEFORE rehydration resolves — sets localWritesSinceMount.
      // Local create works against the cached/initial state without needing
      // the rehydration to have fired or resolved.
      act(() => {
        result.current.createFile('/tmp/local.txt', 'local-only', 'user');
      });

      // Wait for the debounced rehydration fetch to actually fire — only
      // after this is `resolveListPatches` bound by the mock implementation.
      await waitFor(() => expect(mockedListPatchesForMachines).toHaveBeenCalled());

      // Now resolve listPatchesForMachines with an EMPTY server response
      // (would normally wipe local state). Race-mitigation should keep our
      // local write.
      await act(async () => {
        resolveListPatches([]);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      // Local write survived: the file we just created is still readable.
      const node = result.current.getNode('/tmp/local.txt');
      expect(node).not.toBeNull();
      expect(node?.content).toBe('local-only');
    });
  });

  // -----------------------------------------------------------------------
  // Realtime hint subscriptions
  //
  // FileSystemContext subscribes to per-machine broadcast channels for
  // every machine in the player's view. Inbound `patch_change` events
  // are HINTS (machineId + originatorKey) — receivers refetch
  // authoritative state via listPatchesForMachines. Hints whose
  // originatorKey matches the local pubkey are skipped (the local
  // optimistic apply / cross-tab BroadcastChannel already covered the
  // change).
  // -----------------------------------------------------------------------

  describe('realtime hint subscriptions', () => {
    type Hint = { readonly machineId: string; readonly originatorKey: string };
    type SubscribeMockArgs = readonly [unknown, string, (hint: Hint) => void];

    // Identity mock pubkey (see vi.mock('../identity') above).
    const OWN_KEY = 'aa'.repeat(32);
    const OTHER_KEY = 'bb'.repeat(32);

    it('does NOT subscribe when getRealtimeClient returns null (env vars missing)', async () => {
      vi.mocked(mockedGetRealtimeClient).mockReturnValue(null);
      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      expect(mockedSubscribeToMachine).not.toHaveBeenCalled();
    });

    it('subscribes to every machine_id in current view on mount, INCLUDING the player workstation', async () => {
      // Under the eliminated-localhost model the player's workstation_id
      // is unique per player, so subscribing to its patches:<id> channel
      // doesn't leak neighbors' changes — each player has a private
      // channel name. This is load-bearing for cross-player workstation
      // visibility (A nmaps B's workstation → A writes to
      // patches.machine_id=<B.workstation_id> → hint fires on
      // patches:<B.workstation_id> → B refetches).
      const fakeClient = {} as Parameters<typeof mockedSubscribeToMachine>[0];
      vi.mocked(mockedGetRealtimeClient).mockReturnValue(fakeClient);

      const { result } = renderHook(() => useFileSystem(), {
        wrapper: wrap({
          homeFileSystems: { '192.168.1.50': baseLocalhost },
          missionFileSystems: { '10.0.0.1': baseLocalhost },
        }),
      });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      const calledMachineIds = vi
        .mocked(mockedSubscribeToMachine)
        .mock.calls.map((call) => (call as unknown as SubscribeMockArgs)[1]);
      expect(calledMachineIds).toEqual(
        expect.arrayContaining([TEST_HOSTNAME, '192.168.1.50', '10.0.0.1']),
      );
      expect(calledMachineIds).toHaveLength(3);
    });

    it('subscribes to the workstation channel even when no home/mission is loaded (cross-player nmap arrives via this channel)', async () => {
      const fakeClient = {} as Parameters<typeof mockedSubscribeToMachine>[0];
      vi.mocked(mockedGetRealtimeClient).mockReturnValue(fakeClient);

      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      const calledMachineIds = vi
        .mocked(mockedSubscribeToMachine)
        .mock.calls.map((call) => (call as unknown as SubscribeMockArgs)[1]);
      expect(calledMachineIds).toContain(TEST_HOSTNAME);
    });

    it('subscribes to a Realtime channel for each lan-occupant hostname', async () => {
      // Symmetric with the home/mission case above: occupant hostnames
      // join the keyset, so subscribeToMachine fires for each. Without
      // this, daemon state changes on a same-LAN player's workstation
      // (sshd pid file written, etc.) don't fire hints on our side and
      // our nmap shows stale port state. Production code hasn't changed
      // since Step 1 — this test pins the Realtime effect's symmetry
      // with the rehydration fetch (both share machineIdsKey).
      const fakeClient = {} as Parameters<typeof mockedSubscribeToMachine>[0];
      vi.mocked(mockedGetRealtimeClient).mockReturnValue(fakeClient);

      const { result } = renderHook(() => useFileSystem(), {
        wrapper: wrap({
          lanOccupantHostnames: ['mainframe-1a2b3c4d', 'rocket-bbccdd11'],
        }),
      });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      const calledMachineIds = vi
        .mocked(mockedSubscribeToMachine)
        .mock.calls.map((call) => (call as unknown as SubscribeMockArgs)[1]);
      expect(calledMachineIds).toEqual(
        expect.arrayContaining([TEST_HOSTNAME, 'mainframe-1a2b3c4d', 'rocket-bbccdd11']),
      );
    });

    it('passes the supabase client from getRealtimeClient to subscribeToMachine', async () => {
      const fakeClient = { id: 'fake-supabase' } as unknown as Parameters<
        typeof mockedSubscribeToMachine
      >[0];
      vi.mocked(mockedGetRealtimeClient).mockReturnValue(fakeClient);

      const { result } = renderHook(() => useFileSystem(), {
        wrapper: wrap({ homeFileSystems: { '192.168.1.50': baseLocalhost } }),
      });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      const firstCall = vi.mocked(mockedSubscribeToMachine).mock
        .calls[0] as unknown as SubscribeMockArgs;
      expect(firstCall[0]).toBe(fakeClient);
    });

    it('rotates Realtime channels when lanOccupantHostnames changes (WiFi switch case)', async () => {
      // Symmetric with the rehydration refetch test in the debounce
      // block: Realtime subscriptions must rotate too — old occupant
      // channel torn down, new occupant channel spun up. Without
      // lanOccupantHostnames in machineIdsKey's useMemo deps, the
      // Realtime effect's cleanup-and-resubscribe pass wouldn't fire.
      const fakeClient = {} as Parameters<typeof mockedSubscribeToMachine>[0];
      vi.mocked(mockedGetRealtimeClient).mockReturnValue(fakeClient);

      // Track unsubscribes per machine_id so we can assert the OLD
      // occupant's channel was torn down.
      const unsubscribesByMachineId: Record<string, ReturnType<typeof vi.fn>> = {};
      vi.mocked(mockedSubscribeToMachine).mockImplementation((_client, machineId) => {
        const unsub = vi.fn();
        unsubscribesByMachineId[machineId] = unsub;
        return unsub;
      });

      let setOccupants: ((ids: readonly string[] | undefined) => void) | null = null;
      const Outer = ({ children }: { children: ReactNode }) => {
        const [ids, setter] = useState<readonly string[] | undefined>(['mainframe-1a2b3c4d']);
        setOccupants = setter;
        return (
          <FileSystemProvider localhostFileSystem={baseLocalhost} lanOccupantHostnames={ids}>
            {children}
          </FileSystemProvider>
        );
      };

      const { result } = renderHook(() => useFileSystem(), { wrapper: Outer });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));
      // Initial subscriptions: workstation + first occupant.
      expect(unsubscribesByMachineId['mainframe-1a2b3c4d']).toBeDefined();

      act(() => {
        setOccupants?.(['rocket-bbccdd11']);
      });

      // New occupant subscribed.
      await waitFor(() => {
        expect(unsubscribesByMachineId['rocket-bbccdd11']).toBeDefined();
      });
      // Old occupant unsubscribed.
      expect(unsubscribesByMachineId['mainframe-1a2b3c4d']).toHaveBeenCalled();
    });

    it('unsubscribes all on unmount', async () => {
      const fakeClient = {} as Parameters<typeof mockedSubscribeToMachine>[0];
      vi.mocked(mockedGetRealtimeClient).mockReturnValue(fakeClient);
      // Three channels under the eliminated-localhost model:
      // workstation_id + home machine + mission machine. Each subscription
      // returns its own unsubscribe; cleanup must call all of them.
      const unsubscribers = [vi.fn(), vi.fn(), vi.fn()];
      let i = 0;
      vi.mocked(mockedSubscribeToMachine).mockImplementation(() => unsubscribers[i++]);

      const { result, unmount } = renderHook(() => useFileSystem(), {
        wrapper: wrap({
          homeFileSystems: { '192.168.1.50': baseLocalhost },
          missionFileSystems: { '10.0.0.1': baseLocalhost },
        }),
      });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      unmount();

      for (const unsub of unsubscribers) {
        expect(unsub).toHaveBeenCalled();
      }
    });

    it('triggers refetch after debounce when hint arrives from another player', async () => {
      const fakeClient = {} as Parameters<typeof mockedSubscribeToMachine>[0];
      vi.mocked(mockedGetRealtimeClient).mockReturnValue(fakeClient);
      let capturedOnHint: ((hint: Hint) => void) | null = null;
      vi.mocked(mockedSubscribeToMachine).mockImplementation((_client, machineId, onHint) => {
        if (machineId === '192.168.1.50') capturedOnHint = onHint as (hint: Hint) => void;
        return () => {};
      });
      // Server returns a fresh patch from the other player on refetch.
      // Mount does an initial listPatchesForMachines call; the hint-
      // triggered refetch is a SECOND call.
      vi.mocked(mockedListPatchesForMachines)
        .mockResolvedValueOnce([]) // mount-time rehydration
        .mockResolvedValueOnce([
          {
            machineId: '192.168.1.50',
            path: '/tmp/from-other-player.txt',
            content: 'hello from B',
            owner: 'user',
            isNew: true,
          },
        ]);

      const { result } = renderHook(() => useFileSystem(), {
        wrapper: wrap({ homeFileSystems: { '192.168.1.50': baseLocalhost } }),
      });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));
      expect(capturedOnHint).not.toBeNull();
      const callsAfterMount = vi.mocked(mockedListPatchesForMachines).mock.calls.length;

      // Hint from another player.
      act(() => {
        capturedOnHint!({ machineId: '192.168.1.50', originatorKey: OTHER_KEY });
      });

      // Refetch fires after the debounce window. Generous timeout —
      // production debounce is 150ms.
      await waitFor(
        () => {
          expect(vi.mocked(mockedListPatchesForMachines).mock.calls.length).toBe(
            callsAfterMount + 1,
          );
        },
        { timeout: 1500 },
      );
      // Refetch was scoped to the affected machine only.
      const refetchArgs = vi.mocked(mockedListPatchesForMachines).mock.calls[callsAfterMount];
      expect(refetchArgs[1]).toEqual(['192.168.1.50']);

      await waitFor(() => {
        const node = result.current.getNodeFromMachine(
          '192.168.1.50',
          '/tmp/from-other-player.txt',
          '/',
        );
        expect(node?.content).toBe('hello from B');
      });
    });

    it('skips refetch when hint originatorKey matches own pubkey (self-induced echo)', async () => {
      // Self-skip: the local optimistic apply + cross-tab BroadcastChannel
      // already covered this change. A refetch here would risk clobbering
      // the writer's in-flight state if the upsert hasn't fully settled
      // yet, AND it would waste a round-trip.
      const fakeClient = {} as Parameters<typeof mockedSubscribeToMachine>[0];
      vi.mocked(mockedGetRealtimeClient).mockReturnValue(fakeClient);
      let capturedOnHint: ((hint: Hint) => void) | null = null;
      vi.mocked(mockedSubscribeToMachine).mockImplementation((_client, machineId, onHint) => {
        if (machineId === '192.168.1.50') capturedOnHint = onHint as (hint: Hint) => void;
        return () => {};
      });

      const { result } = renderHook(() => useFileSystem(), {
        wrapper: wrap({ homeFileSystems: { '192.168.1.50': baseLocalhost } }),
      });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));
      const callsAfterMount = vi.mocked(mockedListPatchesForMachines).mock.calls.length;

      // Hint with own pubkey — should be a no-op.
      act(() => {
        capturedOnHint!({ machineId: '192.168.1.50', originatorKey: OWN_KEY });
      });

      // Wait WELL past the debounce window. No refetch should fire.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(vi.mocked(mockedListPatchesForMachines).mock.calls.length).toBe(callsAfterMount);
    });

    it('coalesces hints to multiple machines within debounce window into ONE refetch', async () => {
      // Debounce + batching: multiple hints accumulate into one refetch
      // covering all affected machines, instead of one round-trip per
      // hint. Lets active multi-machine missions stay efficient.
      const fakeClient = {} as Parameters<typeof mockedSubscribeToMachine>[0];
      vi.mocked(mockedGetRealtimeClient).mockReturnValue(fakeClient);
      const onHintByMachine = new Map<string, (hint: Hint) => void>();
      vi.mocked(mockedSubscribeToMachine).mockImplementation((_client, machineId, onHint) => {
        onHintByMachine.set(machineId, onHint as (hint: Hint) => void);
        return () => {};
      });
      vi.mocked(mockedListPatchesForMachines).mockResolvedValue([]);

      const { result } = renderHook(() => useFileSystem(), {
        wrapper: wrap({
          homeFileSystems: { '192.168.1.50': baseLocalhost },
          missionFileSystems: { '10.0.0.1': baseLocalhost },
        }),
      });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));
      const callsAfterMount = vi.mocked(mockedListPatchesForMachines).mock.calls.length;

      // Fire two hints for two different machines back-to-back.
      act(() => {
        onHintByMachine.get('192.168.1.50')!({
          machineId: '192.168.1.50',
          originatorKey: OTHER_KEY,
        });
        onHintByMachine.get('10.0.0.1')!({
          machineId: '10.0.0.1',
          originatorKey: OTHER_KEY,
        });
      });

      await waitFor(
        () => {
          expect(vi.mocked(mockedListPatchesForMachines).mock.calls.length).toBe(
            callsAfterMount + 1,
          );
        },
        { timeout: 1500 },
      );
      const refetchCall = vi.mocked(mockedListPatchesForMachines).mock.calls[callsAfterMount];
      const refetchedIds = [...refetchCall[1]].sort();
      expect(refetchedIds).toEqual(['10.0.0.1', '192.168.1.50']);
    });

    it('refetch leaves patches for unaffected machines untouched', async () => {
      const fakeClient = {} as Parameters<typeof mockedSubscribeToMachine>[0];
      vi.mocked(mockedGetRealtimeClient).mockReturnValue(fakeClient);
      const onHintByMachine = new Map<string, (hint: Hint) => void>();
      vi.mocked(mockedSubscribeToMachine).mockImplementation((_client, machineId, onHint) => {
        onHintByMachine.set(machineId, onHint as (hint: Hint) => void);
        return () => {};
      });
      // Mount returns patches for both machines, then a hint refetch
      // for machine A returns only A's patches (B's are NOT cleared).
      vi.mocked(mockedListPatchesForMachines)
        .mockResolvedValueOnce([
          {
            machineId: '192.168.1.50',
            path: '/tmp/a.txt',
            content: 'a-original',
            owner: 'user',
            isNew: true,
          },
          {
            machineId: '10.0.0.1',
            path: '/tmp/b.txt',
            content: 'b-original',
            owner: 'user',
            isNew: true,
          },
        ])
        .mockResolvedValueOnce([
          {
            machineId: '192.168.1.50',
            path: '/tmp/a.txt',
            content: 'a-updated',
            owner: 'user',
            isNew: true,
          },
        ]);

      const { result } = renderHook(() => useFileSystem(), {
        wrapper: wrap({
          homeFileSystems: { '192.168.1.50': baseLocalhost },
          missionFileSystems: { '10.0.0.1': baseLocalhost },
        }),
      });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));
      await waitFor(() => {
        expect(result.current.getNodeFromMachine('10.0.0.1', '/tmp/b.txt', '/')?.content).toBe(
          'b-original',
        );
      });

      // Hint for machine A only.
      act(() => {
        onHintByMachine.get('192.168.1.50')!({
          machineId: '192.168.1.50',
          originatorKey: OTHER_KEY,
        });
      });

      // After refetch: A is updated, B is unchanged.
      await waitFor(
        () => {
          expect(
            result.current.getNodeFromMachine('192.168.1.50', '/tmp/a.txt', '/')?.content,
          ).toBe('a-updated');
        },
        { timeout: 1500 },
      );
      expect(result.current.getNodeFromMachine('10.0.0.1', '/tmp/b.txt', '/')?.content).toBe(
        'b-original',
      );
    });

    it('replays in-flight local writes on top of refetch result (cross-player race protection)', async () => {
      // Race: I'm typing locally on machine X (POST in flight).
      // Another player edits machine X — hint arrives, refetch fires,
      // returns server state which doesn't yet reflect my pending write.
      // Without replay, my optimistic local change would be clobbered.
      // With replay, my pending write is preserved on top of the
      // refetch result.
      const fakeClient = {} as Parameters<typeof mockedSubscribeToMachine>[0];
      vi.mocked(mockedGetRealtimeClient).mockReturnValue(fakeClient);
      let capturedOnHint: ((hint: Hint) => void) | null = null;
      vi.mocked(mockedSubscribeToMachine).mockImplementation((_client, machineId, onHint) => {
        if (machineId === '192.168.1.50') capturedOnHint = onHint as (hint: Hint) => void;
        return () => {};
      });
      // Mount: empty server state.
      // Refetch (after the user has typed locally + another player
      // wrote): server returns the OTHER player's write only — the
      // local in-flight write hasn't landed in DB yet.
      vi.mocked(mockedListPatchesForMachines)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            machineId: '192.168.1.50',
            path: '/tmp/from-other.txt',
            content: 'other player wrote',
            owner: 'user',
            isNew: true,
          },
        ]);
      // upsertPatch never resolves — simulates an in-flight POST.
      vi.mocked(mockedUpsertPatch).mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useFileSystem(), {
        wrapper: wrap({ homeFileSystems: { '192.168.1.50': baseLocalhost } }),
      });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      // Local write: optimistically applies, registers in pendingWrites.
      act(() => {
        result.current.upsertFileOnMachine({
          machineId: '192.168.1.50',
          path: '/tmp/my-write.txt',
          cwd: '/',
          content: 'my pending content',
          userType: 'user',
        });
      });
      // Sanity: local write visible immediately.
      expect(
        result.current.getNodeFromMachine('192.168.1.50', '/tmp/my-write.txt', '/')?.content,
      ).toBe('my pending content');

      // Hint from the other player → refetch.
      act(() => {
        capturedOnHint!({ machineId: '192.168.1.50', originatorKey: OTHER_KEY });
      });

      // Both files exist after refetch — the other player's write was
      // applied AND my pending write survived.
      await waitFor(
        () => {
          expect(
            result.current.getNodeFromMachine('192.168.1.50', '/tmp/from-other.txt', '/')?.content,
          ).toBe('other player wrote');
        },
        { timeout: 1500 },
      );
      expect(
        result.current.getNodeFromMachine('192.168.1.50', '/tmp/my-write.txt', '/')?.content,
      ).toBe('my pending content');
    });

    it('hint refetch failure logs but does not crash', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const fakeClient = {} as Parameters<typeof mockedSubscribeToMachine>[0];
        vi.mocked(mockedGetRealtimeClient).mockReturnValue(fakeClient);
        let capturedOnHint: ((hint: Hint) => void) | null = null;
        vi.mocked(mockedSubscribeToMachine).mockImplementation((_client, machineId, onHint) => {
          if (machineId === '192.168.1.50') capturedOnHint = onHint as (hint: Hint) => void;
          return () => {};
        });
        vi.mocked(mockedListPatchesForMachines)
          .mockResolvedValueOnce([])
          .mockRejectedValueOnce(new Error('network down'));

        const { result } = renderHook(() => useFileSystem(), {
          wrapper: wrap({ homeFileSystems: { '192.168.1.50': baseLocalhost } }),
        });
        await waitFor(() => expect(result.current.isRehydrating).toBe(false));

        act(() => {
          capturedOnHint!({ machineId: '192.168.1.50', originatorKey: OTHER_KEY });
        });

        await waitFor(
          () => {
            expect(consoleErrorSpy).toHaveBeenCalledWith(
              expect.stringContaining('[fs] hint refetch failed'),
              expect.any(Error),
            );
          },
          { timeout: 1500 },
        );
        // The hook is still alive — local reads still work.
        expect(
          result.current.getNodeFromMachine('192.168.1.50', '/tmp/base.txt', '/'),
        ).not.toBeNull();
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it('resubscribes when the machine_ids keyset changes (mid-session mission load)', async () => {
      const fakeClient = {} as Parameters<typeof mockedSubscribeToMachine>[0];
      vi.mocked(mockedGetRealtimeClient).mockReturnValue(fakeClient);
      // Return a noop unsubscribe so the cleanup that runs on resubscription
      // doesn't blow up calling unsubscribe()-as-undefined.
      vi.mocked(mockedSubscribeToMachine).mockReturnValue(() => {});

      let setMissionFilesystems!: (fs: Record<string, FileNode> | undefined) => void;
      const Outer = ({ children }: { children: ReactNode }) => {
        const [missionFs, setMissionFs] = useState<Record<string, FileNode> | undefined>();
        setMissionFilesystems = setMissionFs;
        return (
          <FileSystemProvider localhostFileSystem={baseLocalhost} missionFileSystems={missionFs}>
            {children}
          </FileSystemProvider>
        );
      };

      const { result } = renderHook(() => useFileSystem(), { wrapper: Outer });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      // Initial mount: workstation-only view → exactly one subscription
      // (the player's own workstation_id channel — needed so cross-player
      // writes to the workstation can fire hint-driven refetches).
      const initialMachineIds = vi
        .mocked(mockedSubscribeToMachine)
        .mock.calls.map((c) => (c as unknown as SubscribeMockArgs)[1]);
      expect(initialMachineIds).toEqual([TEST_HOSTNAME]);

      // Mission loads — keyset grows with a mission machine. The whole
      // subscription set is torn down and rebuilt: workstation_id +
      // mission machine.
      vi.mocked(mockedSubscribeToMachine).mockClear();
      act(() => {
        setMissionFilesystems({ '10.0.0.42': baseLocalhost });
      });

      await waitFor(() => {
        const newMachineIds = vi
          .mocked(mockedSubscribeToMachine)
          .mock.calls.map((c) => (c as unknown as SubscribeMockArgs)[1]);
        expect(newMachineIds.sort()).toEqual([TEST_HOSTNAME, '10.0.0.42'].sort());
      });
    });
  });

  // -----------------------------------------------------------------------
  // Session-change refetch: when the foreground session's userType changes
  // (su, ssh push, exit), the server-side read-path filter returns a
  // different set of rows for the affected machine. The client must
  // refetch so the local FS state reflects the new tier without waiting
  // for a Realtime hint or page reload.
  // -----------------------------------------------------------------------

  describe('session-change refetch', () => {
    it('refetches the affected machine when session userType changes (e.g., su to root)', async () => {
      mockSessionState.current = { machine: 'remote-host', currentPath: '/', userType: 'guest' };
      const { rerender } = renderHook(() => useFileSystem(), {
        wrapper: wrap({
          homeFileSystems: { 'remote-host': baseLocalhost },
        }),
      });

      // Wait for initial mount fetch to settle, then clear so we can
      // observe the session-change refetch in isolation.
      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
      vi.mocked(mockedListPatchesForMachines).mockClear();

      // Simulate `su root` on the same machine.
      mockSessionState.current = { machine: 'remote-host', currentPath: '/', userType: 'root' };
      rerender();

      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
      const machineIds = vi.mocked(mockedListPatchesForMachines).mock.calls[0][1];
      expect(machineIds).toContain('remote-host');
    });

    it('refetches when session machine changes (e.g., ssh push)', async () => {
      mockSessionState.current = { machine: TEST_HOSTNAME, currentPath: '/', userType: 'root' };
      const { rerender } = renderHook(() => useFileSystem(), {
        wrapper: wrap({
          homeFileSystems: { 'box-A': baseLocalhost, 'box-B': baseLocalhost },
        }),
      });

      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
      vi.mocked(mockedListPatchesForMachines).mockClear();

      mockSessionState.current = { machine: 'box-B', currentPath: '/', userType: 'guest' };
      rerender();

      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
      const machineIds = vi.mocked(mockedListPatchesForMachines).mock.calls[0][1];
      expect(machineIds).toContain('box-B');
    });

    it('refetches BOTH the previous and new machine when session.machine changes (e.g., ssh exit)', async () => {
      // Regression: A exits B back to A, but B's local patches were
      // filtered at session-tier (e.g., guest walker
      // dropped /var/run/sshd.pid). Without refetching B at the new
      // no-session tier (which permits /var/run/*.pid via allowlist),
      // A's local patches stay stuck without the pidfile and B's port
      // appears closed in nmap until page refresh.
      mockSessionState.current = { machine: 'box-B', currentPath: '/', userType: 'guest' };
      const { rerender } = renderHook(() => useFileSystem(), {
        wrapper: wrap({
          homeFileSystems: { 'box-A': baseLocalhost, 'box-B': baseLocalhost },
        }),
      });

      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
      vi.mocked(mockedListPatchesForMachines).mockClear();

      // Simulate ssh exit: session moves from box-B back to box-A.
      mockSessionState.current = { machine: 'box-A', currentPath: '/', userType: 'root' };
      rerender();

      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
      const machineIds = vi.mocked(mockedListPatchesForMachines).mock.calls[0][1];
      expect(machineIds).toContain('box-A');
      expect(machineIds).toContain('box-B');
    });

    it('does NOT refetch when session is unchanged across rerenders', async () => {
      mockSessionState.current = { machine: TEST_HOSTNAME, currentPath: '/', userType: 'root' };
      const { rerender } = renderHook(() => useFileSystem(), { wrapper: wrap() });

      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
      vi.mocked(mockedListPatchesForMachines).mockClear();

      // Rerender without changing session — no refetch should fire.
      rerender();
      // Wait long enough for the debounce window (150ms) plus slack.
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(mockedListPatchesForMachines).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Cross-player workstation base-FS replication.
  //
  // When the foreground session moves onto another player's workstation
  // (workstation_id pattern, not the player's own hostname, no existing
  // fileSystems entry), useFileSystemSync calls getBaseFs to populate
  // the missing base FS. Without this, A logged into B has an empty
  // local view of B's box and every cat/ls returns null.
  // -----------------------------------------------------------------------

  describe('cross-player workstation base-FS replication', () => {
    const OTHER_WORKSTATION = 'rocket-99887766';

    const mkBaseFs = (): FileNode => ({
      name: '/',
      type: 'directory',
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      children: {
        etc: {
          name: 'etc',
          type: 'directory',
          owner: 'root',
          permissions: { read: ['root'], write: ['root'], execute: ['root'] },
          children: {
            hostname: {
              name: 'hostname',
              type: 'file',
              owner: 'root',
              permissions: { read: ['root'], write: ['root'], execute: ['root'] },
              content: `${OTHER_WORKSTATION}\n`,
            },
          },
        },
      },
    });

    it('calls getBaseFs when session moves to a CROSS-PLAYER workstation_id', async () => {
      mockSessionState.current = { machine: TEST_HOSTNAME, currentPath: '/', userType: 'root' };
      const { rerender } = renderHook(() => useFileSystem(), { wrapper: wrap() });

      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
      vi.mocked(mockedGetBaseFs).mockClear();

      mockSessionState.current = {
        machine: OTHER_WORKSTATION,
        currentPath: '/',
        userType: 'user',
      };
      rerender();

      await waitFor(() => {
        expect(mockedGetBaseFs).toHaveBeenCalled();
      });
      const [, machineId] = vi.mocked(mockedGetBaseFs).mock.calls[0];
      expect(machineId).toBe(OTHER_WORKSTATION);
    });

    it('does NOT call getBaseFs when session is on the player OWN workstation', async () => {
      mockSessionState.current = { machine: 'remote-host', currentPath: '/', userType: 'root' };
      const { rerender } = renderHook(() => useFileSystem(), {
        wrapper: wrap({ homeFileSystems: { 'remote-host': baseLocalhost } }),
      });

      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
      vi.mocked(mockedGetBaseFs).mockClear();

      // Move back to the player's own workstation.
      mockSessionState.current = { machine: TEST_HOSTNAME, currentPath: '/', userType: 'root' };
      rerender();

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(mockedGetBaseFs).not.toHaveBeenCalled();
    });

    it('does NOT call getBaseFs for non-workstation machine_ids (IPv4)', async () => {
      mockSessionState.current = { machine: TEST_HOSTNAME, currentPath: '/', userType: 'root' };
      const { rerender } = renderHook(() => useFileSystem(), {
        wrapper: wrap({ homeFileSystems: { '10.0.0.5': baseLocalhost } }),
      });

      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
      vi.mocked(mockedGetBaseFs).mockClear();

      // Switch to an IPv4 machine_id (NPC home box).
      mockSessionState.current = { machine: '10.0.0.5', currentPath: '/', userType: 'guest' };
      rerender();

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(mockedGetBaseFs).not.toHaveBeenCalled();
    });

    it('does NOT call getBaseFs when fileSystems already has an entry for the machine', async () => {
      mockSessionState.current = { machine: TEST_HOSTNAME, currentPath: '/', userType: 'root' };
      const { rerender } = renderHook(() => useFileSystem(), {
        wrapper: wrap({ lanOccupantHostnames: [OTHER_WORKSTATION] }),
      });

      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });

      // First switch: triggers getBaseFs (cache miss).
      vi.mocked(mockedGetBaseFs).mockResolvedValue(mkBaseFs());
      mockSessionState.current = {
        machine: OTHER_WORKSTATION,
        currentPath: '/',
        userType: 'user',
      };
      rerender();

      await waitFor(() => {
        expect(mockedGetBaseFs).toHaveBeenCalledTimes(1);
      });

      // Switch elsewhere then back — should not refetch (already merged).
      vi.mocked(mockedGetBaseFs).mockClear();
      mockSessionState.current = { machine: TEST_HOSTNAME, currentPath: '/', userType: 'root' };
      rerender();

      await new Promise((resolve) => setTimeout(resolve, 200));
      mockSessionState.current = {
        machine: OTHER_WORKSTATION,
        currentPath: '/',
        userType: 'root',
      };
      rerender();
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(mockedGetBaseFs).not.toHaveBeenCalled();
    });

    it('merges the returned FileNode into fileSystems on success', async () => {
      mockSessionState.current = { machine: TEST_HOSTNAME, currentPath: '/', userType: 'root' };
      const baseFs = mkBaseFs();
      vi.mocked(mockedGetBaseFs).mockResolvedValue(baseFs);

      const { rerender, result } = renderHook(() => useFileSystem(), {
        wrapper: wrap({ lanOccupantHostnames: [OTHER_WORKSTATION] }),
      });

      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });

      mockSessionState.current = {
        machine: OTHER_WORKSTATION,
        currentPath: '/',
        userType: 'user',
      };
      rerender();

      await waitFor(() => {
        // The other player's /etc/hostname should now be visible after merge.
        const node = result.current.getNodeFromMachine(OTHER_WORKSTATION, '/etc/hostname', '/');
        expect(node?.content).toBe(`${OTHER_WORKSTATION}\n`);
      });
    });

    it('does NOT merge when getBaseFs returns null (no-session caller)', async () => {
      mockSessionState.current = { machine: TEST_HOSTNAME, currentPath: '/', userType: 'root' };
      vi.mocked(mockedGetBaseFs).mockResolvedValue(null);

      const { rerender, result } = renderHook(() => useFileSystem(), {
        wrapper: wrap({ lanOccupantHostnames: [OTHER_WORKSTATION] }),
      });

      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });

      mockSessionState.current = {
        machine: OTHER_WORKSTATION,
        currentPath: '/',
        userType: 'guest',
      };
      rerender();

      await waitFor(() => {
        expect(mockedGetBaseFs).toHaveBeenCalled();
      });
      // No merge — getNodeFromMachine should still return null on this machine.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const node = result.current.getNodeFromMachine(OTHER_WORKSTATION, '/etc/hostname', '/');
      expect(node).toBeNull();
    });

    it('STILL calls getBaseFs when fileSystems already has a patch-induced empty stub', async () => {
      // Regression for the bug surfaced in two-browser smoke:
      // applyPatches creates an empty-root stub for any patch whose
      // machine_id isn't in the base map (fileSystemUtils.ts:359).
      // When B writes their own pid file and the patch lands on A's
      // box BEFORE A's session lands on B, fileSystems[B.workstation_id]
      // is already populated — but with a stub that has no /usr/bin,
      // /lib, or /home. The session-change effect MUST still fire
      // getBaseFs in this case, otherwise A lands in B's shell with
      // no binaries (Player A reported `ls: error while loading
      // shared libraries: libpcre.so` in the smoke).
      mockSessionState.current = { machine: TEST_HOSTNAME, currentPath: '/', userType: 'root' };
      // Seed a patch that targets OTHER_WORKSTATION on initial mount —
      // applyPatches will stub fileSystems[OTHER_WORKSTATION] before
      // the session-change effect runs.
      vi.mocked(mockedListPatchesForMachines).mockResolvedValue([
        {
          machineId: OTHER_WORKSTATION,
          path: '/var/run/sshd.pid',
          content: 'sshd:port=22',
          owner: 'root',
        },
      ]);

      const { rerender } = renderHook(() => useFileSystem(), {
        wrapper: wrap({ lanOccupantHostnames: [OTHER_WORKSTATION] }),
      });

      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });
      vi.mocked(mockedGetBaseFs).mockClear();

      mockSessionState.current = {
        machine: OTHER_WORKSTATION,
        currentPath: '/',
        userType: 'root',
      };
      rerender();

      await waitFor(() => {
        expect(mockedGetBaseFs).toHaveBeenCalled();
      });
      expect(mockedGetBaseFs).toHaveBeenCalledTimes(1);
    });

    it('swallows getBaseFs errors without crashing', async () => {
      mockSessionState.current = { machine: TEST_HOSTNAME, currentPath: '/', userType: 'root' };
      vi.mocked(mockedGetBaseFs).mockRejectedValue(new Error('network'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { rerender } = renderHook(() => useFileSystem(), {
        wrapper: wrap({ lanOccupantHostnames: [OTHER_WORKSTATION] }),
      });

      await waitFor(() => {
        expect(mockedListPatchesForMachines).toHaveBeenCalled();
      });

      mockSessionState.current = {
        machine: OTHER_WORKSTATION,
        currentPath: '/',
        userType: 'user',
      };
      rerender();

      await waitFor(() => {
        expect(mockedGetBaseFs).toHaveBeenCalled();
      });
      // Allow the rejection to propagate through the .catch handler.
      await new Promise((resolve) => setTimeout(resolve, 50));
      // No unhandled rejection escaped — test would have failed if it had.
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
