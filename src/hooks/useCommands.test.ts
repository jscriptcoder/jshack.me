import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { useCommands } from './useCommands';
import { SessionProvider } from '../session/SessionContext';
import { MissionProvider } from '../mission/MissionContext';
import { FileSystemProvider } from '../filesystem/FileSystemContext';
import { NetworkProvider } from '../network/NetworkContext';
import type { MissionState } from '../mission/useMissionState';
import { COMMAND_TIERS } from '../commands/permissions';

vi.mock('../utils/storageCache', () => ({
  getCachedSessionState: vi.fn(() => null),
  getCachedFilesystemPatches: vi.fn(() => []),
  getCachedMissionSeed: vi.fn(() => null),
  getDatabase: vi.fn(() => null),
}));

vi.mock('../utils/storage', () => ({
  saveSessionState: vi.fn(),
  saveFilesystemPatches: vi.fn(),
  saveMissionSeed: vi.fn(),
}));

const mockMissionState: MissionState = {
  activeMission: null,
  startMission: vi.fn(),
  abortMission: vi.fn(),
  completeMission: vi.fn(),
};

const createWrapper =
  () =>
  ({ children }: { readonly children: ReactNode }) =>
    createElement(
      SessionProvider,
      null,
      createElement(
        MissionProvider,
        { state: mockMissionState, children: null },
        createElement(FileSystemProvider, null, createElement(NetworkProvider, null, children)),
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

  it('includes all user-accessible commands on localhost', () => {
    const { result } = renderHook(() => useCommands(), { wrapper: createWrapper() });
    const names = result.current.commandNames;

    // Default session is userType 'user' on localhost — all user-tier commands available
    expect(names).toContain('help');
    expect(names).toContain('ls');
    expect(names).toContain('cat');
    expect(names).toContain('nmap');
    expect(names).toContain('ssh');
    expect(names).toContain('echo');
    expect(names).toContain('missions');
    expect(names).not.toContain('decrypt'); // root-only command should be excluded
  });

  it('excludes root-only commands for default user', () => {
    const { result } = renderHook(() => useCommands(), { wrapper: createWrapper() });
    const names = result.current.commandNames;

    // Default session is userType 'user' — root commands should be filtered out
    expect(names).not.toContain('decrypt');
  });

  it('excludes user-tier commands for guest', async () => {
    // Override cached session to start as guest
    const { getCachedSessionState } = await import('../utils/storageCache');
    vi.mocked(getCachedSessionState).mockReturnValue({
      session: {
        username: 'guest',
        userType: 'guest',
        machine: 'localhost',
        currentPath: '/home/guest',
        wifiConnected: true,
        theme: 'amber',
      },
      sessionStack: [],
      ftpSession: null,
      ncSession: null,
    });

    const { result } = renderHook(() => useCommands(), { wrapper: createWrapper() });
    const names = result.current.commandNames;

    // Guest-accessible commands present
    expect(names).toContain('help');
    expect(names).toContain('ls');
    expect(names).toContain('cat');
    expect(names).toContain('echo');

    // User-tier commands absent
    const userTierCommands = Object.entries(COMMAND_TIERS)
      .filter(([, tier]) => tier === 'user')
      .map(([name]) => name);

    for (const cmd of userTierCommands) {
      expect(names).not.toContain(cmd);
    }

    // Restore
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
});
