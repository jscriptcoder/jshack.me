/**
 * Signed-request envelope — the wire shape for every authenticated POST.
 *
 *   - payload:   the JSON.stringify'd action object (these exact bytes are signed)
 *   - publicKey: 32-byte Ed25519 pubkey, hex — identifies the actor
 *   - signature: 64-byte Ed25519 signature over the UTF-8 bytes of `payload`, hex
 *
 * We sign the LITERAL payload string, never a re-canonicalized object, so the
 * server verifies the bytes as transmitted and only parses afterward. Kills the
 * whole "different libraries serialize objects differently" bug class.
 */

import { z } from 'zod';

export type SignedEnvelope = {
  readonly payload: string;
  readonly publicKey: string;
  readonly signature: string;
};

// Replay window: the payload `ts` must be within this of the server's now() in
// EITHER direction (clock-skew tolerance + future-timestamp guard). The nonce
// store TTL matches — past the window the timestamp check rejects regardless.
export const REPLAY_WINDOW_MS = 120_000;

// Nonce = 16 random bytes = 32 hex chars (128 bits — collision-resistant here).
export const NONCE_HEX_LENGTH = 32;

// Strict wrapper shape — rejects unknown top-level fields. Only validates the
// envelope structure; the inner payload is parsed + checked after signature
// verification by the base schema below plus the caller's action schema.
export const signedEnvelopeSchema = z.strictObject({
  payload: z.string().min(1).max(8192),
  publicKey: z.string().regex(/^[0-9a-f]{64}$/i),
  signature: z.string().regex(/^[0-9a-f]{128}$/i),
});

// Base payload fields that signRequest always injects. Loose (passthrough) so a
// caller's action-specific schema validates the rest without schema merging.
export const signedPayloadBaseSchema = z.looseObject({
  action: z.string().min(1).max(64),
  ts: z.number().int(),
  nonce: z.string().regex(/^[0-9a-f]{32}$/i),
});
