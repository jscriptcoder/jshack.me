import { describe, it, expect, beforeEach } from 'vitest';
import { generateIdentity } from './identity';
import { saveIdentity, loadIdentity, clearIdentity, getOrCreateIdentity } from './storage';

// Minimal Storage shim — mimics localStorage's getItem/setItem/removeItem.
const makeStorage = (): Storage => {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    key: (index) => Array.from(map.keys())[index] ?? null,
  };
};

describe('saveIdentity + loadIdentity', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = makeStorage();
  });

  it('save then load returns an equivalent identity', () => {
    const original = generateIdentity();
    saveIdentity(storage, original);
    const loaded = loadIdentity(storage);
    expect(loaded).not.toBeNull();
    expect(loaded!.publicKeyHex).toBe(original.publicKeyHex);
    expect(loaded!.privateKey).toEqual(original.privateKey);
    expect(loaded!.publicKey).toEqual(original.publicKey);
  });

  it('returns null when no identity is stored', () => {
    expect(loadIdentity(storage)).toBeNull();
  });

  it('returns null when stored value is malformed JSON', () => {
    storage.setItem('jshack.identity', 'not-valid-json{{{');
    expect(loadIdentity(storage)).toBeNull();
  });

  it('returns null when stored object is missing required fields', () => {
    storage.setItem('jshack.identity', JSON.stringify({ publicKey: 'abc' }));
    expect(loadIdentity(storage)).toBeNull();
  });

  it('returns null when stored hex is not parsable to 32 bytes', () => {
    storage.setItem(
      'jshack.identity',
      JSON.stringify({ publicKey: 'not-hex', privateKey: 'not-hex' }),
    );
    expect(loadIdentity(storage)).toBeNull();
  });
});

describe('clearIdentity', () => {
  it('removes the identity entry', () => {
    const storage = makeStorage();
    saveIdentity(storage, generateIdentity());
    expect(loadIdentity(storage)).not.toBeNull();
    clearIdentity(storage);
    expect(loadIdentity(storage)).toBeNull();
  });

  it('is a no-op when no identity is stored', () => {
    const storage = makeStorage();
    expect(() => clearIdentity(storage)).not.toThrow();
  });
});

describe('getOrCreateIdentity', () => {
  it('returns the existing identity when one is stored', () => {
    const storage = makeStorage();
    const original = generateIdentity();
    saveIdentity(storage, original);
    const result = getOrCreateIdentity(storage);
    expect(result.publicKeyHex).toBe(original.publicKeyHex);
  });

  it('generates and persists a new identity when none is stored', () => {
    const storage = makeStorage();
    expect(loadIdentity(storage)).toBeNull();
    const result = getOrCreateIdentity(storage);
    expect(result.publicKey.length).toBe(32);
    // The generated identity must be persisted — a second call returns the same one.
    const second = getOrCreateIdentity(storage);
    expect(second.publicKeyHex).toBe(result.publicKeyHex);
  });
});
