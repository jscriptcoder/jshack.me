// Ed25519 identity primitives — keypair generation + sign/verify.
//
// Wraps @noble/ed25519 to keep the rest of the codebase decoupled from the
// underlying lib. If we ever swap implementations (Web Crypto API once
// browser support stabilizes, or a different lib), only this file changes.
//
// See docs/technology-choices.md for the rationale (small + fast + audited
// pure-JS, deterministic signing, etc.) and how this fits into the
// player-identity / patch-signing flow.

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from './hex.js';

// @noble/ed25519 v3+ ships sync sign/verify but requires the caller to
// provide a SHA-512 implementation (kept out of the core package to
// minimize bundle size). Wire it once at module load.
ed.hashes.sha512 = sha512;

export type Identity = {
  readonly privateKey: Uint8Array; // 32 bytes — never leaves the device
  readonly publicKey: Uint8Array; // 32 bytes — the player's identity
  readonly publicKeyHex: string; // 64-char lowercase hex, for display + storage
};

export const generateIdentity = (): Identity => {
  const privateKey = ed.utils.randomSecretKey();
  const publicKey = ed.getPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    publicKeyHex: bytesToHex(publicKey),
  };
};

export const sign = (privateKey: Uint8Array, message: Uint8Array): Uint8Array => {
  return ed.sign(message, privateKey);
};

export const verify = (
  publicKey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): boolean => {
  return ed.verify(signature, message, publicKey);
};
