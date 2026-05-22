import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withTransientAuthSession } from './withTransientAuthSession';
import type { Identity } from '../identity/identity';

vi.mock('../sessionRegistry/client', () => ({
  authCreateSession: vi.fn(),
  endSession: vi.fn(),
}));

import {
  authCreateSession as mockedAuthCreateSession,
  endSession as mockedEndSession,
} from '../sessionRegistry/client';

const identity: Identity = {
  privateKey: new Uint8Array(32),
  publicKey: new Uint8Array(32),
  publicKeyHex: 'aa'.repeat(32),
};

const params = {
  machine_id: '10.0.0.5',
  kind: 'scp' as const,
  username: 'alice',
  auth: { method: 'password' as const, password: 'secret' },
};

describe('withTransientAuthSession', () => {
  beforeEach(() => {
    vi.mocked(mockedAuthCreateSession).mockReset();
    vi.mocked(mockedEndSession).mockReset();
    vi.mocked(mockedEndSession).mockResolvedValue(undefined);
  });

  it('on auth ok: runs body, ends session, returns ok with body value', async () => {
    vi.mocked(mockedAuthCreateSession).mockResolvedValue({
      ok: true,
      session_id: 'tx-id',
      userType: 'user',
    });
    const body = vi.fn().mockResolvedValue('body-result');

    const result = await withTransientAuthSession(identity, params, body);

    expect(result).toEqual({ ok: true, value: 'body-result' });
    expect(body).toHaveBeenCalledWith({ sessionId: 'tx-id', userType: 'user' });
    expect(mockedEndSession).toHaveBeenCalledWith(identity, {
      session_id: 'tx-id',
      reason: 'user_exit',
    });
  });

  it('on auth ok: forwards machine_id, kind, username, and auth method', async () => {
    vi.mocked(mockedAuthCreateSession).mockResolvedValue({
      ok: true,
      session_id: 'tx-id',
      userType: 'user',
    });

    await withTransientAuthSession(identity, params, () => undefined);

    expect(mockedAuthCreateSession).toHaveBeenCalledWith(
      identity,
      expect.objectContaining({
        machine_id: '10.0.0.5',
        kind: 'scp',
        username: 'alice',
        auth: { method: 'password', password: 'secret' },
      }),
    );
  });

  it('on auth fail (invalid_credentials): does NOT run body, does NOT end session', async () => {
    vi.mocked(mockedAuthCreateSession).mockResolvedValue({
      ok: false,
      reason: 'invalid_credentials',
    });
    const body = vi.fn();

    const result = await withTransientAuthSession(identity, params, body);

    expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(body).not.toHaveBeenCalled();
    expect(mockedEndSession).not.toHaveBeenCalled();
  });

  it('on auth fail (rate_limited): does NOT run body, does NOT end session', async () => {
    vi.mocked(mockedAuthCreateSession).mockResolvedValue({
      ok: false,
      reason: 'rate_limited',
    });
    const body = vi.fn();

    const result = await withTransientAuthSession(identity, params, body);

    expect(result).toEqual({ ok: false, reason: 'rate_limited' });
    expect(body).not.toHaveBeenCalled();
    expect(mockedEndSession).not.toHaveBeenCalled();
  });

  it('on body throw: still ends the session, then propagates the throw', async () => {
    vi.mocked(mockedAuthCreateSession).mockResolvedValue({
      ok: true,
      session_id: 'tx-id',
      userType: 'user',
    });
    const body = vi.fn().mockRejectedValue(new Error('body failed'));

    await expect(withTransientAuthSession(identity, params, body)).rejects.toThrow('body failed');

    expect(mockedEndSession).toHaveBeenCalledWith(identity, {
      session_id: 'tx-id',
      reason: 'user_exit',
    });
  });

  it('on authCreateSession throw: propagates the throw', async () => {
    vi.mocked(mockedAuthCreateSession).mockRejectedValue(new Error('network failure'));
    const body = vi.fn();

    await expect(withTransientAuthSession(identity, params, body)).rejects.toThrow(
      'network failure',
    );

    expect(body).not.toHaveBeenCalled();
    expect(mockedEndSession).not.toHaveBeenCalled();
  });

  it('threads parent_session_id and source_ip through to authCreateSession', async () => {
    vi.mocked(mockedAuthCreateSession).mockResolvedValue({
      ok: true,
      session_id: 'tx-id',
      userType: 'user',
    });

    await withTransientAuthSession(
      identity,
      {
        ...params,
        parent_session_id: '00000000-0000-0000-0000-000000000000',
        source_ip: '192.168.1.10',
      },
      () => undefined,
    );

    expect(mockedAuthCreateSession).toHaveBeenCalledWith(
      identity,
      expect.objectContaining({
        parent_session_id: '00000000-0000-0000-0000-000000000000',
        source_ip: '192.168.1.10',
      }),
    );
  });

  it('endSession is fire-and-forget — its failure does not block the body result', async () => {
    vi.mocked(mockedAuthCreateSession).mockResolvedValue({
      ok: true,
      session_id: 'tx-id',
      userType: 'user',
    });
    vi.mocked(mockedEndSession).mockRejectedValue(new Error('end failed'));

    const result = await withTransientAuthSession(identity, params, () => 'ok');

    expect(result).toEqual({ ok: true, value: 'ok' });
  });

  it('passes savedKey auth correctly', async () => {
    vi.mocked(mockedAuthCreateSession).mockResolvedValue({
      ok: true,
      session_id: 'tx-id',
      userType: 'user',
    });

    await withTransientAuthSession(
      identity,
      {
        ...params,
        auth: { method: 'savedKey', fingerprint: 'abc', targetIp: '10.0.0.5' },
      },
      () => undefined,
    );

    expect(mockedAuthCreateSession).toHaveBeenCalledWith(
      identity,
      expect.objectContaining({
        auth: { method: 'savedKey', fingerprint: 'abc', targetIp: '10.0.0.5' },
      }),
    );
  });
});
