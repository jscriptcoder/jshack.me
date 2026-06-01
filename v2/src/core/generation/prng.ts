/**
 * Seeded PRNG — Mulberry32 over an FNV-1a-hashed string seed. Ported from the
 * legacy generator (`src/generation/prng.ts`). Deterministic: the same seed
 * always yields the same sequence, which is what makes the world generator
 * reproducible from the Ed25519 identity pubkey.
 *
 * Only the methods Story 1 consumes are ported (`next`/`nextInt`/`pick`).
 * `pickN`/`shuffle` land when a later generator story first needs them — under
 * their own failing tests, per TDD.
 */

export type Prng = {
  readonly next: () => number;
  readonly nextInt: (min: number, max: number) => number;
  readonly pick: <T>(items: readonly T[]) => T;
};

// FNV-1a hash: converts a seed string to a 32-bit unsigned integer.
// XOR each byte with the hash, then multiply by the FNV prime (0x01000193).
const fnv1aHash = (str: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

export const createPrng = (seed: string): Prng => {
  let state = fnv1aHash(seed);

  // Mulberry32 PRNG — produces a float in [0, 1) from internal 32-bit state.
  // `|0` coerces to 32-bit int; `>>> 0` converts to unsigned before dividing
  // by 2^32 to get the [0, 1) range.
  const next = (): number => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const nextInt = (min: number, max: number): number => {
    return min + Math.floor(next() * (max - min + 1));
  };

  const pick = <T>(items: readonly T[]): T => {
    return items[nextInt(0, items.length - 1)] as T;
  };

  return { next, nextInt, pick };
};
