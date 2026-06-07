import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createServerSession, listServerSessions, type SessionsClientDeps } from './sessionsApi';
import { generateIdentity } from '../core/identity/identity';
import { computeWorkstationId } from '../core/identity/workstation';
import { verifySignedRequest } from '../core/signedRequest/verify';
import { asEpochMs, asMachineId, asPlayerKeyHex } from '../core/types';
import type { Session } from '../core/commands/types';

const ENDPOINT = 'http://test.local/api/sessions';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const makeDeps = (fetchImpl: typeof fetch, over: Partial<SessionsClientDeps> = {}): SessionsClientDeps => {
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
    expect(fetchSpy).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ method: 'POST' }));
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

    expect(fetchSpy).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({ method: 'POST' }));
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

describe('listServerSessions', () => {
  it('POSTs a signed listSessions envelope and maps rows to Sessions', async () => {
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
    expect(verified.payload).toMatchObject({ action: 'listSessions', machine_id: deps.machineId });

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
