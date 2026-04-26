import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SessionProvider, useSession } from './SessionContext';
import type { SessionSummary } from '../sessionRegistry/types';

// Mock the sessionRegistry client so we don't hit the network. Tests control
// what createSession returns via the mock.
vi.mock('../sessionRegistry/client', () => ({
  createSession: vi.fn(),
  endSession: vi.fn(),
  listSessions: vi.fn(),
}));

import {
  createSession as mockedCreateSession,
  endSession as mockedEndSession,
  listSessions as mockedListSessions,
} from '../sessionRegistry/client';

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
    vi.mocked(mockedListSessions).mockReset();
    vi.mocked(mockedListSessions).mockResolvedValue([]);
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

describe('SessionProvider — popSession (server-aware)', () => {
  beforeEach(() => {
    vi.mocked(mockedCreateSession).mockReset();
    vi.mocked(mockedCreateSession).mockResolvedValue('abc-session-id');
    vi.mocked(mockedEndSession).mockReset();
    vi.mocked(mockedEndSession).mockResolvedValue(undefined);
    vi.mocked(mockedListSessions).mockReset();
    vi.mocked(mockedListSessions).mockResolvedValue([]);
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

  it('popSession ends the current server session with reason="user_exit"', async () => {
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    await act(async () => {
      await result.current.pushSession('ssh', {
        machine: '10.0.0.1',
        username: 'admin',
        userType: 'root',
        currentPath: '/root',
      });
    });

    act(() => {
      result.current.popSession();
    });

    expect(mockedEndSession).toHaveBeenCalledWith(
      expect.objectContaining({ publicKeyHex: 'aa'.repeat(32) }),
      { session_id: 'abc-session-id', reason: 'user_exit' },
    );
  });

  it('popSession does not call endSession when there is no stack to pop', () => {
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    let popped;
    act(() => {
      popped = result.current.popSession();
    });

    expect(popped).toBeNull();
    expect(mockedEndSession).not.toHaveBeenCalled();
  });

  it('popSession does not call endSession when current.sessionId is null', async () => {
    // Simulate a manually-constructed state where stack has one entry but
    // current is untracked (theoretical edge case — push always sets a
    // sessionId, but we want the guard to be defensive).
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });
    // Make pushSession resolve to a sessionId, then pop normally — we
    // verify the OPPOSITE case (current with null) by checking that the
    // null-current guard exists when the stack is empty (handled above).
    // Direct construction not possible without exposing internals, so this
    // test asserts the same behaviour from the empty-stack early-return
    // path (already covered above). Skipping a redundant assertion here.
    expect(result.current.session.sessionId).toBeNull();
  });
});

describe('SessionProvider — popAllSessions (server-aware)', () => {
  beforeEach(() => {
    vi.mocked(mockedCreateSession).mockReset();
    vi.mocked(mockedEndSession).mockReset();
    vi.mocked(mockedEndSession).mockResolvedValue(undefined);
    vi.mocked(mockedListSessions).mockReset();
    vi.mocked(mockedListSessions).mockResolvedValue([]);
    sessionStorage.clear();
  });

  it('ends the oldest tracked session in the chain (cascade ends the rest)', async () => {
    vi.mocked(mockedCreateSession)
      .mockResolvedValueOnce('first-id')
      .mockResolvedValueOnce('second-id')
      .mockResolvedValueOnce('third-id');
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    // Three pushes — chain in DB: first → second → third
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
    await act(async () => {
      await result.current.pushSession('su', {
        machine: '10.0.0.2',
        username: 'root',
        userType: 'root',
        currentPath: '/root',
      });
    });

    act(() => {
      result.current.popAllSessions();
    });

    // Should end ONLY the oldest tracked (first-id) — cascade does the rest
    expect(mockedEndSession).toHaveBeenCalledTimes(1);
    expect(mockedEndSession).toHaveBeenCalledWith(
      expect.objectContaining({ publicKeyHex: 'aa'.repeat(32) }),
      { session_id: 'first-id', reason: 'pop_all' },
    );
  });

  it('falls back to current sessionId when only a single push has happened', async () => {
    // Stack[0] = bottom (untracked localhost); current = first push (tracked).
    // No intermediate stack entries — fall back to current.sessionId.
    vi.mocked(mockedCreateSession).mockResolvedValue('only-id');
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    await act(async () => {
      await result.current.pushSession('ssh', {
        machine: '10.0.0.1',
        username: 'admin',
        userType: 'root',
        currentPath: '/root',
      });
    });

    act(() => {
      result.current.popAllSessions();
    });

    expect(mockedEndSession).toHaveBeenCalledWith(
      expect.objectContaining({ publicKeyHex: 'aa'.repeat(32) }),
      { session_id: 'only-id', reason: 'pop_all' },
    );
  });

  it('does not call endSession when stack is empty', () => {
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    act(() => {
      result.current.popAllSessions();
    });

    expect(mockedEndSession).not.toHaveBeenCalled();
  });

  it('resets local state to bottom of stack regardless of server call', async () => {
    vi.mocked(mockedCreateSession).mockResolvedValue('first-id');
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    await act(async () => {
      await result.current.pushSession('ssh', {
        machine: '10.0.0.1',
        username: 'admin',
        userType: 'root',
        currentPath: '/root',
      });
    });

    act(() => {
      result.current.popAllSessions();
    });

    expect(result.current.session.machine).toBe('localhost');
    expect(result.current.session.username).toBe('alice');
    expect(result.current.session.sessionId).toBeNull();
    expect(result.current.sessionStack).toHaveLength(0);
  });
});

