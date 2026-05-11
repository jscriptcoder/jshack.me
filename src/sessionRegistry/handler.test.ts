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
import type {
  FindVirtualUsersConfContentParams,
  FindVirtualUsersConfContentResult,
} from './supabaseFindVirtualUsersConfContent';
import type { FindFsContentParams, FindFsContentResult } from './supabaseFindFsContent';
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
    // stays valid for createSession. The createSession bypass hole on
    // auth-required kinds (ssh/scp/su) is closed — those must use
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
  readonly findVirtualUsersConfContent?: (
    params: FindVirtualUsersConfContentParams,
  ) => Promise<FindVirtualUsersConfContentResult>;
  readonly findFsContent?: (params: FindFsContentParams) => Promise<FindFsContentResult>;
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
  // Default: no virtual_users.conf row (machine has no FTP daemon).
  // FTP-specific tests override with a populated overlay.
  findVirtualUsersConfContent:
    overrides.findVirtualUsersConfContent ??
    vi
      .fn<
        (params: FindVirtualUsersConfContentParams) => Promise<FindVirtualUsersConfContentResult>
      >()
      .mockResolvedValue({ ok: true, found: false }),
  // Generic FS content adapter, used by mysql/redis/snmp arms.
  // Default: every path returns found:false. Per-kind tests override.
  findFsContent:
    overrides.findFsContent ??
    vi
      .fn<(params: FindFsContentParams) => Promise<FindFsContentResult>>()
      .mockResolvedValue({ ok: true, found: false }),
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

  it('passes through explicit kind for non-auth-required kinds (e.g., nc)', async () => {
    // After mysql/redis/snmp migrated into AUTH_REQUIRED_KINDS, the
    // remaining createSession-routed kinds are: exploit, nc,
    // effect_one_shot. nc is the simplest example here.
    const insertSession = vi
      .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
      .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
    const envelope = makeEnvelope(identity, {
      action: 'createSession',
      machine_id: '10.0.0.5',
      credentials: { username: 'root', userType: 'root' },
      kind: 'nc',
    });

    await handleSessionsRequest(envelope, mkDeps({ insertSession }));

    expect(insertSession).toHaveBeenCalledWith(expect.objectContaining({ kind: 'nc' }));
  });

  it('rejects with 400 when kind is omitted (now required, no default)', async () => {
    // kind became required at the schema level. The previous server-side
    // fallback to 'ssh' was a back-compat shim for early pushSession
    // callers; after this change, all callers specify kind explicitly.
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

  describe.each(['ssh', 'scp', 'su', 'ftp', 'mysql', 'redis', 'snmp'] as const)(
    'rejects createSession with auth-required kind=%s',
    (authKind) => {
      it('returns 403 use_authcreatesession and does NOT insert', async () => {
        // PRs 2-4: closing the bypass hole. Auth-required kinds must
        // route through authCreateSession (which validates against the
        // appropriate credential file). createSession with these kinds
        // would let a forge caller mint a session row without proving
        // credentials.
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

    it('accepts (200) when /etc/passwd has no entry for the claimed username (effect-kind synthetic placeholder)', async () => {
      // msfconsole's effect_one_shot / exploit / nc flows use synthetic
      // placeholder usernames ('msf', shell-effect users, pidfile
      // sentinels) that intentionally aren't in /etc/passwd. Their tier
      // comes from the CVE envelope, not from /etc/passwd. Auth-required
      // kinds (ssh/scp/su/ftp/mysql/redis/snmp) go through
      // authCreateSession with per-kind credential adapters — they
      // never reach this validation. So "no entry" is envelope-trusted,
      // not a forge attempt.
      const envelope = makeEnvelope(identity, {
        action: 'createSession',
        machine_id: '10.0.0.1',
        credentials: { username: 'msf', userType: 'root' },
        kind: 'effect_one_shot',
      });
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });

      const result = await handleSessionsRequest(envelope, mkDeps({ insertSession }));

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ session_id: STUB_SESSION_ID });
      expect(insertSession).toHaveBeenCalledOnce();
    });

    it('accepts (200) when /etc/passwd is garbled (no parseable entries)', async () => {
      // Garble is enforced via authCreateSession (which is what real
      // player logins use — sabotage-via-garble breaks login). For
      // CVE effects via createSession, garble shouldn't block — CVEs
      // bypass auth by definition.
      const envelope = makeEnvelope(identity, {
        action: 'createSession',
        machine_id: '10.0.0.1',
        credentials: { username: 'msf', userType: 'root' },
        kind: 'effect_one_shot',
      });
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

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ session_id: STUB_SESSION_ID });
      expect(insertSession).toHaveBeenCalledOnce();
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

// ----- authCreateSession ----------------------------------------------
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
const pidfileAuth = (port: number) => ({ method: 'pidfile' as const, port });

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

  // ----- FTP-specific -------------------------------------------------
  //
  // FTP uses /etc/vsftpd/virtual_users.conf as an overlay on top of
  // /etc/passwd. When the username is in virtual_users.conf, that hash
  // takes precedence for password matching. When it isn't (or the file
  // is missing), the handler falls back to /etc/passwd. userType always
  // derives from /etc/passwd. SavedKey is rejected for FTP.

  describe('FTP overlay (kind=ftp)', () => {
    const TEST_ALICE_FTP_PASSWORD = 'alice-ftp-overlay-pw';
    const VU_CONTENT = [`alice:${md5(TEST_ALICE_FTP_PASSWORD)}`].join('\n');
    const vuConfDep =
      (content: string | null = VU_CONTENT) =>
      () =>
        Promise.resolve({ ok: true as const, found: true as const, content });
    const noVuConfDep = () => Promise.resolve({ ok: true as const, found: false as const });

    // Regression for the empty-system-hash case: the player's own user
    // on a freshly registered workstation has passwordHash='' in
    // /etc/passwd by design (generateLocalhost.ts). Before the
    // findEtcPasswdEntry → deriveUserTypeFromEtcPasswd refactor, the
    // handler conflated "user missing" with "user has empty hash" and
    // short-circuited 401 before consulting virtual_users.conf.
    it('returns 201 when user has empty /etc/passwd hash but matches virtual_users.conf overlay', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      // /etc/passwd with alice having an EMPTY password field.
      const passwdWithEmptyAliceHash =
        `root:${md5(TEST_ROOT_PASSWORD)}:0:0:root:/root:/bin/bash\n` +
        `alice::1001:1001:alice:/home/alice:/bin/bash`;
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'ftp',
        auth: passwordAuth(TEST_ALICE_FTP_PASSWORD),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          insertSession,
          findEtcPasswdContent: authPasswdDep(passwdWithEmptyAliceHash),
          findVirtualUsersConfContent: vuConfDep(),
        }),
      );

      expect(result.status).toBe(201);
      expect(result.body).toEqual({ session_id: STUB_SESSION_ID, userType: 'user' });
    });

    it('returns 201 with userType from /etc/passwd when virtual_users.conf overlay matches', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'ftp',
        auth: passwordAuth(TEST_ALICE_FTP_PASSWORD),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          insertSession,
          findEtcPasswdContent: authPasswdDep(),
          findVirtualUsersConfContent: vuConfDep(),
        }),
      );

      expect(result.status).toBe(201);
      expect(result.body).toEqual({ session_id: STUB_SESSION_ID, userType: 'user' });
      expect(insertSession).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: { username: 'alice', userType: 'user' },
          kind: 'ftp',
        }),
      );
    });

    it('rejects when overlay is matched but the password is wrong', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'ftp',
        auth: passwordAuth('wrong-ftp-password'),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          insertSession,
          findEtcPasswdContent: authPasswdDep(),
          findVirtualUsersConfContent: vuConfDep(),
        }),
      );

      expect(result.status).toBe(401);
      expect(result.body).toEqual({ error: 'invalid_credentials' });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('uses overlay password (NOT /etc/passwd) when both are present and differ', async () => {
      // The overlay takes precedence. If the alice's /etc/passwd hash and
      // virtual_users.conf hash differ, the FTP password must match the
      // overlay; the system password should not validate.
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'ftp',
        // System password — NOT what the overlay expects.
        auth: passwordAuth(TEST_ALICE_PASSWORD),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          insertSession,
          findEtcPasswdContent: authPasswdDep(),
          findVirtualUsersConfContent: vuConfDep(),
        }),
      );

      expect(result.status).toBe(401);
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('falls back to /etc/passwd when virtual_users.conf row is missing', async () => {
      // Machine has no FTP daemon running, so no virtual_users.conf row
      // exists. Real-world vsftpd behaviour: PAM (system credentials)
      // applies. Server mirrors that.
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'ftp',
        auth: passwordAuth(TEST_ALICE_PASSWORD),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          insertSession,
          findEtcPasswdContent: authPasswdDep(),
          findVirtualUsersConfContent: noVuConfDep,
        }),
      );

      expect(result.status).toBe(201);
      expect(insertSession).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'ftp',
          credentials: { username: 'alice', userType: 'user' },
        }),
      );
    });

    it('falls back to /etc/passwd when virtual_users.conf has no entry for the username', async () => {
      // virtual_users.conf is present but lists only bob, not alice.
      // Alice's login must validate against /etc/passwd hash.
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'ftp',
        auth: passwordAuth(TEST_ALICE_PASSWORD),
      });

      const vuOnlyBob = `bob:${md5('bob-pw')}`;
      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          insertSession,
          findEtcPasswdContent: authPasswdDep(),
          findVirtualUsersConfContent: vuConfDep(vuOnlyBob),
        }),
      );

      expect(result.status).toBe(201);
    });

    it('rejects savedKey auth method (no .ssh_keys for ftp)', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const fingerprint = validFingerprint('alice', md5(TEST_ALICE_FTP_PASSWORD));
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'ftp',
        auth: savedKeyAuth(fingerprint),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          insertSession,
          findEtcPasswdContent: authPasswdDep(),
          findVirtualUsersConfContent: vuConfDep(),
        }),
      );

      expect(result.status).toBe(401);
      expect(result.body).toEqual({ error: 'invalid_credentials' });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('returns 401 when username is in virtual_users.conf but absent from /etc/passwd', async () => {
      // userType is underivable without an /etc/passwd entry. Even if
      // the FTP overlay says the password is right, we can't safely
      // construct the session row. Same response code as wrong-password
      // (no info leak).
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const orphanUserVu = `orphan:${md5('orphan-pw')}`;
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'ftp',
        username: 'orphan',
        auth: passwordAuth('orphan-pw'),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          insertSession,
          findEtcPasswdContent: authPasswdDep(),
          findVirtualUsersConfContent: vuConfDep(orphanUserVu),
        }),
      );

      expect(result.status).toBe(401);
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('returns 500 when the virtual_users.conf lookup itself errors', async () => {
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'ftp',
        auth: passwordAuth(TEST_ALICE_PASSWORD),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          findEtcPasswdContent: authPasswdDep(),
          findVirtualUsersConfContent: () => Promise.resolve({ ok: false }),
        }),
      );

      expect(result.status).toBe(500);
      expect(result.body).toEqual({ error: 'fs_lookup_failed' });
    });

    it('does NOT consult virtual_users.conf for non-ftp kinds', async () => {
      // Sanity: kind=ssh should not even call the FTP adapter. Catches
      // accidental dispatch regressions.
      const findVirtualUsersConfContent = vi.fn();
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'ssh',
        auth: passwordAuth(TEST_ALICE_PASSWORD),
      });

      await handleSessionsRequest(
        envelope,
        mkDeps({
          findEtcPasswdContent: authPasswdDep(),
          findVirtualUsersConfContent,
        }),
      );

      expect(findVirtualUsersConfContent).not.toHaveBeenCalled();
    });
  });

  // ----- MySQL ---------------------------------------------------------
  //
  // MySQL reads /var/lib/mysql/data.json. userType comes from the JSON
  // entry (each credential carries its own userType, unlike FTP where
  // virtual_users.conf only has hashes). Password-only — savedKey
  // rejected.

  describe('MySQL (kind=mysql)', () => {
    const TEST_MYSQL_PASSWORD = 'mysql-admin-pw';
    const MYSQL_CONTENT = JSON.stringify({
      name: 'app',
      tables: {},
      credentials: [
        { username: 'admin', passwordHash: md5(TEST_MYSQL_PASSWORD), userType: 'root' },
        { username: 'reader', passwordHash: md5('reader-pw'), userType: 'guest' },
      ],
    });
    const fsContentDep = (path: string, content: string | null) =>
      vi.fn(async (params: FindFsContentParams) =>
        params.path === path
          ? { ok: true as const, found: true as const, content }
          : { ok: true as const, found: false as const },
      );

    it('returns 201 with userType from the JSON for valid credentials', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'mysql',
        username: 'admin',
        auth: passwordAuth(TEST_MYSQL_PASSWORD),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          insertSession,
          findFsContent: fsContentDep('/var/lib/mysql/data.json', MYSQL_CONTENT),
        }),
      );

      expect(result.status).toBe(201);
      expect(result.body).toEqual({ session_id: STUB_SESSION_ID, userType: 'root' });
      expect(insertSession).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: { username: 'admin', userType: 'root' },
          kind: 'mysql',
        }),
      );
    });

    it('returns 401 invalid_credentials for wrong password', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'mysql',
        username: 'admin',
        auth: passwordAuth('wrong'),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          insertSession,
          findFsContent: fsContentDep('/var/lib/mysql/data.json', MYSQL_CONTENT),
        }),
      );

      expect(result.status).toBe(401);
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('returns 401 when username absent from credentials (no enumeration)', async () => {
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'mysql',
        username: 'unknown',
        auth: passwordAuth(TEST_MYSQL_PASSWORD),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ findFsContent: fsContentDep('/var/lib/mysql/data.json', MYSQL_CONTENT) }),
      );

      expect(result.status).toBe(401);
    });

    it('returns 401 when data.json row is missing', async () => {
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'mysql',
        username: 'admin',
        auth: passwordAuth(TEST_MYSQL_PASSWORD),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          findFsContent: () => Promise.resolve({ ok: true, found: false }),
        }),
      );

      expect(result.status).toBe(401);
    });

    it('rejects savedKey method (no .ssh_keys for mysql)', async () => {
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'mysql',
        username: 'admin',
        auth: savedKeyAuth(md5(`admin:${TEST_TARGET_IP}:${md5(TEST_MYSQL_PASSWORD)}`)),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ findFsContent: fsContentDep('/var/lib/mysql/data.json', MYSQL_CONTENT) }),
      );

      expect(result.status).toBe(401);
    });

    it('does NOT consult /etc/passwd for mysql kind', async () => {
      // mysql derives userType from data.json, not /etc/passwd.
      const findEtcPasswdContent = vi.fn();
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'mysql',
        username: 'admin',
        auth: passwordAuth(TEST_MYSQL_PASSWORD),
      });

      await handleSessionsRequest(
        envelope,
        mkDeps({
          findEtcPasswdContent,
          findFsContent: fsContentDep('/var/lib/mysql/data.json', MYSQL_CONTENT),
        }),
      );

      expect(findEtcPasswdContent).not.toHaveBeenCalled();
    });
  });

  // ----- Redis ---------------------------------------------------------
  //
  // Redis is shared-secret. Sentinel username='redis'. requirepass
  // plaintext compare; userType always 'root' on success.

  describe('Redis (kind=redis)', () => {
    const REDIS_PW = 'redis-secret-pw';
    const REDIS_CONTENT = `port 6379\nrequirepass ${REDIS_PW}`;
    const fsContentDep = (path: string, content: string | null) =>
      vi.fn(async (params: FindFsContentParams) =>
        params.path === path
          ? { ok: true as const, found: true as const, content }
          : { ok: true as const, found: false as const },
      );

    it('returns 201 with userType=root on valid requirepass', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'redis',
        username: 'redis',
        auth: passwordAuth(REDIS_PW),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          insertSession,
          findFsContent: fsContentDep('/etc/redis/redis.conf', REDIS_CONTENT),
        }),
      );

      expect(result.status).toBe(201);
      expect(result.body).toEqual({ session_id: STUB_SESSION_ID, userType: 'root' });
      expect(insertSession).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: { username: 'redis', userType: 'root' },
          kind: 'redis',
        }),
      );
    });

    it('returns 401 on wrong requirepass', async () => {
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'redis',
        username: 'redis',
        auth: passwordAuth('wrong'),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ findFsContent: fsContentDep('/etc/redis/redis.conf', REDIS_CONTENT) }),
      );

      expect(result.status).toBe(401);
    });

    it('returns 201 at root tier when requirepass directive is absent (no-auth Redis)', async () => {
      // Mirrors real Redis: no requirepass → anyone with network
      // access gets in at full privilege. The session row is required
      // so subsequent SET/DEL writes pass L1's no_session gate.
      const NO_AUTH_CONTENT = 'port 6379\nbind 0.0.0.0';
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'redis',
        username: 'redis',
        auth: passwordAuth('any-sentinel'),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ findFsContent: fsContentDep('/etc/redis/redis.conf', NO_AUTH_CONTENT) }),
      );

      expect(result.status).toBe(201);
      const body = result.body as { readonly userType: string };
      expect(body.userType).toBe('root');
    });

    it('returns 201 at root tier when redis.conf row is missing (no daemon configured)', async () => {
      // Same semantic as missing requirepass — auth at the daemon
      // level isn't gating, so the session is granted. Without this,
      // SET writes 403 with no_session.
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'redis',
        username: 'redis',
        auth: passwordAuth(REDIS_PW),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ findFsContent: () => Promise.resolve({ ok: true, found: false }) }),
      );

      expect(result.status).toBe(201);
    });

    it('rejects savedKey method', async () => {
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'redis',
        username: 'redis',
        auth: savedKeyAuth(md5(`redis:${TEST_TARGET_IP}:${REDIS_PW}`)),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ findFsContent: fsContentDep('/etc/redis/redis.conf', REDIS_CONTENT) }),
      );

      expect(result.status).toBe(401);
    });
  });

  // ----- SNMP ----------------------------------------------------------
  //
  // SNMP shared-secret via rwcommunity. snmpset is the only path that
  // creates a session today. rocommunity stays read-only/sessionless.

  describe('SNMP (kind=snmp)', () => {
    const RW_COMMUNITY = 'private-rw';
    const RO_COMMUNITY = 'public-ro';
    const SNMP_CONTENT = `rocommunity ${RO_COMMUNITY}\nrwcommunity ${RW_COMMUNITY}`;
    const fsContentDep = (path: string, content: string | null) =>
      vi.fn(async (params: FindFsContentParams) =>
        params.path === path
          ? { ok: true as const, found: true as const, content }
          : { ok: true as const, found: false as const },
      );

    it('returns 201 with userType=root for valid rwcommunity', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'snmp',
        username: 'snmp',
        auth: passwordAuth(RW_COMMUNITY),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          insertSession,
          findFsContent: fsContentDep('/etc/snmp/snmpd.conf', SNMP_CONTENT),
        }),
      );

      expect(result.status).toBe(201);
      expect(result.body).toEqual({ session_id: STUB_SESSION_ID, userType: 'root' });
      expect(insertSession).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: { username: 'snmp', userType: 'root' },
          kind: 'snmp',
        }),
      );
    });

    it('returns 401 on rocommunity match (snmpset needs rwcommunity)', async () => {
      // Read-only community is real but doesn't grant write access, so
      // session creation must fail. snmpwalk goes through a different
      // (sessionless) path.
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'snmp',
        username: 'snmp',
        auth: passwordAuth(RO_COMMUNITY),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ findFsContent: fsContentDep('/etc/snmp/snmpd.conf', SNMP_CONTENT) }),
      );

      expect(result.status).toBe(401);
    });

    it('returns 401 on unknown community', async () => {
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'snmp',
        username: 'snmp',
        auth: passwordAuth('not-a-community'),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ findFsContent: fsContentDep('/etc/snmp/snmpd.conf', SNMP_CONTENT) }),
      );

      expect(result.status).toBe(401);
    });

    it('returns 401 when snmpd.conf has no rwcommunity directive', async () => {
      const RO_ONLY_CONTENT = `rocommunity ${RO_COMMUNITY}`;
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'snmp',
        username: 'snmp',
        auth: passwordAuth(RO_COMMUNITY),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ findFsContent: fsContentDep('/etc/snmp/snmpd.conf', RO_ONLY_CONTENT) }),
      );

      expect(result.status).toBe(401);
    });

    it('rejects savedKey method', async () => {
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'snmp',
        username: 'snmp',
        auth: savedKeyAuth(md5(`snmp:${TEST_TARGET_IP}:${RW_COMMUNITY}`)),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ findFsContent: fsContentDep('/etc/snmp/snmpd.conf', SNMP_CONTENT) }),
      );

      expect(result.status).toBe(401);
    });
  });

  describe('nc backdoor (kind=nc)', () => {
    // nc backdoor pidfile read. Server reads /var/run/nc-<port>.pid from
    // machine_filesystems, parses the line written by `nc -l`, derives
    // credentials, and inserts a kind:'nc' session at the listener's
    // tier. Forge clients can no longer mint cross-player nc sessions
    // at arbitrary userType against a `nc -l`-opened port.

    const NC_PORT = 4444;
    const NC_PIDFILE_PATH = `/var/run/nc-${NC_PORT}.pid`;
    const NC_VALID_CONTENT = `nc:port=${NC_PORT},user=alice,userType=user,home=/home/alice`;

    const fsContentDep = (path: string, content: string | null) =>
      vi.fn(async (params: FindFsContentParams) =>
        params.path === path
          ? { ok: true as const, found: true as const, content }
          : { ok: true as const, found: false as const },
      );

    it('returns 201 with server-derived credentials for a valid pidfile', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'nc',
        // Sentinel — server derives the real username from pidfile.
        username: 'nc',
        auth: pidfileAuth(NC_PORT),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ insertSession, findFsContent: fsContentDep(NC_PIDFILE_PATH, NC_VALID_CONTENT) }),
      );

      expect(result.status).toBe(201);
      expect(result.body).toEqual({
        session_id: STUB_SESSION_ID,
        username: 'alice',
        userType: 'user',
        homePath: '/home/alice',
      });
      expect(insertSession).toHaveBeenCalledWith(
        expect.objectContaining({
          // Credentials come from the pidfile, NOT the envelope's sentinel
          // 'nc'. A forge envelope sending username:'root', userType:'root'
          // would still get the pidfile's actual values.
          credentials: { username: 'alice', userType: 'user' },
          kind: 'nc',
        }),
      );
    });

    it('parses root-tier pidfile correctly', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const ROOT_CONTENT = `nc:port=${NC_PORT},user=root,userType=root,home=/root`;
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'nc',
        username: 'nc',
        auth: pidfileAuth(NC_PORT),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ insertSession, findFsContent: fsContentDep(NC_PIDFILE_PATH, ROOT_CONTENT) }),
      );

      expect(result.status).toBe(201);
      expect(result.body).toEqual({
        session_id: STUB_SESSION_ID,
        username: 'root',
        userType: 'root',
        homePath: '/root',
      });
    });

    it('returns 401 when pidfile row is missing', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'nc',
        username: 'nc',
        auth: pidfileAuth(9999),
      });

      // Default findFsContent returns found:false for any path.
      const result = await handleSessionsRequest(envelope, mkDeps({ insertSession }));

      expect(result.status).toBe(401);
      expect(result.body).toEqual({ error: 'invalid_credentials' });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('returns 401 when pidfile content is malformed', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'nc',
        username: 'nc',
        auth: pidfileAuth(NC_PORT),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          insertSession,
          findFsContent: fsContentDep(NC_PIDFILE_PATH, 'random nonsense without nc: prefix'),
        }),
      );

      expect(result.status).toBe(401);
      expect(result.body).toEqual({ error: 'invalid_credentials' });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('returns 401 when pidfile userType is invalid', async () => {
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'nc',
        username: 'nc',
        auth: pidfileAuth(NC_PORT),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          findFsContent: fsContentDep(
            NC_PIDFILE_PATH,
            `nc:port=${NC_PORT},user=hacker,userType=admin,home=/root`,
          ),
        }),
      );

      expect(result.status).toBe(401);
    });

    it('rejects method=password (only pidfile is valid for nc)', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'nc',
        username: 'alice',
        auth: passwordAuth('anything'),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ insertSession, findFsContent: fsContentDep(NC_PIDFILE_PATH, NC_VALID_CONTENT) }),
      );

      expect(result.status).toBe(401);
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('rejects method=savedKey (only pidfile is valid for nc)', async () => {
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'nc',
        username: 'alice',
        auth: savedKeyAuth('a'.repeat(32)),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({ findFsContent: fsContentDep(NC_PIDFILE_PATH, NC_VALID_CONTENT) }),
      );

      expect(result.status).toBe(401);
    });

    it('returns 500 when findFsContent reports a DB error', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'nc',
        username: 'nc',
        auth: pidfileAuth(NC_PORT),
      });

      const result = await handleSessionsRequest(
        envelope,
        mkDeps({
          insertSession,
          findFsContent: vi.fn(async () => ({ ok: false as const })),
        }),
      );

      expect(result.status).toBe(500);
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('queries the path /var/run/nc-<port>.pid built from envelope port', async () => {
      const findFsContent = vi.fn(async () => ({ ok: true as const, found: false as const }));
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'nc',
        username: 'nc',
        auth: pidfileAuth(31337),
      });

      await handleSessionsRequest(envelope, mkDeps({ findFsContent }));

      expect(findFsContent).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/var/run/nc-31337.pid' }),
      );
    });

    it('passes through optional parent_session_id and source_ip', async () => {
      const insertSession = vi
        .fn<(row: SessionRow) => Promise<InsertSessionResult>>()
        .mockResolvedValue({ ok: true, session_id: STUB_SESSION_ID });
      const envelope = makeEnvelope(identity, {
        ...baseAuthEnvelope,
        kind: 'nc',
        username: 'nc',
        auth: pidfileAuth(NC_PORT),
        parent_session_id: '99999999-aaaa-4bbb-8ccc-dddddddddddd',
        source_ip: '10.0.0.1',
      });

      await handleSessionsRequest(
        envelope,
        mkDeps({ insertSession, findFsContent: fsContentDep(NC_PIDFILE_PATH, NC_VALID_CONTENT) }),
      );

      expect(insertSession).toHaveBeenCalledWith(
        expect.objectContaining({
          parent_session_id: '99999999-aaaa-4bbb-8ccc-dddddddddddd',
          source_ip: '10.0.0.1',
        }),
      );
    });

    it.each(['ssh', 'scp', 'su', 'ftp'] as const)(
      'rejects pidfile method on kind=%s (only valid for nc)',
      async (kind) => {
        // Closes the inverse forge attempt — a caller can't bypass
        // /etc/passwd validation on ssh/scp/su/ftp by switching to
        // method:'pidfile'.
        const envelope = makeEnvelope(identity, {
          ...baseAuthEnvelope,
          kind,
          username: 'alice',
          auth: pidfileAuth(NC_PORT),
        });

        const result = await handleSessionsRequest(
          envelope,
          mkDeps({ findFsContent: fsContentDep(NC_PIDFILE_PATH, NC_VALID_CONTENT) }),
        );

        expect(result.status).toBe(401);
        expect(result.body).toEqual({ error: 'invalid_credentials' });
      },
    );
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
