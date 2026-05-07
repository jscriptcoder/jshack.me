import type { ReactNode } from 'react';
import type { FileNode } from './types';
import { FileSystemProvider } from './FileSystemContext';

// Fixed workstation_id used by every test in this module. Matches the
// shape `${workstation_name}-${first-8-hex(player_key)}` from the
// production registry, so tests exercise the real key path under the
// eliminated-localhost model.
export const TEST_HOSTNAME = 'workstation-aabbccdd';

// Mutable session container the SessionContext mock factory reads from.
// Tests reassign `.current` to simulate session changes (su, ssh,
// exit). Wrapping it in an object lets us share the live binding across
// test files without ESM's read-only-import restriction.
export type MockSession = {
  readonly machine: string;
  readonly currentPath: string;
  readonly userType: 'root' | 'user' | 'guest';
};

export const mockSessionState: { current: MockSession } = {
  current: { machine: TEST_HOSTNAME, currentPath: '/', userType: 'root' },
};

export const resetMockSession = (): void => {
  mockSessionState.current = { machine: TEST_HOSTNAME, currentPath: '/', userType: 'root' };
};

// Minimal localhost filesystem for tests:
//   /tmp/        — world-writable
//   /tmp/base.txt (owned by user, writable by user) — exists in base FS
export const baseLocalhost: FileNode = {
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

export const wrap =
  (overrides?: {
    homeFileSystems?: Record<string, FileNode>;
    missionFileSystems?: Record<string, FileNode>;
    lanOccupantHostnames?: readonly string[];
  }) =>
  ({ children }: { children: ReactNode }) => (
    <FileSystemProvider
      localhostFileSystem={baseLocalhost}
      homeFileSystems={overrides?.homeFileSystems}
      missionFileSystems={overrides?.missionFileSystems}
      lanOccupantHostnames={overrides?.lanOccupantHostnames}
    >
      {children}
    </FileSystemProvider>
  );
