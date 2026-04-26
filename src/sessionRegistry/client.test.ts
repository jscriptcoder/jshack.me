import { describe, it, expect, vi } from 'vitest';
import { createSession, endSession, listSessions } from './client';
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
};

const STUB_SESSION_ID = '11111111-2222-4333-8444-555555555555';

describe('createSession', () => {
  it('POSTs a signed envelope to /api/sessions and returns session_id', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ session_id: STUB_SESSION_ID }));

    const sessionId = await createSession(
      identity,
      { machine_id: '10.0.0.1', credentials: { username: 'root', userType: 'root' } },
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
      { machine_id: '10.0.0.1', credentials: { username: 'root', userType: 'root' } },
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
      { machine_id: '10.0.0.1', credentials: { username: 'root', userType: 'root' } },
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

  it('embeds action and request fields in the signed payload', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ session_id: STUB_SESSION_ID }));

    await createSession(
      identity,
      {
        machine_id: '10.0.0.5',
        credentials: { username: 'alice', userType: 'user' },
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
        { machine_id: '10.0.0.1', credentials: { username: 'root', userType: 'root' } },
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
        { machine_id: '10.0.0.1', credentials: { username: 'root', userType: 'root' } },
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
        { machine_id: '10.0.0.1', credentials: { username: 'root', userType: 'root' } },
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
        { machine_id: '10.0.0.1', credentials: { username: 'root', userType: 'root' } },
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
        { machine_id: '10.0.0.1', credentials: { username: 'root', userType: 'root' } },
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
