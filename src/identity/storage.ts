import { generateIdentity, type Identity } from './identity.js';
import { bytesToHex, hexToBytes } from './hex.js';

const STORAGE_KEY = 'jshack.identity';

type StoredIdentity = {
  readonly privateKey: string;
  readonly publicKey: string;
};

const isValidStoredIdentity = (value: unknown): value is StoredIdentity =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as StoredIdentity).privateKey === 'string' &&
  typeof (value as StoredIdentity).publicKey === 'string';

export const saveIdentity = (storage: Storage, identity: Identity): void => {
  const stored: StoredIdentity = {
    privateKey: bytesToHex(identity.privateKey),
    publicKey: bytesToHex(identity.publicKey),
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(stored));
};

// Defensive: returns null on any malformed storage state so the caller can
// fall back to generateIdentity rather than throwing on boot. The downside
// (silent identity reset on corruption) is documented in the identity-vs-
// wallet-keys memory.
export const loadIdentity = (storage: Storage): Identity | null => {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValidStoredIdentity(parsed)) return null;
    const privateKey = hexToBytes(parsed.privateKey);
    const publicKey = hexToBytes(parsed.publicKey);
    if (!privateKey || privateKey.length !== 32) return null;
    if (!publicKey || publicKey.length !== 32) return null;
    return {
      privateKey,
      publicKey,
      publicKeyHex: parsed.publicKey.toLowerCase(),
    };
  } catch {
    return null;
  }
};

export const clearIdentity = (storage: Storage): void => {
  storage.removeItem(STORAGE_KEY);
};

// Convenience: returns existing identity or generates+persists a new one.
// This is the typical entry point — callers don't usually need to know
// whether the identity is fresh or restored.
export const getOrCreateIdentity = (storage: Storage): Identity => {
  const existing = loadIdentity(storage);
  if (existing) return existing;
  const fresh = generateIdentity();
  saveIdentity(storage, fresh);
  return fresh;
};
