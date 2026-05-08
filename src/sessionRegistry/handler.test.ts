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
import type {
  FindEtcPasswdContentParams,
  FindEtcPasswdContentResult,
} from './supabaseFindEtcPasswdContent';
import type { RateLimiter } from '../ipRegistry/rateLimit';
import { noopRateLimiter } from '../ipRegistry/rateLimit';
import { noopNonceStore, type NonceStore } from '../signedRequest/nonceStore';
import { generateIdentity, type Identity } from '../identity/identity';
import { signRequest } from '../signedRequest/sign';
import { md5 } from '../utils/md5';

// Default /etc/passwd content for tests: matches the default envelope's
// claim (root@10.0.0.1, userType 'root'). Tests that exercise mismatch
// or sabotage scenarios override findEtcPasswdContent explicitly.
const DEFAULT_ETC_PASSWD =
  'root:roothash:0:0:root:/root:/bin/bash\n' +
  'ftpuser:ftphash:1001:1001:ftpuser:/home/ftpuser:/bin/bash\n' +
  'alice:alicehash:1002:1002:alice:/home/alice:/bin/bash\n' +
  'guest:guesthash:65534:65534:guest:/home/guest:/bin/bash';

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
    // exploit is a non-auth-required kind (signed-envelope tier-trust);
    // stays valid for createSession after PR 2 step 5 closes the bypass
    // hole on auth-required kinds (ssh/scp/su) — those must use
    // authCreateSession instead.
    kind: 'exploit',
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
  readonly findEtcPasswdContent?: (
    params: FindEtcPasswdContentParams,
  ) => Promise<FindEtcPasswdContentResult>;
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
  // Default: matches the default envelope's userType claim. Tests
  // exercising mismatch / underivable / no-op scenarios override.
  findEtcPasswdContent:
    overrides.findEtcPasswdContent ??
    vi
      .fn<(params: FindEtcPasswdContentParams) => Promise<FindEtcPasswdContentResult>>()
      .mockResolvedValue({ ok: true, found: true, content: DEFAULT_ETC_PASSWD }),
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
      kind: 'exploit',
    });
  });

  it('passes through explicit kind (e.g., ftp)', async () => {
    const insertSession = vi
      .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
      .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
    const envelope = makeEnvelope(identity, {
      action: 'createSession',
      machine_id: '10.0.0.5',
      credentials: { username: 'ftpuser', userType: 'user' },
      kind: 'ftp',
    });

    await handleSessionsRequest(envelope, mkDeps({ insertSession }));

    expect(insertSession).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ftp' }));
  });

  it('rejects with 400 when kind is omitted (now required, no default)', async () => {
    // PR 2 step 5: kind became required at the schema level. The previous
    // server-side fallback to 'ssh' was a back-compat shim for early
    // pushSession callers; after this change, all callers specify kind
    // explicitly.
    const insertSession = vi
      .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
      .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
    const envelope = makeEnvelope(identity, {
      action: 'createSession',
      machine_id: '10.0.0.1',
      credentials: { username: 'root', userType: 'root' },
      // intentionally no kind
    });
    const result = await handleSessionsRequest(envelope, mkDeps({ insertSession }));
    expect(result.status).toBe(400);
    expect(insertSession).not.toHaveBeenCalled();
  });

  describe.each(['ssh', 'scp', 'su'] as const)(
    'rejects createSession with auth-required kind=%s',
    (authKind) => {
      it('returns 403 use_authcreatesession and does NOT insert', async () => {
        // PR 2 step 5: closing the bypass hole. Auth-required kinds must
        // route through authCreateSession (which validates against
        // /etc/passwd). createSession with these kinds would let a forge
        // caller mint a session row without proving credentials.
        const insertSession = vi
          .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
          .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
        const envelope = makeEnvelope(identity, {
          action: 'createSession',
          machine_id: '10.0.0.1',
          credentials: { username: 'root', userType: 'root' },
          kind: authKind,
        });
        const result = await handleSessionsRequest(envelope, mkDeps({ insertSession }));
        expect(result.status).toBe(403);
        expect(result.body).toEqual({ error: 'use_authcreatesession' });
        expect(insertSession).not.toHaveBeenCalled();
      });
    },
  );

  it('rejects with 400 when client supplies an unknown kind value', async () => {
    // Strict zod enum — only the declared kinds are valid wire values.
    const envelope = makeEnvelope(identity, {
      action: 'createSession',
      machine_id: '10.0.0.1',
      credentials: { username: 'root', userType: 'root' },
      kind: 'shellsh', // typo / attacker
    });
    const result = await handleSessionsRequest(envelope, mkDeps({}));
    expect(result.status).toBe(400);
  });

  it('passes through optional parent_session_id and source_ip', async () => {
    const insertSession = vi
      .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
      .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
    const envelope = makeEnvelope(identity, {
      action: 'createSession',
      machine_id: '10.0.0.5',
      credentials: { username: 'alice', userType: 'user' },
      kind: 'exploit',
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

  describe('userType validation against /etc/passwd', () => {
    // The server reads the live /etc/passwd from machine_filesystems and
    // rejects when the client's claimed userType doesn't match the
    // canonical value derived from the file. Closes the L2 follow-up
    // chunk #3 gap: a client claiming userType: 'root' for what is
    // actually a guest login no longer produces a session row that the
    // walker honors.

    it('rejects 400 usertype_mismatch when claim does not match /etc/passwd', async () => {
      // Envelope claims userType 'root' for username 'alice'; /etc/passwd
      // says alice is uid 1002 → derived userType 'user'. Mismatch → 400.
      const envelope = makeEnvelope(identity, {
        action: 'createSession',
        machine_id: '10.0.0.1',
        credentials: { username: 'alice', userType: 'root' },
        kind: 'exploit',
      });
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });

      const result = await handleSessionsRequest(envelope, mkDeps({ insertSession }));

      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: 'usertype_mismatch' });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('rejects 400 usertype_underivable when /etc/passwd has no entry for the claimed username', async () => {
      const envelope = makeEnvelope(identity, {
        action: 'createSession',
        machine_id: '10.0.0.1',
        credentials: { username: 'eve', userType: 'user' },
        kind: 'exploit',
      });
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });

      const result = await handleSessionsRequest(envelope, mkDeps({ insertSession }));

      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: 'usertype_underivable' });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('rejects 400 usertype_underivable when /etc/passwd is garbled (no parseable entries)', async () => {
      const envelope = makeEnvelope(identity);
      const findEtcPasswdContent = vi
        .fn<(params: FindEtcPasswdContentParams) => Promise<FindEtcPasswdContentResult>>()
        .mockResolvedValue({ ok: true, found: true, content: 'garbage with no colons' });
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ findEtcPasswdContent, insertSession }),
      );

      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: 'usertype_underivable' });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('accepts (200) when claim matches /etc/passwd-derived userType', async () => {
      // Default envelope claims root@10.0.0.1 with userType 'root'; the
      // default DEFAULT_ETC_PASSWD has root with uid 0 → derived 'root'.
      // Match → proceed to insertSession.
      const envelope = makeEnvelope(identity);
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });

      const result = await handleSessionsRequest(envelope, mkDeps({ insertSession }));

      expect(result.status).toBe(200);
      expect(insertSession).toHaveBeenCalled();
    });

    it('accepts (200) and inserts when /etc/passwd has no projection (mission-machine no-op)', async () => {
      // Mission machines are not yet in machine_filesystems
      // (blocked on mission_instances). found=false → no-op the
      // validation, accept the claim. This path goes away once mission
      // instances ship.
      const envelope = makeEnvelope(identity, {
        action: 'createSession',
        machine_id: 'mission-router-42',
        credentials: { username: 'alice', userType: 'root' },
        kind: 'exploit',
      });
      const findEtcPasswdContent = vi
        .fn<(params: FindEtcPasswdContentParams) => Promise<FindEtcPasswdContentResult>>()
        .mockResolvedValue({ ok: true, found: false });
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ findEtcPasswdContent, insertSession }),
      );

      expect(result.status).toBe(200);
      expect(insertSession).toHaveBeenCalled();
    });

    it('returns 500 fs_lookup_failed when the projection query errors', async () => {
      const envelope = makeEnvelope(identity);
      const findEtcPasswdContent = vi
        .fn<(params: FindEtcPasswdContentParams) => Promise<FindEtcPasswdContentResult>>()
        .mockResolvedValue({ ok: false });
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ findEtcPasswdContent, insertSession }),
      );

      expect(result.status).toBe(500);
      expect(result.body).toEqual({ error: 'fs_lookup_failed' });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('rejects 400 when guest user claims root userType (sabotage attempt)', async () => {
      // The threat model: an attacker on a cracked guest shell forges
      // a createSession with credentials.userType='root'. /etc/passwd
      // says guest is uid 65534 with username 'guest' → derived 'guest'.
      // 'guest' !== 'root' → mismatch → 400.
      const envelope = makeEnvelope(identity, {
        action: 'createSession',
        machine_id: '10.0.0.1',
        credentials: { username: 'guest', userType: 'root' },
        kind: 'exploit',
      });
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });

      const result = await handleSessionsRequest(envelope, mkDeps({ insertSession }));

      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: 'usertype_mismatch' });
      expect(insertSession).not.toHaveBeenCalled();
    });
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
      const result = await handleSessionsRequest(envelope, mkDeps({ nonceStore: replayedStore }));
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
    kind: 'ssh',
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

