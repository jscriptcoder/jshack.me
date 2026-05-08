import {
  AUTH_REQUIRED_KINDS,
  sessionsSignedPayloadSchema,
  type AuthRequiredKind,
  type EndSessionParams,
  type EndSessionResult,
  type InsertSessionResult,
  type ListSessionsParams,
  type ListSessionsResult,
  type SessionsPayload,
  type SessionRow,
} from './types.js';
import type { RateLimiter } from '../ipRegistry/rateLimit.js';
import {
  verifySignedRequest,
  type VerifyFailureReason,
  type VerifyResult,
} from '../signedRequest/verify.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import type {
  FindEtcPasswdContentParams,
  FindEtcPasswdContentResult,
} from './supabaseFindEtcPasswdContent.js';
import type {
  FindVirtualUsersConfContentParams,
  FindVirtualUsersConfContentResult,
} from './supabaseFindVirtualUsersConfContent.js';
import { deriveUserTypeFromEtcPasswd, findEtcPasswdEntry } from '../filesystem/etcPasswdHelpers.js';
import { findVirtualUserHash } from '../filesystem/virtualUsersConfHelpers.js';
import { md5 } from '../utils/md5.js';

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly headers?: Record<string, string>;
};

export type HandlerDeps = {
  readonly insertSession: (row: SessionRow) => Promise<InsertSessionResult>;
  readonly endSession: (params: EndSessionParams) => Promise<EndSessionResult>;
  readonly listSessions: (params: ListSessionsParams) => Promise<ListSessionsResult>;
  readonly findEtcPasswdContent: (
    params: FindEtcPasswdContentParams,
  ) => Promise<FindEtcPasswdContentResult>;
  // PR 3 of plans/cross-player-base-fs-replication.md — kind:'ftp' branch
  // of authCreateSession reads /etc/vsftpd/virtual_users.conf as an
  // overlay on top of /etc/passwd. PR 4 (MySQL/Redis/SNMP) may
  // generalize this to a single per-path adapter.
  readonly findVirtualUsersConfContent: (
    params: FindVirtualUsersConfContentParams,
  ) => Promise<FindVirtualUsersConfContentResult>;
  readonly rateLimiter: RateLimiter;
  readonly nonceStore: NonceStore;
  readonly now?: () => number;
};

// HTTP status mapping for verifySignedRequest failures. Auth-class
// problems (signature, replay, ts skew) get 401; structural problems
// get 400. Mirrors api/allocate-ip's mapping — kept local for now;
// candidate for extraction in a later refactor pass.
const STATUS_BY_VERIFY_REASON: Record<VerifyFailureReason, number> = {
  envelope_invalid: 400,
  payload_malformed: 400,
  payload_invalid: 400,
  signature_invalid: 401,
  timestamp_skew: 401,
  replay: 401,
};

// Pure request handler for POST /api/sessions. Single endpoint with
// action-dispatch:
//
//   1. Verify the signed envelope against the discriminated-union schema
//      (createSession / endSession / future actions). The verify path is
//      shared — every action gets identical signature + replay + ts checks.
//   2. Rate-limit on the verified pubkey (per-pubkey, like allocate-ip).
//   3. Dispatch on `verified.payload.action` to the per-action branch.
//
// player_key on every write is server-stamped from the verified pubkey.
// Strict schemas reject any client-supplied `player_key` field.
export const handleSessionsRequest = async (
  envelope: unknown,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(envelope, sessionsSignedPayloadSchema, {
    nonceStore: deps.nonceStore,
    now: deps.now,
  });
  if (!verified.ok) {
    return {
      status: STATUS_BY_VERIFY_REASON[verified.reason],
      body: { error: verified.reason },
    };
  }

  const limit = await deps.rateLimiter(verified.publicKey);
  if (!limit.allowed) {
    return {
      status: 429,
      body: { error: 'rate_limited' },
      headers: { 'Retry-After': String(limit.retryAfterSeconds) },
    };
  }

  // verified is narrowed to VerifyResult<SessionsPayload> (success); the
  // dispatch helpers narrow further by `action`.
  return dispatchAction(verified, deps);
};

const dispatchAction = async (
  verified: Extract<VerifyResult<SessionsPayload>, { ok: true }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const { payload, publicKey } = verified;
  switch (payload.action) {
    case 'createSession':
      return handleCreateSession(publicKey, payload, deps);
    case 'endSession':
      return handleEndSession(publicKey, payload, deps);
    case 'listSessions':
      return handleListSessions(publicKey, deps);
    case 'authCreateSession':
      return handleAuthCreateSession(publicKey, payload, deps);
  }
};

const isAuthRequiredKind = (kind: string): kind is AuthRequiredKind =>
  (AUTH_REQUIRED_KINDS as readonly string[]).includes(kind);

