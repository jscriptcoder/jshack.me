import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSessionsRequest } from './handler';
import type {
  SessionRow,
  InsertSessionResult,
  EndSessionParams,
  EndSessionResult,
  ListSessionsParams,
  ListSessionsResult,
  SessionSummary,
} from './types';
import type { RateLimiter } from '../ipRegistry/rateLimit';
import { noopRateLimiter } from '../ipRegistry/rateLimit';
import { noopNonceStore, type NonceStore } from '../signedRequest/nonceStore';
import { generateIdentity, type Identity } from '../identity/identity';
import { signRequest } from '../signedRequest/sign';

// Real signing in tests — handler-side behaviour is tightly coupled to the
// signing flow, so end-to-end tests are clearer than mocking verify().
const FIXED_NOW = 1_700_000_000_000;
const STUB_SESSION_ID = '11111111-2222-3333-4444-555555555555';

type Fields = Record<string, unknown>;

const makeEnvelope = (
  identity: Identity,
  fields: Fields = {
    action: 'createSession',
    machine_id: '10.0.0.1',
    credentials: { username: 'root', userType: 'root' },
  },
) => {
  const realNow = Date.now;
  Date.now = () => FIXED_NOW;
  try {
    const { action, ...rest } = fields as { action?: string };
    return signRequest(identity, action ?? 'createSession', rest);
  } finally {
    Date.now = realNow;
  }
};

const mkDeps = (overrides: {
  readonly insertSession?: (row: SessionRow) => Promise<InsertSessionResult>;
  readonly endSession?: (params: EndSessionParams) => Promise<EndSessionResult>;
  readonly listSessions?: (params: ListSessionsParams) => Promise<ListSessionsResult>;
  readonly rateLimiter?: RateLimiter;
  readonly nonceStore?: NonceStore;
  readonly now?: () => number;
}) => ({
  insertSession:
    overrides.insertSession ??
    vi
      .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
      .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID }),
  endSession:
    overrides.endSession ??
    vi
      .fn<(params: EndSessionParams) => Promise<EndSessionResult>>()
      .mockResolvedValue({ ok: true, affected: 1 }),
  listSessions:
    overrides.listSessions ??
    vi
      .fn<(params: ListSessionsParams) => Promise<ListSessionsResult>>()
      .mockResolvedValue({ ok: true, sessions: [] }),
  rateLimiter: overrides.rateLimiter ?? noopRateLimiter,
  nonceStore: overrides.nonceStore ?? noopNonceStore,
  now: overrides.now ?? (() => FIXED_NOW),
});

