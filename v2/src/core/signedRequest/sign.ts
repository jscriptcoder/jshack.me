/**
 * signRequest — build a signed envelope for an authenticated POST.
 *
 * Injects `action`, a fresh `nonce`, and `ts` itself, overriding any
 * caller-supplied versions (spread order: caller fields first, then ours) so a
 * buggy/malicious caller can't backdoor a stale timestamp or known nonce. The
 * SIGNED BYTES are the literal JSON string produced here — the server verifies
 * those exact bytes and parses afterward.
 */

import { sign as edSign } from '../identity/identity';
import { bytesToHex, hexToBytes } from '../identity/hex';
import { NONCE_HEX_LENGTH, type SignedEnvelope } from './types';
import type { Identity } from '../commands/types';

const NONCE_BYTES = NONCE_HEX_LENGTH / 2;

const generateNonce = (): string => {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
};

/** Caller-provided action fields. `action`, `ts`, and `nonce` are reserved. */
export type ActionFields = Readonly<Record<string, unknown>>;

export const signRequest = (
  identity: Identity,
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
  // loadIdentity), so hexToBytes never returns null here.
  const signature = edSign(hexToBytes(identity.privateKeyHex)!, messageBytes);
  return {
    payload,
    publicKey: identity.publicKeyHex,
    signature: bytesToHex(signature),
  };
};
