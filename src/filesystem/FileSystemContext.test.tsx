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
  clearTransientPatches: vi.fn(),
  clearOwnedPatches: vi.fn(),
}));

import {
  upsertPatch as mockedUpsertPatch,
  removePatch as mockedRemovePatch,
  listPatches as mockedListPatches,
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
    vi.mocked(mockedListPatches).mockReset();
    vi.mocked(mockedClearTransientPatches).mockReset();
    vi.mocked(mockedUpsertPatch).mockResolvedValue(undefined);
    vi.mocked(mockedRemovePatch).mockResolvedValue(undefined);
    vi.mocked(mockedListPatches).mockResolvedValue([]);
    vi.mocked(mockedClearTransientPatches).mockResolvedValue(undefined);
  });

  // -----------------------------------------------------------------------
  // Mount rehydration
  // -----------------------------------------------------------------------

  describe('mount rehydration', () => {
    it('calls listPatches on mount', async () => {
      renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => {
        expect(mockedListPatches).toHaveBeenCalled();
      });
    });

    it('exposes isRehydrating: true initially, transitions to false after listPatches resolves', async () => {
      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      expect(result.current.isRehydrating).toBe(true);
      await waitFor(() => {
        expect(result.current.isRehydrating).toBe(false);
      });
    });

    it('still sets isRehydrating: false when listPatches rejects', async () => {
      vi.mocked(mockedListPatches).mockRejectedValueOnce(new Error('network'));
      const { result } = renderHook(() => useFileSystem(), { wrapper: wrap() });
      await waitFor(() => {
        expect(result.current.isRehydrating).toBe(false);
      });
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
      await waitFor(() => expect(mockedListPatches).toHaveBeenCalled());
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
    it('skips replacement when a local write happened before listPatches resolved', async () => {
      // Defer the listPatches resolution until we explicitly trigger it.
      let resolveListPatches!: (patches: never[]) => void;
      vi.mocked(mockedListPatches).mockImplementationOnce(
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

      // Now resolve listPatches with an EMPTY server response (would normally
      // wipe local state). Race-mitigation should keep our local write.
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
});
