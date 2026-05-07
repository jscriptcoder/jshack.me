import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFileSystem } from './FileSystemContext';
import { TEST_HOSTNAME, mockSessionState, resetMockSession, wrap } from './testHelpers';

// Mock the patchRegistry client so tests don't hit the network and we can
// control the rehydration response per-test.
vi.mock('../patchRegistry/client', () => ({
  upsertPatch: vi.fn(),
  removePatch: vi.fn(),
  listPatchesForMachines: vi.fn(),
  clearOwnedPatches: vi.fn(),
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

describe('useFileSystemMutations — write/create/delete dispatch + flush', () => {
  beforeEach(() => {
    vi.mocked(mockedUpsertPatch).mockReset();
    vi.mocked(mockedRemovePatch).mockReset();
    vi.mocked(mockedListPatchesForMachines).mockReset();
    vi.mocked(mockedGetRealtimeClient).mockReset();
    vi.mocked(mockedSubscribeToMachine).mockReset();
    vi.mocked(mockedUpsertPatch).mockResolvedValue(undefined);
    vi.mocked(mockedRemovePatch).mockResolvedValue(undefined);
    vi.mocked(mockedListPatchesForMachines).mockResolvedValue([]);
    // Default: realtime client unavailable (most existing tests don't care
    // about subscriptions). Tests that exercise realtime override per-case.
    vi.mocked(mockedGetRealtimeClient).mockReturnValue(null);
    vi.mocked(mockedSubscribeToMachine).mockReturnValue(() => {});
    resetMockSession();
  });

  // -----------------------------------------------------------------------
  // Write/create dispatch
  // -----------------------------------------------------------------------

  describe('write/create → upsertPatchOnServer', () => {
    it('createFile fires upsertPatch with the new patch', async () => {
      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      act(() => {
        result.current.createFile('/tmp/new.txt', 'hello', 'user');
      });

      expect(mockedUpsertPatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          machineId: TEST_HOSTNAME,
          path: '/tmp/new.txt',
          content: 'hello',
          owner: 'user',
          isNew: true,
        }),
      );
      expect(mockedRemovePatch).not.toHaveBeenCalled();
    });

    it('writeFile (existing base file) fires upsertPatch', async () => {
      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      act(() => {
        result.current.writeFile('/tmp/base.txt', 'modified', 'user');
      });

      expect(mockedUpsertPatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          machineId: TEST_HOSTNAME,
          path: '/tmp/base.txt',
          content: 'modified',
        }),
      );
      expect(mockedRemovePatch).not.toHaveBeenCalled();
    });

    // upsertFileOnMachine — handles both write-existing and create-new in
    // a single call. msfconsole's writeRemoteFile uses this so file_write,
    // password_reset, and backdoor_port_open all work whether the target
    // path exists or not.
    it('upsertFileOnMachine creates a new file when path does not exist (fires isNew=true)', async () => {
      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      let opResult: { allowed: boolean } | undefined;
      act(() => {
        opResult = result.current.upsertFileOnMachine({
          machineId: TEST_HOSTNAME,
          path: '/tmp/created-by-upsert.txt',
          cwd: '/',
          content: 'fresh',
          userType: 'user',
        });
      });

      expect(opResult?.allowed).toBe(true);
      expect(mockedUpsertPatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          machineId: TEST_HOSTNAME,
          path: '/tmp/created-by-upsert.txt',
          content: 'fresh',
          owner: 'user',
          isNew: true,
        }),
      );
    });

    it('upsertFileOnMachine overwrites an existing file (fires upsertPatch without isNew, preserves owner)', async () => {
      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      let opResult: { allowed: boolean } | undefined;
      act(() => {
        opResult = result.current.upsertFileOnMachine({
          machineId: TEST_HOSTNAME,
          path: '/tmp/base.txt', // exists in baseLocalhost, owner=user
          cwd: '/',
          content: 'overwritten',
          userType: 'user',
        });
      });

      expect(opResult?.allowed).toBe(true);
      expect(mockedUpsertPatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          machineId: TEST_HOSTNAME,
          path: '/tmp/base.txt',
          content: 'overwritten',
          owner: 'user', // preserved from existing
        }),
      );
      // Existing-file overwrite does NOT set isNew=true
      const upsertCalls = vi.mocked(mockedUpsertPatch).mock.calls;
      const lastCall = upsertCalls[upsertCalls.length - 1];
      expect((lastCall?.[1] as Record<string, unknown>)?.isNew).toBeFalsy();
    });

    it('upsertFileOnMachine returns {allowed: false} when parent directory is unwritable (no patch fired)', async () => {
      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      let opResult: { allowed: boolean; error?: string } | undefined;
      act(() => {
        opResult = result.current.upsertFileOnMachine({
          // /etc doesn't exist in baseLocalhost — guest can't create files in /
          // (root-only write on root dir).
          machineId: TEST_HOSTNAME,
          path: '/forbidden/new.txt',
          cwd: '/',
          content: 'denied',
          userType: 'guest',
        });
      });

      expect(opResult?.allowed).toBe(false);
      expect(mockedUpsertPatch).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Delete dispatch
  // -----------------------------------------------------------------------

  describe('delete → server dispatch by isNew', () => {
    it('delete of an isNew file fires removePatch only (no upsertPatch null marker)', async () => {
      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      act(() => {
        result.current.createFile('/tmp/scratch.txt', 'x', 'user');
      });
      vi.mocked(mockedUpsertPatch).mockClear();
      vi.mocked(mockedRemovePatch).mockClear();

      act(() => {
        result.current.deleteNode('/tmp/scratch.txt', 'user');
      });

      expect(mockedRemovePatch).toHaveBeenCalledWith(expect.anything(), {
        machineId: TEST_HOSTNAME,
        path: '/tmp/scratch.txt',
      });
      // No upsertPatch in the isNew deletion path — the file never existed
      // in the base FS, no marker needed.
      expect(mockedUpsertPatch).not.toHaveBeenCalled();
    });

    it('delete of a base file fires removePatch then upsertPatch (null marker)', async () => {
      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));
      vi.mocked(mockedUpsertPatch).mockClear();
      vi.mocked(mockedRemovePatch).mockClear();

      // Wait for the chained .then() to resolve so both calls land before assertion.
      await act(async () => {
        result.current.deleteNode('/tmp/base.txt', 'user');
        // Flush microtasks so the chained .then(() => upsertPatch) settles.
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(mockedRemovePatch).toHaveBeenCalledWith(expect.anything(), {
        machineId: TEST_HOSTNAME,
        path: '/tmp/base.txt',
      });
      expect(mockedUpsertPatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          machineId: TEST_HOSTNAME,
          path: '/tmp/base.txt',
          content: null,
        }),
      );
      // Order: remove must precede upsert (descendants gone before marker reinstated).
      const removeOrder = vi.mocked(mockedRemovePatch).mock.invocationCallOrder[0];
      const upsertOrder = vi.mocked(mockedUpsertPatch).mock.invocationCallOrder[0];
      expect(removeOrder).toBeLessThan(upsertOrder);
    });
  });

  // -----------------------------------------------------------------------
  // flushPendingPatches — eliminates the transient-session race where
  // endSession arrives at the server before the in-flight upsertPatch.
  // Transient-session wrappers (scp, snmpset, msfconsole one-shots) call
  // this after the body runs, before letting `withTransientSession` end.
  // -----------------------------------------------------------------------

  describe('flushPendingPatches', () => {
    it('resolves immediately when no patches are in flight', async () => {
      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      await expect(result.current.flushPendingPatches()).resolves.toBeUndefined();
    });

    it('waits for an in-flight upsertPatch to settle before resolving', async () => {
      // Stuck upsert — only resolves when we say so. Lets us prove
      // flushPendingPatches actually awaits, not just returns immediately.
      let resolveUpsert: () => void = () => {};
      vi.mocked(mockedUpsertPatch).mockReturnValue(
        new Promise<void>((resolve) => {
          resolveUpsert = () => resolve(undefined);
        }),
      );

      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      act(() => {
        result.current.writeFile('/tmp/base.txt', 'updated', 'user');
      });

      let flushResolved = false;
      const flushPromise = result.current.flushPendingPatches().then(() => {
        flushResolved = true;
      });

      // Microtask tick — flush has started but upsert is still stuck.
      await Promise.resolve();
      await Promise.resolve();
      expect(flushResolved).toBe(false);

      resolveUpsert();
      await flushPromise;
      expect(flushResolved).toBe(true);
    });

    it('resolves even when in-flight upsertPatch rejects', async () => {
      // The patch's catch handler swallows the error already; flush
      // should still resolve cleanly so transient-session wrappers
      // don't crash on a network blip.
      let rejectUpsert: () => void = () => {};
      vi.mocked(mockedUpsertPatch).mockReturnValue(
        new Promise<void>((_resolve, reject) => {
          rejectUpsert = () => reject(new Error('network down'));
        }),
      );

      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      act(() => {
        result.current.writeFile('/tmp/base.txt', 'updated', 'user');
      });

      const flushPromise = result.current.flushPendingPatches();
      rejectUpsert();

      await expect(flushPromise).resolves.toBeUndefined();
    });

    it('snapshots in-flight patches at call time — patches started after are not awaited', async () => {
      // First write's upsert stalls; flush is called; second write
      // starts AFTER flush call. Flush should resolve when the FIRST
      // upsert resolves, regardless of the second.
      let resolveFirst: () => void = () => {};
      vi.mocked(mockedUpsertPatch)
        .mockReturnValueOnce(
          new Promise<void>((resolve) => {
            resolveFirst = () => resolve(undefined);
          }),
        )
        .mockReturnValueOnce(new Promise(() => {})); // second never resolves

      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => expect(result.current.isRehydrating).toBe(false));

      act(() => {
        result.current.writeFile('/tmp/base.txt', 'first', 'user');
      });

      const flushPromise = result.current.flushPendingPatches();

      act(() => {
        result.current.writeFile('/tmp/base.txt', 'second', 'user');
      });

      resolveFirst();

      await expect(flushPromise).resolves.toBeUndefined();
    });
  });
});
