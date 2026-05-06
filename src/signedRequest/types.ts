import { z } from 'zod';

// Authenticated-request envelope, end-to-end design captured in
// docs/technology-choices.md. Three pieces:
//
//   - payload:   the JSON.stringify'd action object (signed bytes)
//   - publicKey: 32-byte Ed25519 public key, hex-encoded — identifies the actor
//   - signature: 64-byte Ed25519 signature over UTF-8 bytes of payload, hex-encoded
//
// We sign the literal payload string (not a re-canonicalized object) so the
// server never has to reproduce the client's JSON serialization. Eliminates a
// whole class of "different libraries serialize objects differently" bugs.

export type SignedEnvelope = {
  readonly payload: string;
  readonly publicKey: string;
  readonly signature: string;
};

// Sliding window for replay protection. ts inside the payload must be within
// REPLAY_WINDOW_MS of server's now() in either direction (clock skew tolerance).
// Nonce TTL in the nonceStore is set to match this — once outside the window,
// the timestamp check rejects regardless of nonce uniqueness.
export const REPLAY_WINDOW_MS = 120_000;

// Hex lengths. publicKey = 32 bytes = 64 hex chars; signature = 64 bytes = 128.
// Nonce = 16 bytes = 32 hex chars (128 bits — collision-resistant for our scale).
export const NONCE_HEX_LENGTH = 32;

// Strict envelope shape — rejects unknown top-level fields. Validates only
// structural correctness of the wrapper; the inner payload is parsed + checked
// by the route's action-specific schema after signature verification.
export const signedEnvelopeSchema = z
  .object({
    payload: z.string().min(1).max(8192),
    publicKey: z.string().regex(/^[0-9a-f]{64}$/i),
    signature: z.string().regex(/^[0-9a-f]{128}$/i),
  })
  .strict();

// Internal-base — validates the ts/nonce/action fields that signRequest
// always injects. Uses passthrough so callers' action-specific schemas can
// validate the rest of the parsed object without us needing to merge schemas.
export const signedPayloadBaseSchema = z
  .object({
    action: z.string().min(1).max(64),
    ts: z.number().int(),
    nonce: z.string().regex(/^[0-9a-f]{32}$/i),
  })
  .passthrough();
