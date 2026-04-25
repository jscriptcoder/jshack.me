import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { generateIdentity } from '../identity/identity';
import { signRequest } from './sign';
import { verifySignedRequest } from './verify';
import { noopNonceStore, type NonceStore } from './nonceStore';

const allocateIpSchema = z
  .object({
    action: z.literal('allocateIp'),
    nonce: z.string(),
    ts: z.number(),
    kind: z.enum(['mission_instance', 'home_network']),
  })
  .strict();

describe('verifySignedRequest', () => {
  const fixedTs = 1_700_000_000_000;
  const now = () => fixedTs;

  it('returns ok with publicKey + parsed payload on a valid envelope', async () => {
    const identity = generateIdentity();
    // Force ts close to our fixed now
    const realNow = Date.now;
    Date.now = () => fixedTs;
    const envelope = signRequest(identity, 'allocateIp', { kind: 'mission_instance' });
    Date.now = realNow;

    const result = await verifySignedRequest(envelope, allocateIpSchema, {
      nonceStore: noopNonceStore,
      now,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.publicKey).toBe(identity.publicKeyHex);
      expect(result.payload.action).toBe('allocateIp');
      expect(result.payload.kind).toBe('mission_instance');
    }
  });

  it('rejects when envelope is not an object', async () => {
    const result = await verifySignedRequest('garbage', allocateIpSchema, {
      nonceStore: noopNonceStore,
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('envelope_invalid');
  });

  it('rejects when envelope is missing fields', async () => {
    const result = await verifySignedRequest({}, allocateIpSchema, {
      nonceStore: noopNonceStore,
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('envelope_invalid');
  });

  it('rejects when publicKey is wrong length', async () => {
    const identity = generateIdentity();
    const real = signRequest(identity, 'allocateIp', { kind: 'mission_instance' });
    const envelope = { ...real, publicKey: 'ab' };
    const result = await verifySignedRequest(envelope, allocateIpSchema, {
      nonceStore: noopNonceStore,
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('envelope_invalid');
  });

  it('rejects when signature does not verify against publicKey', async () => {
    const identity = generateIdentity();
    const stranger = generateIdentity();
    const real = signRequest(identity, 'allocateIp', { kind: 'mission_instance' });
    const envelope = { ...real, publicKey: stranger.publicKeyHex };
    const result = await verifySignedRequest(envelope, allocateIpSchema, {
      nonceStore: noopNonceStore,
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('signature_invalid');
  });

  it('rejects when payload is tampered after signing', async () => {
    const identity = generateIdentity();
    const real = signRequest(identity, 'allocateIp', { kind: 'mission_instance' });
    const envelope = { ...real, payload: real.payload.replace('mission_instance', 'home_network') };
    const result = await verifySignedRequest(envelope, allocateIpSchema, {
      nonceStore: noopNonceStore,
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('signature_invalid');
  });

  it('rejects when payload is not valid JSON (signed garbage)', async () => {
    const identity = generateIdentity();
    // Sign actual non-JSON bytes via the lower-level primitive
    const { sign: edSign } = await import('../identity/identity');
    const { bytesToHex } = await import('../identity/hex');
    const garbage = 'not-json-at-all';
    const sig = edSign(identity.privateKey, new TextEncoder().encode(garbage));
    const envelope = {
      payload: garbage,
      publicKey: identity.publicKeyHex,
      signature: bytesToHex(sig),
    };
    const result = await verifySignedRequest(envelope, allocateIpSchema, {
      nonceStore: noopNonceStore,
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('payload_malformed');
  });

  it('rejects when payload is missing base fields (action/ts/nonce)', async () => {
    const identity = generateIdentity();
    const { sign: edSign } = await import('../identity/identity');
    const { bytesToHex } = await import('../identity/hex');
    const payload = JSON.stringify({ kind: 'mission_instance' });
    const sig = edSign(identity.privateKey, new TextEncoder().encode(payload));
    const envelope = {
      payload,
      publicKey: identity.publicKeyHex,
      signature: bytesToHex(sig),
    };
    const result = await verifySignedRequest(envelope, allocateIpSchema, {
      nonceStore: noopNonceStore,
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('payload_invalid');
  });

  it('rejects when caller schema rejects (e.g. unknown kind)', async () => {
    const identity = generateIdentity();
    Date.now = () => fixedTs;
    const envelope = signRequest(identity, 'allocateIp', { kind: 'evil_kind' });
    Date.now = () => Date.now();

    const result = await verifySignedRequest(envelope, allocateIpSchema, {
      nonceStore: noopNonceStore,
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('payload_invalid');
  });

  it('rejects when timestamp is too far in the past (replay window)', async () => {
    const identity = generateIdentity();
    const realNow = Date.now;
    Date.now = () => fixedTs - 200_000; // 200s ago, outside 120s window
    const envelope = signRequest(identity, 'allocateIp', { kind: 'mission_instance' });
    Date.now = realNow;

    const result = await verifySignedRequest(envelope, allocateIpSchema, {
      nonceStore: noopNonceStore,
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('timestamp_skew');
  });

  it('rejects when timestamp is too far in the future', async () => {
    const identity = generateIdentity();
    const realNow = Date.now;
    Date.now = () => fixedTs + 200_000; // 200s ahead
    const envelope = signRequest(identity, 'allocateIp', { kind: 'mission_instance' });
    Date.now = realNow;

    const result = await verifySignedRequest(envelope, allocateIpSchema, {
      nonceStore: noopNonceStore,
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('timestamp_skew');
  });

  it('accepts timestamps within the 120s window', async () => {
    const identity = generateIdentity();
    const realNow = Date.now;
    Date.now = () => fixedTs - 60_000; // 60s ago, within window
    const envelope = signRequest(identity, 'allocateIp', { kind: 'mission_instance' });
    Date.now = realNow;

    const result = await verifySignedRequest(envelope, allocateIpSchema, {
      nonceStore: noopNonceStore,
      now,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects when nonce store reports replay (duplicate)', async () => {
    const identity = generateIdentity();
    Date.now = () => fixedTs;
    const envelope = signRequest(identity, 'allocateIp', { kind: 'mission_instance' });
    Date.now = () => Date.now();

    const replayedStore: NonceStore = vi.fn().mockResolvedValue({ fresh: false });
    const result = await verifySignedRequest(envelope, allocateIpSchema, {
      nonceStore: replayedStore,
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('replay');
  });

  it('does not call the nonce store until signature + schema + ts have all passed', async () => {
    // Important: nonce store hits Upstash. We don't want to burn that call on
    // requests that fail cheap CPU-only checks.
    const nonceStore: NonceStore = vi.fn().mockResolvedValue({ fresh: true });
    await verifySignedRequest('garbage', allocateIpSchema, { nonceStore, now });
    expect(nonceStore).not.toHaveBeenCalled();
  });
});
