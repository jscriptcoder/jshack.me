/**
 * The draws a white-hat job keeps from a player holding the bundle: streams seeded under the
 * deployment's mission secret, and the outside addresses an intruder's work names.
 *
 * SERVER ONLY by discipline. Without the secret nothing here can be worked out from a contract's
 * number, which is what lets an implant's place or an intruder's address be the job.
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createPrng, type Prng } from '../generation/prng.js';
import { networkAt, REGION_FIRST_OCTETS } from '../generation/world.js';

/** A stream for `label`, seeded by an HMAC of it under the deployment's secret. */
export const streamUnder = (secret: string, label: string): Prng =>
  createPrng(
    bytesToHex(hmac(sha256, new TextEncoder().encode(secret), new TextEncoder().encode(label))),
  );

/** An address in the world's region block that no network answers at: a host an intruder's work
 *  names, which leads nowhere and never outside the game. */
export const outsideHostOf = (prng: Prng): string => {
  for (;;) {
    const candidate = `${prng.pick(REGION_FIRST_OCTETS)}.${prng.nextInt(1, 254)}.${prng.nextInt(0, 255)}.${prng.nextInt(2, 254)}`;
    if (networkAt(candidate) === undefined) return candidate;
  }
};
