import { describe, expect, it } from 'vitest';
import {
  computeWorkstationId,
  deriveHostnameSuffix,
  isOwnWorkstation,
  parseWorkstationId,
} from './workstation';

const PK = 'a'.repeat(64);
// Pinned vectors for PK (computed from sha256). Anchor the algorithm + slice.
const PREFIXED_SUFFIX = 'd7cf8f0b'; // sha256('ed25519:' + PK)[0..8]
const RAW_SUFFIX = 'ffe054fe'; //      sha256(PK)[0..8]  — what a prefix-drop mutant yields

describe('computeWorkstationId', () => {
  it('composes name + identity-derived 8-hex suffix (pinned vector)', () => {
    expect(computeWorkstationId('skylab', PK)).toBe(`skylab-${PREFIXED_SUFFIX}`);
  });

  it("applies the load-bearing 'ed25519:' prefix — suffix differs from the raw-key hash", () => {
    // A mutant dropping the prefix would yield `skylab-${RAW_SUFFIX}` and
    // silently break every cross-player auth/lookup path.
    expect(computeWorkstationId('skylab', PK)).not.toBe(`skylab-${RAW_SUFFIX}`);
  });
});

describe('deriveHostnameSuffix', () => {
  it('returns 8 lowercase hex chars', () => {
    expect(deriveHostnameSuffix(`ed25519:${PK}`)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('parseWorkstationId', () => {
  it('round-trips a computed workstation id', () => {
    expect(parseWorkstationId(computeWorkstationId('skylab', PK))).toEqual({
      name: 'skylab',
      suffix: PREFIXED_SUFFIX,
    });
  });

  it('keeps internal hyphens in the name (last-8-hex rule)', () => {
    expect(parseWorkstationId(`skylab-prime-${PREFIXED_SUFFIX}`)).toEqual({
      name: 'skylab-prime',
      suffix: PREFIXED_SUFFIX,
    });
  });

  it('returns undefined for a non-workstation id (IPv4)', () => {
    expect(parseWorkstationId('10.0.0.1')).toBeUndefined();
  });

  it('returns undefined when the trailing segment is not 8 hex', () => {
    expect(parseWorkstationId('box-nothex8')).toBeUndefined();
  });

  it('returns undefined when there is trailing junk after the 8-hex suffix', () => {
    // Anchors the trailing `$`: `box-<8hex>zz` must not parse as a workstation.
    expect(parseWorkstationId(`box-${PREFIXED_SUFFIX}zz`)).toBeUndefined();
  });
});

describe('isOwnWorkstation', () => {
  it('is true when the machine id suffix matches the player key', () => {
    expect(isOwnWorkstation(computeWorkstationId('skylab', PK), PK)).toBe(true);
  });

  it('is false for a different player key (suffix mismatch)', () => {
    expect(isOwnWorkstation(computeWorkstationId('skylab', PK), 'b'.repeat(64))).toBe(false);
  });

  it('is false for a non-workstation machine id', () => {
    expect(isOwnWorkstation('10.0.0.1', PK)).toBe(false);
  });
});
