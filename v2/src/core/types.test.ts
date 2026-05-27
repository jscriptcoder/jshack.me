import { describe, expect, it } from 'vitest';
import {
  asEpochMs,
  asGameTime,
  asMachineId,
  asNetworkAddress,
  asPlayerKeyHex,
  asSha256Hex,
} from './types';

// The brand is a compile-time fiction; at runtime each constructor must be a
// zero-cost identity. Pin that contract so a constructor can't silently start
// transforming its input.
describe('brand constructors', () => {
  it('return their input unchanged', () => {
    expect(asMachineId('m-1')).toBe('m-1');
    expect(asPlayerKeyHex('ab12')).toBe('ab12');
    expect(asNetworkAddress('10.0.0.1')).toBe('10.0.0.1');
    expect(asSha256Hex('deadbeef')).toBe('deadbeef');
    expect(asGameTime(42)).toBe(42);
    expect(asEpochMs(1000)).toBe(1000);
  });
});
