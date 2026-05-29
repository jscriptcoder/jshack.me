/**
 * verifySignedRequest — validate a signed envelope, cheapest checks first.
 *
 *   1. Envelope shape      (regex + zod — sub-µs)
 *   2. Signature verify    (~50µs CPU)
 *   3. JSON.parse          (CPU)
 *   4. Base + caller schema (CPU)
 *   5. Timestamp window    (CPU)
 *   6. Nonce dedupe        (one store round-trip — only if everything else passed)
 *
 * Ordering matters: we never burn a nonce-store call on garbage. Auth-class
 * failures and structural failures get distinct reasons so callers (and the
 * eventual HTTP layer) can map them to 401 vs 400.
 */

import { z } from 'zod';
import { verify as edVerify } from '../identity/identity';
import { hexToBytes } from '../identity/hex';
import { REPLAY_WINDOW_MS, signedEnvelopeSchema, signedPayloadBaseSchema } from './types';
import type { NonceStore } from './nonceStore';

export type VerifyFailureReason =
  | 'envelope_invalid'
  | 'signature_invalid'
  | 'payload_malformed'
  | 'payload_invalid'
  | 'timestamp_skew'
  | 'replay';

export type VerifyResult<T> =
  | { readonly ok: true; readonly publicKey: string; readonly payload: T }
  | { readonly ok: false; readonly reason: VerifyFailureReason };

export type VerifyDeps = {
  readonly nonceStore: NonceStore;
  readonly now?: () => number;
};

export const verifySignedRequest = async <T>(
  envelope: unknown,
  payloadSchema: z.ZodType<T>,
  deps: VerifyDeps,
): Promise<VerifyResult<T>> => {
  const now = deps.now ?? (() => Date.now());

  const envParsed = signedEnvelopeSchema.safeParse(envelope);
  if (!envParsed.success) return { ok: false, reason: 'envelope_invalid' };

  // The envelope regex guarantees hex of the right length, so neither decode
  // returns null here.
  const sigBytes = hexToBytes(envParsed.data.signature)!;
  const pubBytes = hexToBytes(envParsed.data.publicKey)!;
  const messageBytes = new TextEncoder().encode(envParsed.data.payload);

  let signatureValid: boolean;
  try {
    signatureValid = edVerify(pubBytes, sigBytes, messageBytes);
  } catch {
    // @noble throws on certain malformed points — treat as a failed signature,
    // not a 500.
    signatureValid = false;
  }
  if (!signatureValid) return { ok: false, reason: 'signature_invalid' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(envParsed.data.payload);
  } catch {
    return { ok: false, reason: 'payload_malformed' };
  }

  const baseParsed = signedPayloadBaseSchema.safeParse(parsed);
  if (!baseParsed.success) return { ok: false, reason: 'payload_invalid' };

  const callerParsed = payloadSchema.safeParse(parsed);
  if (!callerParsed.success) return { ok: false, reason: 'payload_invalid' };

  if (Math.abs(now() - baseParsed.data.ts) > REPLAY_WINDOW_MS) {
    return { ok: false, reason: 'timestamp_skew' };
  }

  const { fresh } = await deps.nonceStore(baseParsed.data.nonce);
  if (!fresh) return { ok: false, reason: 'replay' };

  return { ok: true, publicKey: envParsed.data.publicKey, payload: callerParsed.data };
};
