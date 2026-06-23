import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  authCreateServerSession,
  authCreateServerSessionInnerGateway,
  authCreateServerSessionPublic,
  authCreateServerSessionSameLan,
  authElevateServerSession,
  createServerSession,
  endServerSession,
  listServerSessions,
  type SessionsClientDeps,
} from './sessionsApi';
import { generateIdentity } from '../core/identity/identity';
import { computeWorkstationId } from '../core/identity/workstation';
import { verifySignedRequest } from '../core/signedRequest/verify';
import { asEpochMs, asMachineId, asPlayerKeyHex } from '../core/types';
import type { Session } from '../core/commands/types';

const ENDPOINT = 'http://test.local/api/sessions';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const makeDeps = (
  fetchImpl: typeof fetch,
  over: Partial<SessionsClientDeps> = {},
): SessionsClientDeps => {
  const identity = generateIdentity();
  return {
    identity,
    machineId: asMachineId(computeWorkstationId('skylab', identity.publicKeyHex)),
    endpoint: ENDPOINT,
    fetchImpl,
    ...over,
  };
};

const sessionFor = (deps: SessionsClientDeps, over: Partial<Session> = {}): Session => ({
  id: 'su-root-1700000000000',
  playerKey: asPlayerKeyHex(deps.identity.publicKeyHex),
  machineId: deps.machineId,
  username: 'root',
  userType: 'root',
  kind: 'su',
  createdAt: asEpochMs(0),
  ...over,
});

const sentEnvelope = (fetchSpy: ReturnType<typeof vi.fn>): unknown =>
  JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);

const verifyPayload = (envelope: unknown) =>
  verifySignedRequest(envelope, z.looseObject({ action: z.string() }), {
    nonceStore: async () => ({ fresh: true }),
  });

describe('createServerSession', () => {
  it('POSTs a real signed createSession envelope with the session fields', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await createServerSession(deps, sessionFor(deps), 'seed-session');

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } }),
    );
    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected a verified envelope');
    expect(verified.payload).toMatchObject({
      action: 'createSession',
      machine_id: deps.machineId,
      session_id: 'su-root-1700000000000',
      credentials: { username: 'root', userType: 'root' },
      kind: 'su',
      parent_session_id: 'seed-session',
    });
  });

  it('sends parent_session_id null when there is no parent', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    await createServerSession(deps, sessionFor(deps), null);

    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected a verified envelope');
    expect((verified.payload as Record<string, unknown>).parent_session_id).toBeNull();
  });

  it('posts to /api/sessions by default when no endpoint is configured', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true }));
    const identity = generateIdentity();
    // Built without `endpoint` so the adapter falls back to its DEFAULT_ENDPOINT.
    const deps: SessionsClientDeps = {
      identity,
      machineId: asMachineId(computeWorkstationId('skylab', identity.publicKeyHex)),
      fetchImpl: fetchSpy as unknown as typeof fetch,
    };

    await createServerSession(deps, sessionFor(deps), null);

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/sessions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('maps a 403 to a no_session result', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(403, { error: 'no_session' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await createServerSession(deps, sessionFor(deps), null)).toEqual({
      ok: false,
      error: 'no_session',
    });
  });

  it('maps a non-ok non-403 response to network_error', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(500, { error: 'insert_failed' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await createServerSession(deps, sessionFor(deps), null)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });

  it('maps a thrown fetch (offline) to network_error', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('offline');
    });
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await createServerSession(deps, sessionFor(deps), null)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });
});

