import { sha256 } from '@noble/hashes/sha2.js';

// Deterministic BSSID derivation: the AP's MAC address is a function of
// the ESSID (the access point's identity in our model), not of the
// per-player PRNG state. Two players who see the same ESSID see the
// same BSSID — matching real WiFi where one physical AP has exactly
// one MAC address.
//
// The previous per-PRNG generation produced different BSSIDs for the
// same ESSID across players with different gameSeeds, which surfaced
// during PR #88 smoke-testing as a realism break (CASA-DE-RAMIREZ
// appearing with a different MAC in each browser).
//
// For noise WiFis with the 'hidden' reason, callers should derive from
// the ORIGINAL essid (before the `<hidden>` placeholder is substituted)
// — otherwise every hidden entry in a network would collide on the
// same BSSID.

export const bssidFromEssid = (essid: string): string => {
  const hash = sha256(new TextEncoder().encode(essid));
  return [0, 1, 2, 3, 4, 5]
    .map((i) => hash[i]!.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
};
