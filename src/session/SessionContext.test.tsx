import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SessionProvider, useSession } from './SessionContext';

// Mock the sessionRegistry client so we don't hit the network. Tests control
// what createSession returns via the mock.
vi.mock('../sessionRegistry/client', () => ({
  createSession: vi.fn(),
  endSession: vi.fn(),
  listSessions: vi.fn(),
}));

import { createSession as mockedCreateSession } from '../sessionRegistry/client';

// Mock identity singleton so we don't depend on browser localStorage.
vi.mock('../identity', () => ({
  getIdentity: () => ({
    privateKey: new Uint8Array(32),
    publicKey: new Uint8Array(32),
    publicKeyHex: 'aa'.repeat(32),
  }),
}));

const wrapper =
  (username: string) =>
  ({ children }: { children: ReactNode }) => (
    <SessionProvider username={username}>{children}</SessionProvider>
  );

describe('SessionProvider — pushSession (server-aware)', () => {
  beforeEach(() => {
    vi.mocked(mockedCreateSession).mockReset();
    sessionStorage.clear();
  });

  it('initial Session has sessionId: null (untracked default localhost)', () => {
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });
    expect(result.current.session.sessionId).toBeNull();
  });

  it('pushSession returns a Promise<void>', async () => {
    vi.mocked(mockedCreateSession).mockResolvedValue('abc-session-id');
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    let returned: unknown;
    await act(async () => {
      returned = result.current.pushSession('ssh', {
        machine: '10.0.0.1',
        username: 'admin',
        userType: 'root',
        currentPath: '/root',
      });
      await returned;
    });

    expect(returned).toBeInstanceOf(Promise);
  });

  it('calls createSession with parent_session_id null when current is untracked localhost', async () => {
    vi.mocked(mockedCreateSession).mockResolvedValue('abc-session-id');
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    await act(async () => {
      await result.current.pushSession('ssh', {
        machine: '10.0.0.1',
        username: 'admin',
        userType: 'root',
        currentPath: '/root',
      });
    });

    expect(mockedCreateSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        machine_id: '10.0.0.1',
        credentials: { username: 'admin', userType: 'root' },
        source_ip: 'localhost',
      }),
    );
    // parent_session_id should be absent (or undefined) since current sessionId is null
    const args = vi.mocked(mockedCreateSession).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args.parent_session_id).toBeUndefined();
  });

  it('atomically updates current Session and stack on resolve', async () => {
    vi.mocked(mockedCreateSession).mockResolvedValue('abc-session-id');
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    await act(async () => {
      await result.current.pushSession('ssh', {
        machine: '10.0.0.1',
        username: 'admin',
        userType: 'root',
        currentPath: '/root',
      });
    });

    expect(result.current.session.machine).toBe('10.0.0.1');
    expect(result.current.session.username).toBe('admin');
    expect(result.current.session.userType).toBe('root');
    expect(result.current.session.currentPath).toBe('/root');
    expect(result.current.session.sessionId).toBe('abc-session-id');

    expect(result.current.sessionStack).toHaveLength(1);
    const snapshot = result.current.sessionStack[0]!;
    expect(snapshot.machine).toBe('localhost');
    expect(snapshot.username).toBe('alice');
    expect(snapshot.reason).toBe('ssh');
    expect(snapshot.sessionId).toBeNull();
  });

  it('preserves hostname in current Session when destination provides one', async () => {
    vi.mocked(mockedCreateSession).mockResolvedValue('abc-session-id');
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    await act(async () => {
      await result.current.pushSession('ssh', {
        machine: '10.0.0.1',
        hostname: 'webserver',
        username: 'admin',
        userType: 'root',
        currentPath: '/root',
      });
    });

    expect(result.current.session.hostname).toBe('webserver');
  });

  it('chains parent_session_id on a second push', async () => {
    vi.mocked(mockedCreateSession)
      .mockResolvedValueOnce('first-id')
      .mockResolvedValueOnce('second-id');
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    await act(async () => {
      await result.current.pushSession('ssh', {
        machine: '10.0.0.1',
        username: 'admin',
        userType: 'root',
        currentPath: '/root',
      });
    });

    await act(async () => {
      await result.current.pushSession('ssh', {
        machine: '10.0.0.2',
        username: 'bob',
        userType: 'user',
        currentPath: '/home/bob',
      });
    });

    const secondCallArgs = vi.mocked(mockedCreateSession).mock.calls[1]?.[1] as Record<
      string,
      unknown
    >;
    expect(secondCallArgs.parent_session_id).toBe('first-id');
    expect(secondCallArgs.source_ip).toBe('10.0.0.1');

    expect(result.current.session.sessionId).toBe('second-id');
    expect(result.current.sessionStack).toHaveLength(2);
    // Second snapshot preserves first push's sessionId
    expect(result.current.sessionStack[1]?.sessionId).toBe('first-id');
  });

  it('rethrows when createSession fails — local state remains untouched', async () => {
    vi.mocked(mockedCreateSession).mockRejectedValue(new Error('server error'));
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    const beforeMachine = result.current.session.machine;

    await expect(
      act(async () => {
        await result.current.pushSession('ssh', {
          machine: '10.0.0.1',
          username: 'admin',
          userType: 'root',
          currentPath: '/root',
        });
      }),
    ).rejects.toThrow('server error');

    // After failure: session unchanged, stack unchanged
    expect(result.current.session.machine).toBe(beforeMachine);
    expect(result.current.session.sessionId).toBeNull();
    expect(result.current.sessionStack).toHaveLength(0);
  });

  it('passes the player identity to createSession', async () => {
    vi.mocked(mockedCreateSession).mockResolvedValue('abc-session-id');
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    await act(async () => {
      await result.current.pushSession('ssh', {
        machine: '10.0.0.1',
        username: 'admin',
        userType: 'root',
        currentPath: '/root',
      });
    });

    const identityArg = vi.mocked(mockedCreateSession).mock.calls[0]?.[0];
    expect(identityArg).toMatchObject({
      publicKeyHex: 'aa'.repeat(32),
    });
  });

  it('su-style push (same machine) keeps current machine, only swaps credentials', async () => {
    vi.mocked(mockedCreateSession).mockResolvedValueOnce('first-id').mockResolvedValueOnce('su-id');
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    // First SSH to a remote
    await act(async () => {
      await result.current.pushSession('ssh', {
        machine: '10.0.0.1',
        username: 'alice',
        userType: 'user',
        currentPath: '/home/alice',
      });
    });

    // Then su to root on the same machine
    await act(async () => {
      await result.current.pushSession('su', {
        machine: '10.0.0.1', // same machine
        username: 'root',
        userType: 'root',
        currentPath: '/root',
      });
    });

    expect(result.current.session.machine).toBe('10.0.0.1');
    expect(result.current.session.username).toBe('root');
    expect(result.current.session.userType).toBe('root');
    expect(result.current.session.sessionId).toBe('su-id');

    // The most-recent snapshot reflects the SSH state (machine + user) before su
    const lastSnapshot = result.current.sessionStack[1]!;
    expect(lastSnapshot.username).toBe('alice');
    expect(lastSnapshot.machine).toBe('10.0.0.1');
    expect(lastSnapshot.reason).toBe('su');
  });
});

describe('SessionProvider — popSession (existing behaviour preserved)', () => {
  beforeEach(() => {
    vi.mocked(mockedCreateSession).mockReset();
    vi.mocked(mockedCreateSession).mockResolvedValue('abc-session-id');
    sessionStorage.clear();
  });

  it('popSession restores prior Session including sessionId', async () => {
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    await act(async () => {
      await result.current.pushSession('ssh', {
        machine: '10.0.0.1',
        username: 'admin',
        userType: 'root',
        currentPath: '/root',
      });
    });

    let popped;
    act(() => {
      popped = result.current.popSession();
    });

    expect(popped).toBeTruthy();
    expect(result.current.session.machine).toBe('localhost');
    expect(result.current.session.sessionId).toBeNull();
    expect(result.current.sessionStack).toHaveLength(0);
  });
});