describe('handleSessionsRequest — createSession', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  it('returns 200 with session_id on a valid envelope', async () => {
    const envelope = makeEnvelope(identity);
    const result = await handleSessionsRequest(envelope, mkDeps({}));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ session_id: STUB_SESSION_ID });
  });

  it('stamps player_key from verified public key (server-side, not client-trusted)', async () => {
    const insertSession = vi
      .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
      .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
    const envelope = makeEnvelope(identity);

    await handleSessionsRequest(envelope, mkDeps({ insertSession }));

    expect(insertSession).toHaveBeenCalledWith({
      player_key: identity.publicKeyHex,
      machine_id: '10.0.0.1',
      credentials: { username: 'root', userType: 'root' },
    });
  });

  it('passes through optional parent_session_id and source_ip', async () => {
    const insertSession = vi
      .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
      .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
    const envelope = makeEnvelope(identity, {
      action: 'createSession',
      machine_id: '10.0.0.5',
      credentials: { username: 'alice', userType: 'user' },
      parent_session_id: '99999999-aaaa-4bbb-8ccc-dddddddddddd',
      source_ip: '10.0.0.1',
    });

    await handleSessionsRequest(envelope, mkDeps({ insertSession }));

    expect(insertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        parent_session_id: '99999999-aaaa-4bbb-8ccc-dddddddddddd',
        source_ip: '10.0.0.1',
      }),
    );
  });

  describe('schema validation', () => {
    it('returns 400 if client supplies player_key (strict schema rejects unknown fields)', async () => {
      const envelope = makeEnvelope(identity, {
        action: 'createSession',
        machine_id: '10.0.0.1',
        credentials: { username: 'root', userType: 'root' },
        player_key: 'ed25519:attacker',
      });
      const result = await handleSessionsRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ error: 'payload_invalid' });
    });

    it('returns 400 when machine_id is missing', async () => {
      const envelope = makeEnvelope(identity, {
        action: 'createSession',
        credentials: { username: 'root', userType: 'root' },
      });
      const result = await handleSessionsRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
    });

    it('returns 400 when credentials.userType is not in the enum', async () => {
      const envelope = makeEnvelope(identity, {
        action: 'createSession',
        machine_id: '10.0.0.1',
        credentials: { username: 'root', userType: 'admin' },
      });
      const result = await handleSessionsRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
    });

    it('returns 400 when action is unknown', async () => {
      const envelope = makeEnvelope(identity, {
        action: 'unknownAction',
        machine_id: '10.0.0.1',
        credentials: { username: 'root', userType: 'root' },
      });
      const result = await handleSessionsRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
    });

    it('returns 400 when parent_session_id is not a UUID', async () => {
      const envelope = makeEnvelope(identity, {
        action: 'createSession',
        machine_id: '10.0.0.1',
        credentials: { username: 'root', userType: 'root' },
        parent_session_id: 'not-a-uuid',
      });
      const result = await handleSessionsRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
    });
  });

  describe('signature validation', () => {
    it('returns 400 when envelope is not an object', async () => {
      const result = await handleSessionsRequest('garbage', mkDeps({}));
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ error: 'envelope_invalid' });
    });

    it('returns 401 when signature does not match public key', async () => {
      const stranger = generateIdentity();
      const envelope = makeEnvelope(identity);
      const tampered = { ...envelope, publicKey: stranger.publicKeyHex };
      const result = await handleSessionsRequest(tampered, mkDeps({}));
      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({ error: 'signature_invalid' });
    });

    it('returns 401 when timestamp is outside replay window', async () => {
      const envelope = makeEnvelope(identity);
      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ now: () => FIXED_NOW + 200_000 }),
      );
      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({ error: 'timestamp_skew' });
    });

    it('returns 401 when nonce store reports a replay', async () => {
      const envelope = makeEnvelope(identity);
      const replayedStore: NonceStore = vi.fn().mockResolvedValue({ fresh: false });
      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ nonceStore: replayedStore }),
      );
      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({ error: 'replay' });
    });
  });

  describe('rate limiting', () => {
    it('rate-limits on the verified public key', async () => {
      const rateLimiter = vi.fn<RateLimiter>().mockResolvedValue({ allowed: true });
      const envelope = makeEnvelope(identity);

      await handleSessionsRequest(envelope, mkDeps({ rateLimiter }));

      expect(rateLimiter).toHaveBeenCalledWith(identity.publicKeyHex);
    });

    it('returns 429 with Retry-After when rate-limited', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const rateLimiter = vi
        .fn<RateLimiter>()
        .mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
      const envelope = makeEnvelope(identity);

      const result = await handleSessionsRequest(envelope, mkDeps({ insertSession, rateLimiter }));

      expect(result.status).toBe(429);
      expect(result.body).toMatchObject({ error: 'rate_limited' });
      expect(result.headers).toMatchObject({ 'Retry-After': '30' });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('rate-limit check runs after verification (does not consume budget on garbage)', async () => {
      const rateLimiter = vi.fn<RateLimiter>().mockResolvedValue({ allowed: true });
      await handleSessionsRequest('garbage', mkDeps({ rateLimiter }));
      expect(rateLimiter).not.toHaveBeenCalled();
    });
  });

  describe('insert failures', () => {
    it('returns 500 when the supabase insert fails', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: false });
      const envelope = makeEnvelope(identity);
      const result = await handleSessionsRequest(envelope, mkDeps({ insertSession }));
      expect(result.status).toBe(500);
      expect(result.body).toMatchObject({ error: 'insert_failed' });
    });
  });
});

