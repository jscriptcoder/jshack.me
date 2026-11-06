import { describe, expect, it } from 'vitest';
import { writeAmount } from './amount.js';

describe('writeAmount — an amount of JSC as every screen prints it', () => {
  it('puts the coin sign before the number, with nothing between', () => {
    expect(writeAmount(25)).toBe('§25');
  });

  it('writes nothing held as a zero, not as an empty amount', () => {
    expect(writeAmount(0)).toBe('§0');
  });

  it('groups thousands with a comma once the number reaches four digits', () => {
    expect(writeAmount(999)).toBe('§999');
    expect(writeAmount(1000)).toBe('§1,000');
    expect(writeAmount(1650)).toBe('§1,650');
    expect(writeAmount(1000000)).toBe('§1,000,000');
  });
});
