import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { useFileSystem, FileSystemProvider } from './FileSystemContext';
import { SessionProvider } from '../session/SessionContext';
import { generateLocalhost } from '../generation/generateLocalhost';

vi.mock('../utils/storageCache', () => ({
  getCachedSessionState: vi.fn(() => null),
  getCachedWifiState: vi.fn(() => null),
  getCachedBrickedMachines: vi.fn(() => []),
  getCachedFilesystemPatches: vi.fn(() => []),
  getCachedMissionSeed: vi.fn(() => null),
  getCachedGameState: vi.fn(() => null),
  getDatabase: vi.fn(() => null),
}));

vi.mock('../utils/storage', () => ({
  saveSessionToTab: vi.fn(),
  saveWifiState: vi.fn(),
  saveFilesystemPatches: vi.fn(),
  saveMissionSeed: vi.fn(),
}));

const TEST_HOSTNAME = 'testbox-aabbccdd';
const testLocalhost = generateLocalhost(
  { seed: 'test', workstationName: 'testbox', username: 'testuser', rootPassword: 'pw' },
  TEST_HOSTNAME,
);

const createWrapper =
  () =>
  ({ children }: { readonly children: ReactNode }) =>
    createElement(
      SessionProvider,
      { username: 'testuser', hostname: TEST_HOSTNAME, children: null },
      createElement(
        FileSystemProvider,
        { localhostFileSystem: testLocalhost.fileSystem, children: null },
        children,
      ),
    );

// Boundary contract for PR 3 (plans/use-stable-callback-refactor.md).
// FileSystemContext composes readers + mutations + sync; each of those
// internally returns stable-identity wraps so the consolidated context
// exposes stable references too.
describe('FileSystemContext: stable identity contract', () => {
  it('exposes context methods with stable identity across renders', () => {
    const { result, rerender } = renderHook(() => useFileSystem(), { wrapper: createWrapper() });

    // Method-valued keys we expect to be stable. State values
    // (fileSystem, isRehydrating) and useRef handles (machineIdsKeyRef)
    // are intentionally excluded — they're not subject to the closure-
    // capture bug class.
    const methodKeys = [
      'resolvePath',
      'resolvePathForMachine',
      'getNode',
      'getNodeFromMachine',
      'canRead',
      'canWrite',
      'canReadFromMachine',
      'canWriteFromMachine',
      'listDirectory',
      'listDirectoryFromMachine',
      'readFile',
      'readFileFromMachine',
      'writeFile',
      'createFile',
      'createDirectory',
      'deleteNode',
      'writeFileToMachine',
      'createFileOnMachine',
      'upsertFileOnMachine',
      'createDirectoryOnMachine',
      'deleteNodeFromMachine',
      'updatePermissions',
      'canTraverse',
      'canTraverseOnMachine',
      'getDefaultHomePath',
      'flushPendingPatches',
      'prefetchPatchesForMachines',
      'awaitCrossPlayerBaseFs',
    ] as const;

    const before = Object.fromEntries(
      methodKeys.map((key) => [key, result.current[key]]),
    ) as Record<(typeof methodKeys)[number], unknown>;

    rerender();

    for (const key of methodKeys) {
      expect(result.current[key], `${key} should keep stable identity`).toBe(before[key]);
    }
  });
});