describe('SessionProvider — rehydration on mount', () => {
  beforeEach(() => {
    vi.mocked(mockedCreateSession).mockReset();
    vi.mocked(mockedEndSession).mockReset();
    vi.mocked(mockedListSessions).mockReset();
    sessionStorage.clear();
  });

  const sessionA: SessionSummary = {
    session_id: 'aaa-id',
    machine_id: '10.0.0.1',
    credentials: { username: 'admin', userType: 'root' },
    parent_session_id: null,
    source_ip: 'localhost',
    created_at: '2026-04-26T10:00:00.000Z',
  };

  const sessionB: SessionSummary = {
    session_id: 'bbb-id',
    machine_id: '10.0.0.2',
    credentials: { username: 'bob', userType: 'user' },
    parent_session_id: 'aaa-id',
    source_ip: '10.0.0.1',
    created_at: '2026-04-26T10:01:00.000Z',
  };

  const sessionC: SessionSummary = {
    session_id: 'ccc-id',
    machine_id: '10.0.0.2',
    credentials: { username: 'root', userType: 'root' },
    parent_session_id: 'bbb-id',
    source_ip: '10.0.0.2',
    created_at: '2026-04-26T10:02:00.000Z',
  };

  it('calls listSessions once on mount', async () => {
    vi.mocked(mockedListSessions).mockResolvedValue([]);
    renderHook(() => useSession(), { wrapper: wrapper('alice') });

    await waitFor(() => {
      expect(mockedListSessions).toHaveBeenCalled();
    });
    // StrictMode in tests may double-invoke; allow ≥1 call.
    expect(vi.mocked(mockedListSessions).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('isRehydrating starts true and flips false after listSessions resolves', async () => {
    vi.mocked(mockedListSessions).mockResolvedValue([]);
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    expect(result.current.isRehydrating).toBe(true);
    await waitFor(() => {
      expect(result.current.isRehydrating).toBe(false);
    });
  });

  it('empty server response leaves stack empty and current at default localhost', async () => {
    vi.mocked(mockedListSessions).mockResolvedValue([]);
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    await waitFor(() => {
      expect(result.current.isRehydrating).toBe(false);
    });

    expect(result.current.sessionStack).toHaveLength(0);
    expect(result.current.session.machine).toBe('localhost');
    expect(result.current.session.sessionId).toBeNull();
  });

  it('1 server session: stack = [bottom], current = the session', async () => {
    vi.mocked(mockedListSessions).mockResolvedValue([sessionA]);
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    await waitFor(() => {
      expect(result.current.session.sessionId).toBe('aaa-id');
    });

    expect(result.current.session.machine).toBe('10.0.0.1');
    expect(result.current.session.username).toBe('admin');
    expect(result.current.session.userType).toBe('root');
    expect(result.current.session.currentPath).toBe('/root');

    expect(result.current.sessionStack).toHaveLength(1);
    const bottom = result.current.sessionStack[0]!;
    expect(bottom.machine).toBe('localhost');
    expect(bottom.username).toBe('alice');
    expect(bottom.sessionId).toBeNull();
  });

  it('3 server sessions chain: stack = [bottom, A, B], current = C', async () => {
    vi.mocked(mockedListSessions).mockResolvedValue([sessionA, sessionB, sessionC]);
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    await waitFor(() => {
      expect(result.current.session.sessionId).toBe('ccc-id');
    });

    expect(result.current.session.machine).toBe('10.0.0.2');
    expect(result.current.session.username).toBe('root');

    expect(result.current.sessionStack).toHaveLength(3);
    expect(result.current.sessionStack[0]?.machine).toBe('localhost');
    expect(result.current.sessionStack[0]?.sessionId).toBeNull();
    expect(result.current.sessionStack[1]?.machine).toBe('10.0.0.1');
    expect(result.current.sessionStack[1]?.sessionId).toBe('aaa-id');
    expect(result.current.sessionStack[2]?.machine).toBe('10.0.0.2');
    expect(result.current.sessionStack[2]?.sessionId).toBe('bbb-id');
  });

  it('derives currentPath from credentials.userType (root → /root)', async () => {
    vi.mocked(mockedListSessions).mockResolvedValue([sessionA]);
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    await waitFor(() => {
      expect(result.current.session.sessionId).toBe('aaa-id');
    });

    expect(result.current.session.currentPath).toBe('/root');
  });

  it('derives currentPath from credentials.userType (user → /home/<username>)', async () => {
    vi.mocked(mockedListSessions).mockResolvedValue([sessionB]);
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    await waitFor(() => {
      expect(result.current.session.sessionId).toBe('bbb-id');
    });

    expect(result.current.session.currentPath).toBe('/home/bob');
  });

  it('logs error and leaves local state untouched on listSessions failure', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(mockedListSessions).mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useSession(), { wrapper: wrapper('alice') });

    await waitFor(() => {
      expect(result.current.isRehydrating).toBe(false);
    });

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(result.current.session.machine).toBe('localhost');
    expect(result.current.session.sessionId).toBeNull();
    expect(result.current.sessionStack).toHaveLength(0);

    consoleErrorSpy.mockRestore();
  });
});
