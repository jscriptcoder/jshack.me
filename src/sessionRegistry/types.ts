import { z } from 'zod';

// Permitted user roles inside the game world. Mirrors the existing
// session-storage type — keeps the credentials shape compact.
export const USER_TYPES = ['root', 'user', 'guest'] as const;
export type UserType = (typeof USER_TYPES)[number];

export const credentialsSchema = z
  .object({
    username: z.string().min(1).max(64),
    userType: z.enum(USER_TYPES),
  })
  .strict();

export type Credentials = z.infer<typeof credentialsSchema>;

// Schema for the signed payload that clients POST to /api/sessions for
// createSession. Includes the signedRequest base fields (action/ts/nonce)
// plus the createSession-specific fields. player_key is intentionally
// absent — the server stamps it from the verified pubkey. Strict: rejects
// unknown fields.
export const createSessionSignedPayloadSchema = z
  .object({
    action: z.literal('createSession'),
    ts: z.number().int(),
    nonce: z.string().regex(/^[0-9a-f]{32}$/i),
    machine_id: z.string().min(1).max(256),
    credentials: credentialsSchema,
    parent_session_id: z.string().uuid().optional(),
    source_ip: z.string().min(1).max(256).optional(),
  })
  .strict();

export type CreateSessionPayload = z.infer<typeof createSessionSignedPayloadSchema>;

// Internal allocator input — used between the handler and the
// supabaseInsert adapter after the signed envelope has been verified
// and player_key has been stamped from the verified pubkey.
export type SessionRow = {
  readonly player_key: string;
  readonly machine_id: string;
  readonly credentials: Credentials;
  readonly parent_session_id?: string;
  readonly source_ip?: string;
};

// Result of attempting one INSERT. session_id comes back from the DB
// via Postgres RETURNING — we don't construct the UUID client-side.
export type InsertSessionResult =
  | { readonly ok: true; readonly session_id: string }
  | { readonly ok: false };
