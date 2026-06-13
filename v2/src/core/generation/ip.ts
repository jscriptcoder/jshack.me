/**
 * Seeded public-IP generation (ported from legacy `src/generation/ip.ts`).
 *
 * `generatePublicIp` draws a routable WAN address — the public face of a home
 * router or themed network. The leading octet is picked from a fixed pool of
 * realistic hosting/cloud prefixes, so the result is never an RFC1918 private
 * range or loopback by construction (no validation pass needed).
 *
 * Legacy carried a `usedIps` collision-avoidance loop for batch allocation; it
 * is dropped here until an IP registry needs it (single allocation today).
 */

import type { Prng } from './prng';

/** Realistic public IP first-octet pool (routable hosting/cloud prefixes). */
export const publicFirstOctets: readonly number[] = [
  45, 51, 62, 78, 91, 103, 138, 162, 185, 198, 203, 212,
];

export const generatePublicIp = (prng: Prng): string => {
  const first = prng.pick(publicFirstOctets);
  const second = prng.nextInt(1, 254);
  const third = prng.nextInt(1, 254);
  const fourth = prng.nextInt(2, 254);
  return `${first}.${second}.${third}.${fourth}`;
};

const SINGLE_IP = /^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** Whether `target` is a single public IP the game could have generated — a
 *  `x.y.z.w` whose first octet is one of the routable prefixes. Used by `nmap` to
 *  route a public-IP target to cross-player server resolution instead of the
 *  player's own LAN; a range, a private/own-subnet address, or any other shape is
 *  not a cross-player target. Consistent-by-construction with `generatePublicIp`
 *  (same prefix pool), so every registered public IP classifies true. */
export const isPublicIp = (target: string): boolean => {
  const match = target.match(SINGLE_IP);
  return match !== null && publicFirstOctets.includes(Number(match[1]));
};
