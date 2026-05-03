import type { Prng } from '../generation/prng';

// Random LAN host octet allocation. Returns a string like '.187' — the
// host portion of a /24 subnet. The full IP is constructed at render time
// by combining the row's subnet (derived from the network seed) with this
// octet.
//
// Range [10, 250] avoids the conventional reserved low addresses (.1
// gateway, .2-.9 reservations) and the broadcast-adjacent high range
// (.251-.255). 241 slots in a max-8-occupant LAN keeps collision rolls
// rare; the UNIQUE (network_id, lan_ip) constraint catches the rest.
//
// Flat range across all density tiers is deliberate: a tier-narrowed
// range would leak crowdedness information from the assigned IP to anyone
// observing it. See README.md "Design rules" for the full rationale.
//
// Exclusion set is passed through to avoid colliding with octets that
// are NOT in `home_network_occupants` but are still reserved — chiefly
// the NPC machine octets the FS generator produced for this LAN's seed.
// Without it, a random slot pick can land on an NPC IP (e.g., the
// generator put `http-srv` at .208, and the slot allocator gave Player
// B .208) and the two views diverge: each player renders the LAN
// locally, so Player A's NPC shadows Player B's overlay. See the
// `getReservedLanOctets` helper for the source.

const MIN_OCTET = 10;
const MAX_OCTET = 250;
const MAX_RANDOM_ATTEMPTS = 50;

export type PickRandomLanIpOptions = {
  readonly excludedOctets?: ReadonlySet<number>;
};

export const pickRandomLanIp = (prng: Prng, options: PickRandomLanIpOptions = {}): string => {
  const excluded = options.excludedOctets;

  // Fast path: random rolls, retry on excluded. With 241 slots and
  // (NPCs ~10 + occupants ≤8) excluded, the expected hit rate is well
  // below 10%; capped at 50 attempts to avoid pathological loops.
  if (excluded && excluded.size > 0) {
    for (let i = 0; i < MAX_RANDOM_ATTEMPTS; i++) {
      const octet = prng.nextInt(MIN_OCTET, MAX_OCTET);
      if (!excluded.has(octet)) return `.${octet}`;
    }
    // Fallback: linear scan from a random starting point. Guarantees
    // a result if any free octet exists, at the cost of slight
    // determinism leakage (the output isn't purely PRNG-driven). Only
    // hit when excluded is dense enough that 50 random rolls all miss
    // — pathological by definition.
    const start = prng.nextInt(MIN_OCTET, MAX_OCTET);
    for (let i = 0; i <= MAX_OCTET - MIN_OCTET; i++) {
      const octet = MIN_OCTET + ((start - MIN_OCTET + i) % (MAX_OCTET - MIN_OCTET + 1));
      if (!excluded.has(octet)) return `.${octet}`;
    }
    throw new Error(`pickRandomLanIp: no free octet in [${MIN_OCTET}, ${MAX_OCTET}]`);
  }

  return `.${prng.nextInt(MIN_OCTET, MAX_OCTET)}`;
};