describe('authCreateServerSession', () => {
  const params = {
    sessionId: 'ssh-root-1700000000000',
    essid: 'BEAN-THERE-WIFI',
    targetIp: '192.168.50.108',
    username: 'root',
    password: 'hunter2',
    parentSessionId: 'su-root-1',
    sourceIp: '192.168.50.23',
  };

  it('POSTs a signed authCreateSession envelope and returns the server-derived userType', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true, userType: 'root' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await authCreateServerSession(deps, params);

    expect(result).toEqual({ ok: true, userType: 'root' });
    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected a verified envelope');
    expect(verified.payload).toMatchObject({
      action: 'authCreateSession',
      session_id: 'ssh-root-1700000000000',
      essid: 'BEAN-THERE-WIFI',
      target_ip: '192.168.50.108',
      username: 'root',
      password: 'hunter2',
      parent_session_id: 'su-root-1',
      source_ip: '192.168.50.23',
    });
  });

  it('passes through a non-root userType (user)', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true, userType: 'user' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSession(deps, params)).toEqual({ ok: true, userType: 'user' });
  });

  it('passes through the guest userType', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true, userType: 'guest' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSession(deps, params)).toEqual({ ok: true, userType: 'guest' });
  });

  it('maps a 401 to invalid_credentials (bad password or unknown user)', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(401, { error: 'invalid_credentials' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSession(deps, params)).toEqual({
      ok: false,
      error: 'invalid_credentials',
    });
  });

  it('maps a 404 to host_unreachable', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(404, { error: 'host_unreachable' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSession(deps, params)).toEqual({
      ok: false,
      error: 'host_unreachable',
    });
  });

  it('maps any other non-ok status to network_error', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(500, { error: 'insert_failed' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSession(deps, params)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });

  it('maps a 200 with a missing/garbage userType to network_error (never trusts a malformed ok)', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true, userType: 'superuser' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSession(deps, params)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });

  it('maps a thrown fetch (offline) to network_error', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('offline');
    });
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSession(deps, params)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });
});

describe('authCreateServerSessionPublic', () => {
  const params = {
    sessionId: 'ssh-guest-1700000000000',
    target: '203.0.113.7',
    username: 'guest',
    password: 'guestpw',
    port: 2222,
    parentSessionId: 'su-root-1',
    sourceIp: '192.168.50.23',
  };

  it('POSTs a signed authCreateSessionPublic envelope and returns the userType + owner machine id', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { ok: true, userType: 'guest', machine_id: 'skylab-deadbeef' }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await authCreateServerSessionPublic(deps, params);

    expect(result).toEqual({ ok: true, userType: 'guest', machineId: 'skylab-deadbeef' });
    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected a verified envelope');
    expect(verified.payload).toMatchObject({
      action: 'authCreateSessionPublic',
      session_id: 'ssh-guest-1700000000000',
      target: '203.0.113.7',
      username: 'guest',
      password: 'guestpw',
      port: 2222,
      parent_session_id: 'su-root-1',
      source_ip: '192.168.50.23',
    });
    // The target is a public IP resolved server-side — no own-machine scope is sent.
    expect(verified.payload).not.toHaveProperty('machine_id');
  });

  it('maps a 401 to invalid_credentials', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(401, { error: 'invalid_credentials' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSessionPublic(deps, params)).toEqual({
      ok: false,
      error: 'invalid_credentials',
    });
  });

  it('maps a 404 to host_unreachable', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(404, { error: 'host_unreachable' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSessionPublic(deps, params)).toEqual({
      ok: false,
      error: 'host_unreachable',
    });
  });

  it('maps any other non-ok status to network_error', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(500, { error: 'insert_failed' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSessionPublic(deps, params)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });

  it('maps a 200 with a garbage userType to network_error', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { ok: true, userType: 'superuser', machine_id: 'skylab-deadbeef' }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSessionPublic(deps, params)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });

  it('maps a 200 with a missing machine_id to network_error (never lands a session with no target id)', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true, userType: 'guest' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSessionPublic(deps, params)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });

  it('maps a thrown fetch (offline) to network_error', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('offline');
    });
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSessionPublic(deps, params)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });
});

