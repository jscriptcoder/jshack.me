import type { ZodSchema } from 'zod';
import { verify as edVerify } from '../identity/identity.js';
import { hexToBytes } from '../identity/hex.js';
import { signedEnvelopeSchema, signedPayloadBaseSchema, REPLAY_WINDOW_MS } from './types.js';
import type { NonceStore } from './nonceStore.js';

export type VerifyFailureReason =
  | 'envelope_invalid' // structural — bad hex lengths, missing fields, wrong types
  | 'signature_invalid' // ed verify returned false (or the bytes don't decode)
  | 'payload_malformed' // signed bytes weren't valid JSON
  | 'payload_invalid' // JSON parsed but rejected by base or caller schema
  | 'timestamp_skew' // ts outside REPLAY_WINDOW_MS in either direction
  | 'replay'; // nonce already seen within the window

export type VerifyResult<T> =
  | { readonly ok: true; readonly publicKey: string; readonly payload: T }
  | { readonly ok: false; readonly reason: VerifyFailureReason };

export type VerifyDeps = {
  readonly nonceStore: NonceStore;
  readonly now?: () => number;
};

// Order matters — we go from cheapest checks to most expensive (Upstash I/O):
//
//   1. Envelope shape         (regex + structural — sub-µs)
//   2. Signature verify       (~50µs CPU)
//   3. JSON.parse             (CPU)
//   4. Base + caller schema   (CPU)
//   5. Timestamp window       (CPU)
//   6. Nonce dedupe           (one Upstash round-trip — only if everything else passed)
//
// Skipping a CPU check to "save time" with the nonce store would be backwards:
// I/O dominates, and we don't want to burn nonce-store calls on garbage.
export const verifySignedRequest = async <T>(
  envelope: unknown,
  payloadSchema: ZodSchema<T>,
  deps: VerifyDeps,
): Promise<VerifyResult<T>> => {
  const now = deps.now ?? (() => Date.now());

  const envParsed = signedEnvelopeSchema.safeParse(envelope);
  if (!envParsed.success) return { ok: false, reason: 'envelope_invalid' };

  const sigBytes = hexToBytes(envParsed.data.signature);
  const pubBytes = hexToBytes(envParsed.data.publicKey);
  // Regex in the schema already guarantees valid hex of the right length, so
  // hexToBytes can't return null here — but the type narrowing keeps TS happy
  // and makes the invariant explicit.
  if (!sigBytes || !pubBytes) return { ok: false, reason: 'envelope_invalid' };

  const messageBytes = new TextEncoder().encode(envParsed.data.payload);
  let signatureValid = false;
  try {
    signatureValid = edVerify(pubBytes, sigBytes, messageBytes);
  } catch {
    // @noble/ed25519 throws on certain malformed inputs (e.g. point not on
    // curve). Treat any verify exception as a failed signature, not a 500.
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

  return {
    ok: true,
    publicKey: envParsed.data.publicKey,
    payload: callerParsed.data,
  };
};
