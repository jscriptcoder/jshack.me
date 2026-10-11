import { describe, expect, it } from 'vitest';
import { handleWalletHistory, type WalletHistoryDeps } from './handleWalletHistory.js';

/**
 * The public read of what one address has sent and received.
 *
 * Nobody is authenticated here either: the request names an address and carries
 * no envelope. The rows are the ledger's, in the shape they come off the wire.
 */

const ADDRESS = `jsc${'0123456789abcdef'.repeat(3).slice(0, 40)}`;
const OTHER = `jsc${'fedcba9876543210'.repeat(3).slice(0, 40)}`;

type Asked = { readonly address: string; readonly limit: number };

/** A ledger that lists `rows` for any address, and keeps what it was asked for. */
const ledgerListing = (
  rows: unknown = [],
): { readonly deps: WalletHistoryDeps; readonly asked: readonly Asked[] } => {
  const asked: Asked[] = [];
  return {
    deps: {
      findTransfers: async (address, limit) => {
        asked.push({ address, limit });
        return { data: rows, error: null };
      },
    },
    asked,
  };
};

const historyOf = (address: unknown): unknown => ({ action: 'history', address });

/** A transfer row as the table holds it: a mint to `ADDRESS` unless told otherwise. */
const rowOf = (overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> => ({
  from_address: null,
  to_address: ADDRESS,
  amount: 500,
  created_at: '2026-10-11T14:02:33.123456+00:00',
  ...overrides,
});

describe('handleWalletHistory — what an address has done', () => {
  it('answers with the transfers the ledger lists, in the order it lists them', async () => {
    const { deps, asked } = ledgerListing([
      rowOf({
        from_address: ADDRESS,
        to_address: OTHER,
        amount: 500,
        created_at: '2026-10-11T14:09:41.5+00:00',
      }),
      rowOf({
        from_address: OTHER,
        to_address: ADDRESS,
        amount: 200,
        created_at: '2026-10-11T14:05:00+00:00',
      }),
      rowOf(),
    ]);

    const response = await handleWalletHistory(historyOf(ADDRESS), deps);

    expect(response).toEqual({
      status: 200,
      body: {
        transfers: [
          { from: ADDRESS, to: OTHER, amount: 500, at: '2026-10-11T14:09:41.500Z' },
          { from: OTHER, to: ADDRESS, amount: 200, at: '2026-10-11T14:05:00.000Z' },
          { from: null, to: ADDRESS, amount: 500, at: '2026-10-11T14:02:33.123Z' },
        ],
      },
    });
    expect(asked).toEqual([{ address: ADDRESS, limit: 20 }]);
  });

  it('answers an empty list for an address the ledger has never seen', async () => {
    const { deps } = ledgerListing([]);

    const response = await handleWalletHistory(historyOf(ADDRESS), deps);

    expect(response).toEqual({ status: 200, body: { transfers: [] } });
  });

  it('tells the time in UTC, whatever offset the row was written in', async () => {
    const { deps } = ledgerListing([rowOf({ created_at: '2026-10-11T23:30:00+02:00' })]);

    const response = await handleWalletHistory(historyOf(ADDRESS), deps);

    expect(response.body).toEqual({
      transfers: [{ from: null, to: ADDRESS, amount: 500, at: '2026-10-11T21:30:00.000Z' }],
    });
  });

  it('answers with the largest amount the ledger holds, exactly', async () => {
    const { deps } = ledgerListing([rowOf({ amount: Number.MAX_SAFE_INTEGER })]);

    const response = await handleWalletHistory(historyOf(ADDRESS), deps);

    expect(response.body).toEqual({
      transfers: [
        { from: null, to: ADDRESS, amount: 9007199254740991, at: '2026-10-11T14:02:33.123Z' },
      ],
    });
  });

  it('hands on nothing of a row but who, how many and when', async () => {
    const { deps } = ledgerListing([rowOf({ id: 41, note: 'operator' })]);

    const response = await handleWalletHistory(historyOf(ADDRESS), deps);

    expect(response.body).toEqual({
      transfers: [{ from: null, to: ADDRESS, amount: 500, at: '2026-10-11T14:02:33.123Z' }],
    });
  });

  it('needs no signature, and ignores one that is sent', async () => {
    const { deps } = ledgerListing([]);

    const response = await handleWalletHistory(
      { action: 'history', address: ADDRESS, publicKey: 'f'.repeat(64), signature: 'nonsense' },
      deps,
    );

    expect(response).toEqual({ status: 200, body: { transfers: [] } });
  });
});

describe('handleWalletHistory — what it turns away before reading the ledger', () => {
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
    const { deps, asked } = ledgerListing([rowOf()]);

    const response = await handleWalletHistory(historyOf(address), deps);

    expect(response).toEqual({ status: 400, body: { error: 'invalid_address' } });
    expect(asked).toEqual([]);
  });

  it.each([
    ['a body that is not an object', ADDRESS],
    ['no body', null],
    ['nothing', undefined],
  ])('answers 400 to %s', async (_label, body) => {
    const { deps, asked } = ledgerListing([rowOf()]);

    const response = await handleWalletHistory(body, deps);

    expect(response).toEqual({ status: 400, body: { error: 'invalid_address' } });
    expect(asked).toEqual([]);
  });
});

describe('handleWalletHistory — a ledger that cannot be read', () => {
  const LOOKUP_FAILED = { status: 500, body: { error: 'history_lookup_failed' } };

  it('answers 500 and no list when the read fails', async () => {
    const response = await handleWalletHistory(historyOf(ADDRESS), {
      findTransfers: async () => ({ data: null, error: { message: 'connection refused' } }),
    });

    expect(response).toEqual(LOOKUP_FAILED);
  });

  it('answers 500 when the read fails and still hands back rows', async () => {
    const response = await handleWalletHistory(historyOf(ADDRESS), {
      findTransfers: async () => ({ data: [rowOf()], error: { message: 'partial read' } }),
    });

    expect(response).toEqual(LOOKUP_FAILED);
  });

  it.each([
    ['no rows at all, where a list was due', null],
    ['one row, where a list was due', rowOf()],
  ])('answers 500 rather than read %s as a history', async (_label, rows) => {
    const { deps } = ledgerListing(rows);

    const response = await handleWalletHistory(historyOf(ADDRESS), deps);

    expect(response).toEqual(LOOKUP_FAILED);
  });

  it.each([
    ['a sender that is not an address', { from_address: 'coinbase' }],
    ['a sender in upper case', { from_address: OTHER.toUpperCase() }],
    ['a row with no sender column', { from_address: undefined }],
    ['a destination that is not an address', { to_address: 'nowhere' }],
    ['a row with no destination', { to_address: null }],
    ['an amount that came back as text', { amount: '500' }],
    ['an amount below zero', { amount: -1 }],
    ['an amount with a fraction', { amount: 2.5 }],
    ['an amount too large to be exact', { amount: 2 ** 53 }],
    ['a row with no amount', { amount: undefined }],
    ['a time that is not one', { created_at: 'yesterday' }],
    ['a time with no offset to read it by', { created_at: '2026-10-11T14:02:33' }],
    ['a time that came back as a number', { created_at: 1791727353000 }],
    ['a row with no time', { created_at: undefined }],
  ])('answers 500 rather than repeat %s', async (_label, overrides) => {
    const { deps } = ledgerListing([rowOf(), rowOf(overrides)]);

    const response = await handleWalletHistory(historyOf(ADDRESS), deps);

    expect(response).toEqual(LOOKUP_FAILED);
  });
});
