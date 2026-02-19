import { describe, it, expect } from 'vitest';
import { createPrng } from './prng';

describe('createPrng', () => {
  it('produces deterministic output for the same seed', () => {
    const a = createPrng('test-seed');
    const b = createPrng('test-seed');
    const valuesA = Array.from({ length: 10 }, () => a.next());
    const valuesB = Array.from({ length: 10 }, () => b.next());
    expect(valuesA).toEqual(valuesB);
  });

  it('produces different output for different seeds', () => {
    const a = createPrng('seed-alpha');
    const b = createPrng('seed-beta');
    const valuesA = Array.from({ length: 10 }, () => a.next());
    const valuesB = Array.from({ length: 10 }, () => b.next());
    expect(valuesA).not.toEqual(valuesB);
  });

  it('next() returns values in [0, 1)', () => {
    const prng = createPrng('distribution-test');
    const values = Array.from({ length: 1000 }, () => prng.next());
    values.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    });
  });

  it('nextInt() returns inclusive integers in range', () => {
    const prng = createPrng('int-test');
    const values = Array.from({ length: 500 }, () => prng.nextInt(3, 7));
    values.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isInteger(v)).toBe(true);
    });
    const unique = new Set(values);
    expect(unique.size).toBe(5);
  });

  it('pick() selects from the array', () => {
    const prng = createPrng('pick-test');
    const items = ['a', 'b', 'c', 'd'] as const;
    const picked = Array.from({ length: 100 }, () => prng.pick(items));
    picked.forEach((v) => {
      expect(items).toContain(v);
    });
    const unique = new Set(picked);
    expect(unique.size).toBeGreaterThan(1);
  });

  it('pickN() selects n unique elements', () => {
    const prng = createPrng('pickn-test');
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const selected = prng.pickN(items, 3);
    expect(selected).toHaveLength(3);
    const unique = new Set(selected);
    expect(unique.size).toBe(3);
    selected.forEach((v) => {
      expect(items).toContain(v);
    });
  });

  it('pickN() does not modify the original array', () => {
    const prng = createPrng('immutable-test');
    const items = [1, 2, 3, 4, 5];
    const original = [...items];
    prng.pickN(items, 3);
    expect(items).toEqual(original);
  });

  it('pickN() caps at array length', () => {
    const prng = createPrng('cap-test');
    const items = ['a', 'b', 'c'];
    const selected = prng.pickN(items, 10);
    expect(selected).toHaveLength(3);
  });

  it('shuffle() returns all elements in a different order', () => {
    const prng = createPrng('shuffle-test');
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled = prng.shuffle(items);
    expect(shuffled).toHaveLength(items.length);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
    expect(shuffled).not.toEqual(items);
  });

  it('shuffle() does not modify the original array', () => {
    const prng = createPrng('shuffle-immutable');
    const items = [1, 2, 3, 4, 5];
    const original = [...items];
    prng.shuffle(items);
    expect(items).toEqual(original);
  });
});
