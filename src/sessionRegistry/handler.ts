import {
  createSessionSignedPayloadSchema,
  type InsertSessionResult,
  type SessionRow,
} from './types.js';
import type { RateLimiter } from '../ipRegistry/rateLimit.js';
import { verifySignedRequest, type VerifyFailureReason } from '../signedRequest/verify.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly headers?: Record<string, string>;
};

export type HandlerDeps = {
  readonly insertSession: (row: SessionRow) => Promise<InsertSessionResult>;
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

// Pure request handler for POST /api/sessions. Order:
//
//   1. Verify signed envelope — Ed25519 signature, payload schema, ts
//      window, nonce dedupe. Cheap CPU checks first; the nonce store
//      hits Upstash only after everything else passed.
//   2. Rate-limit on the verified public key (per-pubkey, like allocate-ip).
//   3. Insert session row — player_key is server-stamped from the verified
//      pubkey, never trusted from client claims.
//
// Action dispatch: this handler currently only accepts createSession.
// endSession + listSessions will land in subsequent steps and switch to
// a discriminated-union schema.
export const handleSessionsRequest = async (
  envelope: unknown,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(envelope, createSessionSignedPayloadSchema, {
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

  const { machine_id, credentials, parent_session_id, source_ip } = verified.payload;
  const row: SessionRow = {
    player_key: verified.publicKey,
    machine_id,
    credentials,
    ...(parent_session_id !== undefined && { parent_session_id }),
    ...(source_ip !== undefined && { source_ip }),
  };

  const result = await deps.insertSession(row);
  if (!result.ok) {
    return { status: 500, body: { error: 'insert_failed' } };
  }

  return { status: 200, body: { session_id: result.session_id } };
};
