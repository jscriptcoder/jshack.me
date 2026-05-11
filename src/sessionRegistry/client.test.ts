import { describe, it, expect, vi } from 'vitest';
import {
  authCreateNcSession,
  authCreateSession,
  createSession,
  endSession,
  listSessions,
} from './client';
import { generateIdentity, verify } from '../identity/identity';
import { hexToBytes } from '../identity/hex';
import { signedEnvelopeSchema } from '../signedRequest/types';
import type { SessionSummary } from './types';

const ok = (body: object): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const errResponse = (status: number, body: object = { error: 'x' }): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const sampleSession: SessionSummary = {
  session_id: '11111111-2222-4333-8444-555555555555',
  machine_id: '10.0.0.1',
  credentials: { username: 'root', userType: 'root' },
  parent_session_id: null,
  source_ip: null,
  created_at: '2026-04-26T10:00:00.000Z',
  kind: 'ssh',
};

const STUB_SESSION_ID = '11111111-2222-4333-8444-555555555555';

describe('createSession', () => {
  it('POSTs a signed envelope to /api/sessions and returns session_id', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ session_id: STUB_SESSION_ID }));

    const sessionId = await createSession(
      identity,
      {
        machine_id: '10.0.0.1',
        credentials: { username: 'root', userType: 'root' },
        kind: 'exploit',
      },
      fetchMock,
    );

    expect(sessionId).toBe(STUB_SESSION_ID);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('sends a body matching the SignedEnvelope schema', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ session_id: STUB_SESSION_ID }));

    await createSession(
      identity,
      {
        machine_id: '10.0.0.1',
        credentials: { username: 'root', userType: 'root' },
        kind: 'exploit',
      },
      fetchMock,
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body: unknown = JSON.parse(init.body as string);
    expect(signedEnvelopeSchema.safeParse(body).success).toBe(true);
  });

  it('signs the payload with the provided identity (verifiable on the server)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ session_id: STUB_SESSION_ID }));

    await createSession(
      identity,
      {
        machine_id: '10.0.0.1',
        credentials: { username: 'root', userType: 'root' },
        kind: 'exploit',
      },
      fetchMock,
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const env = JSON.parse(init.body as string) as {
      payload: string;
      publicKey: string;
      signature: string;
    };

    expect(env.publicKey).toBe(identity.publicKeyHex);
    const sig = hexToBytes(env.signature)!;
    const pub = hexToBytes(env.publicKey)!;
    const msg = new TextEncoder().encode(env.payload);
    expect(verify(pub, sig, msg)).toBe(true);
  });

  it('embeds explicit kind in the signed payload when supplied', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ session_id: STUB_SESSION_ID }));

    await createSession(
      identity,
      {
        machine_id: '10.0.0.5',
        credentials: { username: 'ftpuser', userType: 'user' },
        kind: 'ftp',
      },
      fetchMock,
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const env = JSON.parse(init.body as string) as { payload: string };
    const payload = JSON.parse(env.payload) as Record<string, unknown>;
    expect(payload.kind).toBe('ftp');
  });

  it('always embeds kind in the signed payload (now required)', async () => {
    // Server requires kind; client type matches. The previous "default
    // to ssh" client behavior is gone — every caller specifies kind
    // explicitly. Pinned so a regression that drops the field from the
    // wire surfaces loudly.
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ session_id: STUB_SESSION_ID }));

    await createSession(
      identity,
      {
        machine_id: '10.0.0.1',
        credentials: { username: 'root', userType: 'root' },
        kind: 'exploit',
      },
      fetchMock,
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const env = JSON.parse(init.body as string) as { payload: string };
    const payload = JSON.parse(env.payload) as Record<string, unknown>;
    expect(payload.kind).toBe('exploit');
  });

  it('embeds action and request fields in the signed payload', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ session_id: STUB_SESSION_ID }));

    await createSession(
      identity,
      {
        machine_id: '10.0.0.5',
        credentials: { username: 'alice', userType: 'user' },
        kind: 'exploit',
        parent_session_id: '99999999-aaaa-4bbb-8ccc-dddddddddddd',
        source_ip: '10.0.0.1',
      },
      fetchMock,
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const env = JSON.parse(init.body as string) as { payload: string };
    const payload = JSON.parse(env.payload) as Record<string, unknown>;
    expect(payload.action).toBe('createSession');
    expect(payload.machine_id).toBe('10.0.0.5');
    expect(payload.credentials).toEqual({ username: 'alice', userType: 'user' });
    expect(payload.parent_session_id).toBe('99999999-aaaa-4bbb-8ccc-dddddddddddd');
    expect(payload.source_ip).toBe('10.0.0.1');
  });

  it('throws with the status code when the response is non-2xx', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(errResponse(500));

    await expect(
      createSession(
        identity,
        {
          machine_id: '10.0.0.1',
          credentials: { username: 'root', userType: 'root' },
          kind: 'exploit',
        },
        fetchMock,
      ),
    ).rejects.toThrow(/500/);
  });

  it('throws on 401 (signature_invalid / replay / timestamp_skew)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errResponse(401, { error: 'signature_invalid' }));

    await expect(
      createSession(
        identity,
        {
          machine_id: '10.0.0.1',
          credentials: { username: 'root', userType: 'root' },
          kind: 'exploit',
        },
        fetchMock,
      ),
    ).rejects.toThrow();
  });

  it('throws when response is missing session_id', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({}));

    await expect(
      createSession(
        identity,
        {
          machine_id: '10.0.0.1',
          credentials: { username: 'root', userType: 'root' },
          kind: 'exploit',
        },
        fetchMock,
      ),
    ).rejects.toThrow();
  });

  it('throws when session_id is not a string', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ session_id: 42 }));

    await expect(
      createSession(
        identity,
        {
          machine_id: '10.0.0.1',
          credentials: { username: 'root', userType: 'root' },
          kind: 'exploit',
        },
        fetchMock,
      ),
    ).rejects.toThrow();
  });

  it('propagates fetch errors (network failures)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network failure'));

    await expect(
      createSession(
        identity,
        {
          machine_id: '10.0.0.1',
          credentials: { username: 'root', userType: 'root' },
          kind: 'exploit',
        },
        fetchMock,
      ),
    ).rejects.toThrow('network failure');
  });
});

