import { describe, expect, it } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha2.js';
import { readBalance, readHistory, sendTransfer } from './walletApi.js';
import { bytesToHex, hexToBytes } from '../core/identity/hex.js';
import { handleWalletHistory } from '../core/wallet/handleWalletHistory.js';
import { handleWalletTransfer, type TransferOrder } from '../core/wallet/handleWalletTransfer.js';

/**
 * walletApi — the `/api/wallet` client behind `env.wallet`.
 *
 * A balance read is unsigned: the ledger is public, and nothing the player holds
 * travels with the question. A history is read the same way. A transfer is
 * signed, by the wallet's key and by nothing of the player's.
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

const OTHER_ADDRESS = `jsc${'fedcba9876543210'.repeat(3).slice(0, 40)}`;

/** A transfer as the ledger answers with it: a mint to `ADDRESS` unless told otherwise. */
const recordOf = (overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> => ({
  from: null,
  to: ADDRESS,
  amount: 500,
  at: '2026-10-11T14:02:33.123Z',
  ...overrides,
});

describe('readHistory', () => {
  it('hands back the transfers the ledger answers with, in its order', async () => {
    const transfers = [
      recordOf({ from: ADDRESS, to: OTHER_ADDRESS, at: '2026-10-11T14:09:41.500Z' }),
      recordOf({ from: OTHER_ADDRESS, amount: 200, at: '2026-10-11T14:05:00.000Z' }),
      recordOf(),
    ];
    const { fetchImpl } = serverThat(() => jsonResponse(200, { transfers }));

    const result = await readHistory({ endpoint: ENDPOINT, fetchImpl }, ADDRESS);

    expect(result).toEqual({ ok: true, transfers });
  });

  it('hands back an empty list for an address that has done nothing', async () => {
    const { fetchImpl } = serverThat(() => jsonResponse(200, { transfers: [] }));

    const result = await readHistory({ endpoint: ENDPOINT, fetchImpl }, ADDRESS);

    expect(result).toEqual({ ok: true, transfers: [] });
  });

  it('asks with the address and nothing that says who is asking', async () => {
    const { fetchImpl, sent } = serverThat(() => jsonResponse(200, { transfers: [] }));

    await readHistory({ endpoint: ENDPOINT, fetchImpl }, ADDRESS);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(ENDPOINT);
    expect(sent[0]?.init?.method).toBe('POST');
    expect(sent[0]?.init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(sent[0]?.init?.body))).toEqual({
      action: 'history',
      address: ADDRESS,
    });
  });

  it('asks the game’s own wallet endpoint when none is named', async () => {
    const { fetchImpl, sent } = serverThat(() => jsonResponse(200, { transfers: [] }));

    await readHistory({ fetchImpl }, ADDRESS);

    expect(sent[0]?.url).toBe('/api/wallet');
  });

  it('reads what the ledger’s own handler answers with', async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      const { status, body } = await handleWalletHistory(JSON.parse(String(init?.body)), {
        findTransfers: async (address) => ({
          data: [
            {
              from_address: address,
              to_address: OTHER_ADDRESS,
              amount: 500,
              created_at: '2026-10-11T14:09:41.5+00:00',
            },
            {
              from_address: null,
              to_address: address,
              amount: 500,
              created_at: '2026-10-11T14:02:33.123456+00:00',
            },
          ],
          error: null,
        }),
      });
      return jsonResponse(status, body);
    };

    const result = await readHistory({ endpoint: ENDPOINT, fetchImpl }, ADDRESS);

    expect(result).toEqual({
      ok: true,
      transfers: [
        { from: ADDRESS, to: OTHER_ADDRESS, amount: 500, at: '2026-10-11T14:09:41.500Z' },
        { from: null, to: ADDRESS, amount: 500, at: '2026-10-11T14:02:33.123Z' },
      ],
    });
  });

  it.each([
    ['a refused request', () => jsonResponse(400, { error: 'invalid_address' })],
    ['a server error', () => jsonResponse(500, { error: 'history_lookup_failed' })],
    [
      'an error status that carries a list anyway',
      () => jsonResponse(500, { transfers: [recordOf()] }),
    ],
    ['an answer with no list', () => jsonResponse(200, {})],
    [
      'a list that is one transfer and not a list',
      () => jsonResponse(200, { transfers: recordOf() }),
    ],
    ['a balance where a list was due', () => jsonResponse(200, { balance: 250, nextSequence: 0 })],
    [
      'a sender that is not an address',
      () => jsonResponse(200, { transfers: [recordOf({ from: 'coinbase' })] }),
    ],
    [
      'a transfer with no sender named',
      () => jsonResponse(200, { transfers: [recordOf({ from: undefined })] }),
    ],
    [
      'a destination that is not an address',
      () => jsonResponse(200, { transfers: [recordOf({ to: 'nowhere' })] }),
    ],
    [
      'a transfer with no destination',
      () => jsonResponse(200, { transfers: [recordOf({ to: null })] }),
    ],
    [
      'an amount sent as text',
      () => jsonResponse(200, { transfers: [recordOf({ amount: '500' })] }),
    ],
    ['an amount below zero', () => jsonResponse(200, { transfers: [recordOf({ amount: -1 })] })],
    [
      'an amount with a fraction',
      () => jsonResponse(200, { transfers: [recordOf({ amount: 2.5 })] }),
    ],
    [
      'an amount too large to be exact',
      () => jsonResponse(200, { transfers: [recordOf({ amount: 2 ** 53 })] }),
    ],
    [
      'a time in a clock that is not UTC',
      () => jsonResponse(200, { transfers: [recordOf({ at: '2026-10-11T16:02:33.123+02:00' })] }),
    ],
    [
      'a time that is not one',
      () => jsonResponse(200, { transfers: [recordOf({ at: 'yesterday' })] }),
    ],
    [
      'a time sent as a number',
      () => jsonResponse(200, { transfers: [recordOf({ at: 1791727353000 })] }),
    ],
    [
      'a transfer with no time',
      () => jsonResponse(200, { transfers: [recordOf({ at: undefined })] }),
    ],
    [
      'one bad transfer among good ones',
      () => jsonResponse(200, { transfers: [recordOf(), recordOf({ amount: '1' }), recordOf()] }),
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

    const result = await readHistory({ endpoint: ENDPOINT, fetchImpl }, ADDRESS);

    expect(result).toEqual({ ok: false, error: 'network_error' });
  });
});

