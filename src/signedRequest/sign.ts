import { sign as edSign, type Identity } from '../identity/identity.js';
import { bytesToHex } from '../identity/hex.js';
import type { SignedEnvelope } from './types.js';

// Nonce = 16 random bytes = 128 bits. Birthday bound: ~2^64 nonces before
// collision becomes likely — orders of magnitude beyond the 120s replay
// window in which uniqueness actually matters. crypto.getRandomValues is
// the browser's CSPRNG; on Node 19+ globalThis.crypto exposes it too.
const NONCE_BYTES = 16;

const generateNonce = (): string => {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
};

// Caller-provided action fields. We reserve `action`, `nonce`, `ts` and
// strip any caller-supplied versions so a buggy/malicious caller can't
// inject a stale timestamp or pre-known nonce.
export type ActionFields = Readonly<Record<string, unknown>>;

export const signRequest = (
  identity: Identity,
  action: string,
  fields: ActionFields,
): SignedEnvelope => {
  // Order: caller fields first, then our injected fields — so our values
  // overwrite any conflicts. Object spread handles the override naturally.
  const payloadObj = {
    ...fields,
    action,
    nonce: generateNonce(),
    ts: Date.now(),
  };
  const payload = JSON.stringify(payloadObj);
  const messageBytes = new TextEncoder().encode(payload);
  const signature = edSign(identity.privateKey, messageBytes);
  return {
    payload,
    publicKey: identity.publicKeyHex,
    signature: bytesToHex(signature),
  };
};
