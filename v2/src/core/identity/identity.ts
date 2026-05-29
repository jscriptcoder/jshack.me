/**
 * Ed25519 player identity — keypair generation, defensive load, and a
 * storage-backed get-or-create.
 *
 * Wraps `@noble/ed25519` (v3 sync API) to keep the rest of the codebase
 * decoupled from the lib. The env-level `Identity` carries hex strings
 * (JSON-safe, serializable); signing converts back to bytes at the adapter
 * boundary (a later slice).
 *
 * `loadIdentity` is deliberately defensive: any malformed storage (missing
 * fields, wrong length, non-lowercase-hex, non-JSON) returns null so
 * `getOrCreateIdentity` regenerates instead of crashing on boot. Silent reset
 * on corruption is intentional (see project_multiplayer_identity_wallet_keys).
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { asPlayerKeyHex } from '../types';
import type { Identity } from '../commands/types';
import { bytesToHex } from './hex';

// @noble/ed25519 v3 ships sync sign/verify but requires the caller to provide
// a SHA-512 implementation (kept out of the core package to minimize bundle
// size). Wire it once at module load.
ed.hashes.sha512 = sha512;

/** The minimal storage surface `getOrCreateIdentity` needs — a subset of the
 *  DOM `Storage` interface so it's unit-testable with a fake. */
export type IdentityStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const IDENTITY_STORAGE_KEY = 'jshack.identity';

// Canonical stored form: 64 lowercase hex chars per key. Strict on load — we
// serialize lowercase, so anything else is corruption and gets regenerated.
const HEX_64 = /^[0-9a-f]{64}$/;

const isHex64 = (value: unknown): value is string =>
  typeof value === 'string' && HEX_64.test(value);

export const generateIdentity = (): Identity => {
  const privateKey = ed.utils.randomSecretKey();
  const publicKey = ed.getPublicKey(privateKey);
  return {
    publicKeyHex: asPlayerKeyHex(bytesToHex(publicKey)),
    privateKeyHex: bytesToHex(privateKey),
  };
};

export const loadIdentity = (raw: string | null): Identity | null => {
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const { publicKeyHex, privateKeyHex } = parsed as Record<string, unknown>;
  if (!isHex64(publicKeyHex) || !isHex64(privateKeyHex)) return null;

  return { publicKeyHex: asPlayerKeyHex(publicKeyHex), privateKeyHex };
};

export const serializeIdentity = (identity: Identity): string =>
  JSON.stringify({
    publicKeyHex: identity.publicKeyHex,
    privateKeyHex: identity.privateKeyHex,
  });

export const getOrCreateIdentity = (storage: IdentityStorage): Identity => {
  const existing = loadIdentity(storage.getItem(IDENTITY_STORAGE_KEY));
  if (existing !== null) return existing;

  const fresh = generateIdentity();
  storage.setItem(IDENTITY_STORAGE_KEY, serializeIdentity(fresh));
  return fresh;
};

// Low-level Ed25519 sign/verify over raw bytes — the single wrapping point for
// @noble. Higher layers (signedRequest) convert hex ↔ bytes at the boundary.
export const sign = (privateKey: Uint8Array, message: Uint8Array): Uint8Array =>
  ed.sign(message, privateKey);

export const verify = (
  publicKey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): boolean => ed.verify(signature, message, publicKey);
