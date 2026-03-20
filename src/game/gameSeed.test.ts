import { describe, it, expect } from 'vitest';
import { generateGameSeed } from './gameSeed';

describe('generateGameSeed', () => {
  it('should produce a 16-character hex string', () => {
    const seed = generateGameSeed();
    expect(seed).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should produce different seeds on repeated calls', () => {
    const seeds = new Set(Array.from({ length: 10 }, () => generateGameSeed()));
    expect(seeds.size).toBe(10);
  });
});
