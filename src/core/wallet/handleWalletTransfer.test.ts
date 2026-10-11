import { describe, expect, it } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  handleWalletTransfer,
  type TransferOrder,
  type WalletTransferDeps,
} from './handleWalletTransfer.js';
import { bytesToHex, hexToBytes } from '../identity/hex.js';

/**
 * A transfer of coins from one address to another.
 *
 * The one thing the ledger asks of a sender is the signature of the key their
 * address was made from. Nothing here knows a player, a machine or a session.
 */

const SENDER_KEY = 'c0ffee'.repeat(11).slice(0, 64);
const STRANGER_KEY = '5ca1ab1e'.repeat(8);
const DESTINATION = `jsc${'0123456789abcdef'.repeat(3).slice(0, 40)}`;
const NOW = 1_800_000_000_000;

const bytesOf = (hex: string): Uint8Array => {
  const bytes = hexToBytes(hex);
  if (bytes === null) throw new Error(`not hex: ${hex}`);
  return bytes;
};

const publicKeyOf = (keyHex: string): string => bytesToHex(ed.getPublicKey(bytesOf(keyHex)));

/** The address a key answers to, worked out here from the rule itself — `jsc`
 *  and the first 40 hex characters of the public key's sha256 — so the test
 *  does not ask the code under test what its own answer should be. */
const addressOfKey = (keyHex: string): string =>
  `jsc${bytesToHex(sha256(ed.getPublicKey(bytesOf(keyHex)))).slice(0, 40)}`;

const SENDER = addressOfKey(SENDER_KEY);

/** What a wallet signs to move coins. A field overridden with `undefined` is
 *  left out of the signed text altogether. */
const transferOf = (overrides: Readonly<Record<string, unknown>> = {}): unknown => ({
  action: 'transfer',
  to: DESTINATION,
  amount: 200,
  sequence: 0,
  nonce: 'ab'.repeat(16),
  ts: NOW,
  ...overrides,
});

/** An envelope around `payload`, signed by `keyHex`: the text is signed exactly
 *  as it is sent. */
const signedBy = (
  keyHex: string,
  payload: unknown,
): { readonly payload: string; readonly publicKey: string; readonly signature: string } => {
  const text = JSON.stringify(payload);
  return {
    payload: text,
    publicKey: publicKeyOf(keyHex),
    signature: bytesToHex(ed.sign(new TextEncoder().encode(text), bytesOf(keyHex))),
  };
};

/** A ledger that answers every transfer with `answer`, and keeps what it was
 *  asked to move. */
const ledgerThat = (
  answer: { readonly data: unknown; readonly error: unknown } = { data: 'moved', error: null },
  fresh = true,
): { readonly deps: WalletTransferDeps; readonly asked: readonly TransferOrder[] } => {
  const asked: TransferOrder[] = [];
  return {
    deps: {
      nonceStore: async () => ({ fresh }),
      now: () => NOW,
      transfer: async (order) => {
        asked.push(order);
        return answer;
      },
    },
    asked,
  };
};

describe('handleWalletTransfer — a transfer the ledger makes', () => {
  it('moves the amount when the envelope is signed by the sending address’s key', async () => {
    const { deps, asked } = ledgerThat();

    const response = await handleWalletTransfer(signedBy(SENDER_KEY, transferOf()), deps);

    expect(response).toEqual({ status: 200, body: { ok: true } });
    expect(asked).toEqual([{ from: SENDER, to: DESTINATION, amount: 200, sequence: 0 }]);
  });

  it('sends from the address of the key that signed, whatever the transfer says of its sender', async () => {
    const { deps, asked } = ledgerThat();
    const claimed = transferOf({ from: addressOfKey(STRANGER_KEY) });

    await handleWalletTransfer(signedBy(SENDER_KEY, claimed), deps);

    expect(asked.map((order) => order.from)).toEqual([SENDER]);
  });

  it('sends from the same address when the public key arrives in upper case', async () => {
    const { deps, asked } = ledgerThat();
    const envelope = signedBy(SENDER_KEY, transferOf());

    const response = await handleWalletTransfer(
      { ...envelope, publicKey: envelope.publicKey.toUpperCase() },
      deps,
    );

    expect(response.status).toBe(200);
    expect(asked.map((order) => order.from)).toEqual([SENDER]);
  });

  it('moves a single coin, at whatever sequence number the wallet has reached', async () => {
    const { deps, asked } = ledgerThat();

    const response = await handleWalletTransfer(
      signedBy(SENDER_KEY, transferOf({ amount: 1, sequence: 7 })),
      deps,
    );

    expect(response.status).toBe(200);
    expect(asked).toEqual([{ from: SENDER, to: DESTINATION, amount: 1, sequence: 7 }]);
  });

  it('moves the largest amount the ledger holds, exactly', async () => {
    const { deps, asked } = ledgerThat();

    await handleWalletTransfer(
      signedBy(SENDER_KEY, transferOf({ amount: Number.MAX_SAFE_INTEGER })),
      deps,
    );

    expect(asked.map((order) => order.amount)).toEqual([9007199254740991]);
  });
});

