import { lookupHomeNetworkSignedPayloadSchema, type HomeNetworkRow } from './types.js';
import type { RateLimiter } from '../ipRegistry/rateLimit.js';
import { verifySignedRequest, type VerifyFailureReason } from '../signedRequest/verify.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';

export type LookupHandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly headers?: Record<string, string>;
};

export type LookupHandlerDeps = {
  // Row lookup. Returns null when no row matches the public IP.
  readonly findNetworkByPublicIp: (publicIp: string) => Promise<HomeNetworkRow | null>;
  readonly rateLimiter: RateLimiter;
  readonly nonceStore: NonceStore;
  readonly now?: () => number;
};

const STATUS_BY_VERIFY_REASON: Record<VerifyFailureReason, number> = {
  envelope_invalid: 400,
  payload_malformed: 400,
  payload_invalid: 400,
  signature_invalid: 401,
  timestamp_skew: 401,
  replay: 401,
};

// Orchestrates the lookup flow:
//
//   1. Verify signed envelope        — auth, schema, replay protection
//   2. Rate-limit per pubkey          — abuse mitigation
//   3. Storage lookup                 — single SELECT by public_ip
//   4. Pass-through projection        — return the row as stored (no
//                                       client-supplied re-derivation)
//
// The handler exists as a function because anon SELECT on home_networks
// is otherwise blocked by RLS — the service-role client behind this
// function is the boundary. See project_cross_lan_trilogy.
export const handleLookupHomeNetworkRequest = async (
  envelope: unknown,
  deps: LookupHandlerDeps,
): Promise<LookupHandlerResponse> => {
  const verified = await verifySignedRequest(envelope, lookupHomeNetworkSignedPayloadSchema, {
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

  const row = await deps.findNetworkByPublicIp(verified.payload.public_ip);
  if (!row) {
    return { status: 404, body: { error: 'not_found' } };
  }

  return {
    status: 200,
    body: {
      public_ip: row.public_ip,
      essid_template: row.essid_template,
      density_tier: row.density_tier,
      max_slots: row.max_slots,
      seed: row.seed,
    },
  };
};