describe('handleSessionsRequest — endSession', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  const validEndPayload = {
    action: 'endSession',
    session_id: '11111111-2222-4333-8444-555555555555',
    reason: 'user_exit',
  };

  it('returns 200 with empty body on a valid end of an active own session', async () => {
    const envelope = makeEnvelope(identity, validEndPayload);
    const result = await handleSessionsRequest(envelope, mkDeps({}));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({});
  });

  it('calls endSession with verified pubkey as player_key (not client claim)', async () => {
    const endSession = vi
      .fn<(params: EndSessionParams) => Promise<EndSessionResult>>()
      .mockResolvedValue({ ok: true, affected: 1 });
    const envelope = makeEnvelope(identity, validEndPayload);

    await handleSessionsRequest(envelope, mkDeps({ endSession }));

    expect(endSession).toHaveBeenCalledWith({
      session_id: validEndPayload.session_id,
      player_key: identity.publicKeyHex,
      reason: 'user_exit',
    });
  });

  it('returns 404 when affected = 0 (not found, not yours, or already ended)', async () => {
    const endSession = vi
      .fn<(params: EndSessionParams) => Promise<EndSessionResult>>()
      .mockResolvedValue({ ok: true, affected: 0 });
    const envelope = makeEnvelope(identity, validEndPayload);

    const result = await handleSessionsRequest(envelope, mkDeps({ endSession }));

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: 'session_not_found' });
  });

  it('returns 500 when the DB update errors', async () => {
    const endSession = vi
      .fn<(params: EndSessionParams) => Promise<EndSessionResult>>()
      .mockResolvedValue({ ok: false });
    const envelope = makeEnvelope(identity, validEndPayload);

    const result = await handleSessionsRequest(envelope, mkDeps({ endSession }));

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: 'update_failed' });
  });

  describe('schema validation', () => {
    it('returns 400 when session_id is not a UUID', async () => {
      const envelope = makeEnvelope(identity, {
        action: 'endSession',
        session_id: 'not-a-uuid',
        reason: 'user_exit',
      });
      const result = await handleSessionsRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
    });

    it('returns 400 when reason is missing', async () => {
      const envelope = makeEnvelope(identity, {
        action: 'endSession',
        session_id: validEndPayload.session_id,
      });
      const result = await handleSessionsRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
    });

    it('returns 400 when reason exceeds max length', async () => {
      const envelope = makeEnvelope(identity, {
        action: 'endSession',
        session_id: validEndPayload.session_id,
        reason: 'x'.repeat(100),
      });
      const result = await handleSessionsRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
    });

    it('returns 400 when client supplies unknown extra fields', async () => {
      const envelope = makeEnvelope(identity, {
        action: 'endSession',
        session_id: validEndPayload.session_id,
        reason: 'user_exit',
        admin: true,
      });
      const result = await handleSessionsRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
    });
  });

  describe('cross-action isolation', () => {
    it('does not call insertSession when action is endSession', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, validEndPayload);

      await handleSessionsRequest(envelope, mkDeps({ insertSession }));

      expect(insertSession).not.toHaveBeenCalled();
    });

    it('does not call endSession when action is createSession', async () => {
      const endSession = vi
        .fn<(params: EndSessionParams) => Promise<EndSessionResult>>()
        .mockResolvedValue({ ok: true, affected: 1 });
      const envelope = makeEnvelope(identity); // default = createSession

      await handleSessionsRequest(envelope, mkDeps({ endSession }));

      expect(endSession).not.toHaveBeenCalled();
    });
  });

  describe('signature + rate-limit (parity with createSession)', () => {
    it('returns 401 on bad signature for endSession too', async () => {
      const stranger = generateIdentity();
      const envelope = makeEnvelope(identity, validEndPayload);
      const tampered = { ...envelope, publicKey: stranger.publicKeyHex };
      const result = await handleSessionsRequest(tampered, mkDeps({}));
      expect(result.status).toBe(401);
    });

    it('returns 429 when rate-limited (insert + update both blocked)', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const endSession = vi
        .fn<(params: EndSessionParams) => Promise<EndSessionResult>>()
        .mockResolvedValue({ ok: true, affected: 1 });
      const rateLimiter = vi
        .fn<RateLimiter>()
        .mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
      const envelope = makeEnvelope(identity, validEndPayload);

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ insertSession, endSession, rateLimiter }),
      );

      expect(result.status).toBe(429);
      expect(insertSession).not.toHaveBeenCalled();
      expect(endSession).not.toHaveBeenCalled();
    });
  });
});