describe('endSession', () => {
  it('POSTs a signed envelope and resolves to undefined on 200', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({}));

    const result = await endSession(
      identity,
      { session_id: STUB_SESSION_ID, reason: 'user_exit' },
      fetchMock,
    );

    expect(result).toBeUndefined();
  });

  it('embeds action="endSession" and request fields in the signed payload', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({}));

    await endSession(identity, { session_id: STUB_SESSION_ID, reason: 'user_exit' }, fetchMock);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const env = JSON.parse(init.body as string) as { payload: string };
    const payload = JSON.parse(env.payload) as Record<string, unknown>;
    expect(payload.action).toBe('endSession');
    expect(payload.session_id).toBe(STUB_SESSION_ID);
    expect(payload.reason).toBe('user_exit');
  });

  it('signs with the provided identity', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({}));

    await endSession(identity, { session_id: STUB_SESSION_ID, reason: 'user_exit' }, fetchMock);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const env = JSON.parse(init.body as string) as {
      payload: string;
      publicKey: string;
      signature: string;
    };
    expect(env.publicKey).toBe(identity.publicKeyHex);
    const sig = hexToBytes(env.signature)!;
    const pub = hexToBytes(env.publicKey)!;
    const msg = new TextEncoder().encode(env.payload);
    expect(verify(pub, sig, msg)).toBe(true);
  });

  it('throws on 404 (session_not_found)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errResponse(404, { error: 'session_not_found' }));

    await expect(
      endSession(identity, { session_id: STUB_SESSION_ID, reason: 'user_exit' }, fetchMock),
    ).rejects.toThrow(/404/);
  });

  it('throws with the status code on any non-2xx', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(errResponse(500));

    await expect(
      endSession(identity, { session_id: STUB_SESSION_ID, reason: 'user_exit' }, fetchMock),
    ).rejects.toThrow(/500/);
  });

  it('propagates fetch errors', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network failure'));

    await expect(
      endSession(identity, { session_id: STUB_SESSION_ID, reason: 'user_exit' }, fetchMock),
    ).rejects.toThrow('network failure');
  });
});

