import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  connectDatabase,
  runDatabaseStatement,
  authCreateServerSession,
  authCreateServerSessionInnerGateway,
  authCreateServerSessionPublic,
  authCreateServerSessionSameLan,
  authElevateServerSession,
  createServerSession,
  endServerSession,
  listServerSessions,
  runExploit,
  type SessionsClientDeps,
} from './sessionsApi';
import { generateIdentity } from '../core/identity/identity';
import { computeWorkstationId } from '../core/identity/workstation';
import { verifySignedRequest } from '../core/signedRequest/verify';
import { asEpochMs, asMachineId, asPlayerKeyHex } from '../core/types';
import type { MysqlConnectParams, Session } from '../core/commands/types';

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

/**
 * The exploit door sends no credential and gets a capability back, so what this
 * adapter must not do is let a SERVER fault read as a hardened target. The server's
 * two 404s are two different facts — one says the box was not there, the other says
 * nothing there opened — and everything else is a fault, not an answer about the box.
 */
describe('runExploit', () => {
  const params = {
    sessionId: 'exploit-22-1700000000000',
    essid: 'BEAN-THERE-WIFI',
    targetIp: '192.168.1.31',
    port: 22,
    parentSessionId: 'shell-1',
    sourceIp: '192.168.1.50',
  };

  it('POSTs a signed exploitCreateSession envelope carrying an address and a port and no credential', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        cve: 'CVE-2026-0184',
        severity: 'critical',
        username: 'root',
        userType: 'root',
        kind: 'exploit',
      }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    const result = await runExploit(deps, params);

    expect(result).toEqual({
      ok: true,
      cve: 'CVE-2026-0184',
      severity: 'critical',
      username: 'root',
      userType: 'root',
      kind: 'exploit',
    });
    const verified = await verifyPayload(sentEnvelope(fetchSpy));
    if (!verified.ok) throw new Error('expected a verified envelope');
    expect(verified.payload).toMatchObject({
      action: 'exploitCreateSession',
      session_id: 'exploit-22-1700000000000',
      essid: 'BEAN-THERE-WIFI',
      target_ip: '192.168.1.31',
      port: 22,
      parent_session_id: 'shell-1',
      source_ip: '192.168.1.50',
    });
    // Nothing about the hole travels outward: the server derives all of it.
    expect(verified.payload).not.toHaveProperty('username');
    expect(verified.payload).not.toHaveProperty('password');
    expect(verified.payload).not.toHaveProperty('cve');
  });

  it('carries back the weaker grant as its own kind', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        cve: 'CVE-2026-0912',
        severity: 'medium',
        username: 'guest',
        userType: 'guest',
        kind: 'exploit_limited',
      }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, params)).toMatchObject({ kind: 'exploit_limited' });
  });

  it('maps the refusal 404 to not_vulnerable', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(404, { error: 'not_vulnerable' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, params)).toEqual({ ok: false, error: 'not_vulnerable' });
  });

  it('keeps the unreachable 404 apart from the refusal', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(404, { error: 'host_unreachable' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, params)).toEqual({ ok: false, error: 'host_unreachable' });
  });

  it('maps a server fault to network_error rather than to a target that held', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(500, { error: 'insert_failed' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, params)).toEqual({ ok: false, error: 'network_error' });
  });

  it('maps a rejected envelope to network_error', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(401, { error: 'bad_signature' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, params)).toEqual({ ok: false, error: 'network_error' });
  });

  it('refuses to open a shell on a 200 whose body is not a grant', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        cve: 'CVE-2026-0184',
        severity: 'catastrophic',
        username: 'root',
        userType: 'root',
        kind: 'exploit',
      }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, params)).toEqual({ ok: false, error: 'network_error' });
  });

  it('refuses a 200 that names a session kind no exploit can mint', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        cve: 'CVE-2026-0184',
        severity: 'critical',
        username: 'root',
        userType: 'root',
        kind: 'ssh',
      }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, params)).toEqual({ ok: false, error: 'network_error' });
  });

  it('maps a thrown fetch (offline) to network_error', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('offline');
    });
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, params)).toEqual({ ok: false, error: 'network_error' });
  });

  it('carries back a file_read grant as the file it read, not as a shell', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        effect: 'file_read',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        read: { ok: true, content: 'root:x:0:0:root:/root:/bin/bash' },
      }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, { ...params, arg: '/etc/passwd' })).toEqual({
      ok: true,
      effect: 'file_read',
      cve: 'CVE-2026-0184',
      severity: 'high',
      tier: 'user',
      read: { ok: true, content: 'root:x:0:0:root:/root:/bin/bash' },
    });
  });

  it('carries back a request for a path when a read hole is fired blind', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        effect: 'file_read',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        needsArg: true,
      }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, params)).toEqual({
      ok: true,
      effect: 'file_read',
      cve: 'CVE-2026-0184',
      severity: 'high',
      tier: 'user',
      needsArg: true,
    });
  });

  it('carries back a reset as the credential it left behind, not as a shell', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        effect: 'password_reset',
        cve: 'CVE-2026-0122135',
        severity: 'low',
        tier: 'guest',
        username: 'guest',
        password: 'pwned-2135-guest',
      }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, params)).toEqual({
      ok: true,
      effect: 'password_reset',
      cve: 'CVE-2026-0122135',
      severity: 'low',
      tier: 'guest',
      username: 'guest',
      password: 'pwned-2135-guest',
    });
  });

  it('refuses a reset that names no password rather than announcing a lock it holds no key to', async () => {
    // The plaintext IS the prize. A body without one is not a reset, and letting it
    // through would tell the player the account had moved while handing them nothing
    // to open it with.
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        effect: 'password_reset',
        cve: 'CVE-2026-0122135',
        severity: 'low',
        tier: 'guest',
        username: 'guest',
      }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, params)).toEqual({ ok: false, error: 'network_error' });
  });

  it('signs the named path into the envelope, and omits it entirely when none was named', async () => {
    const named = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        effect: 'file_read',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        read: { ok: true, content: '' },
      }),
    );
    await runExploit(makeDeps(named as unknown as typeof fetch), { ...params, arg: '/etc/passwd' });
    const withPath = await verifyPayload(sentEnvelope(named));
    if (!withPath.ok) throw new Error('expected a verified envelope');
    expect(withPath.payload).toMatchObject({ arg: '/etc/passwd' });

    const bare = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        cve: 'CVE-2026-0184',
        severity: 'critical',
        username: 'root',
        userType: 'root',
        kind: 'exploit',
      }),
    );
    await runExploit(makeDeps(bare as unknown as typeof fetch), params);
    const withoutPath = await verifyPayload(sentEnvelope(bare));
    if (!withoutPath.ok) throw new Error('expected a verified envelope');
    // Absent, not present-and-null: a signed key the server did not need would be a
    // field to verify, and it is how the server tells a blind fire from a targeted one.
    expect(withoutPath.payload).not.toHaveProperty('arg');
  });

  it('refuses a 200 whose read body is malformed rather than inventing an empty read', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        effect: 'file_read',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'superuser',
        read: { ok: true, content: 'x' },
      }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, params)).toEqual({ ok: false, error: 'network_error' });
  });

  it('carries back a dir_list grant as the entries it listed, not as a shell', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        effect: 'dir_list',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        list: { ok: true, entries: ['passwd', 'shadow'] },
      }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, { ...params, arg: '/etc' })).toEqual({
      ok: true,
      effect: 'dir_list',
      cve: 'CVE-2026-0184',
      severity: 'high',
      tier: 'user',
      list: { ok: true, entries: ['passwd', 'shadow'] },
    });
  });

  it('carries back a request for a path when a dir_list hole is fired blind', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        effect: 'dir_list',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        needsArg: true,
      }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, params)).toEqual({
      ok: true,
      effect: 'dir_list',
      cve: 'CVE-2026-0184',
      severity: 'high',
      tier: 'user',
      needsArg: true,
    });
  });

  it('refuses a dir_list body naming a list error it does not define, rather than inventing a list', async () => {
    // `is_directory` is a file read's failure, never a directory list's — a list that
    // failed for a reason the contract does not carry is a fault, not an empty listing.
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        effect: 'dir_list',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        list: { ok: false, error: 'is_directory' },
      }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, params)).toEqual({ ok: false, error: 'network_error' });
  });

  it('carries back a write as the bytes it planted, not as a shell', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        effect: 'file_write',
        cve: 'CVE-2026-0712758',
        severity: 'medium',
        tier: 'guest',
        write: { ok: true, bytes: 27, path: '/tmp/loot.txt' },
      }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(
      await runExploit(deps, {
        ...params,
        arg: '/home/attacker/loot.txt:/tmp/loot.txt',
        content: 'the combination is 12-24-36\n',
      }),
    ).toEqual({
      ok: true,
      effect: 'file_write',
      cve: 'CVE-2026-0712758',
      severity: 'medium',
      tier: 'guest',
      write: { ok: true, bytes: 27, path: '/tmp/loot.txt' },
    });
  });

  it('carries back a write the target refused, naming the path it refused', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        effect: 'file_write',
        cve: 'CVE-2026-0712758',
        severity: 'medium',
        tier: 'guest',
        write: { ok: false, error: 'permission_denied', path: '/etc/passwd' },
      }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, { ...params, arg: '/home/a/x:/etc/passwd', content: 'x' })).toEqual(
      {
        ok: true,
        effect: 'file_write',
        cve: 'CVE-2026-0712758',
        severity: 'medium',
        tier: 'guest',
        write: { ok: false, error: 'permission_denied', path: '/etc/passwd' },
      },
    );
  });

  it('carries back a request for a pair when a write hole is fired blind', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        effect: 'file_write',
        cve: 'CVE-2026-0712758',
        severity: 'medium',
        tier: 'guest',
        needsArg: true,
      }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, params)).toEqual({
      ok: true,
      effect: 'file_write',
      cve: 'CVE-2026-0712758',
      severity: 'medium',
      tier: 'guest',
      needsArg: true,
    });
  });

  it('signs the local bytes into the envelope, and omits them when the token was not a pair', async () => {
    const withBytes = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        effect: 'file_write',
        cve: 'CVE-2026-0712758',
        severity: 'medium',
        tier: 'guest',
        write: { ok: true, bytes: 4, path: '/tmp/x' },
      }),
    );
    await runExploit(makeDeps(withBytes as unknown as typeof fetch), {
      ...params,
      arg: '/home/a/x:/tmp/x',
      content: 'abcd',
    });
    const signed = await verifyPayload(sentEnvelope(withBytes));
    if (!signed.ok) throw new Error('expected a verified envelope');
    expect(signed.payload).toMatchObject({ arg: '/home/a/x:/tmp/x', content: 'abcd' });

    const bare = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        effect: 'file_read',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        read: { ok: true, content: '' },
      }),
    );
    await runExploit(makeDeps(bare as unknown as typeof fetch), { ...params, arg: '/etc/passwd' });
    const withoutBytes = await verifyPayload(sentEnvelope(bare));
    if (!withoutBytes.ok) throw new Error('expected a verified envelope');
    // Absent on UNDEFINED, never on emptiness: an empty string is a real payload — it is
    // how a player plants an empty file — so dropping it for being falsy would quietly
    // turn a write into a fire that carried nothing.
    expect(withoutBytes.payload).not.toHaveProperty('content');
  });

  it('refuses a write body that names no destination rather than reporting a file it cannot point to', async () => {
    // Where the bytes landed IS the news — it is the only way the player finds the file
    // again. A body without it would have the tool print a destination of `undefined` to
    // the one person who needs to go looking.
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        effect: 'file_write',
        cve: 'CVE-2026-0712758',
        severity: 'medium',
        tier: 'guest',
        write: { ok: true, bytes: 27 },
      }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await runExploit(deps, params)).toEqual({ ok: false, error: 'network_error' });
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


