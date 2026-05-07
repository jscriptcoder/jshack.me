import {
  registerWorkstationSignedPayloadSchema,
  type PopulateBaseFsResult,
  type UpsertWorkstationResult,
  type WorkstationRow,
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
  readonly upsertWorkstation: (row: WorkstationRow) => Promise<UpsertWorkstationResult>;
  // populateBaseFs takes rootPassword separately from the row because
  // rootPassword is transient — used to generate correct /etc/passwd
  // hash content at register-time and then discarded. It does NOT
  // belong on WorkstationRow (which is the persistence shape).
  readonly populateBaseFs: (
    row: WorkstationRow,
    rootPassword: string,
  ) => Promise<PopulateBaseFsResult>;
  readonly rateLimiter: RateLimiter;
  readonly nonceStore: NonceStore;
  readonly now?: () => number;
};

// HTTP status mapping for verifySignedRequest failures. Auth-class
// problems (signature, replay, ts skew) map to 401; structural problems
// (envelope/payload shape) map to 400. Mirror of sessionRegistry's
// table — kept local for now; candidate for extraction in a later
// refactor pass.
const STATUS_BY_VERIFY_REASON: Record<VerifyFailureReason, number> = {
  envelope_invalid: 400,
  payload_malformed: 400,
  payload_invalid: 400,
  signature_invalid: 401,
  timestamp_skew: 401,
  replay: 401,
};

// Pure request handler for POST /api/register-workstation. Idempotently
// records the player's own workstation server-side and populates the
// L2 projection (machine_filesystems) with the workstation's base FS
// so non-owner forged envelopes hit a real walker check instead of the
// leaf-only permit fallback. See plans/l2-own-workstation-backfill.md.
//
// player_key is server-stamped from the verified pubkey — never trusted
// from the wire. The payload only carries (workstation_name, username);
// those are the only fields strictly needed to regen the FS structure
// (the Step 1 invariant test pins this), and they're treated as
// immutable per player_key — differing values on re-register surface
// as 409 to keep the workstation_id stable across calls.
export const handleRegisterWorkstationRequest = async (
  envelope: unknown,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(envelope, registerWorkstationSignedPayloadSchema, {
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

  const row: WorkstationRow = {
    player_key: verified.publicKey,
    workstation_name: verified.payload.workstation_name,
    username: verified.payload.username,
    seed: verified.payload.seed,
  };

  const upserted = await deps.upsertWorkstation(row);
  if (!upserted.ok) {
    return { status: 500, body: { error: 'upsert_failed' } };
  }

  if (!upserted.inserted) {
    // Idempotent path. Compare immutable fields; mismatch is 409 since
    // changing username would reshape the FS structure and orphan every
    // dependent machine_filesystems row.
    const matches =
      upserted.existing.workstation_name === row.workstation_name &&
      upserted.existing.username === row.username;
    if (!matches) {
      return { status: 409, body: { error: 'already_registered' } };
    }
    return { status: 200, body: { inserted: false } };
  }

  // Fresh row — populate machine_filesystems base-FS so L2 enforces.
  // Best-effort: log + proceed on failure (matches the home/world
  // populate posture; the backfill script in Step 6 catches misses).
  const populated = await deps.populateBaseFs(row, verified.payload.rootPassword);
  if (!populated.ok) {
    console.error(
      '[register-workstation] base-FS populate failed for',
      row.player_key,
      row.workstation_name,
    );
  }

  return { status: 201, body: { inserted: true } };
};
