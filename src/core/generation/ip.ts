/**
 * Seeded public-IP generation (ported from legacy `src/generation/ip.ts`).
 *
 * `generatePublicIp` draws a routable WAN address — the public face of a home
 * router or themed network. The leading octet is picked from a fixed pool of
 * realistic hosting/cloud prefixes, so the result is never an RFC1918 private
 * range or loopback by construction (no validation pass needed).
 *
 * Legacy carried a `usedIps` collision-avoidance loop for batch allocation; it
 * is dropped here until an IP allocator needs it (single allocation today).
 */

import type { Prng } from './prng.js';
import { PLACELESS_FIRST_OCTET, REGION_FIRST_OCTETS } from './world.js';

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

/** Whether `target` is a single public address: a `x.y.z.w` inside one of the blocks
 *  the world answers in, a region's or the placeless one. Used by every command that
 *  reaches across networks to route the target to the server instead of the player's
 *  own LAN; a range, a private or own-subnet address, or any other shape is not one.
 *  Every declared network's address classifies true by construction. */
export const isPublicIp = (target: string): boolean => {
  const match = target.match(SINGLE_IP);
  if (match === null) return false;
  const firstOctet = Number(match[1]);
  return firstOctet === PLACELESS_FIRST_OCTET || REGION_FIRST_OCTETS.includes(firstOctet);
};
