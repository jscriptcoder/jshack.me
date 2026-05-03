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

  describe('with excludedOctets', () => {
    it('never returns an octet in the exclusion set', () => {
      // Pinned: this is the headline collision-avoidance guarantee.
      // A mutant that ignored the exclusion set would let players
      // land on NPC IPs again — exactly the bug we're fixing.
      const excluded = new Set([60, 150, 176, 208]); // typical NPC octets
      const prng = createPrng('exclusion-check');
      for (let i = 0; i < 1000; i++) {
        const octet = Number(pickRandomLanIp(prng, { excludedOctets: excluded }).slice(1));
        expect(excluded.has(octet)).toBe(false);
        expect(octet).toBeGreaterThanOrEqual(10);
        expect(octet).toBeLessThanOrEqual(250);
      }
    });

    it('still returns a valid octet when the exclusion is dense (linear-scan fallback)', () => {
      // Exclude every octet except 30. The fast-path random rolls have
      // a 1/241 chance of landing on 30, so 50 attempts is unlikely to
      // hit it. The linear-scan fallback must still return 30.
      const excluded = new Set<number>();
      for (let i = 10; i <= 250; i++) {
        if (i !== 30) excluded.add(i);
      }
      const prng = createPrng('dense-exclusion');
      const result = pickRandomLanIp(prng, { excludedOctets: excluded });
      expect(result).toBe('.30');
    });

    it('throws when no octet in [10, 250] is free', () => {
      // Every octet excluded — the allocator has to fail loudly so the
      // join handler can return slot_allocation_exhausted.
      const excluded = new Set<number>();
      for (let i = 10; i <= 250; i++) excluded.add(i);
      const prng = createPrng('all-excluded');
      expect(() => pickRandomLanIp(prng, { excludedOctets: excluded })).toThrow();
    });

    it('treats an empty exclusion set as no constraint', () => {
      const prng = createPrng('empty-exclusion');
      const result = pickRandomLanIp(prng, { excludedOctets: new Set() });
      const octet = Number(result.slice(1));
      expect(octet).toBeGreaterThanOrEqual(10);
      expect(octet).toBeLessThanOrEqual(250);
    });

    it('omitted options behaves identically to no-exclusion path (legacy callers)', () => {
      // Sanity: the sub-PR doesn't change behavior for callers that
      // didn't opt in to exclusions yet.
      const a = pickRandomLanIp(createPrng('legacy'));
      const b = pickRandomLanIp(createPrng('legacy'), {});
      expect(a).toBe(b);
    });
  });
});
