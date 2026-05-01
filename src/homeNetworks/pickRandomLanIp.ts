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
// observing it. See plans/home-network-occupants.md (Out of Scope §
// Tier-influenced LAN address ranges).

export const pickRandomLanIp = (prng: Prng): string => {
  return `.${prng.nextInt(10, 250)}`;
};
