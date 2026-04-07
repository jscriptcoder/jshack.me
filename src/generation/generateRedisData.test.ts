import { describe, it, expect } from 'vitest';
import { createPrng } from './prng';
import { generateRedisData } from './generateRedisData';

describe('generateRedisData', () => {
  const users = ['admin', 'deploy', 'guest'];

  it('generates 8-15 keys', () => {
    for (let i = 0; i < 30; i++) {
      const result = generateRedisData(createPrng(`redis-keys-${i}`), users);
      const keyCount = Object.keys(result.keys).length;
      expect(keyCount).toBeGreaterThanOrEqual(8);
      expect(keyCount).toBeLessThanOrEqual(15);
    }
  });

  it('generates keys with namespace conventions', () => {
    const result = generateRedisData(createPrng('redis-namespaces'), users);
    const keys = Object.keys(result.keys);
    // At least some keys should use colon-delimited namespaces
    const namespacedKeys = keys.filter((k) => k.includes(':'));
    expect(namespacedKeys.length).toBeGreaterThan(0);
  });

  it('generates string values', () => {
    const result = generateRedisData(createPrng('redis-values'), users);
    Object.values(result.keys).forEach((value) => {
      expect(typeof value).toBe('string');
    });
  });

  it('is deterministic for the same seed', () => {
    const a = generateRedisData(createPrng('redis-det'), users);
    const b = generateRedisData(createPrng('redis-det'), users);
    expect(a).toEqual(b);
  });

  it('produces different data for different seeds', () => {
    const a = generateRedisData(createPrng('redis-alpha'), users);
    const b = generateRedisData(createPrng('redis-beta'), users);
    expect(a.keys).not.toEqual(b.keys);
  });

  it('sometimes has requirepass and sometimes does not (~25% rate)', () => {
    let withPass = 0;
    const total = 100;
    for (let i = 0; i < total; i++) {
      const result = generateRedisData(createPrng(`redis-auth-${i}`), users);
      if (result.requirepass !== null) withPass++;
    }
    // ~25% rate — allow 10%-45% range
    expect(withPass).toBeGreaterThanOrEqual(total * 0.1);
    expect(withPass).toBeLessThanOrEqual(total * 0.45);
  });

  it('requirepass is a non-empty string when set', () => {
    for (let i = 0; i < 100; i++) {
      const result = generateRedisData(createPrng(`redis-pass-${i}`), users);
      if (result.requirepass !== null) {
        expect(result.requirepass.length).toBeGreaterThan(0);
        return;
      }
    }
    // Should have found at least one with requirepass
    expect.unreachable('No requirepass found in 100 seeds');
  });
});
