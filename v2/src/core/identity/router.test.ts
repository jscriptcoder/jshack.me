import { describe, expect, it } from 'vitest';
import { computeRouterId } from './router';
import { computeWorkstationId, isOwnWorkstation, parseWorkstationId } from './workstation';

// A representative Ed25519 pubkey hex (64 chars). Any fixed value works — the
// contract is determinism + DISTINCTNESS, not a specific key.
const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

describe('computeRouterId', () => {
  it('returns a `router-<8 hex>` id', () => {
    expect(computeRouterId(KEY)).toMatch(/^router-[0-9a-f]{8}$/);
  });

  it('is deterministic for the same key', () => {
    expect(computeRouterId(KEY)).toBe(computeRouterId(KEY));
  });

  it('differs for different keys', () => {
    expect(computeRouterId(KEY)).not.toBe(computeRouterId(OTHER_KEY));
  });

  it('uses a DISTINCT namespace from the workstation id for the same key', () => {
    // Same owner key, but the router suffix must NOT equal the workstation
    // suffix — otherwise the router would alias the player's own box and the
    // suffix-only `isOwnWorkstation` check would wrongly claim it.
    const routerSuffix = parseWorkstationId(computeRouterId(KEY))?.suffix;
    const workstationSuffix = parseWorkstationId(computeWorkstationId('box', KEY))?.suffix;
    expect(routerSuffix).toBeDefined();
    expect(routerSuffix).not.toBe(workstationSuffix);
  });

  it("is never recognised as the owner's own workstation", () => {
    expect(isOwnWorkstation(computeRouterId(KEY), KEY)).toBe(false);
  });
});