describe('listSessions', () => {
  it('POSTs a signed envelope and returns the sessions array', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ sessions: [sampleSession] }));

    const sessions = await listSessions(identity, fetchMock);

    expect(sessions).toEqual([sampleSession]);
  });

  it('returns an empty array when player has no sessions', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ sessions: [] }));

    expect(await listSessions(identity, fetchMock)).toEqual([]);
  });

  it('embeds action="listSessions" in the signed payload', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ sessions: [] }));

    await listSessions(identity, fetchMock);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const env = JSON.parse(init.body as string) as { payload: string };
    const payload = JSON.parse(env.payload) as Record<string, unknown>;
    expect(payload.action).toBe('listSessions');
    // No filter fields (yet)
    expect(payload.machine_id).toBeUndefined();
  });

  it('signs with the provided identity', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ sessions: [] }));

    await listSessions(identity, fetchMock);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const env = JSON.parse(init.body as string) as {
      payload: string;
      publicKey: string;
      signature: string;
    };
    expect(env.publicKey).toBe(identity.publicKeyHex);
    const sig = hexToBytes(env.signature)!;
    const pub = hexToBytes(env.publicKey)!;
    const msg = new TextEncoder().encode(env.payload);
    expect(verify(pub, sig, msg)).toBe(true);
  });

  it('throws on non-2xx with status code in message', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(errResponse(500));

    await expect(listSessions(identity, fetchMock)).rejects.toThrow(/500/);
  });

  it('throws when response is missing sessions field', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({}));

    await expect(listSessions(identity, fetchMock)).rejects.toThrow();
  });

  it('throws when sessions is not an array', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ sessions: 'oops' }));

    await expect(listSessions(identity, fetchMock)).rejects.toThrow();
  });

  it('propagates fetch errors', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network failure'));

    await expect(listSessions(identity, fetchMock)).rejects.toThrow('network failure');
  });
});

// ----- authCreateSession --------------------------------------------------
//
// Atomic credential validation + session creation. Returns a Result type
// (NOT throws) for the credentials-failure case so call sites can branch
// on "wrong password" vs "infrastructure error" without parsing exception
// messages. Other failure modes (network, malformed response) still throw.

describe('authCreateSession', () => {
  const baseRequest = {
    machine_id: 'target-host',
    kind: 'ssh' as const,
    username: 'alice',
    auth: { method: 'password' as const, password: 'secret' },
  };

  it('returns ok with session_id and userType on 201', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ session_id: STUB_SESSION_ID, userType: 'user' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await authCreateSession(identity, baseRequest, fetchMock);

    expect(result).toEqual({
      ok: true,
      session_id: STUB_SESSION_ID,
      userType: 'user',
    });
  });

  it('returns ok:false reason=invalid_credentials on 401', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errResponse(401, { error: 'invalid_credentials' }));

    const result = await authCreateSession(identity, baseRequest, fetchMock);

    expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('returns ok:false reason=rate_limited on 429', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errResponse(429, { error: 'rate_limited' }));

    const result = await authCreateSession(identity, baseRequest, fetchMock);

    expect(result).toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('throws on 500 (server error — not a credentials failure)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errResponse(500, { error: 'fs_lookup_failed' }));

    await expect(authCreateSession(identity, baseRequest, fetchMock)).rejects.toThrow(/500/);
  });

  it('throws on signature_invalid 401 — distinct from invalid_credentials body', async () => {
    // Both server paths return 401, but the body differs. The client
    // distinguishes: invalid_credentials → ok:false (expected failure
    // mode), signature_invalid → throw (the client itself is broken).
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errResponse(401, { error: 'signature_invalid' }));

    await expect(authCreateSession(identity, baseRequest, fetchMock)).rejects.toThrow();
  });

  it('signs the envelope with the action=authCreateSession and provided fields', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ session_id: STUB_SESSION_ID, userType: 'user' }), {
        status: 201,
      }),
    );

    await authCreateSession(identity, baseRequest, fetchMock);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const env = JSON.parse(init.body as string) as { payload: string };
    const payload = JSON.parse(env.payload) as Record<string, unknown>;
    expect(payload.action).toBe('authCreateSession');
    expect(payload.machine_id).toBe('target-host');
    expect(payload.kind).toBe('ssh');
    expect(payload.username).toBe('alice');
    expect(payload.auth).toEqual({ method: 'password', password: 'secret' });
  });

  it('passes savedKey auth method and targetIp through the wire', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ session_id: STUB_SESSION_ID, userType: 'user' }), {
        status: 201,
      }),
    );

    await authCreateSession(
      identity,
      {
        ...baseRequest,
        auth: { method: 'savedKey', fingerprint: 'abc123', targetIp: '10.0.0.5' },
      },
      fetchMock,
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const env = JSON.parse(init.body as string) as { payload: string };
    const payload = JSON.parse(env.payload) as Record<string, unknown>;
    expect(payload.auth).toEqual({
      method: 'savedKey',
      fingerprint: 'abc123',
      targetIp: '10.0.0.5',
    });
  });

  it('passes optional parent_session_id and source_ip through', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ session_id: STUB_SESSION_ID, userType: 'user' }), {
        status: 201,
      }),
    );

    await authCreateSession(
      identity,
      {
        ...baseRequest,
        parent_session_id: '00000000-0000-0000-0000-000000000000',
        source_ip: '192.168.1.10',
      },
      fetchMock,
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const env = JSON.parse(init.body as string) as { payload: string };
    const payload = JSON.parse(env.payload) as Record<string, unknown>;
    expect(payload.parent_session_id).toBe('00000000-0000-0000-0000-000000000000');
    expect(payload.source_ip).toBe('192.168.1.10');
  });

  it('throws when 201 response is missing session_id', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ userType: 'user' }), { status: 201 }));

    await expect(authCreateSession(identity, baseRequest, fetchMock)).rejects.toThrow(
      /malformed response/,
    );
  });

  it('throws when 201 response is missing userType', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ session_id: STUB_SESSION_ID }), { status: 201 }),
      );

    await expect(authCreateSession(identity, baseRequest, fetchMock)).rejects.toThrow(
      /malformed response/,
    );
  });

  it('propagates fetch errors (network failures)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network failure'));

    await expect(authCreateSession(identity, baseRequest, fetchMock)).rejects.toThrow(
      'network failure',
    );
  });
});