// ----- authCreateSession (PR 2) ---------------------------------------
//
// Server-authoritative auth + session creation, atomic. Server reads the
// target's /etc/passwd from machine_filesystems, validates the auth
// method, derives userType, inserts the session row.

const TEST_ROOT_PASSWORD = 'rootpw';
const TEST_ALICE_PASSWORD = 'alicepw';
const TEST_GUEST_PASSWORD = 'guestpw';
const TEST_TARGET_IP = '10.0.0.5';

const AUTH_TEST_ETC_PASSWD = [
  `root:${md5(TEST_ROOT_PASSWORD)}:0:0:root:/root:/bin/bash`,
  `alice:${md5(TEST_ALICE_PASSWORD)}:1001:1001:alice:/home/alice:/bin/bash`,
  `guest:${md5(TEST_GUEST_PASSWORD)}:65534:65534:guest:/home/guest:/bin/bash`,
].join('\n');

const validFingerprint = (username: string, hash: string, targetIp = TEST_TARGET_IP) =>
  md5(`${username}:${targetIp}:${hash}`);

const baseAuthEnvelope = {
  action: 'authCreateSession' as const,
  machine_id: 'target-host',
  kind: 'ssh' as const,
  username: 'alice',
};

const passwordAuth = (password: string) => ({ method: 'password' as const, password });
const savedKeyAuth = (fingerprint: string, targetIp = TEST_TARGET_IP) => ({
  method: 'savedKey' as const,
  fingerprint,
  targetIp,
});

