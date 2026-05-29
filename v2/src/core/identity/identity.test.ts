import { describe, expect, it } from 'vitest';
import {
  generateIdentity,
  getOrCreateIdentity,
  IDENTITY_STORAGE_KEY,
  loadIdentity,
  serializeIdentity,
  sign,
  verify,
  type IdentityStorage,
} from './identity';
import { hexToBytes } from './hex';

const HEX_64 = /^[0-9a-f]{64}$/;

/** A stateful in-memory stand-in for the DOM Storage surface. Tracks
 *  setItem calls so tests can assert "persisted" vs "left untouched". */
const fakeStorage = (
  initial: string | null = null,
): IdentityStorage & { readonly writes: ReadonlyArray<{ key: string; value: string }> } => {
  const writes: { key: string; value: string }[] = [];
  let value = initial;
  return {
    getItem: () => value,
    setItem: (key: string, val: string) => {
      value = val;
      writes.push({ key, value: val });
    },
    writes,
  };
};

describe('generateIdentity', () => {
  it('produces a 64-char lowercase-hex public and private key', () => {
    const id = generateIdentity();
    expect(id.publicKeyHex).toMatch(HEX_64);
    expect(id.privateKeyHex).toMatch(HEX_64);
  });

  it('produces a different key on each call (real randomness)', () => {
    expect(generateIdentity().publicKeyHex).not.toBe(generateIdentity().publicKeyHex);
  });
});

describe('loadIdentity', () => {
  it('round-trips a serialized identity', () => {
    const id = generateIdentity();
    expect(loadIdentity(serializeIdentity(id))).toEqual(id);
  });

  it('returns null for null input', () => {
    expect(loadIdentity(null)).toBeNull();
  });

  it('returns null for non-JSON input', () => {
    expect(loadIdentity('not json {')).toBeNull();
  });

  it('returns null for a JSON null payload (without throwing on destructure)', () => {
    // The object/null guard exists so `const { ... } = parsed` never runs
    // against null. Stored `null` must yield null, not a thrown TypeError.
    expect(loadIdentity('null')).toBeNull();
  });

  it('returns null when publicKeyHex is missing', () => {
    expect(loadIdentity(JSON.stringify({ privateKeyHex: 'a'.repeat(64) }))).toBeNull();
  });

  it('returns null when privateKeyHex is missing', () => {
    expect(loadIdentity(JSON.stringify({ publicKeyHex: 'a'.repeat(64) }))).toBeNull();
  });

  it('returns null when publicKeyHex is one char too short (63)', () => {
    expect(
      loadIdentity(JSON.stringify({ publicKeyHex: 'a'.repeat(63), privateKeyHex: 'b'.repeat(64) })),
    ).toBeNull();
  });

  it('returns null when publicKeyHex is one char too long (65)', () => {
    expect(
      loadIdentity(JSON.stringify({ publicKeyHex: 'a'.repeat(65), privateKeyHex: 'b'.repeat(64) })),
    ).toBeNull();
  });

  it('returns null for uppercase hex (storage is canonical lowercase)', () => {
    expect(
      loadIdentity(JSON.stringify({ publicKeyHex: 'A'.repeat(64), privateKeyHex: 'b'.repeat(64) })),
    ).toBeNull();
  });

  it('returns null for non-hex characters', () => {
    expect(
      loadIdentity(JSON.stringify({ publicKeyHex: 'g'.repeat(64), privateKeyHex: 'b'.repeat(64) })),
    ).toBeNull();
  });

  it('returns null when only the private key is malformed', () => {
    expect(
      loadIdentity(JSON.stringify({ publicKeyHex: 'a'.repeat(64), privateKeyHex: 'b'.repeat(10) })),
    ).toBeNull();
  });
});

describe('sign / verify', () => {
  const keysOf = (id = generateIdentity()) => ({
    priv: hexToBytes(id.privateKeyHex)!,
    pub: hexToBytes(id.publicKeyHex)!,
  });

  it('verifies a signature produced over the same message and key', () => {
    const { priv, pub } = keysOf();
    const message = new TextEncoder().encode('hello world');
    expect(verify(pub, sign(priv, message), message)).toBe(true);
  });

  it('rejects a signature when the message was altered', () => {
    const { priv, pub } = keysOf();
    const signature = sign(priv, new TextEncoder().encode('original'));
    expect(verify(pub, signature, new TextEncoder().encode('tampered'))).toBe(false);
  });

  it('rejects a signature verified against a different public key', () => {
    const signer = keysOf();
    const other = keysOf();
    const message = new TextEncoder().encode('hello');
    expect(verify(other.pub, sign(signer.priv, message), message)).toBe(false);
  });
});

describe('getOrCreateIdentity', () => {
  it('generates and persists a fresh identity when storage is empty', () => {
    const storage = fakeStorage(null);

    const id = getOrCreateIdentity(storage);

    expect(id.publicKeyHex).toMatch(HEX_64);
    expect(storage.writes).toEqual([{ key: IDENTITY_STORAGE_KEY, value: serializeIdentity(id) }]);
  });

  it('returns the stored identity without rewriting it', () => {
    const existing = generateIdentity();
    const storage = fakeStorage(serializeIdentity(existing));

    const id = getOrCreateIdentity(storage);

    expect(id).toEqual(existing);
    expect(storage.writes).toEqual([]);
  });

  it('regenerates and overwrites when stored data is corrupt', () => {
    const storage = fakeStorage('corrupt-not-json');

    const id = getOrCreateIdentity(storage);

    expect(id.publicKeyHex).toMatch(HEX_64);
    expect(storage.writes).toEqual([{ key: IDENTITY_STORAGE_KEY, value: serializeIdentity(id) }]);
  });
});