describe('authCreateServerSessionSameLan', () => {
  const params = {
    sessionId: 'ssh-guest-1700000000000',
    essid: 'SHARED-LAN-WIFI',
    targetIp: '192.168.29.42',
    username: 'guest',
    password: 'guestpw',
    port: 22,
    parentSessionId: 'shell-1',
    sourceIp: '192.168.29.50',
  };

  it('POSTs a signed authCreateSessionSameLan envelope and returns the userType + owner machine id', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { ok: true, userType: 'guest', machine_id: 'skylab-deadbeef' }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await authCreateServerSessionSameLan(deps, params);

    expect(result).toEqual({ ok: true, userType: 'guest', machineId: 'skylab-deadbeef' });
    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected a verified envelope');
    expect(verified.payload).toMatchObject({
      action: 'authCreateSessionSameLan',
      session_id: 'ssh-guest-1700000000000',
      essid: 'SHARED-LAN-WIFI',
      target_ip: '192.168.29.42',
      username: 'guest',
      password: 'guestpw',
      port: 22,
      parent_session_id: 'shell-1',
      source_ip: '192.168.29.50',
    });
    // A LAN IP is resolved through the ESSID occupancy server-side — no own-machine scope.
    expect(verified.payload).not.toHaveProperty('machine_id');
  });

  it('maps a 401 to invalid_credentials', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(401, { error: 'invalid_credentials' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSessionSameLan(deps, params)).toEqual({
      ok: false,
      error: 'invalid_credentials',
    });
  });

  it('maps a 404 to host_unreachable', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(404, { error: 'host_unreachable' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSessionSameLan(deps, params)).toEqual({
      ok: false,
      error: 'host_unreachable',
    });
  });

  it('maps a 403 (non-occupant) to network_error', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(403, { error: 'not_an_occupant' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSessionSameLan(deps, params)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });

  it('maps a 200 with a garbage userType to network_error', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { ok: true, userType: 'superuser', machine_id: 'skylab-deadbeef' }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSessionSameLan(deps, params)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });

  it('maps a 200 with a missing machine_id to network_error (never lands a session with no target id)', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true, userType: 'guest' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSessionSameLan(deps, params)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });

  it('maps a thrown fetch (offline) to network_error', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('offline');
    });
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSessionSameLan(deps, params)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });
});

describe('authCreateServerSessionInnerGateway', () => {
  const params = {
    sessionId: 'ssh-guest-1700000000000',
    essid: 'BEAN-THERE-WIFI',
    target: '192.168.29.25',
    username: 'guest',
    password: 'guestpw',
    port: 2222,
    parentSessionId: 'shell-1',
    sourceIp: '192.168.29.50',
  };

  it('POSTs a signed authCreateSessionInnerGateway envelope and returns the userType + deep host id', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { ok: true, userType: 'guest', machine_id: 'iot-cam-deadbeef' }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await authCreateServerSessionInnerGateway(deps, params);

    expect(result).toEqual({ ok: true, userType: 'guest', machineId: 'iot-cam-deadbeef' });
    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected a verified envelope');
    expect(verified.payload).toMatchObject({
      action: 'authCreateSessionInnerGateway',
      session_id: 'ssh-guest-1700000000000',
      essid: 'BEAN-THERE-WIFI',
      target: '192.168.29.25',
      username: 'guest',
      password: 'guestpw',
      port: 2222,
      parent_session_id: 'shell-1',
      source_ip: '192.168.29.50',
    });
    // The gateway + deep host are regenerated server-side from the verified key — no
    // own-machine scope on the envelope.
    expect(verified.payload).not.toHaveProperty('machine_id');
  });

  it('maps a 401 to invalid_credentials', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(401, { error: 'invalid_credentials' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSessionInnerGateway(deps, params)).toEqual({
      ok: false,
      error: 'invalid_credentials',
    });
  });

  it('maps a 404 to host_unreachable', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(404, { error: 'host_unreachable' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSessionInnerGateway(deps, params)).toEqual({
      ok: false,
      error: 'host_unreachable',
    });
  });

  it('maps any other non-ok status to network_error', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(500, { error: 'patches_lookup_failed' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSessionInnerGateway(deps, params)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });

  it('maps a 200 with a garbage userType to network_error', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { ok: true, userType: 'superuser', machine_id: 'iot-cam-deadbeef' }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSessionInnerGateway(deps, params)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });

  it('maps a 200 with a missing machine_id to network_error (never lands a session with no target id)', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true, userType: 'guest' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSessionInnerGateway(deps, params)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });

  it('maps a thrown fetch (offline) to network_error', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('offline');
    });
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authCreateServerSessionInnerGateway(deps, params)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });
});