const handleCreateSession = async (
  publicKey: string,
  payload: Extract<SessionsPayload, { action: 'createSession' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const { machine_id, credentials, parent_session_id, source_ip, kind } = payload;

  // PR 2 step 5: auth-required kinds (ssh/scp/su) cannot mint sessions
  // through createSession — those must prove credentials via
  // authCreateSession. Closing this hole prevents a forge caller from
  // claiming userType:'root' for username='root' (matches /etc/passwd,
  // bypasses the userType-validation branch below) without ever
  // proving the password.
  if (isAuthRequiredKind(kind)) {
    return { status: 403, body: { error: 'use_authcreatesession' } };
  }

  // Server-side userType validation. Read the live /etc/passwd content
  // for the target machine and derive the canonical userType for the
  // claimed username. Reject on mismatch (a malicious client claiming
  // userType: 'root' for what is actually a guest login is the threat).
  //
  // Mission machines have no entry in machine_filesystems today (blocked
  // on mission_instances). For now, found=false → no-op the validation
  // and accept the claim. TODO: when mission_instances ship, drop the
  // no-op branch.
  //
  // See plans/etc-passwd-canonical.md step 5.
  const fsLookup = await deps.findEtcPasswdContent({ machine_id });
  if (!fsLookup.ok) {
    return { status: 500, body: { error: 'fs_lookup_failed' } };
  }
  if (fsLookup.found) {
    const derived = deriveUserTypeFromEtcPasswd(fsLookup.content, credentials.username);
    if (derived === undefined) {
      return { status: 400, body: { error: 'usertype_underivable' } };
    }
    if (derived !== credentials.userType) {
      return { status: 400, body: { error: 'usertype_mismatch' } };
    }
  }

  const row: SessionRow = {
    player_key: publicKey,
    machine_id,
    credentials,
    kind,
    ...(parent_session_id !== undefined && { parent_session_id }),
    ...(source_ip !== undefined && { source_ip }),
  };

  const result = await deps.insertSession(row);
  if (!result.ok) {
    return { status: 500, body: { error: 'insert_failed' } };
  }
  return { status: 200, body: { session_id: result.session_id } };
};

// Server-authoritative auth + session creation for ssh/scp/su/ftp.
// Reads the target's /etc/passwd from machine_filesystems, validates
// the auth method (password vs savedKey), derives userType from the
// /etc/passwd entry, and atomically inserts the session row.
//
// FTP (PR 3) extends the flow with /etc/vsftpd/virtual_users.conf as
// an overlay on /etc/passwd: when the username appears in
// virtual_users.conf, that hash takes precedence for password matching.
// userType always derives from /etc/passwd. FTP rejects savedKey
// (no `.ssh_keys` for ftp).
//
// All credential failure modes — wrong password, missing user, missing
// /etc/passwd, sabotaged file, fingerprint mismatch — collapse to one
// `401 invalid_credentials` response. Distinguishing them on the wire
// would leak machine state and username existence to forge-envelope
// probers (hydra-style brute force, account enumeration).
//
// PR 2 + PR 3 of plans/cross-player-base-fs-replication.md.
const handleAuthCreateSession = async (
  publicKey: string,
  payload: Extract<SessionsPayload, { action: 'authCreateSession' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const { machine_id, kind, username, auth, parent_session_id, source_ip } = payload;

  const fsLookup = await deps.findEtcPasswdContent({ machine_id });
  if (!fsLookup.ok) {
    return { status: 500, body: { error: 'fs_lookup_failed' } };
  }

  // Missing /etc/passwd → cannot validate. Return invalid_credentials
  // (NOT a distinct error) so callers can't distinguish "machine has no
  // FS" from "wrong password" via the response. userType is also
  // underivable, so even FTP-with-virtual-overlay fails here.
  const content = fsLookup.found ? fsLookup.content : null;
  const entry = findEtcPasswdEntry(content, username);
  if (entry === undefined) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  // Determine the expected hash for password matching. Default is the
  // /etc/passwd hash; FTP overrides with virtual_users.conf when the
  // overlay lists the user.
  let expectedHash = entry.passwordHash;

  if (kind === 'ftp') {
    // FTP does not support `.ssh_keys` saved-key auth — reject early.
    // Same response code as wrong-password (no info leak).
    if (auth.method !== 'password') {
      return { status: 401, body: { error: 'invalid_credentials' } };
    }
    const vuLookup = await deps.findVirtualUsersConfContent({ machine_id });
    if (!vuLookup.ok) {
      return { status: 500, body: { error: 'fs_lookup_failed' } };
    }
    const vuContent = vuLookup.found ? vuLookup.content : null;
    const vuHash = findVirtualUserHash(vuContent, username);
    if (vuHash !== undefined) {
      expectedHash = vuHash;
    }
    // If virtual_users.conf has no entry (or file is missing/empty),
    // fall through to /etc/passwd hash — mirrors authenticateFtpInline
    // precedence in src/hooks/useAuthentication.ts.
  }

  const authValid =
    auth.method === 'password'
      ? md5(auth.password) === expectedHash
      : auth.fingerprint === md5(`${username}:${auth.targetIp}:${expectedHash}`);

  if (!authValid) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const row: SessionRow = {
    player_key: publicKey,
    machine_id,
    // userType comes from /etc/passwd (server-derived), NOT from any
    // client claim — clients can't promote themselves to root by lying.
    credentials: { username, userType: entry.userType },
    kind,
    ...(parent_session_id !== undefined && { parent_session_id }),
    ...(source_ip !== undefined && { source_ip }),
  };

  const result = await deps.insertSession(row);
  if (!result.ok) {
    return { status: 500, body: { error: 'insert_failed' } };
  }
  return {
    status: 201,
    body: { session_id: result.session_id, userType: entry.userType },
  };
};

const handleEndSession = async (
  publicKey: string,
  payload: Extract<SessionsPayload, { action: 'endSession' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const result = await deps.endSession({
    session_id: payload.session_id,
    player_key: publicKey,
    reason: payload.reason,
  });
  if (!result.ok) {
    return { status: 500, body: { error: 'update_failed' } };
  }
  if (result.affected === 0) {
    // Collapses three cases into one 404 (intentional, see plan):
    //   - session_id doesn't exist
    //   - session belongs to another player_key
    //   - session is already ended
    // Atomic SQL UPDATE filter handles all three; no info leak.
    return { status: 404, body: { error: 'session_not_found' } };
  }
  return { status: 200, body: {} };
};

const handleListSessions = async (
  publicKey: string,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const result = await deps.listSessions({ player_key: publicKey });
  if (!result.ok) {
    return { status: 500, body: { error: 'query_failed' } };
  }
  return { status: 200, body: { sessions: result.sessions } };
};