describe('handleWalletTransfer — a transfer it turns away before the ledger', () => {
  it.each([
    ['the mint’s label as its destination', { to: 'coinbase' }],
    ['a destination in upper case', { to: DESTINATION.toUpperCase() }],
    ['a destination one character short', { to: DESTINATION.slice(0, -1) }],
    ['a destination one character long', { to: `${DESTINATION}0` }],
    ['a destination that is a number', { to: 12 }],
    ['no destination', { to: undefined }],
    ['an amount of nothing', { amount: 0 }],
    ['an amount below nothing', { amount: -5 }],
    ['an amount with a fraction', { amount: 2.5 }],
    ['an amount sent as text', { amount: '200' }],
    ['an amount too large to be exact', { amount: 2 ** 53 }],
    ['no amount', { amount: undefined }],
    ['a sequence number below zero', { sequence: -1 }],
    ['a sequence number with a fraction', { sequence: 0.5 }],
    ['a sequence number sent as text', { sequence: '0' }],
    ['a sequence number too large to be exact', { sequence: 2 ** 53 }],
    ['no sequence number', { sequence: undefined }],
    ['a signed read of a balance', { action: 'balance' }],
    ['an action in upper case', { action: 'TRANSFER' }],
  ])('answers 400 to %s', async (_label, overrides) => {
    const { deps, asked } = ledgerThat();

    const response = await handleWalletTransfer(signedBy(SENDER_KEY, transferOf(overrides)), deps);

    expect(response).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(asked).toEqual([]);
  });

  it('answers 400 to a transfer to the address it comes from', async () => {
    const { deps, asked } = ledgerThat();

    const response = await handleWalletTransfer(
      signedBy(SENDER_KEY, transferOf({ to: SENDER })),
      deps,
    );

    expect(response).toEqual({ status: 400, body: { error: 'self_transfer' } });
    expect(asked).toEqual([]);
  });

  it.each([
    ['an unsigned read of a balance', { action: 'balance', address: DESTINATION }],
    ['a transfer with no envelope around it', transferOf()],
    ['no body', null],
    ['nothing', undefined],
  ])('answers 400 to %s', async (_label, body) => {
    const { deps, asked } = ledgerThat();

    const response = await handleWalletTransfer(body, deps);

    expect(response).toEqual({ status: 400, body: { error: 'envelope_invalid' } });
    expect(asked).toEqual([]);
  });
});

describe('handleWalletTransfer — a transfer nobody with the key signed', () => {
  it('answers 401 when another key’s signature rides under the sender’s public key', async () => {
    const { deps, asked } = ledgerThat();
    const forged = {
      ...signedBy(STRANGER_KEY, transferOf()),
      publicKey: publicKeyOf(SENDER_KEY),
    };

    const response = await handleWalletTransfer(forged, deps);

    expect(response).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(asked).toEqual([]);
  });

  it('answers 401 when the amount was changed after it was signed', async () => {
    const { deps, asked } = ledgerThat();
    const signed = signedBy(SENDER_KEY, transferOf({ amount: 200 }));

    const response = await handleWalletTransfer(
      { ...signed, payload: JSON.stringify(transferOf({ amount: 500 })) },
      deps,
    );

    expect(response).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(asked).toEqual([]);
  });

  it('answers 401 to a transfer signed too long ago', async () => {
    const { deps, asked } = ledgerThat();

    const response = await handleWalletTransfer(
      signedBy(SENDER_KEY, transferOf({ ts: NOW - 120_001 })),
      deps,
    );

    expect(response).toEqual({ status: 401, body: { error: 'timestamp_skew' } });
    expect(asked).toEqual([]);
  });

  it('answers 401 to a transfer the nonce store has seen before', async () => {
    const { deps, asked } = ledgerThat({ data: 'moved', error: null }, false);

    const response = await handleWalletTransfer(signedBy(SENDER_KEY, transferOf()), deps);

    expect(response).toEqual({ status: 401, body: { error: 'replay' } });
    expect(asked).toEqual([]);
  });
});

describe('handleWalletTransfer — a transfer the ledger refuses', () => {
  it.each([
    ['a sequence number the wallet has moved past', 'stale_sequence'],
    ['a balance that does not cover the amount', 'insufficient_balance'],
    ['a destination that can hold no more', 'destination_full'],
  ])('answers 409 to %s', async (_label, refusal) => {
    const { deps } = ledgerThat({ data: refusal, error: null });

    const response = await handleWalletTransfer(signedBy(SENDER_KEY, transferOf()), deps);

    expect(response).toEqual({ status: 409, body: { error: refusal } });
  });

  it('answers 500 when the ledger fails', async () => {
    const { deps } = ledgerThat({ data: null, error: { message: 'connection refused' } });

    const response = await handleWalletTransfer(signedBy(SENDER_KEY, transferOf()), deps);

    expect(response).toEqual({ status: 500, body: { error: 'transfer_failed' } });
  });

  it('answers 500 when the ledger fails and still says the coins moved', async () => {
    const { deps } = ledgerThat({ data: 'moved', error: { message: 'connection lost' } });

    const response = await handleWalletTransfer(signedBy(SENDER_KEY, transferOf()), deps);

    expect(response).toEqual({ status: 500, body: { error: 'transfer_failed' } });
  });

  it.each([
    ['nothing', null],
    ['a word it does not know', 'ok'],
    ['the right word in upper case', 'MOVED'],
    ['a balance', 300],
    ['a row', { outcome: 'moved' }],
  ])('answers 500 rather than read %s as a transfer made', async (_label, data) => {
    const { deps } = ledgerThat({ data, error: null });

    const response = await handleWalletTransfer(signedBy(SENDER_KEY, transferOf()), deps);

    expect(response).toEqual({ status: 500, body: { error: 'transfer_failed' } });
  });
});
