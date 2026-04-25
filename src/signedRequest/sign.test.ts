import { describe, it, expect } from 'vitest';
import { generateIdentity, verify } from '../identity/identity';
import { hexToBytes } from '../identity/hex';
import { signRequest } from './sign';
import { signedEnvelopeSchema, signedPayloadBaseSchema } from './types';

describe('signRequest', () => {
  it('returns an envelope matching the strict envelope schema', () => {
    const identity = generateIdentity();
    const envelope = signRequest(identity, 'test_action', { foo: 'bar' });
    expect(signedEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });

  it("uses the identity's publicKeyHex as the envelope publicKey", () => {
    const identity = generateIdentity();
    const envelope = signRequest(identity, 'test_action', {});
    expect(envelope.publicKey).toBe(identity.publicKeyHex);
  });

  it('signs the UTF-8 bytes of the payload string — verifies with the matching public key', () => {
    const identity = generateIdentity();
    const envelope = signRequest(identity, 'test_action', { kind: 'mission_instance' });

    const sigBytes = hexToBytes(envelope.signature)!;
    const pubBytes = hexToBytes(envelope.publicKey)!;
    const msgBytes = new TextEncoder().encode(envelope.payload);

    expect(verify(pubBytes, sigBytes, msgBytes)).toBe(true);
  });

  it('embeds action, nonce, and ts in the parsed payload', () => {
    const identity = generateIdentity();
    const before = Date.now();
    const envelope = signRequest(identity, 'allocateIp', { kind: 'mission_instance' });
    const after = Date.now();

    const parsed = JSON.parse(envelope.payload);
    const base = signedPayloadBaseSchema.safeParse(parsed);
    expect(base.success).toBe(true);
    if (base.success) {
      expect(base.data.action).toBe('allocateIp');
      expect(base.data.ts).toBeGreaterThanOrEqual(before);
      expect(base.data.ts).toBeLessThanOrEqual(after);
      expect(base.data.nonce).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('preserves caller-provided action fields in the payload', () => {
    const identity = generateIdentity();
    const envelope = signRequest(identity, 'allocateIp', {
      kind: 'home_network',
      owner_key: 'ed25519:abc',
      instance_ref: 'ref-xyz',
    });
    const parsed = JSON.parse(envelope.payload);
    expect(parsed.kind).toBe('home_network');
    expect(parsed.owner_key).toBe('ed25519:abc');
    expect(parsed.instance_ref).toBe('ref-xyz');
  });

  it('produces different nonces (and signatures) on consecutive calls', () => {
    const identity = generateIdentity();
    const a = signRequest(identity, 'allocateIp', { kind: 'mission_instance' });
    const b = signRequest(identity, 'allocateIp', { kind: 'mission_instance' });
    expect(JSON.parse(a.payload).nonce).not.toBe(JSON.parse(b.payload).nonce);
    expect(a.signature).not.toBe(b.signature);
  });

  it('forbids caller from overriding action/ts/nonce via fields', () => {
    // Type-level guard would be ideal, but at runtime we strip these out so a
    // misbehaving caller can't backdoor a stale ts or replay a nonce.
    const identity = generateIdentity();
    const before = Date.now();
    const envelope = signRequest(identity, 'allocateIp', {
      action: 'overridden' as never,
      ts: 0 as never,
      nonce: 'bad' as never,
      kind: 'mission_instance',
    });
    const parsed = JSON.parse(envelope.payload);
    expect(parsed.action).toBe('allocateIp');
    expect(parsed.ts).toBeGreaterThanOrEqual(before);
    expect(parsed.nonce).not.toBe('bad');
    expect(parsed.nonce).toMatch(/^[0-9a-f]{32}$/);
  });
});