/**
 * The database door's client half.
 *
 * Two things it must carry that no other door does: the PORT, because through a NAT
 * forward the port is the whole of the address, and the NAME of the box that answered,
 * because a deep box's address is absent from the generated LAN and the greeting has
 * nothing else to greet with.
 *
 * A wrong password and an account the database never held still collapse into one
 * refusal. What does NOT collapse into it is a box that was not there — those are not
 * claims about a credential, and on the caller's own LAN the command refuses them
 * before it even prompts.
 */
describe('the database door', () => {
  const connectParams = (over: Partial<MysqlConnectParams> = {}): MysqlConnectParams => ({
    essid: 'BEAN-THERE-WIFI',
    targetIp: '192.168.1.31',
    port: 3306,
    username: 'app_rw',
    password: 'hunter-two',
    sourceIp: '192.168.1.50',
    ...over,
  });

  const sentPayload = async (fetchSpy: { mock: { calls: readonly unknown[][] } }) => {
    const init = fetchSpy.mock.calls[0]?.[1] as { readonly body: string };
    const envelope: unknown = JSON.parse(init.body);
    const verified = await verifySignedRequest(envelope, z.looseObject({}), {
      nonceStore: async () => ({ fresh: true }),
    });
    if (!verified.ok) throw new Error('the adapter sent something it did not sign');
    return verified.payload as Record<string, unknown>;
  };

  it('sends the port it was asked to connect on, not the daemon default', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true, hostname: 'db-11' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    await connectDatabase(deps, connectParams({ port: 33306 }));

    // A forwarded port IS the address of a box on a hidden layer. Dropped here, every
    // deep connection would land on whatever the gateway holds at 3306 instead.
    expect((await sentPayload(fetchSpy)).port).toBe(33306);
  });

  it('opens with the name the box answered with', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true, hostname: 'records-186' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await connectDatabase(deps, connectParams())).toEqual({
      ok: true,
      hostname: 'records-186',
    });
  });

  it('treats a 200 that names no box as no door at all', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { ok: true }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    // There is nothing to greet with, so there is nothing to enter. Passing it through
    // as an open connection would leave the player at a prompt titled after nothing.
    expect(await connectDatabase(deps, connectParams())).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('refuses a credential at the address the DAEMON saw, not the one it was sent from', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(401, { error: 'invalid_credentials', from: '10.42.7.1' }),
    );
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    // Through a forward the box was only ever shown the fronting gateway's `.1`. The
    // command renders the 1045 line from this, so echoing the caller's own address
    // would print a sentence the box's log flatly contradicts.
    expect(await connectDatabase(deps, connectParams())).toEqual({
      ok: false,
      reason: 'denied',
      fromIp: '10.42.7.1',
    });
  });

  it('falls back to the address it sent from when the refusal names none', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(401, { error: 'invalid_credentials' }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    expect(await connectDatabase(deps, connectParams())).toEqual({
      ok: false,
      reason: 'denied',
      fromIp: '192.168.1.50',
    });
  });

  it('tells a stopped daemon apart from a box that is not there', async () => {
    const stopped = vi.fn(async () => jsonResponse(404, { error: 'service_not_running' }));
    const missing = vi.fn(async () => jsonResponse(404, { error: 'host_unreachable' }));

    // Two different sentences to the player: one says nothing is listening there, the
    // other says nothing is there. Collapsing them would report a database the player
    // just stopped as an address that never existed.
    expect(await connectDatabase(makeDeps(stopped as unknown as typeof fetch), connectParams())).toEqual(
      { ok: false, reason: 'refused' },
    );
    expect(await connectDatabase(makeDeps(missing as unknown as typeof fetch), connectParams())).toEqual(
      { ok: false, reason: 'unreachable' },
    );
  });

  it('sends the held port with every statement, so each one re-resolves the same forward', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { output: ['Empty set'], failed: false }));
    const deps = makeDeps(fetchSpy as unknown as typeof fetch);

    await runDatabaseStatement(deps, {
      ...connectParams({ port: 33306 }),
      statement: 'SHOW TABLES',
    });

    // Without it a session opened through a forward would answer its first statement
    // against whatever holds 3306 on the gateway — or nothing at all.
    expect((await sentPayload(fetchSpy)).port).toBe(33306);
  });

  it('turns any refusal of a statement into a lost connection, whatever its name', async () => {
    // The prompt has one way to end badly and the player has one thing to do about
    // it. A daemon stopped under a live session and a forward pulled out from under
    // one are the same event from the prompt: the box stopped answering.
    const stopped = vi.fn(async () => jsonResponse(404, { error: 'service_not_running' }));
    const pulled = vi.fn(async () => jsonResponse(404, { error: 'host_unreachable' }));
    const statement = { ...connectParams({ port: 33306 }), statement: 'SHOW TABLES' };

    expect(
      await runDatabaseStatement(makeDeps(stopped as unknown as typeof fetch), statement),
    ).toEqual({ kind: 'lost' });
    expect(
      await runDatabaseStatement(makeDeps(pulled as unknown as typeof fetch), statement),
    ).toEqual({ kind: 'lost' });
  });
});
