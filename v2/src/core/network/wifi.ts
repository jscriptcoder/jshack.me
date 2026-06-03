/**
 * WiFi network model (connectivity arc).
 *
 * The access points a player's `airdump` sees and `aircrack`/`nmcli` act on.
 * Ported + simplified from legacy `network/wifiNetworks.ts` + `bssidFromEssid`.
 *
 * Design (grill-me decision 2): a DISCRIMINATED union on `crackable`, so the
 * password lives on the type system's happy path — only a `crackable: true` AP
 * has a `password`, and TypeScript forbids reading it off a noise AP. No `tier`
 * (home-network density) yet — it ships with the shared-LAN model. The
 * `WPA2|WPA3|WEP|OPEN` enum is kept for display fidelity even though generation
 * only emits WPA2/WPA3 (the crackability gates) — WEP/OPEN mechanics deferred.
 *
 * A `crackable: false` AP still carries `encryption`/`power`/`essid` so
 * `aircrack` can pick the right failure reason (WPA3 / weak signal / hidden)
 * without a separate tag — the failure is re-derived from observable state.
 */

import { sha256 } from '@noble/hashes/sha2.js';

export type WifiEncryption = 'WPA2' | 'WPA3' | 'WEP' | 'OPEN';

type WifiNetworkBase = {
  readonly bssid: string;
  readonly essid: string;
  /** Signal strength in dBm (negative; closer to 0 = stronger). */
  readonly power: number;
  readonly channel: number;
  readonly encryption: WifiEncryption;
};

export type WifiNetwork =
  | (WifiNetworkBase & { readonly crackable: true; readonly password: string })
  | (WifiNetworkBase & { readonly crackable: false });

/**
 * Deterministic BSSID (AP MAC) from the ESSID: the first six bytes of
 * sha256(essid) as uppercase colon-joined hex. The AP's MAC is a function of
 * its identity (ESSID), not of per-player PRNG state, so the same network shows
 * the same BSSID to every player who sees it.
 *
 * For hidden APs, callers derive from the ORIGINAL essid (before the `<hidden>`
 * placeholder is substituted) so hidden entries don't all collide on one BSSID.
 */
export const bssidFromEssid = (essid: string): string => {
  const hash = sha256(new TextEncoder().encode(essid));
  return [0, 1, 2, 3, 4, 5]
    .map((index) => hash[index]!.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
};
