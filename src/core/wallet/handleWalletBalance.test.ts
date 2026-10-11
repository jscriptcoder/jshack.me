import { describe, expect, it } from 'vitest';
import { handleWalletBalance, type WalletBalanceDeps } from './handleWalletBalance.js';

/**
 * The public read of one address off the ledger.
 *
 * Nobody is authenticated here: the ledger knows addresses and nothing about
 * players, so the request names an address and carries no envelope.
 */

const ADDRESS = `jsc${'0123456789abcdef'.repeat(3).slice(0, 40)}`;

/** A ledger holding `rows`, which keeps every address it was asked for. */
const ledgerOf = (
  rows: Readonly<Record<string, unknown>> = {},
): { readonly deps: WalletBalanceDeps; readonly asked: readonly string[] } => {
  const asked: string[] = [];
  return {
    deps: {
      findBalance: async (address) => {
        asked.push(address);
        return { data: rows[address] ?? null, error: null };
      },
    },
    asked,
  };
};

const balanceOf = (address: unknown): unknown => ({ action: 'balance', address });

describe('handleWalletBalance — what an address holds', () => {
  it('answers with the balance and the next sequence number of an address it holds', async () => {
    const { deps, asked } = ledgerOf({ [ADDRESS]: { balance: 250, next_sequence: 3 } });

    const response = await handleWalletBalance(balanceOf(ADDRESS), deps);

    expect(response).toEqual({ status: 200, body: { balance: 250, nextSequence: 3 } });
    expect(asked).toEqual([ADDRESS]);
  });

  it('answers zero for both at an address it has never seen', async () => {
    const { deps } = ledgerOf();

    const response = await handleWalletBalance(balanceOf(ADDRESS), deps);

    expect(response).toEqual({ status: 200, body: { balance: 0, nextSequence: 0 } });
  });

  it('answers with the largest balance the ledger holds, exactly', async () => {
    const { deps } = ledgerOf({
      [ADDRESS]: { balance: Number.MAX_SAFE_INTEGER, next_sequence: 0 },
    });

    const response = await handleWalletBalance(balanceOf(ADDRESS), deps);

    expect(response.body).toEqual({ balance: 9007199254740991, nextSequence: 0 });
  });

  it('needs no signature, and ignores one that is sent', async () => {
    const { deps } = ledgerOf({ [ADDRESS]: { balance: 1, next_sequence: 0 } });

    const response = await handleWalletBalance(
      { action: 'balance', address: ADDRESS, publicKey: 'f'.repeat(64), signature: 'nonsense' },
      deps,
    );

    expect(response).toEqual({ status: 200, body: { balance: 1, nextSequence: 0 } });
  });
});

describe('handleWalletBalance — what it turns away before reading the ledger', () => {
  it.each([
    ['the mint’s label', 'coinbase'],
    ['an address in upper case', ADDRESS.toUpperCase()],
    ['an address one character short', ADDRESS.slice(0, -1)],
    ['an address one character long', `${ADDRESS}0`],
    ['an address with a character that is not hex', `${ADDRESS.slice(0, -1)}g`],
    ['an address with text before it', `x${ADDRESS}`],
    ['an empty address', ''],
    ['a number', 12],
    ['a list holding an address', [ADDRESS]],
    ['no address at all', undefined],
  ])('answers 400 to %s', async (_label, address) => {
    const { deps, asked } = ledgerOf({ [ADDRESS]: { balance: 250, next_sequence: 0 } });

    const response = await handleWalletBalance(balanceOf(address), deps);

    expect(response).toEqual({ status: 400, body: { error: 'invalid_address' } });
    expect(asked).toEqual([]);
  });

  it.each([
    ['an action it does not know', { action: 'drain', address: ADDRESS }],
    ['no action', { address: ADDRESS }],
    ['an action in upper case', { action: 'BALANCE', address: ADDRESS }],
    ['a body that is not an object', ADDRESS],
    ['no body', null],
    ['nothing', undefined],
  ])('answers 400 to %s', async (_label, body) => {
    const { deps, asked } = ledgerOf({ [ADDRESS]: { balance: 250, next_sequence: 0 } });

    const response = await handleWalletBalance(body, deps);

    expect(response).toEqual({ status: 400, body: { error: 'unknown_action' } });
    expect(asked).toEqual([]);
  });
});

describe('handleWalletBalance — a ledger that cannot be read', () => {
  it('answers 500 and no balance when the read fails', async () => {
    const response = await handleWalletBalance(balanceOf(ADDRESS), {
      findBalance: async () => ({ data: null, error: { message: 'connection refused' } }),
    });

    expect(response).toEqual({ status: 500, body: { error: 'balance_lookup_failed' } });
  });

  it('answers 500 when the read fails and still hands back a row', async () => {
    const response = await handleWalletBalance(balanceOf(ADDRESS), {
      findBalance: async () => ({
        data: { balance: 250, next_sequence: 0 },
        error: { message: 'partial read' },
      }),
    });

    expect(response).toEqual({ status: 500, body: { error: 'balance_lookup_failed' } });
  });

  it.each([
    ['a balance that came back as text', { balance: '250', next_sequence: 0 }],
    ['a balance below zero', { balance: -1, next_sequence: 0 }],
    ['a balance with a fraction', { balance: 2.5, next_sequence: 0 }],
    ['a balance too large to be exact', { balance: 2 ** 53, next_sequence: 0 }],
    ['a sequence number below zero', { balance: 250, next_sequence: -1 }],
    ['a sequence number with a fraction', { balance: 250, next_sequence: 0.5 }],
    ['a row with no sequence number', { balance: 250 }],
    ['a row with no balance', { next_sequence: 0 }],
  ])('answers 500 rather than repeat %s', async (_label, row) => {
    const { deps } = ledgerOf({ [ADDRESS]: row });

    const response = await handleWalletBalance(balanceOf(ADDRESS), deps);

    expect(response).toEqual({ status: 500, body: { error: 'balance_lookup_failed' } });
  });
});
