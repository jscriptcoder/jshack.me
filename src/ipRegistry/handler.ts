import { allocateIp, type AllocateIpDeps } from './allocate.js';
import type { RateLimiter } from './rateLimit.js';
import { allocateIpSignedPayloadSchema, type AllocateIpRequest } from './types.js';
import { verifySignedRequest, type VerifyFailureReason } from '../signedRequest/verify.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly headers?: Record<string, string>;
};

export type HandlerDeps = AllocateIpDeps & {
  readonly rateLimiter: RateLimiter;
  readonly nonceStore: NonceStore;
  readonly now?: () => number;
};

// HTTP status mapping for verifySignedRequest failures. Auth-class problems
// (signature, replay, ts skew) get 401; structural problems get 400. The
// distinction matters for clients that retry — 401 means re-sign, 400 means
// the payload itself is malformed.
const STATUS_BY_VERIFY_REASON: Record<VerifyFailureReason, number> = {
  envelope_invalid: 400,
  payload_malformed: 400,
  payload_invalid: 400,
  signature_invalid: 401,
  timestamp_skew: 401,
  replay: 401,
};

// Pure request handler. Order:
//
//   1. Verify signed envelope — Ed25519 signature, payload schema, ts window,
//      nonce dedupe. Cheap CPU checks first; the nonce store hits Upstash only
//      after everything else passed.
//   2. Rate-limit on the verified public key. Switched from caller-IP because
//      shared NAT (school networks, mobile carriers) made IP-based rate
//      limiting collateral-damage prone.
//   3. Allocate — server-side roll + INSERT-with-retry on PK conflict. The
//      owner_key column is stamped server-side from the verified pubkey, so
//      players can't allocate IPs in someone else's name even via Burp/curl.
//
// See docs/technology-choices.md ("Authenticated requests") for the broader
// design.
export const handleAllocateRequest = async (
  envelope: unknown,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(envelope, allocateIpSignedPayloadSchema, {
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

  const { kind, instance_ref } = verified.payload;
  const request: AllocateIpRequest = {
    kind,
    owner_key: `ed25519:${verified.publicKey}`,
    ...(instance_ref !== undefined && { instance_ref }),
  };

  const result = await allocateIp(request, deps);
  if (!result.ok) {
    return { status: 500, body: { error: result.error } };
  }

  return { status: 200, body: { ip: result.ip } };
};
