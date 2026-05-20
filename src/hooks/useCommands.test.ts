import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { useCommands } from './useCommands';
import { SessionProvider } from '../session/SessionContext';
import { MissionProvider } from '../mission/MissionContext';
import { FileSystemProvider } from '../filesystem/FileSystemContext';
import { NetworkProvider } from '../network/NetworkContext';
import { HomeNetworksProvider } from '../homeNetworks/HomeNetworksContext';
import { ForeignNetworksProvider } from '../foreignNetworks/ForeignNetworksContext';
import type { MissionState } from '../mission/useMissionState';
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

const mockMissionState: MissionState = {
  activeMission: null,
  startMission: vi.fn(),
  abortMission: vi.fn(),
  completeMission: vi.fn(),
};

const testGameState = {
  seed: 'test-seed',
  workstationName: 'testbox',
  username: 'testuser',
  rootPassword: 'testpass',
};

// Test fixture: a synthetic suffixed hostname. Real production code computes
// this via computePlayerHostname(workstationName, identity); tests just hand
// in a static value so the localhost FS generation has a hostname to render
// into /etc/hostname and sample log entries. The same value flows into
// SessionProvider as `hostname` — under the eliminated-localhost model it
// IS the workstation_id (storage key for the player's filesystem, value
// session.machine takes when on the player's own workstation).
const TEST_HOSTNAME = 'testbox-aabbccdd';
const testLocalhost = generateLocalhost(testGameState, TEST_HOSTNAME);

const createWrapper =
  () =>
  ({ children }: { readonly children: ReactNode }) =>
    createElement(
      SessionProvider,
      { username: 'testuser', hostname: TEST_HOSTNAME, children: null },
      createElement(
        HomeNetworksProvider,
        {
          gameSeed: null,
          workstationPrefix: null,
          connectedWifi: null,
          children: null,
        },
        createElement(
          ForeignNetworksProvider,
          { ownActiveHomePublicIp: null, children: null },
          createElement(
            MissionProvider,
            { state: mockMissionState, usedPublicIps: new Set<string>(), children: null },
            createElement(
              FileSystemProvider,
              { localhostFileSystem: testLocalhost.fileSystem, children: null },
              createElement(NetworkProvider, null, children),
            ),
          ),
        ),
      ),
    );

describe('useCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns commandNames and executionContext', () => {
    const { result } = renderHook(() => useCommands(), { wrapper: createWrapper() });

    expect(Array.isArray(result.current.commandNames)).toBe(true);
    expect(result.current.commandNames.length).toBeGreaterThan(0);
    expect(typeof result.current.executionContext).toBe('object');
  });

  it('includes all commands on localhost regardless of user type', () => {
    const { result } = renderHook(() => useCommands(), { wrapper: createWrapper() });
    const names = result.current.commandNames;

    // All commands should be visible — no user-type filtering
    expect(names).toContain('help');
    expect(names).toContain('ls');
    expect(names).toContain('cat');
    expect(names).toContain('airmon');
    expect(names).toContain('ssh');
    expect(names).toContain('echo');
    expect(names).toContain('missions');
    expect(names).toContain('gpg');
    expect(names).toContain('reboot');
    // nmap is NOT pre-installed on localhost — requires apt install
    expect(names).not.toContain('nmap');
  });

  it('shows all commands to guest on the player workstation', async () => {
    const { getCachedSessionState } = await import('../utils/storageCache');
    vi.mocked(getCachedSessionState).mockReturnValue({
      session: {
        username: 'guest',
        userType: 'guest',
        machine: TEST_HOSTNAME,
        hostname: TEST_HOSTNAME,
        currentPath: '/home/guest',
        theme: 'amber',
        sessionId: null,
      },
      sessionStack: [],
      ftpSession: null,
      ncSession: null,
      mysqlSession: null,
      redisSession: null,
    });

    const { result } = renderHook(() => useCommands(), { wrapper: createWrapper() });
    const names = result.current.commandNames;

    // Guest sees ALL pre-installed commands on localhost — visibility is not user-type filtered
    expect(names).toContain('help');
    expect(names).toContain('ls');
    expect(names).toContain('airmon');
    expect(names).toContain('missions');
    expect(names).toContain('gpg');
    expect(names).toContain('reboot');
    expect(names).toContain('apt');
    expect(names).toContain('ifconfig');
    // nmap is NOT pre-installed on localhost — requires apt install
    expect(names).not.toContain('nmap');

    vi.mocked(getCachedSessionState).mockReturnValue(null);
  });

  it('every commandName has a matching executionContext entry', () => {
    const { result } = renderHook(() => useCommands(), { wrapper: createWrapper() });
    const { commandNames, executionContext } = result.current;

    for (const name of commandNames) {
      expect(executionContext).toHaveProperty(name);
      expect(typeof executionContext[name]).toBe('function');
    }
  });

  it('executionContext.echo is callable and returns output', () => {
    const { result } = renderHook(() => useCommands(), { wrapper: createWrapper() });

    const output = result.current.executionContext.echo('hello');
    expect(output).toBe('hello');
  });

  it('root-only commands throw Permission denied for non-root users', () => {
    const { result } = renderHook(() => useCommands(), { wrapper: createWrapper() });

    // Default session is userType 'user' — gpg and reboot are root-only binaries
    expect(() => result.current.executionContext.gpg()).toThrow('Permission denied');
    expect(() => result.current.executionContext.reboot()).toThrow('Permission denied');
  });
});
