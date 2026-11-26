import { describe, expect, it } from 'vitest';
import type { Prng } from '../generation/prng.js';
import { wifiPoolOf } from '../generation/generateWifi.js';
import { networkAt, publicAddress, REGION_FIRST_OCTETS } from '../generation/world.js';
import { outsideHostOf } from './secretDraws.js';

/** A stream answering with `draws` in order, an index for a pick and the number itself for an
 *  integer, so a test can steer which address comes up. The world's networks are sparse in the
 *  region block, so a seeded stream almost never lands on one. */
const steeredBy = (draws: readonly number[]): Prng => {
  const queue = [...draws];
  const take = (): number => {
    const draw = queue.shift();
    if (draw === undefined) throw new Error('the steered stream ran out of draws');
    return draw;
  };
  const pick = <T>(items: readonly T[]): T => {
    const item = items[take()];
    if (item === undefined) throw new Error('a steered pick fell outside the items');
    return item;
  };
  return {
    next: () => take(),
    nextInt: () => take(),
    pick,
    pickN: (items) => items,
    shuffle: (items) => items,
  };
};

/** The draws that make `address` the candidate. */
const drawsFor = (address: string): readonly number[] => {
  const [first = 0, ...rest] = address.split('.').map(Number);
  return [REGION_FIRST_OCTETS.indexOf(first), ...rest];
};

describe('an outside address an intruder’s work names', () => {
  // An address a network answers at would send the contractor to someone's real box.
  it('passes over an address a network answers at, and takes the next one none does', () => {
    const [essid = ''] = wifiPoolOf('Millbrook');
    const answered = publicAddress(essid) ?? '';
    const [first, second, third, fourth = 0] = answered.split('.');
    const quiet = `${first}.${second}.${third}.${Number(fourth) + 1}`;

    expect(networkAt(answered)).toBe(essid);
    expect(networkAt(quiet)).toBeUndefined();
    expect(outsideHostOf(steeredBy([...drawsFor(answered), ...drawsFor(quiet)]))).toBe(quiet);
  });
});