describe('handleSessionsRequest — listSessions', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  const validListPayload = { action: 'listSessions' };

  const sampleSession: SessionSummary = {
    session_id: '11111111-2222-4333-8444-555555555555',
    machine_id: '10.0.0.1',
    credentials: { username: 'root', userType: 'root' },
    parent_session_id: null,
    source_ip: null,
    created_at: '2026-04-26T10:00:00.000Z',
  };

  it('returns 200 with the active sessions array', async () => {
    const listSessions = vi
      .fn<(params: ListSessionsParams) => Promise<ListSessionsResult>>()
      .mockResolvedValue({ ok: true, sessions: [sampleSession] });
    const envelope = makeEnvelope(identity, validListPayload);

    const result = await handleSessionsRequest(envelope, mkDeps({ listSessions }));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ sessions: [sampleSession] });
  });

  it('returns 200 with empty array when player has no active sessions', async () => {
    const listSessions = vi
      .fn<(params: ListSessionsParams) => Promise<ListSessionsResult>>()
      .mockResolvedValue({ ok: true, sessions: [] });
    const envelope = makeEnvelope(identity, validListPayload);

    const result = await handleSessionsRequest(envelope, mkDeps({ listSessions }));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ sessions: [] });
  });

  it('queries with verified pubkey as player_key', async () => {
    const listSessions = vi
      .fn<(params: ListSessionsParams) => Promise<ListSessionsResult>>()
      .mockResolvedValue({ ok: true, sessions: [] });
    const envelope = makeEnvelope(identity, validListPayload);

    await handleSessionsRequest(envelope, mkDeps({ listSessions }));

    expect(listSessions).toHaveBeenCalledWith({ player_key: identity.publicKeyHex });
  });

  it('returns 500 when the DB query errors', async () => {
    const listSessions = vi
      .fn<(params: ListSessionsParams) => Promise<ListSessionsResult>>()
      .mockResolvedValue({ ok: false });
    const envelope = makeEnvelope(identity, validListPayload);

    const result = await handleSessionsRequest(envelope, mkDeps({ listSessions }));

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: 'query_failed' });
  });

  describe('schema validation', () => {
    it('returns 400 when client supplies unknown extra fields', async () => {
      const envelope = makeEnvelope(identity, {
        action: 'listSessions',
        machine_id: '10.0.0.1',
      });
      const result = await handleSessionsRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
    });
  });

  describe('cross-action isolation', () => {
    it('does not call insertSession or endSession on listSessions', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const endSession = vi
        .fn<(params: EndSessionParams) => Promise<EndSessionResult>>()
        .mockResolvedValue({ ok: true, affected: 1 });
      const envelope = makeEnvelope(identity, validListPayload);

      await handleSessionsRequest(envelope, mkDeps({ insertSession, endSession }));

      expect(insertSession).not.toHaveBeenCalled();
      expect(endSession).not.toHaveBeenCalled();
    });

    it('does not call listSessions on createSession or endSession', async () => {
      const listSessions = vi
        .fn<(params: ListSessionsParams) => Promise<ListSessionsResult>>()
        .mockResolvedValue({ ok: true, sessions: [] });
      // createSession path
      await handleSessionsRequest(makeEnvelope(identity), mkDeps({ listSessions }));
      // endSession path
      await handleSessionsRequest(
        makeEnvelope(identity, {
          action: 'endSession',
          session_id: '11111111-2222-4333-8444-555555555555',
          reason: 'user_exit',
        }),
        mkDeps({ listSessions }),
      );

      expect(listSessions).not.toHaveBeenCalled();
    });
  });

  describe('signature + rate-limit (parity)', () => {
    it('returns 401 on bad signature for listSessions too', async () => {
      const stranger = generateIdentity();
      const envelope = makeEnvelope(identity, validListPayload);
      const tampered = { ...envelope, publicKey: stranger.publicKeyHex };
      const result = await handleSessionsRequest(tampered, mkDeps({}));
      expect(result.status).toBe(401);
    });

    it('returns 429 when rate-limited (DB query blocked)', async () => {
      const listSessions = vi
        .fn<(params: ListSessionsParams) => Promise<ListSessionsResult>>()
        .mockResolvedValue({ ok: true, sessions: [] });
      const rateLimiter = vi
        .fn<RateLimiter>()
        .mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
      const envelope = makeEnvelope(identity, validListPayload);

      const result = await handleSessionsRequest(envelope, mkDeps({ listSessions, rateLimiter }));

      expect(result.status).toBe(429);
      expect(listSessions).not.toHaveBeenCalled();
    });
  });
});