const WALLET_KEY = 'c0ffee'.repeat(11).slice(0, 64);

/** The public half of a key and the address it answers to, worked out here from
 *  the rule itself so the test does not ask the code under test for its answer. */
const publicHalfOf = (keyHex: string): { readonly publicKey: string; readonly address: string } => {
  const privateKey = hexToBytes(keyHex);
  if (privateKey === null) throw new Error(`not a hex key: ${keyHex}`);
  const publicKey = ed.getPublicKey(privateKey);
  return {
    publicKey: bytesToHex(publicKey),
    address: `jsc${bytesToHex(sha256(publicKey)).slice(0, 40)}`,
  };
};

const SEND_200 = { keyHex: WALLET_KEY, to: ADDRESS, amount: 200, sequence: 3 };

describe('sendTransfer', () => {
  it('reports a transfer the ledger made', async () => {
    const { fetchImpl } = serverThat(() => jsonResponse(200, { ok: true }));

    const result = await sendTransfer({ endpoint: ENDPOINT, fetchImpl }, SEND_200);

    expect(result).toEqual({ ok: true });
  });

  it('sends a transfer the ledger takes as coming from the key’s own address', async () => {
    const moved: TransferOrder[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const { status, body } = await handleWalletTransfer(JSON.parse(String(init?.body)), {
        nonceStore: async () => ({ fresh: true }),
        transfer: async (order) => {
          moved.push(order);
          return { data: 'moved', error: null };
        },
      });
      return jsonResponse(status, body);
    };

    const result = await sendTransfer({ endpoint: ENDPOINT, fetchImpl }, SEND_200);

    expect(result).toEqual({ ok: true });
    expect(moved).toEqual([
      { from: publicHalfOf(WALLET_KEY).address, to: ADDRESS, amount: 200, sequence: 3 },
    ]);
  });

  it('posts one envelope, carrying the wallet’s public key and never its private one', async () => {
    const { fetchImpl, sent } = serverThat(() => jsonResponse(200, { ok: true }));

    await sendTransfer({ endpoint: ENDPOINT, fetchImpl }, SEND_200);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(ENDPOINT);
    expect(sent[0]?.init?.method).toBe('POST');
    expect(sent[0]?.init?.headers).toEqual({ 'Content-Type': 'application/json' });
    const envelope = JSON.parse(String(sent[0]?.init?.body)) as Record<string, string>;
    expect(Object.keys(envelope).sort()).toEqual(['payload', 'publicKey', 'signature']);
    expect(envelope.publicKey).toBe(publicHalfOf(WALLET_KEY).publicKey);
    expect(String(sent[0]?.init?.body)).not.toContain(WALLET_KEY);
  });

  it('signs the destination, the amount and the sequence number, and nothing of the player’s', async () => {
    const { fetchImpl, sent } = serverThat(() => jsonResponse(200, { ok: true }));

    await sendTransfer({ endpoint: ENDPOINT, fetchImpl }, SEND_200);

    const envelope = JSON.parse(String(sent[0]?.init?.body)) as { readonly payload: string };
    expect(JSON.parse(envelope.payload)).toEqual({
      action: 'transfer',
      to: ADDRESS,
      amount: 200,
      sequence: 3,
      nonce: expect.stringMatching(/^[0-9a-f]{32}$/),
      ts: expect.any(Number),
    });
  });

  it('posts to the game’s own wallet endpoint when none is named', async () => {
    const { fetchImpl, sent } = serverThat(() => jsonResponse(200, { ok: true }));

    await sendTransfer({ fetchImpl }, SEND_200);

    expect(sent[0]?.url).toBe('/api/wallet');
  });

  it.each(['stale_sequence', 'insufficient_balance', 'destination_full'] as const)(
    'reports why the ledger left the coins where they were: %s',
    async (refusal) => {
      const { fetchImpl } = serverThat(() => jsonResponse(409, { error: refusal }));

      const result = await sendTransfer({ endpoint: ENDPOINT, fetchImpl }, SEND_200);

      expect(result).toEqual({ ok: false, error: refusal });
    },
  );

  it.each([
    ['a transfer the server would not read', () => jsonResponse(400, { error: 'payload_invalid' })],
    [
      'a signature the server did not accept',
      () => jsonResponse(401, { error: 'signature_invalid' }),
    ],
    ['a server error', () => jsonResponse(500, { error: 'transfer_failed' })],
    ['an error status that says the coins moved', () => jsonResponse(500, { ok: true })],
    ['a refusal with no reason', () => jsonResponse(409, {})],
    ['a refusal in upper case', () => jsonResponse(409, { error: 'STALE_SEQUENCE' })],
    ['an ok status with a refusal in it', () => jsonResponse(200, { error: 'stale_sequence' })],
    ['an ok status that does not say the coins moved', () => jsonResponse(200, {})],
    ['an ok status that says they did not', () => jsonResponse(200, { ok: false })],
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

    const result = await sendTransfer({ endpoint: ENDPOINT, fetchImpl }, SEND_200);

    expect(result).toEqual({ ok: false, error: 'network_error' });
  });
});
