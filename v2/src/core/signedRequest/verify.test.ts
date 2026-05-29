import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { verifySignedRequest } from './verify';
import { signRequest } from './sign';
import { REPLAY_WINDOW_MS } from './types';
import type { NonceStore } from './nonceStore';
import * as identity from '../identity/identity';
import { generateIdentity, sign } from '../identity/identity';
import { bytesToHex, hexToBytes } from '../identity/hex';

const freshStore: NonceStore = async () => ({ fresh: true });
const usedStore: NonceStore = async () => ({ fresh: false });

// Accepts any object (the base schema enforces action/ts/nonce separately).
const anySchema = z.looseObject({});

/** Sign an arbitrary payload string verbatim — for cases signRequest can't
 *  produce (non-JSON bytes, a controlled ts, a payload missing base fields). */
const signPayload = (payload: string, id = generateIdentity()) => ({
  payload,
  publicKey: id.publicKeyHex,
  signature: bytesToHex(sign(hexToBytes(id.privateKeyHex)!, new TextEncoder().encode(payload))),
});

const fixedTs = 1_000_000;
const validPayloadAt = (ts: number): string =>
  JSON.stringify({ action: 'act', ts, nonce: 'a'.repeat(32) });

describe('verifySignedRequest', () => {
  it('accepts a freshly signed envelope and returns the parsed payload', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'act', { foo: 'bar' });

    const result = await verifySignedRequest(envelope, anySchema, { nonceStore: freshStore });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.publicKey).toBe(id.publicKeyHex);
    expect((result.payload as { foo: string }).foo).toBe('bar');
  });

  it('rejects a tampered payload as signature_invalid', async () => {
    const envelope = signRequest(generateIdentity(), 'act', {});
    const tampered = { ...envelope, payload: `${envelope.payload} ` };

    const result = await verifySignedRequest(tampered, anySchema, { nonceStore: freshStore });

    expect(result).toEqual({ ok: false, reason: 'signature_invalid' });
  });

  it('rejects a structurally invalid envelope as envelope_invalid', async () => {
    const envelope = signRequest(generateIdentity(), 'act', {});
    const broken = { ...envelope, publicKey: 'too-short' };

    const result = await verifySignedRequest(broken, anySchema, { nonceStore: freshStore });

    expect(result).toEqual({ ok: false, reason: 'envelope_invalid' });
  });

  it('rejects validly-signed non-JSON bytes as payload_malformed', async () => {
    const envelope = signPayload('this is not json');

    const result = await verifySignedRequest(envelope, anySchema, { nonceStore: freshStore });

    expect(result).toEqual({ ok: false, reason: 'payload_malformed' });
  });

  it('rejects a payload missing the base fields as payload_invalid', async () => {
    const envelope = signPayload(JSON.stringify({ foo: 'bar' }));

    const result = await verifySignedRequest(envelope, anySchema, { nonceStore: freshStore });

    expect(result).toEqual({ ok: false, reason: 'payload_invalid' });
  });

  it('rejects a payload the caller schema refuses as payload_invalid', async () => {
    const envelope = signRequest(generateIdentity(), 'act', {});
    const demandingSchema = z.looseObject({ required: z.string() });

    const result = await verifySignedRequest(envelope, demandingSchema, { nonceStore: freshStore });

    expect(result).toEqual({ ok: false, reason: 'payload_invalid' });
  });

  it('rejects a duplicate nonce as replay', async () => {
    const envelope = signRequest(generateIdentity(), 'act', {});

    const result = await verifySignedRequest(envelope, anySchema, { nonceStore: usedStore });

    expect(result).toEqual({ ok: false, reason: 'replay' });
  });

  describe('timestamp window (bidirectional)', () => {
    it('accepts a ts exactly at the window edge in the future', async () => {
      const envelope = signPayload(validPayloadAt(fixedTs));
      const result = await verifySignedRequest(envelope, anySchema, {
        nonceStore: freshStore,
        now: () => fixedTs + REPLAY_WINDOW_MS,
      });
      expect(result.ok).toBe(true);
    });

    it('rejects a ts one ms past the window in the future', async () => {
      const envelope = signPayload(validPayloadAt(fixedTs));
      const result = await verifySignedRequest(envelope, anySchema, {
        nonceStore: freshStore,
        now: () => fixedTs + REPLAY_WINDOW_MS + 1,
      });
      expect(result).toEqual({ ok: false, reason: 'timestamp_skew' });
    });

    it('rejects a ts one ms past the window in the past', async () => {
      const envelope = signPayload(validPayloadAt(fixedTs));
      const result = await verifySignedRequest(envelope, anySchema, {
        nonceStore: freshStore,
        now: () => fixedTs - REPLAY_WINDOW_MS - 1,
      });
      expect(result).toEqual({ ok: false, reason: 'timestamp_skew' });
    });
  });

  it('uses a real clock by default — an ancient ts is rejected as timestamp_skew', async () => {
    // No deps.now → the default () => Date.now() must run; a ts of 0 is ~decades
    // outside the window. Catches a default-clock mutant that returns undefined.
    const envelope = signPayload(JSON.stringify({ action: 'act', ts: 0, nonce: 'a'.repeat(32) }));

    const result = await verifySignedRequest(envelope, anySchema, { nonceStore: freshStore });

    expect(result).toEqual({ ok: false, reason: 'timestamp_skew' });
  });

  // The hex anchors are the zero-trust boundary's first gate: without ^/$ a
  // prefixed/suffixed key slips through as signature_invalid (401) instead of
  // being rejected up front as envelope_invalid (400).
  const validHex64 = 'a'.repeat(64);
  const validHex128 = 'a'.repeat(128);
  it.each([
    ['publicKey with leading junk', { publicKey: `z${validHex64}` }],
    ['publicKey with trailing junk', { publicKey: `${validHex64}z` }],
    ['signature with leading junk', { signature: `z${validHex128}` }],
    ['signature with trailing junk', { signature: `${validHex128}z` }],
  ])('rejects an envelope whose %s as envelope_invalid', async (_name, override) => {
    const base = signRequest(generateIdentity(), 'act', {});

    const result = await verifySignedRequest({ ...base, ...override }, anySchema, {
      nonceStore: freshStore,
    });

    expect(result).toEqual({ ok: false, reason: 'envelope_invalid' });
  });

  it.each([
    ['leading junk', `z${'a'.repeat(32)}`],
    ['trailing junk', `${'a'.repeat(32)}z`],
  ])('rejects a payload nonce with %s as payload_invalid', async (_name, nonce) => {
    const envelope = signPayload(JSON.stringify({ action: 'act', ts: fixedTs, nonce }));

    const result = await verifySignedRequest(envelope, anySchema, {
      nonceStore: freshStore,
      now: () => fixedTs,
    });

    expect(result).toEqual({ ok: false, reason: 'payload_invalid' });
  });

  it('treats a crypto-lib throw as signature_invalid, not a crash', async () => {
    // @noble can throw on certain malformed points. The boundary must turn that
    // into a clean rejection (401), never an unhandled 500. Simulate the throw.
    const envelope = signRequest(generateIdentity(), 'act', {});
    const spy = vi.spyOn(identity, 'verify').mockImplementationOnce(() => {
      throw new Error('malformed point');
    });

    const result = await verifySignedRequest(envelope, anySchema, { nonceStore: freshStore });

    spy.mockRestore();
    expect(result).toEqual({ ok: false, reason: 'signature_invalid' });
  });

  it('does not consult the nonce store when an earlier check fails (cheapest-first)', async () => {
    const envelope = signRequest(generateIdentity(), 'act', {});
    const tampered = { ...envelope, payload: `${envelope.payload} ` };
    const spy = vi.fn<NonceStore>(async () => ({ fresh: true }));

    await verifySignedRequest(tampered, anySchema, { nonceStore: spy });

    expect(spy).not.toHaveBeenCalled();
  });
});
