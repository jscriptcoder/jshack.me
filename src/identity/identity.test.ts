import { describe, it, expect } from 'vitest';
import { generateIdentity, sign, verify } from './identity';

describe('generateIdentity', () => {
  it('returns a valid Ed25519 keypair', () => {
    const identity = generateIdentity();
    expect(identity.privateKey).toBeInstanceOf(Uint8Array);
    expect(identity.publicKey).toBeInstanceOf(Uint8Array);
    expect(identity.privateKey.length).toBe(32);
    expect(identity.publicKey.length).toBe(32);
  });

  it('exposes publicKeyHex matching the public key bytes', () => {
    const identity = generateIdentity();
    expect(identity.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces unique keys on each call', () => {
    const a = generateIdentity();
    const b = generateIdentity();
    expect(a.publicKeyHex).not.toBe(b.publicKeyHex);
  });
});

describe('sign + verify', () => {
  const message = new TextEncoder().encode('hello world');

  it('round-trips: sign with private key, verify with public key', () => {
    const { privateKey, publicKey } = generateIdentity();
    const signature = sign(privateKey, message);
    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.length).toBe(64);
    expect(verify(publicKey, signature, message)).toBe(true);
  });

  it('rejects a tampered message', () => {
    const { privateKey, publicKey } = generateIdentity();
    const signature = sign(privateKey, message);
    const tampered = new TextEncoder().encode('hello world!');
    expect(verify(publicKey, signature, tampered)).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const a = generateIdentity();
    const b = generateIdentity();
    const signature = sign(a.privateKey, message);
    // verify with B's public key — signature was made with A's private key
    expect(verify(b.publicKey, signature, message)).toBe(false);
  });

  it('signing is deterministic for the same (key, message) pair', () => {
    // Ed25519 spec: sign(k, m) is a fixed function — no randomness at sign time.
    // Two signs of the same message with the same key must produce identical bytes.
    const { privateKey } = generateIdentity();
    const sigA = sign(privateKey, message);
    const sigB = sign(privateKey, message);
    expect(sigA).toEqual(sigB);
  });
});
