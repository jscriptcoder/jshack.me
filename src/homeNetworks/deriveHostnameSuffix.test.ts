import { describe, it, expect } from 'vitest';
import { deriveHostnameSuffix } from './deriveHostnameSuffix';

describe('deriveHostnameSuffix', () => {
  it('returns the same suffix for the same player key (stable)', () => {
    const key = 'ed25519:abc123';
    expect(deriveHostnameSuffix(key)).toBe(deriveHostnameSuffix(key));
  });

  it('returns different suffixes for different player keys', () => {
    const a = deriveHostnameSuffix('ed25519:player-a');
    const b = deriveHostnameSuffix('ed25519:player-b');
    expect(a).not.toBe(b);
  });

  it('returns a 4-character lowercase hex string', () => {
    const suffix = deriveHostnameSuffix('ed25519:any-key');
    expect(suffix).toMatch(/^[0-9a-f]{4}$/);
  });

  it('produces a valid suffix for an empty key', () => {
    // Should not throw or return empty — the suffix is still well-formed
    // even when the input is degenerate. Hashing handles arbitrary input.
    expect(deriveHostnameSuffix('')).toMatch(/^[0-9a-f]{4}$/);
  });

  it('distributes suffixes across the hex space', () => {
    // Sanity check that we're not collapsing to a constant — sample 100
    // distinct keys and require at least 50 distinct suffixes (loose bound;
    // expected unique count is ~99 for 4 hex chars / 65k space).
    const suffixes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      suffixes.add(deriveHostnameSuffix(`ed25519:key-${i}`));
    }
    expect(suffixes.size).toBeGreaterThan(50);
  });
});
