import { z } from 'zod';

// Density tier on a home_networks row. Mirrors the WifiTier on the
// crackable WiFi catalog (src/network/wifiNetworks.ts) — the tier of the
// cracked ESSID flows through to the LAN's max occupancy.
export const DENSITY_TIERS = ['crowded', 'shared', 'solo'] as const;
export type DensityTier = (typeof DENSITY_TIERS)[number];

// Maximum occupants per density tier. Drives find-or-create: a row with
// occupants < max_slots has room for the joining player; otherwise a new
// row is allocated.
export const MAX_SLOTS_BY_TIER: Readonly<Record<DensityTier, number>> = {
  crowded: 8,
  shared: 3,
  solo: 1,
};

// Schema for the signed payload that clients POST to /api/join-home-network.
// Strict — rejects unknown fields. workstation_prefix capped at 32 chars to
// leave headroom for the 4-hex suffix and dash within the 63-char Linux
// hostname limit.
export const joinHomeNetworkSignedPayloadSchema = z
  .object({
    action: z.literal('joinHomeNetwork'),
    ts: z.number().int(),
    nonce: z.string().regex(/^[0-9a-f]{32}$/i),
    essid_template: z.string().min(1).max(64),
    density_tier: z.enum(DENSITY_TIERS),
    workstation_prefix: z.string().min(1).max(32),
  })
  .strict();

export type JoinHomeNetworkSignedPayload = z.infer<typeof joinHomeNetworkSignedPayloadSchema>;

// Database row shapes — used by the handler's injected DB ops.
export type HomeNetworkRow = {
  readonly public_ip: string;
  readonly essid_template: string;
  readonly density_tier: DensityTier;
  readonly max_slots: number;
  readonly seed: string;
};

export type HomeNetworkOccupantRow = {
  readonly network_id: string;
  readonly player_key: string;
  readonly lan_ip: string;
  readonly hostname: string;
};

// Response payload returned to the client on a successful join. Schema is
// the source of truth — derive the type so the client wrapper can validate
// untrusted server responses with the same shape the handler returns.
export const joinResultSchema = z
  .object({
    public_ip: z.string(),
    lan_ip: z.string(),
    hostname: z.string(),
    network_seed: z.string(),
  })
  .strict();

export type JoinResult = z.infer<typeof joinResultSchema>;

// Outcome of attempting one occupant INSERT. The storage adapter (Step 4)
// classifies Postgres unique-constraint violations into these buckets so
// the handler can route correctly: lan_ip_conflict warrants a retry with
// a new IP; hostname_conflict is deterministic (suffix is identity-derived,
// retrying lan_ip won't change it) and returns immediately.
export type InsertOccupantResult = 'ok' | 'lan_ip_conflict' | 'hostname_conflict' | 'error';

// Public-readable shape of a home_network_occupants row. Used by
// listOccupants (anon SELECT) so HomeNetworksProvider can render other
// players on the active LAN as discoverable machines in nmap. Schema is
// runtime-validated before the data hits React state.
//
// player_key is intentionally NOT projected — public keys are
// cryptographically safe to share, but exposing them lets any LAN peer
// link a player across other networks they share. The hostname column
// (workstation_id, identity-derived) already supports cross-player
// addressing for gameplay; the player_key adds nothing the client uses
// and a future "rename workstation" feature shouldn't be defeated by a
// stale field nobody actually consumes. Self-filtering uses hostname
// comparison instead — see HomeNetworksContext.
export const occupantSummarySchema = z
  .object({
    network_id: z.string(),
    lan_ip: z.string(),
    hostname: z.string(),
  })
  .strict();

export type OccupantSummary = z.infer<typeof occupantSummarySchema>;

// IPv4 dotted-quad regex. Permissive on leading-zero octets (Linux ifconfig
// would accept them too); strict on the four-octets-of-1-to-3-digits shape.
// Used by lookupHomeNetwork to reject obviously-malformed inputs before they
// reach the DB. The handler itself is content-agnostic — a syntactically
// valid but unallocated public_ip simply returns 404.
const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// Schema for the signed payload that clients POST to /api/lookup-home-network.
// Used by piece-2b lazy subscription: first touch of a foreign public IP
// resolves to {public_ip, occupants[]} so the client can subscribe to the
// foreign router's machine_id (which IS the public_ip) and cache occupants
// for foothold-driven LAN expansion (Chunk D).
//
// Strict — rejects unknown fields. The signature attributes calls to a
// pubkey so the rate limiter can throttle abuse; the response data itself
// is anon-public (same projection as listOccupants + the public_ip column
// from home_networks).
export const lookupHomeNetworkSignedPayloadSchema = z
  .object({
    action: z.literal('lookupHomeNetwork'),
    ts: z.number().int(),
    nonce: z.string().regex(/^[0-9a-f]{32}$/i),
    public_ip: z.string().regex(IPV4_REGEX),
  })
  .strict();

export type LookupHomeNetworkSignedPayload = z.infer<typeof lookupHomeNetworkSignedPayloadSchema>;

// Response payload returned to the client on a successful lookup.
// public_ip is the router's machine_id (router.ip === router.publicIp by
// construction — see src/network/networkUtils.ts), so callers can pass it
// straight to subscribeToMachine without further translation. Occupants
// are the same projection as listOccupants — included here to save a
// follow-up round-trip during Chunk D's foothold expansion. essid_template
// feeds generateHomeNetwork's `essid` field during foreign-router regen
// so UI surfaces (nmap output, hostname resolution, future findit.io
// listings) render the real ESSID instead of a placeholder.
export const lookupHomeNetworkResultSchema = z
  .object({
    public_ip: z.string(),
    essid_template: z.string(),
    occupants: z.array(occupantSummarySchema),
  })
  .strict();

export type LookupHomeNetworkResult = z.infer<typeof lookupHomeNetworkResultSchema>;
