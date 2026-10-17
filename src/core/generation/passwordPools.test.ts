import { describe, expect, it } from 'vitest';
import { CRACKABLE_PASSWORDS, drawPasswordHash, UNCRACKABLE_HASHES } from './passwordPools.js';
import { md5 } from './md5.js';
import { createPrng, type Prng } from './prng.js';
import { UNCRACKABLE_PASSWORDS } from '../../test/passwords.js';

/**
 * The two pools every generated door draws from. The pools' own invariants (disjoint,
 * unique, non-blank, large enough) are checked where the data enters, by
 * `parseSecrets`, so a bad `JSHACK_SECRETS` fails the build itself.
 */

/** A prng whose roll is fixed and whose pick takes the first item, so a test can
 *  stand exactly on the crack chance. */
const prngRolling = (roll: number): Prng => ({
  ...createPrng('fixed'),
  next: () => roll,
  pick: <T>(items: readonly T[]): T => items[0]!,
});

describe('the uncrackable pool', () => {
  it('is carried as the md5 of each word, in the pool order a seed picks by', () => {
    // A seed lands on an index, so a reordered or re-hashed list would move every
    // uncrackable door in the world while each still looked like a valid hash.
    expect(UNCRACKABLE_HASHES).toEqual(UNCRACKABLE_PASSWORDS.map(md5));
  });
});

describe('drawPasswordHash', () => {
  it('hashes a crackable word when the roll falls under the chance', () => {
    expect(drawPasswordHash(prngRolling(0.39), 0.4)).toBe(md5(CRACKABLE_PASSWORDS[0]!));
  });

  it('draws an uncrackable hash when the roll lands exactly on the chance', () => {
    expect(drawPasswordHash(prngRolling(0.4), 0.4)).toBe(UNCRACKABLE_HASHES[0]);
  });

  it('reaches both pools from a real seed', () => {
    expect(CRACKABLE_PASSWORDS.map(md5)).toContain(drawPasswordHash(createPrng('door'), 1));
    expect(UNCRACKABLE_HASHES).toContain(drawPasswordHash(createPrng('door'), 0));
  });

  it.each([1, 0])(
    'consumes exactly two draws at chance %s, so retuning a chance moves no later draw',
    (crackChance) => {
      const drawn = createPrng('door');
      drawPasswordHash(drawn, crackChance);
      const untouched = createPrng('door');
      untouched.next();
      untouched.next();

      expect(drawn.next()).toBe(untouched.next());
    },
  );
});
