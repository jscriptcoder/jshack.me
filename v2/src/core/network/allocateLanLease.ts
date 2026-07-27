/**
 * allocateLanLease — pure server-side DHCP-style address allocation for an occupant
 * of an AP's `/24`.
 *
 * Where the AP's public IP is ONE address per ESSID shared by every occupant, a LAN
 * lease is per `(essid, owner_key)`: each occupant holds its own host octet, and no
 * two occupants of one ESSID may hold the same one. That uniqueness is a database
 * constraint rather than an application check, because a read-then-insert has a
 * lost-update race that only a constraint (or a transaction) closes.
 *
 * The lease is PERMANENT and deliberately outlives occupancy: `unregisterOccupant`
 * deletes the occupancy row on disconnect, but the lease stays, so reconnecting to a
 * network returns you to the address you had.
 *
 * The first candidate offered is the occupant's PREFERRED octet — the address the
 * pure `assignHomeNetwork` derivation issues. Seeding from it means every occupant
 * already connected under the derivation leases the address it is already using, so
 * moving the readers onto leases relocates nobody except genuinely-colliding
 * players. Only a collision redraws.
 *
 * The store effects are injected so this stays framework-agnostic `core/`; the
 * Supabase wiring (an `INSERT … ON CONFLICT (essid, owner_key) DO NOTHING`) lives in
 * the `api/` adapter.
 */

import type { Prng } from '../generation/prng';

/** Usable host octets on a `/24`: `.0` is the network address, `.1` is the AP
 *  gateway (a real machine an occupant would otherwise be impersonating), and
 *  `.255` is broadcast. */
const LAN_OCTET_MIN = 2;
const LAN_OCTET_MAX = 254;

/** Bounded redraws. Unlike the public-IP allocator — whose address space is large
 *  enough that exhaustion is purely pathological — this pool is 253 wide, so
 *  exhaustion is reachable in principle. It stays vanishingly unlikely at any
 *  plausible occupancy (with 50 occupants on one AP, all 8 attempts colliding is
 *  ~2e-6), and failing cleanly beats looping on a genuinely full subnet. */
const DEFAULT_MAX_ATTEMPTS = 8;

export type AllocateLanLeaseDeps = {
  /** The octet already leased to this `(essid, owner_key)`, or null if none yet. */
  readonly readLease: (essid: string, ownerKey: string) => Promise<number | null>;
  /** Draw a replacement octet outside `excluded` (server randomness in production).
   *  Never consulted while the preferred octet is still available and usable. The
   *  allocator hands the exclusion set in rather than letting the draw hold its own
   *  copy, so one place decides which octets are off-limits. */
  readonly redrawOctet: (excluded: ReadonlySet<number>) => number;
  /**
   * Atomically bind `(essid, ownerKey) → octet`. Returns the octet now leased to the
   * occupant — the offered one if it stuck, or the one a concurrent write for the
   * SAME occupant already bound — or null if that octet belongs to ANOTHER occupant
   * of the ESSID (redraw).
   */
  readonly claim: (essid: string, ownerKey: string, octet: number) => Promise<number | null>;
  readonly maxAttempts?: number;
};

export type LanLeaseRequest = {
  readonly essid: string;
  readonly ownerKey: string;
  readonly preferredOctet: number;
  /** Octets no occupant may be issued: the ESSID's own generated hosts. The population
   *  is shared by everyone on the AP, so an occupant leased on top of an NPC does not
   *  merely hide it from itself — that machine disappears for every occupant, orphaning
   *  any journal already written to it. */
  readonly excludedOctets?: ReadonlySet<number>;
};

const NOTHING_EXCLUDED: ReadonlySet<number> = new Set();

/** A uniformly drawn usable host octet that is not in `excluded`. Drawing from the
 *  ALLOWED pool rather than rejecting afterwards is what keeps an exclusion from
 *  costing an attempt: every draw is a candidate worth claiming. */
export const drawLanOctet = (prng: Prng, excluded: ReadonlySet<number> = NOTHING_EXCLUDED): number => {
  const usable = Array.from(
    { length: LAN_OCTET_MAX - LAN_OCTET_MIN + 1 },
    (_unused, index) => index + LAN_OCTET_MIN,
  ).filter((octet) => !excluded.has(octet));
  if (usable.length === 0) throw new Error('no usable LAN octet remains on this subnet');
  return usable[prng.nextInt(0, usable.length - 1)]!;
};

export const allocateLanLease = async (
  request: LanLeaseRequest,
  deps: AllocateLanLeaseDeps,
): Promise<number> => {
  // An address already held outranks the exclusion: it governs what may be ISSUED, not
  // what is already in use, so a returning occupant is never relocated out from under
  // a saved connection.
  const existing = await deps.readLease(request.essid, request.ownerKey);
  if (existing !== null) return existing;

  const excluded = request.excludedOctets ?? NOTHING_EXCLUDED;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const preferredIsUsable = !excluded.has(request.preferredOctet);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate =
      attempt === 0 && preferredIsUsable ? request.preferredOctet : deps.redrawOctet(excluded);
    const leased = await deps.claim(request.essid, request.ownerKey, candidate);
    if (leased !== null) return leased;
  }
  throw new Error(`LAN lease allocation exhausted after ${maxAttempts} attempts`);
};
