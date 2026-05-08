import type { Identity } from '../identity/identity.js';
import { signRequest } from '../signedRequest/sign.js';
import type {
  AuthMethod,
  AuthRequiredKind,
  Credentials,
  SessionKind,
  SessionSummary,
} from './types.js';
import type { UserType } from '../session/types.js';

// Browser-side wrappers for POST /api/sessions. Single endpoint with
// action-dispatch — each wrapper signs an envelope with the matching
// `action` field and POSTs it.
//
// Pattern mirrors src/ipRegistry/client.ts (allocatePublicIp). All three
// functions accept an injectable `fetch` for testability.
//
// Future patches/missions endpoints will follow the same shape — at that
// point we'll likely extract a shared `signedPost` helper. Inlining for
// now keeps each wrapper readable end-to-end.

const SESSIONS_URL = '/api/sessions';

const postEnvelope = async (envelope: unknown, fetchImpl: typeof fetch): Promise<Response> =>
  fetchImpl(SESSIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });

// ---- createSession ---------------------------------------------------------

export type CreateSessionRequest = {
  readonly machine_id: string;
  readonly credentials: Credentials;
  readonly parent_session_id?: string;
  readonly source_ip?: string;
  // Required as of PR 2 step 5 of plans/cross-player-base-fs-replication.md.
  // Auth-required kinds (ssh/scp/su) are rejected by the server here
  // and must use authCreateSession instead. Other kinds (exploit, snmp,
  // nc, ftp, mysql, redis, effect_one_shot) keep using createSession.
  readonly kind: SessionKind;
};

export const createSession = async (
  identity: Identity,
  request: CreateSessionRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<string> => {
  const envelope = signRequest(identity, 'createSession', { ...request });
  const response = await postEnvelope(envelope, fetchImpl);

  if (!response.ok) {
    throw new Error(`createSession failed with status ${response.status}`);
  }

  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null || !('session_id' in data)) {
    throw new Error('createSession returned malformed response (missing session_id)');
  }
  const sessionId = (data as { readonly session_id: unknown }).session_id;
  if (typeof sessionId !== 'string') {
    throw new Error('createSession returned malformed response (session_id is not a string)');
  }
  return sessionId;
};

// ---- authCreateSession -----------------------------------------------------

export type AuthCreateSessionRequest = {
  readonly machine_id: string;
  readonly kind: AuthRequiredKind;
  readonly username: string;
  readonly auth: AuthMethod;
  readonly parent_session_id?: string;
  readonly source_ip?: string;
};

// Result type — distinguishes "credentials failed" (an EXPECTED outcome
// that the SSH UX handles with a "Permission denied" message) from
// "infrastructure failed" (network, server error, malformed response —
// treated as exceptions that propagate to the user as an error toast).
//
// reason='invalid_credentials' covers wrong password, missing user,
// missing /etc/passwd, sabotaged file, fingerprint mismatch — all
// collapse to one server response (no info leak), and the client
// preserves that collapse on the result side.
export type AuthCreateSessionResult =
  | { readonly ok: true; readonly session_id: string; readonly userType: UserType }
  | { readonly ok: false; readonly reason: 'invalid_credentials' | 'rate_limited' };

const isUserType = (v: unknown): v is UserType => v === 'root' || v === 'user' || v === 'guest';

export const authCreateSession = async (
  identity: Identity,
  request: AuthCreateSessionRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthCreateSessionResult> => {
  const envelope = signRequest(identity, 'authCreateSession', { ...request });
  const response = await postEnvelope(envelope, fetchImpl);

  if (response.status === 201) {
    const data: unknown = await response.json();
    if (typeof data !== 'object' || data === null) {
      throw new Error('authCreateSession returned malformed response (not an object)');
    }
    const sessionId = (data as { readonly session_id?: unknown }).session_id;
    const userType = (data as { readonly userType?: unknown }).userType;
    if (typeof sessionId !== 'string') {
      throw new Error('authCreateSession returned malformed response (missing session_id)');
    }
    if (!isUserType(userType)) {
      throw new Error('authCreateSession returned malformed response (missing or invalid userType)');
    }
    return { ok: true, session_id: sessionId, userType };
  }

  // Expected credential-failure mode: server returned 401 with
  // body.error === 'invalid_credentials'. Other 401s (signature_invalid,
  // replay, timestamp_skew) are envelope-level errors that indicate the
  // CLIENT is broken — those throw rather than return a soft failure.
  if (response.status === 401) {
    const body: unknown = await response.json().catch(() => null);
    if (
      typeof body === 'object' &&
      body !== null &&
      (body as { readonly error?: unknown }).error === 'invalid_credentials'
    ) {
      return { ok: false, reason: 'invalid_credentials' };
    }
    throw new Error(`authCreateSession failed with status 401 (envelope-level)`);
  }

  if (response.status === 429) {
    return { ok: false, reason: 'rate_limited' };
  }

  throw new Error(`authCreateSession failed with status ${response.status}`);
};

// ---- endSession ------------------------------------------------------------

export type EndSessionRequest = {
  readonly session_id: string;
  readonly reason: string;
};

export const endSession = async (
  identity: Identity,
  request: EndSessionRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<void> => {
  const envelope = signRequest(identity, 'endSession', { ...request });
  const response = await postEnvelope(envelope, fetchImpl);

  if (!response.ok) {
    throw new Error(`endSession failed with status ${response.status}`);
  }
  // 200 has empty body — discard.
};

// ---- listSessions ----------------------------------------------------------

export const listSessions = async (
  identity: Identity,
  fetchImpl: typeof fetch = fetch,
): Promise<ReadonlyArray<SessionSummary>> => {
  const envelope = signRequest(identity, 'listSessions', {});
  const response = await postEnvelope(envelope, fetchImpl);

  if (!response.ok) {
    throw new Error(`listSessions failed with status ${response.status}`);
  }

  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null || !('sessions' in data)) {
    throw new Error('listSessions returned malformed response (missing sessions)');
  }
  const sessions = (data as { readonly sessions: unknown }).sessions;
  if (!Array.isArray(sessions)) {
    throw new Error('listSessions returned malformed response (sessions is not an array)');
  }
  // Trust the server's row shape (it produced them server-side from the
  // sessions table). Future hardening could zod-validate each entry.
  return sessions as ReadonlyArray<SessionSummary>;
};