describe('authElevateServerSession', () => {
  const params = {
    sessionId: 'su-root-1700000000000',
    machineId: 'skylab-deadbeef',
    username: 'root',
    password: 'matrix1999',
    parentSessionId: 'ssh-guest-1',
    sourceIp: '192.168.50.23',
    fromUser: 'guest',
  };

  it('POSTs a signed suElevate envelope and returns the server-derived userType', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true, userType: 'root' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await authElevateServerSession(deps, params);

    expect(result).toEqual({ ok: true, userType: 'root' });
    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected a verified envelope');
    expect(verified.payload).toMatchObject({
      action: 'suElevate',
      session_id: 'su-root-1700000000000',
      machine_id: 'skylab-deadbeef',
      username: 'root',
      password: 'matrix1999',
      parent_session_id: 'ssh-guest-1',
      source_ip: '192.168.50.23',
      from_user: 'guest',
    });
  });

  it('passes through the guest userType', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true, userType: 'guest' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authElevateServerSession(deps, params)).toEqual({ ok: true, userType: 'guest' });
  });

  it('maps a 401 to invalid_credentials (bad password or unknown user)', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(401, { error: 'invalid_credentials' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authElevateServerSession(deps, params)).toEqual({
      ok: false,
      error: 'invalid_credentials',
    });
  });

  it('maps a 404 to host_unreachable', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(404, { error: 'host_unreachable' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authElevateServerSession(deps, params)).toEqual({
      ok: false,
      error: 'host_unreachable',
    });
  });

  it('maps any other non-ok status to network_error', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(500, { error: 'insert_failed' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authElevateServerSession(deps, params)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });

  it('maps a 200 with a missing/garbage userType to network_error (never trusts a malformed ok)', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true, userType: 'superuser' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authElevateServerSession(deps, params)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });

  it('maps a thrown fetch (offline) to network_error', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('offline');
    });
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await authElevateServerSession(deps, params)).toEqual({
      ok: false,
      error: 'network_error',
    });
  });
});

describe('endServerSession', () => {
  it('POSTs a signed endSession envelope carrying the session_id', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await endServerSession(deps, 'su-root-1700000000000');

    expect(result).toEqual({ ok: true });
    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected a verified envelope');
    expect(verified.payload).toMatchObject({
      action: 'endSession',
      session_id: 'su-root-1700000000000',
    });
  });

  it('maps a 403 to a no_session result', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(403, { error: 'no_session' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await endServerSession(deps, 'su-root-1700000000000')).toEqual({
      ok: false,
      error: 'no_session',
    });
  });

  it('maps a non-ok non-403 response to network_error', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(500, { error: 'update_failed' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await endServerSession(deps, 'su-root-1700000000000')).toEqual({
      ok: false,
      error: 'network_error',
    });
  });

  it('maps a thrown fetch (offline) to network_error', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('offline');
    });
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await endServerSession(deps, 'su-root-1700000000000')).toEqual({
      ok: false,
      error: 'network_error',
    });
  });
});

describe('listServerSessions', () => {
  it('POSTs a signed listSessions envelope (no machine scope) and maps rows to Sessions', async () => {
    const summary = {
      session_id: 'su-root-1700000000000',
      machine_id: 'skylab-deadbeef',
      credentials: { username: 'root', userType: 'root' },
      parent_session_id: 'seed-session',
      source_ip: null,
      kind: 'su',
      created_at: '2026-06-07T14:32:01.000Z',
    };
    const fetchSpy = vi.fn(async () => jsonResponse(200, { sessions: [summary] }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const sessions = await listServerSessions(deps);

    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected a verified envelope');
    expect(verified.payload).toMatchObject({ action: 'listSessions' });
    // The hop chain spans machines (su on the own box + ssh hops), so the read
    // is scoped by player_key alone — the client sends no machine filter.
    expect(verified.payload).not.toHaveProperty('machine_id');

    expect(sessions).toEqual([
      {
        id: 'su-root-1700000000000',
        playerKey: deps.identity.publicKeyHex,
        machineId: 'skylab-deadbeef',
        username: 'root',
        userType: 'root',
        kind: 'su',
        createdAt: Date.parse('2026-06-07T14:32:01.000Z'),
      },
    ]);
  });

  it('returns [] on a non-ok response even when it carries rows (never trusts a rejected read)', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(403, {
        sessions: [
          {
            session_id: 'su-root-1700000000000',
            machine_id: 'skylab-deadbeef',
            credentials: { username: 'root', userType: 'root' },
            parent_session_id: null,
            source_ip: null,
            kind: 'su',
            created_at: '2026-06-07T14:32:01.000Z',
          },
        ],
      }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await listServerSessions(deps)).toEqual([]);
  });

  it('returns [] when the body has no sessions field', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, {}));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await listServerSessions(deps)).toEqual([]);
  });

  it('returns [] on a thrown fetch (offline)', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('offline');
    });
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await listServerSessions(deps)).toEqual([]);
  });
});
