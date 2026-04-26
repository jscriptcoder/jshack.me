import type { Identity } from '../identity/identity.js';
import { signRequest } from '../signedRequest/sign.js';
import type { Credentials, SessionSummary } from './types.js';

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