describe('authCreateNcSession', () => {
  // Distinct wrapper because the nc-pidfile branch returns username +
  // homePath alongside session_id and userType (server reads them from
  // the pidfile content).

  const baseRequest = {
    machine_id: 'target-host',
    port: 4444,
  };

  const ncOk = (body: object) =>
    new Response(JSON.stringify(body), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });

  it('returns ok with session_id, username, userType, homePath on 201', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      ncOk({
        session_id: STUB_SESSION_ID,
        username: 'alice',
        userType: 'user',
        homePath: '/home/alice',
      }),
    );

    const result = await authCreateNcSession(identity, baseRequest, fetchMock);

    expect(result).toEqual({
      ok: true,
      session_id: STUB_SESSION_ID,
      username: 'alice',
      userType: 'user',
      homePath: '/home/alice',
    });
  });

  it('returns ok:false reason=invalid_credentials on 401', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errResponse(401, { error: 'invalid_credentials' }));

    const result = await authCreateNcSession(identity, baseRequest, fetchMock);

    expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('returns ok:false reason=rate_limited on 429', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errResponse(429, { error: 'rate_limited' }));

    const result = await authCreateNcSession(identity, baseRequest, fetchMock);

    expect(result).toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('throws on 500', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errResponse(500, { error: 'fs_lookup_failed' }));

    await expect(authCreateNcSession(identity, baseRequest, fetchMock)).rejects.toThrow(/500/);
  });

  it('signs envelope with kind=nc, method=pidfile, sentinel username', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      ncOk({
        session_id: STUB_SESSION_ID,
        username: 'alice',
        userType: 'user',
        homePath: '/home/alice',
      }),
    );

    await authCreateNcSession(identity, baseRequest, fetchMock);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const env = JSON.parse(init.body as string) as { payload: string };
    const payload = JSON.parse(env.payload) as Record<string, unknown>;
    expect(payload.action).toBe('authCreateSession');
    expect(payload.kind).toBe('nc');
    expect(payload.username).toBe('nc');
    expect(payload.auth).toEqual({ method: 'pidfile', port: 4444 });
  });

  it('passes parent_session_id and source_ip through', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      ncOk({
        session_id: STUB_SESSION_ID,
        username: 'alice',
        userType: 'user',
        homePath: '/home/alice',
      }),
    );

    await authCreateNcSession(
      identity,
      {
        ...baseRequest,
        parent_session_id: '00000000-0000-0000-0000-000000000000',
        source_ip: '192.168.1.10',
      },
      fetchMock,
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const env = JSON.parse(init.body as string) as { payload: string };
    const payload = JSON.parse(env.payload) as Record<string, unknown>;
    expect(payload.parent_session_id).toBe('00000000-0000-0000-0000-000000000000');
    expect(payload.source_ip).toBe('192.168.1.10');
  });

  it('throws when 201 response is missing username', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      ncOk({
        session_id: STUB_SESSION_ID,
        userType: 'user',
        homePath: '/home/alice',
      }),
    );

    await expect(authCreateNcSession(identity, baseRequest, fetchMock)).rejects.toThrow(
      /malformed response/,
    );
  });

  it('throws when 201 response has invalid userType', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      ncOk({
        session_id: STUB_SESSION_ID,
        username: 'alice',
        userType: 'admin',
        homePath: '/home/alice',
      }),
    );

    await expect(authCreateNcSession(identity, baseRequest, fetchMock)).rejects.toThrow(
      /malformed response/,
    );
  });
});
