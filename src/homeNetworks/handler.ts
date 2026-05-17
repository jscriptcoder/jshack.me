import {
  joinHomeNetworkSignedPayloadSchema,
  lookupHomeNetworkSignedPayloadSchema,
  MAX_SLOTS_BY_TIER,
  type DensityTier,
  type HomeNetworkOccupantRow,
  type HomeNetworkRow,
  type InsertOccupantResult,
  type OccupantSummary,
} from './types.js';
import type { RateLimiter } from '../ipRegistry/rateLimit.js';
import { verifySignedRequest, type VerifyFailureReason } from '../signedRequest/verify.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import { deriveHostnameSuffix } from './homeNetworkHelpers.js';

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly headers?: Record<string, string>;
};

export type HandlerDeps = {
  // DB ops — injected so the handler stays pure and tests can compose the
  // five behaviors (idempotent return, find-existing, create-new, allocate-
  // slot, retry-on-collision) without a live Supabase.
  readonly findOccupantByPlayer: (params: {
    readonly essidTemplate: string;
    readonly densityTier: DensityTier;
    readonly playerKey: string;
  }) => Promise<{
    readonly network: HomeNetworkRow;
    readonly occupant: HomeNetworkOccupantRow;
  } | null>;
  readonly findNetworkWithFreeSlots: (params: {
    readonly essidTemplate: string;
    readonly densityTier: DensityTier;
  }) => Promise<HomeNetworkRow | null>;
  readonly createNetwork: (params: {
    readonly publicIp: string;
    readonly essidTemplate: string;
    readonly densityTier: DensityTier;
    readonly maxSlots: number;
    readonly seed: string;
  }) => Promise<HomeNetworkRow>;
  readonly insertOccupant: (row: HomeNetworkOccupantRow) => Promise<InsertOccupantResult>;
  // Returns null when the IP space is exhausted (existing allocator's
  // 'exhausted' bucket).
  readonly allocatePublicIp: () => Promise<string | null>;
  // Slot allocator. Receives the network identity so the wiring layer
  // can compute the per-network exclusion set (NPC octets reserved by
  // the FS generator + octets already taken by other occupants). Async
  // because the wiring queries Supabase + regenerates the topology to
  // build the exclusion set; results are deterministic for a given
  // (seed, publicIp) pair so the wiring can memoize if needed.
  readonly pickLanIp: (input: {
    readonly seed: string;
    readonly publicIp: string;
  }) => Promise<string>;
  // Realtime hint broadcast: fired after a successful occupant INSERT
  // so subscribed clients on the same LAN refetch live. The payload is
  // just (network_id, originator_key) — receivers do the actual data
  // fetch via listOccupants. Forging the hint cannot corrupt UI state
  // because there's no row content to inject. Fire-and-forget —
  // broadcast failures are swallowed inside publishOccupantChange and
  // don't affect the HTTP response.
  //
  // Optional: tests + alternate adapters that don't care about
  // broadcasts can skip wiring the dep. NOT called on the idempotent
  // existing-row return (nothing changed) or on any failure path
  // (lan_ip_conflict-exhausted, hostname_conflict, insert error,
  // ip_allocation_exhausted).
  //
  // See homeNetworks/broadcast.ts and project_realtime_publish_-
  // authorization memory.
  readonly publishOccupantChange?: (network_id: string, originator_key: string) => Promise<void>;
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

// Bound on slot retries. With a 241-wide range and ≤8 occupants per LAN,
// the probability of even one collision is tiny; 20 retries is comfortably
// above any realistic conflict rate without burning unbounded DB time on a
// pathological case (e.g., a stuck schema where all slots are taken).
const MAX_SLOT_ALLOCATION_ATTEMPTS = 20;

// Orchestrates the join flow:
//
//   1. Verify signed envelope        — auth, schema, replay protection
//   2. Rate-limit per pubkey          — abuse mitigation
//   3. Idempotent existing-row return — server is source of truth for "did
//                                       I already join this LAN"
//   4. Find-or-create network         — fill existing rows before spawning
//                                       new ones
//   5. Allocate slot with retry       — random IP, retry on collision
//
// player_key is always derived from the verified pubkey, never from the
// payload — the strict Zod schema rejects any client-supplied owner field.
export const handleJoinHomeNetworkRequest = async (
  envelope: unknown,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(envelope, joinHomeNetworkSignedPayloadSchema, {
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

  const playerKey = `ed25519:${verified.publicKey}`;
  const { essid_template, density_tier, workstation_prefix } = verified.payload;
  const hostname = `${workstation_prefix}-${deriveHostnameSuffix(playerKey)}`;

  const existing = await deps.findOccupantByPlayer({
    essidTemplate: essid_template,
    densityTier: density_tier,
    playerKey,
  });
  if (existing) {
    return {
      status: 200,
      body: {
        public_ip: existing.network.public_ip,
        lan_ip: existing.occupant.lan_ip,
        hostname: existing.occupant.hostname,
        network_seed: existing.network.seed,
      },
    };
  }

  let network = await deps.findNetworkWithFreeSlots({
    essidTemplate: essid_template,
    densityTier: density_tier,
  });
  if (!network) {
    const publicIp = await deps.allocatePublicIp();
    if (!publicIp) {
      return { status: 500, body: { error: 'ip_allocation_exhausted' } };
    }
    network = await deps.createNetwork({
      publicIp,
      essidTemplate: essid_template,
      densityTier: density_tier,
      maxSlots: MAX_SLOTS_BY_TIER[density_tier],
      seed: `home-${publicIp}`,
    });
  }

  for (let attempt = 0; attempt < MAX_SLOT_ALLOCATION_ATTEMPTS; attempt++) {
    const lanIp = await deps.pickLanIp({ seed: network.seed, publicIp: network.public_ip });
    const occupant: HomeNetworkOccupantRow = {
      network_id: network.public_ip,
      player_key: playerKey,
      lan_ip: lanIp,
      hostname,
    };
    const result = await deps.insertOccupant(occupant);
    if (result === 'ok') {
      // Realtime hint: notify other LAN occupants that membership
      // changed. Receivers refetch via listOccupants for authoritative
      // state. Self-skip uses originator_key === own player_key.
      if (deps.publishOccupantChange) {
        await deps.publishOccupantChange(network.public_ip, playerKey);
      }
      return {
        status: 200,
        body: {
          public_ip: network.public_ip,
          lan_ip: lanIp,
          hostname,
          network_seed: network.seed,
        },
      };
    }
    if (result === 'hostname_conflict') {
      // Suffix is identity-derived; retrying lan_ip won't change it. Bail
      // immediately rather than burning the retry budget on a deterministic
      // conflict.
      return { status: 409, body: { error: 'hostname_conflict' } };
    }
    if (result === 'error') {
      return { status: 500, body: { error: 'occupant_insert_failed' } };
    }
    // 'lan_ip_conflict' → loop with a fresh roll
  }

  return { status: 500, body: { error: 'slot_allocation_exhausted' } };
};

// ---------------------------------------------------------------------------
// handleLookupHomeNetworkRequest — piece-2b lazy-subscription primitive
//
// Resolves a foreign public IP to (public_ip, occupants[]). public_ip IS
// the router's machine_id by construction (router.ip === router.publicIp,
// see src/network/networkUtils.ts) so callers can subscribe to it
// directly. Occupants are included to save a follow-up round-trip during
// the Chunk D foothold-driven LAN expansion — they're not subscribed-to
// here; the caller decides when (on foothold).
//
// Signing is for rate-limit attribution + replay protection. The response
// data is anon-public (same projection as listOccupants, plus the public
// IP which is by definition external-facing).
// ---------------------------------------------------------------------------

export type LookupHomeNetworkDeps = {
  // Looks up the home_networks row by public_ip. Returns null when no row
  // matches — the handler turns that into a 404.
  readonly findHomeNetworkByPublicIp: (publicIp: string) => Promise<HomeNetworkRow | null>;
  // Returns the same projection as listOccupants for a given network_id.
  // Empty array is a valid result (brand-new home_networks row before
  // first occupant lands).
  readonly listOccupantsByNetworkId: (networkId: string) => Promise<readonly OccupantSummary[]>;
  readonly rateLimiter: RateLimiter;
  readonly nonceStore: NonceStore;
  readonly now?: () => number;
};

export const handleLookupHomeNetworkRequest = async (
  envelope: unknown,
  deps: LookupHomeNetworkDeps,
): Promise<HandlerResponse> => {
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

  const network = await deps.findHomeNetworkByPublicIp(verified.payload.public_ip);
  if (!network) {
    return { status: 404, body: { error: 'not_found' } };
  }

  const occupants = await deps.listOccupantsByNetworkId(network.public_ip);

  return {
    status: 200,
    body: {
      public_ip: network.public_ip,
      occupants: [...occupants],
    },
  };
};
