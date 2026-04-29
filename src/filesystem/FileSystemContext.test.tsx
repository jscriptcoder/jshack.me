import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { FileSystemProvider, useFileSystem } from './FileSystemContext';
import type { FileNode } from './types';

// Mock the patchRegistry client so tests don't hit the network and we can
// control the rehydration response per-test.
vi.mock('../patchRegistry/client', () => ({
  upsertPatch: vi.fn(),
  removePatch: vi.fn(),
  listPatches: vi.fn(),
  listPatchesForMachines: vi.fn(),
  clearTransientPatches: vi.fn(),
  clearOwnedPatches: vi.fn(),
}));

import {
  upsertPatch as mockedUpsertPatch,
  removePatch as mockedRemovePatch,
  listPatchesForMachines as mockedListPatchesForMachines,
  clearTransientPatches as mockedClearTransientPatches,
} from '../patchRegistry/client';

// Mock identity singleton so we don't depend on browser localStorage.
vi.mock('../identity', () => ({
  getIdentity: () => ({
    privateKey: new Uint8Array(32),
    publicKey: new Uint8Array(32),
    publicKeyHex: 'aa'.repeat(32),
  }),
}));

// Mock useSession — FileSystemContext only reads session.machine + currentPath.
vi.mock('../session/SessionContext', () => ({
  useSession: () => ({
    session: { machine: 'localhost', currentPath: '/' },
  }),
}));

// Minimal localhost filesystem for tests:
//   /tmp/        — world-writable
//   /tmp/base.txt (owned by user, writable by user) — exists in base FS
const baseLocalhost: FileNode = {
  name: '/',
  type: 'directory',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  children: {
    tmp: {
      name: 'tmp',
      type: 'directory',
      owner: 'root',
      permissions: {
        read: ['root', 'user', 'guest'],
        write: ['root', 'user', 'guest'],
        execute: ['root', 'user', 'guest'],
      },
      children: {
        'base.txt': {
          name: 'base.txt',
          type: 'file',
          owner: 'user',
          permissions: {
            read: ['root', 'user', 'guest'],
            write: ['root', 'user'],
            execute: ['root'],
          },
          content: 'base content',
        },
      },
    },
  },
};

const wrap =
  (overrides?: {
    homeFileSystems?: Record<string, FileNode>;
    missionFileSystems?: Record<string, FileNode>;
  }) =>
  ({ children }: { children: ReactNode }) => (
    <FileSystemProvider
      localhostFileSystem={baseLocalhost}
      homeFileSystems={overrides?.homeFileSystems}
      missionFileSystems={overrides?.missionFileSystems}
    >
      {children}
    </FileSystemProvider>
  );

describe('FileSystemProvider — server-aware patch dispatch', () => {
  beforeEach(() => {
    vi.mocked(mockedUpsertPatch).mockReset();
    vi.mocked(mockedRemovePatch).mockReset();
    vi.mocked(mockedListPatchesForMachines).mockReset();
    vi.mocked(mockedClearTransientPatches).mockReset();
    vi.mocked(mockedUpsertPatch).mockResolvedValue(undefined);
    vi.mocked(mockedRemovePatch).mockResolvedValue(undefined);
    vi.mocked(mockedListPatchesForMachines).mockResolvedValue([]);
    vi.mocked(mockedClearTransientPatches).mockResolvedValue(undefined);
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
      expect(machineIds).toEqual(['localhost']);
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
        expect.arrayContaining(['localhost', '192.168.1.50', '192.168.1.51']),
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
      expect(machineIds).toEqual(expect.arrayContaining(['localhost', '10.0.0.1', '10.0.0.2']));
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
      expect(counts['localhost']).toBe(1);
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
          machineId: 'localhost',
          path: '/tmp/base.txt',
          content: 'older from player A',
          owner: 'user',
        },
        {
          machineId: 'localhost',
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
          machineId: 'localhost',
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
          machineId: 'localhost',
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
          machineId: 'localhost',
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
          machineId: 'localhost',
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
          machineId: 'localhost',
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
          machineId: 'localhost',
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
          machineId: 'localhost',
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
        machineId: 'localhost',
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
        machineId: 'localhost',
        path: '/tmp/base.txt',
      });
      expect(mockedUpsertPatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          machineId: 'localhost',
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
  // Mission/home transition
  // -----------------------------------------------------------------------

  describe('mission/home transition → clearTransientPatchesOnServer', () => {
    it('does not fire on initial mount (isInitialMissionMount guard)', async () => {
      renderHook(() => useFileSystem(), {
        wrapper: wrap({
          missionFileSystems: { '10.0.0.1': baseLocalhost },
        }),
      });
      await waitFor(() => expect(mockedListPatchesForMachines).toHaveBeenCalled());
      // Initial mount must not trigger the transient cleanup — that's the
      // existing isInitialMissionMount guard.
      expect(mockedClearTransientPatches).not.toHaveBeenCalled();
    });

    it('fires when missionFileSystems is added at runtime (after initial mount)', async () => {
      // State-driven wrapper toggles missionFileSystems so the FSC's
      // mission/home transition useEffect fires with !isInitialMissionMount.
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
      vi.mocked(mockedClearTransientPatches).mockClear();

      act(() => {
        setMissionEnabled?.(true);
      });

      await waitFor(() => {
        expect(mockedClearTransientPatches).toHaveBeenCalled();
      });
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
      // Local write BEFORE rehydration resolves — sets localWritesSinceMount
      act(() => {
        result.current.createFile('/tmp/local.txt', 'local-only', 'user');
      });

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
