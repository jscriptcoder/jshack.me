/**
 * signRequest — build a signed envelope for an authenticated POST.
 *
 * Injects `action`, a fresh `nonce`, and `ts` itself, overriding any
 * caller-supplied versions (spread order: caller fields first, then ours) so a
 * buggy/malicious caller can't backdoor a stale timestamp or known nonce. The
 * SIGNED BYTES are the literal JSON string produced here — the server verifies
 * those exact bytes and parses afterward.
 */

import { sign as edSign } from '../identity/identity.js';
import { bytesToHex, hexToBytes } from '../identity/hex.js';
import { NONCE_HEX_LENGTH, type SignedEnvelope } from './types.js';

const NONCE_BYTES = NONCE_HEX_LENGTH / 2;

const generateNonce = (): string => {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
};

/** Caller-provided action fields. `action`, `ts`, and `nonce` are reserved. */
export type ActionFields = Readonly<Record<string, unknown>>;

/** Whoever signs: the player's identity for most actions, a wallet's key for a
 *  transfer. Both halves hex-encoded. */
export type Signer = {
  readonly publicKeyHex: string;
  readonly privateKeyHex: string;
};

export const signRequest = (
  signer: Signer,
  action: string,
  fields: ActionFields,
): SignedEnvelope => {
  const payload = JSON.stringify({
    ...fields,
    action,
    nonce: generateNonce(),
    ts: Date.now(),
  });
  const messageBytes = new TextEncoder().encode(payload);
  // privateKeyHex is 64-char hex by construction (generateIdentity / validated
  // loadIdentity, or a wallet key its file's key line matched), so hexToBytes
  // never returns null here.
  const signature = edSign(hexToBytes(signer.privateKeyHex)!, messageBytes);
  return {
    payload,
    publicKey: signer.publicKeyHex,
    signature: bytesToHex(signature),
  };
};