const authPasswdDep =
  (content: string | null = AUTH_TEST_ETC_PASSWD) =>
  () =>
    Promise.resolve({ ok: true as const, found: true as const, content });

describe('handleSessionsRequest — authCreateSession', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  describe('password auth', () => {
    it('returns 201 with session_id and userType for a valid password', async () => {
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        auth: passwordAuth(TEST_ALICE_PASSWORD),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ findEtcPasswdContent: authPasswdDep() }),
      );

      expect(result.status).toBe(201);
      expect(result.body).toEqual({ session_id: STUB_SESSION_ID, userType: 'user' });
    });

    it('returns 401 invalid_credentials for a wrong password', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        auth: passwordAuth('wrong-password'),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ insertSession, findEtcPasswdContent: authPasswdDep() }),
      );

      expect(result.status).toBe(401);
      expect(result.body).toEqual({ error: 'invalid_credentials' });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('returns 401 invalid_credentials when username is not in /etc/passwd (no enumeration)', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        username: 'nonexistent',
        auth: passwordAuth(TEST_ALICE_PASSWORD),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ insertSession, findEtcPasswdContent: authPasswdDep() }),
      );

      // Same response code/body as wrong-password — no info leak.
      expect(result.status).toBe(401);
      expect(result.body).toEqual({ error: 'invalid_credentials' });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('derives userType from /etc/passwd, NOT from any client claim (server-authoritative)', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        username: 'root',
        auth: passwordAuth(TEST_ROOT_PASSWORD),
      });

      await handleSessionsRequest(
        envelope,
        mkDeps({ insertSession, findEtcPasswdContent: authPasswdDep() }),
      );

      expect(insertSession).toHaveBeenCalledWith(
        expect.objectContaining({
          player_key: identity.publicKeyHex,
          machine_id: 'target-host',
          credentials: { username: 'root', userType: 'root' },
          kind: 'ssh',
        }),
      );
    });

    it('passes parent_session_id and source_ip through to the session row', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        auth: passwordAuth(TEST_ALICE_PASSWORD),
        parent_session_id: '00000000-0000-0000-0000-000000000000',
        source_ip: '192.168.1.10',
      });

      await handleSessionsRequest(
        envelope,
        mkDeps({ insertSession, findEtcPasswdContent: authPasswdDep() }),
      );

      expect(insertSession).toHaveBeenCalledWith(
        expect.objectContaining({
          parent_session_id: '00000000-0000-0000-0000-000000000000',
          source_ip: '192.168.1.10',
        }),
      );
    });

    it('respects kind=scp', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'scp',
        auth: passwordAuth(TEST_ALICE_PASSWORD),
      });

      await handleSessionsRequest(
        envelope,
        mkDeps({ insertSession, findEtcPasswdContent: authPasswdDep() }),
      );

      expect(insertSession).toHaveBeenCalledWith(expect.objectContaining({ kind: 'scp' }));
    });

    it('respects kind=su', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'su',
        auth: passwordAuth(TEST_ALICE_PASSWORD),
      });

      await handleSessionsRequest(
        envelope,
        mkDeps({ insertSession, findEtcPasswdContent: authPasswdDep() }),
      );

      expect(insertSession).toHaveBeenCalledWith(expect.objectContaining({ kind: 'su' }));
    });
  });

  describe('savedKey auth', () => {
    it('returns 201 when fingerprint matches md5(username:targetIp:hash) for the live /etc/passwd', async () => {
      const aliceHash = md5(TEST_ALICE_PASSWORD);
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        auth: savedKeyAuth(validFingerprint('alice', aliceHash)),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ findEtcPasswdContent: authPasswdDep() }),
      );

      expect(result.status).toBe(201);
      expect(result.body).toEqual({ session_id: STUB_SESSION_ID, userType: 'user' });
    });

    it('returns 401 when fingerprint does not match (e.g., post-password_reset)', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        // Stale fingerprint computed against the OLD hash.
        auth: savedKeyAuth(validFingerprint('alice', 'old-hash')),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ insertSession, findEtcPasswdContent: authPasswdDep() }),
      );

      expect(result.status).toBe(401);
      expect(result.body).toEqual({ error: 'invalid_credentials' });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('returns 401 when targetIp differs from what the saved fingerprint was computed with', async () => {
      const aliceHash = md5(TEST_ALICE_PASSWORD);
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        // Fingerprint was computed with TEST_TARGET_IP, but envelope claims a different one.
        auth: savedKeyAuth(validFingerprint('alice', aliceHash, TEST_TARGET_IP), '10.99.99.99'),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ findEtcPasswdContent: authPasswdDep() }),
      );

      expect(result.status).toBe(401);
    });

    it('returns 401 when username is missing in /etc/passwd (savedKey path also avoids enumeration)', async () => {
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        username: 'nonexistent',
        auth: savedKeyAuth(validFingerprint('nonexistent', 'whatever')),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ findEtcPasswdContent: authPasswdDep() }),
      );

      expect(result.status).toBe(401);
      expect(result.body).toEqual({ error: 'invalid_credentials' });
    });
  });

  describe('failure modes', () => {
    it('returns 401 when /etc/passwd is missing for the machine (no_passwd would leak machine state)', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        auth: passwordAuth(TEST_ALICE_PASSWORD),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          insertSession,
          findEtcPasswdContent: () => Promise.resolve({ ok: true, found: false }),
        }),
      );

      expect(result.status).toBe(401);
      expect(result.body).toEqual({ error: 'invalid_credentials' });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('returns 500 when the FS lookup itself fails (transient DB error)', async () => {
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        auth: passwordAuth(TEST_ALICE_PASSWORD),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          findEtcPasswdContent: () => Promise.resolve({ ok: false }),
        }),
      );

      expect(result.status).toBe(500);
      expect(result.body).toEqual({ error: 'fs_lookup_failed' });
    });

    it('returns 500 when insertSession fails after a successful auth', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: false });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        auth: passwordAuth(TEST_ALICE_PASSWORD),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ insertSession, findEtcPasswdContent: authPasswdDep() }),
      );

      expect(result.status).toBe(500);
      expect(result.body).toEqual({ error: 'insert_failed' });
    });

    it('returns 401 when /etc/passwd content is null (sabotaged file)', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        auth: passwordAuth(TEST_ALICE_PASSWORD),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          insertSession,
          findEtcPasswdContent: authPasswdDep(null),
        }),
      );

      expect(result.status).toBe(401);
      expect(insertSession).not.toHaveBeenCalled();
    });
  });

  describe('rate limiting + envelope auth (shared with createSession)', () => {
    it('returns 429 rate_limited before any FS lookup', async () => {
      const findEtcPasswdContent = vi.fn();
      const rateLimiter: RateLimiter = vi
        .fn<RateLimiter>()
        .mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        auth: passwordAuth(TEST_ALICE_PASSWORD),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ rateLimiter, findEtcPasswdContent }),
      );

      expect(result.status).toBe(429);
      expect(findEtcPasswdContent).not.toHaveBeenCalled();
    });

    it('returns 401 signature_invalid on a tampered envelope', async () => {
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        auth: passwordAuth(TEST_ALICE_PASSWORD),
      });
      const tampered = { ...envelope, signature: '00'.repeat(64) };

      const result = await handleSessionsRequest(tampered, mkDeps({}));

      expect(result.status).toBe(401);
      expect(result.body).toEqual({ error: 'signature_invalid' });
    });
  });
});
