import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withTransientSession } from './withTransientSession';
import type { Identity } from '../identity/identity';

vi.mock('../sessionRegistry/client', () => ({
  createSession: vi.fn(),
  endSession: vi.fn(),
}));

import {
  createSession as mockedCreateSession,
  endSession as mockedEndSession,
} from '../sessionRegistry/client';

const identity: Identity = {
  privateKey: new Uint8Array(32),
  publicKey: new Uint8Array(32),
  publicKeyHex: 'aa'.repeat(32),
};

const params = {
  machine_id: '10.0.0.5',
  credentials: { username: 'scpuser', userType: 'user' as const },
  kind: 'scp' as const,
};

describe('withTransientSession', () => {
  beforeEach(() => {
    vi.mocked(mockedCreateSession).mockReset();
    vi.mocked(mockedEndSession).mockReset();
    vi.mocked(mockedEndSession).mockResolvedValue(undefined);
  });

  it('pushes session, runs body, ends session — returns body result', async () => {
    vi.mocked(mockedCreateSession).mockResolvedValue('tx-session-id');
    const body = vi.fn().mockResolvedValue('body-result');

    const result = await withTransientSession(identity, params, body);

    expect(result).toBe('body-result');
    expect(mockedCreateSession).toHaveBeenCalledTimes(1);
    expect(body).toHaveBeenCalledWith('tx-session-id');
    expect(mockedEndSession).toHaveBeenCalledWith(identity, {
      session_id: 'tx-session-id',
      reason: 'user_exit',
    });
  });

  it('forwards createSession args including kind', async () => {
    vi.mocked(mockedCreateSession).mockResolvedValue('tx-id');
    await withTransientSession(
      identity,
      {
        machine_id: '10.0.0.9',
        credentials: { username: 'admin', userType: 'root' },
        kind: 'snmp',
        parent_session_id: 'parent-id',
        source_ip: 'localhost',
      },
      () => 'ok',
    );

    expect(mockedCreateSession).toHaveBeenCalledWith(identity, {
      machine_id: '10.0.0.9',
      credentials: { username: 'admin', userType: 'root' },
      kind: 'snmp',
      parent_session_id: 'parent-id',
      source_ip: 'localhost',
    });
  });

  it('omits parent_session_id and source_ip from createSession when not supplied', async () => {
    vi.mocked(mockedCreateSession).mockResolvedValue('tx-id');
    await withTransientSession(identity, params, () => 'ok');

    const args = vi.mocked(mockedCreateSession).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args).not.toHaveProperty('parent_session_id');
    expect(args).not.toHaveProperty('source_ip');
  });

  it('ends session even when body throws — re-throws the body error', async () => {
    vi.mocked(mockedCreateSession).mockResolvedValue('tx-id');
    const error = new Error('body failed');
    const body = vi.fn().mockRejectedValue(error);

    await expect(withTransientSession(identity, params, body)).rejects.toThrow('body failed');
    expect(mockedEndSession).toHaveBeenCalledWith(identity, {
      session_id: 'tx-id',
      reason: 'user_exit',
    });
  });

  it('does not call endSession when push fails — rejection propagates', async () => {
    const pushError = new Error('push failed');
    vi.mocked(mockedCreateSession).mockRejectedValue(pushError);
    const body = vi.fn();

    await expect(withTransientSession(identity, params, body)).rejects.toThrow('push failed');
    expect(body).not.toHaveBeenCalled();
    expect(mockedEndSession).not.toHaveBeenCalled();
  });

  it('logs end-session failures without shadowing body result', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(mockedCreateSession).mockResolvedValue('tx-id');
    vi.mocked(mockedEndSession).mockRejectedValue(new Error('end failed'));

    const result = await withTransientSession(identity, params, () => 'ok');

    expect(result).toBe('ok');
    // .catch handler logs but doesn't throw — we need to wait for it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('accepts a synchronous body (returning T directly, not Promise<T>)', async () => {
    vi.mocked(mockedCreateSession).mockResolvedValue('tx-id');
    const result = await withTransientSession(identity, params, (sessionId) => `body-${sessionId}`);
    expect(result).toBe('body-tx-id');
  });
});
