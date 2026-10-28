import { describe, expect, it } from 'vitest';
import { tripAddress } from './fare.js';

/**
 * Where a traveller pays for a trip: an address made from their key and the trips they
 * have taken, so each trip has its own and the address alone says who paid for which.
 */

const PLAYER = 'ab'.repeat(32);
const OTHER_PLAYER = 'cd'.repeat(32);

describe('tripAddress', () => {
  it('is jsc and the first 40 hex of the hash of the traveller and the trip', () => {
    expect(tripAddress(PLAYER, 0)).toBe('jsc0612820023d341ff3ace924e0e4cafda09b51a98');
    expect(tripAddress(PLAYER, 1)).toBe('jsc0aaf62768ef267398e5c270313d1422d6ac48424');
  });

  it('is the same address every time it is asked for the same trip', () => {
    expect(tripAddress(PLAYER, 3)).toBe(tripAddress(PLAYER, 3));
  });

  it('never gives two players the same address for a trip', () => {
    expect(tripAddress(PLAYER, 0)).not.toBe(tripAddress(OTHER_PLAYER, 0));
  });
});
