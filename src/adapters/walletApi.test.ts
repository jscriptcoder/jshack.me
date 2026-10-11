import { describe, expect, it } from 'vitest';
import { readBalance } from './walletApi.js';

/**
 * walletApi — the `/api/wallet` client behind `env.wallet`.
 *
 * A balance read is unsigned: the ledger is public, and nothing the player holds
 * travels with the question.
 */

const ENDPOINT = 'http://test.local/api/wallet';
const ADDRESS = `jsc${'0123456789abcdef'.repeat(3).slice(0, 40)}`;

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Sent = { readonly url: string; readonly init: RequestInit | undefined };

/** A server that answers every request with `respond`, and keeps what it was sent. */
const serverThat = (
  respond: () => Response | Promise<Response>,
): { readonly fetchImpl: typeof fetch; readonly sent: readonly Sent[] } => {
  const sent: Sent[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    sent.push({ url: String(input), init });
    return respond();
  };
  return { fetchImpl, sent };
};

describe('readBalance', () => {
  it('hands back the balance and the next sequence number the ledger answers with', async () => {
    const { fetchImpl } = serverThat(() => jsonResponse(200, { balance: 250, nextSequence: 3 }));

    const result = await readBalance({ endpoint: ENDPOINT, fetchImpl }, ADDRESS);

    expect(result).toEqual({ ok: true, balance: 250, nextSequence: 3 });
  });

  it('asks with the address and nothing that says who is asking', async () => {
    const { fetchImpl, sent } = serverThat(() =>
      jsonResponse(200, { balance: 0, nextSequence: 0 }),
    );

    await readBalance({ endpoint: ENDPOINT, fetchImpl }, ADDRESS);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(ENDPOINT);
    expect(sent[0]?.init?.method).toBe('POST');
    expect(sent[0]?.init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(sent[0]?.init?.body))).toEqual({
      action: 'balance',
      address: ADDRESS,
    });
  });

  it('asks the game’s own wallet endpoint when none is named', async () => {
    const { fetchImpl, sent } = serverThat(() =>
      jsonResponse(200, { balance: 0, nextSequence: 0 }),
    );

    await readBalance({ fetchImpl }, ADDRESS);

    expect(sent[0]?.url).toBe('/api/wallet');
  });

  it('hands back the largest balance the ledger holds, exactly', async () => {
    const { fetchImpl } = serverThat(() =>
      jsonResponse(200, { balance: Number.MAX_SAFE_INTEGER, nextSequence: 0 }),
    );

    const result = await readBalance({ endpoint: ENDPOINT, fetchImpl }, ADDRESS);

    expect(result).toEqual({ ok: true, balance: 9007199254740991, nextSequence: 0 });
  });

  it.each([
    ['a refused request', () => jsonResponse(400, { error: 'invalid_address' })],
    ['a server error', () => jsonResponse(500, { error: 'balance_lookup_failed' })],
    [
      'an error status that carries a balance anyway',
      () => jsonResponse(500, { balance: 250, nextSequence: 0 }),
    ],
    ['an answer with no balance', () => jsonResponse(200, { nextSequence: 0 })],
    ['an answer with no sequence number', () => jsonResponse(200, { balance: 250 })],
    ['a balance sent as text', () => jsonResponse(200, { balance: '250', nextSequence: 0 })],
    ['a balance below zero', () => jsonResponse(200, { balance: -1, nextSequence: 0 })],
    ['a balance with a fraction', () => jsonResponse(200, { balance: 2.5, nextSequence: 0 })],
    [
      'a balance too large to be exact',
      () => jsonResponse(200, { balance: 2 ** 53, nextSequence: 0 }),
    ],
    ['a sequence number below zero', () => jsonResponse(200, { balance: 250, nextSequence: -1 })],
    [
      'a sequence number with a fraction',
      () => jsonResponse(200, { balance: 250, nextSequence: 0.5 }),
    ],
    ['a body that is not JSON', () => new Response('<html>502</html>', { status: 200 })],
    ['an answer that is not an object', () => jsonResponse(200, null)],
    [
      'a request that never completes',
      () => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ])('reports %s as a ledger that did not answer', async (_label, respond) => {
    const { fetchImpl } = serverThat(respond);

    const result = await readBalance({ endpoint: ENDPOINT, fetchImpl }, ADDRESS);

    expect(result).toEqual({ ok: false, error: 'network_error' });
  });
});
