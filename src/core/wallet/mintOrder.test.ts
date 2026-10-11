import { describe, expect, it } from 'vitest';
import { readMintOrder } from './mintOrder.js';

/**
 * What the operator typed after the mint script's name, read as an order to mint.
 *
 * The script writes to the ledger with the service role, so nothing downstream
 * second-guesses it: anything this lets through is minted.
 */

const ADDRESS = `jsc${'0123456789abcdef'.repeat(3).slice(0, 40)}`;

describe('readMintOrder — an order it takes', () => {
  it('reads the address and the amount', () => {
    expect(readMintOrder([ADDRESS, '500'])).toEqual({ address: ADDRESS, amount: 500 });
  });

  it('takes a single coin', () => {
    expect(readMintOrder([ADDRESS, '1'])).toEqual({ address: ADDRESS, amount: 1 });
  });

  it('takes an amount with a zero inside it', () => {
    expect(readMintOrder([ADDRESS, '1050'])).toEqual({ address: ADDRESS, amount: 1050 });
  });

  it('takes the largest amount the ledger holds, exactly', () => {
    expect(readMintOrder([ADDRESS, '9007199254740991'])).toEqual({
      address: ADDRESS,
      amount: 9007199254740991,
    });
  });
});

describe('readMintOrder — an amount it refuses', () => {
  it.each([
    ['nothing', '0'],
    ['one past the largest the ledger holds', '9007199254740992'],
    ['an amount that rounds on its way to a number', '9007199254740993'],
    ['an amount far past the largest', '9'.repeat(30)],
    ['a fraction', '2.5'],
    ['a whole number written with a fraction', '250.0'],
    ['an exponent', '1e3'],
    ['a plus sign', '+5'],
    ['a negative amount', '-5'],
    ['a leading zero', '0250'],
    ['an amount with its unit', '250 JSC'],
    ['a space before the digits', ' 250'],
    ['a space after the digits', '250 '],
    ['a thousands separator', '1,000'],
    ['hex', '0x10'],
    ['a word', 'lots'],
    ['an empty amount', ''],
  ])('refuses %s', (_label, amount) => {
    expect(readMintOrder([ADDRESS, amount])).toBeNull();
  });
});

describe('readMintOrder — an address it refuses', () => {
  it.each([
    ['the mint’s own label', 'coinbase'],
    ['an address in upper case', ADDRESS.toUpperCase()],
    ['an address one character short', ADDRESS.slice(0, -1)],
    ['an address one character long', `${ADDRESS}0`],
    ['an empty address', ''],
  ])('refuses %s', (_label, address) => {
    expect(readMintOrder([address, '500'])).toBeNull();
  });
});

describe('readMintOrder — the wrong number of words', () => {
  it.each([
    ['nothing at all', []],
    ['an address and no amount', [ADDRESS]],
    ['the amount before the address', ['500', ADDRESS]],
    ['a third word', [ADDRESS, '500', '500']],
    ['a third word that is empty', [ADDRESS, '500', '']],
  ])('refuses %s', (_label, words) => {
    expect(readMintOrder(words)).toBeNull();
  });
});
