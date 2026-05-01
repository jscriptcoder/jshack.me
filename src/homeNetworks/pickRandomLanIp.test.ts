import { describe, it, expect } from 'vitest';
import { createPrng } from '../generation/prng';
import { pickRandomLanIp } from './pickRandomLanIp';

describe('pickRandomLanIp', () => {
  it('returns a host octet in .X format where X is in [10, 250]', () => {
    const prng = createPrng('lan-ip-format');
    const result = pickRandomLanIp(prng);
    expect(result).toMatch(/^\.\d+$/);
    const octet = Number(result.slice(1));
    expect(octet).toBeGreaterThanOrEqual(10);
    expect(octet).toBeLessThanOrEqual(250);
  });

  it('is deterministic for a given prng seed', () => {
    const a = pickRandomLanIp(createPrng('same-seed'));
    const b = pickRandomLanIp(createPrng('same-seed'));
    expect(a).toBe(b);
  });

  it('never produces an octet outside [10, 250] across many samples', () => {
    const prng = createPrng('range-bounds-check');
    for (let i = 0; i < 2000; i++) {
      const octet = Number(pickRandomLanIp(prng).slice(1));
      expect(octet).toBeGreaterThanOrEqual(10);
      expect(octet).toBeLessThanOrEqual(250);
    }
  });

  it('spans most of the [10, 250] range across many samples', () => {
    const prng = createPrng('range-span-check');
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const octet = Number(pickRandomLanIp(prng).slice(1));
      min = Math.min(min, octet);
      max = Math.max(max, octet);
    }
    // 2000 samples in a 241-wide range — both ends should land within ~5
    // of the boundaries with overwhelming probability.
    expect(min).toBeLessThan(20);
    expect(max).toBeGreaterThan(240);
  });
});
