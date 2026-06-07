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
