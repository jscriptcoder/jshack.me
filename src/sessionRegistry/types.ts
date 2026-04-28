import { z } from 'zod';

// Permitted user roles inside the game world. Mirrors the existing
// session-storage type — keeps the credentials shape compact.
export const USER_TYPES = ['root', 'user', 'guest'] as const;
export type UserType = (typeof USER_TYPES)[number];

// Session kinds — distinguishes how a session was opened. Two
// categories with different rehydration semantics:
//
//   Shell-class:    'ssh' | 'su' | 'exploit'
//     Go on the SessionContext snapshot stack. Reconstructed on mount
//     by the rehydration useEffect (filtered to these kinds before
//     the linear-chain reconstruction).
//
//   Protocol/transient:
//     'ftp' | 'mysql' | 'redis' | 'nc' | 'scp' | 'snmp' | 'effect_one_shot'
//     Live in their own client-side state field (FtpSession,
//     MysqlSession, NcSession, ...) or fire transient via
//     withTransientSession. Excluded from rehydration's chain
//     reconstruction. The L1 patch-validation gate doesn't care which
//     kind — only that an active row exists for (player_key, machine_id).
export const SESSION_KINDS = [
  'ssh',
  'su',
  'exploit',
  'ftp',
  'mysql',
  'redis',
  'nc',
  'scp',
  'snmp',
  'effect_one_shot',
] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

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
    // Optional — defaulted to 'ssh' server-side when absent. This keeps
    // existing pushSession callers (SSH/su/exploit) working unchanged
    // while letting protocol sessions specify their kind explicitly.
    kind: z.enum(SESSION_KINDS).optional(),
  })
  .strict();

export type CreateSessionPayload = z.infer<typeof createSessionSignedPayloadSchema>;

// Schema for endSession — marks an existing session ended_at + end_reason.
// Server identifies the caller via the verified pubkey (must match the
// row's player_key for the UPDATE to affect anything). The atomic UPDATE
// in the adapter filters by player_key + ended_at IS NULL so non-owner
// or already-ended attempts produce affected: 0 → 404.
export const endSessionSignedPayloadSchema = z
  .object({
    action: z.literal('endSession'),
    ts: z.number().int(),
    nonce: z.string().regex(/^[0-9a-f]{32}$/i),
    session_id: z.string().uuid(),
    reason: z.string().min(1).max(64),
  })
  .strict();

export type EndSessionPayload = z.infer<typeof endSessionSignedPayloadSchema>;

// Schema for listSessions — returns the caller's active sessions. No
// filter parameters yet; future versions could add per-machine or
// include-ended filters without breaking existing clients.
export const listSessionsSignedPayloadSchema = z
  .object({
    action: z.literal('listSessions'),
    ts: z.number().int(),
    nonce: z.string().regex(/^[0-9a-f]{32}$/i),
  })
  .strict();

export type ListSessionsPayload = z.infer<typeof listSessionsSignedPayloadSchema>;

// Combined schema for /api/sessions — discriminated by `action`. Adding a
// new action: extend this union and add a dispatch arm in handler.ts.
export const sessionsSignedPayloadSchema = z.discriminatedUnion('action', [
  createSessionSignedPayloadSchema,
  endSessionSignedPayloadSchema,
  listSessionsSignedPayloadSchema,
]);

export type SessionsPayload = z.infer<typeof sessionsSignedPayloadSchema>;

// Internal allocator input — used between the handler and the
// supabaseInsert adapter after the signed envelope has been verified
// and player_key has been stamped from the verified pubkey.
export type SessionRow = {
  readonly player_key: string;
  readonly machine_id: string;
  readonly credentials: Credentials;
  readonly parent_session_id?: string;
  readonly source_ip?: string;
  // Required at the row level so every insert specifies which session
  // category. Handler defaults the wire-payload's optional kind to
  // 'ssh' before constructing the row.
  readonly kind: SessionKind;
};

// Result of attempting one INSERT. session_id comes back from the DB
// via Postgres RETURNING — we don't construct the UUID client-side.
export type InsertSessionResult =
  | { readonly ok: true; readonly session_id: string }
  | { readonly ok: false };

// Parameters for the atomic UPDATE that ends a session. player_key is
// part of the WHERE filter (not just the SET) so a player can only end
// their own sessions — non-owner attempts produce affected: 0.
export type EndSessionParams = {
  readonly session_id: string;
  readonly player_key: string;
  readonly reason: string;
};

// Result of the end-session UPDATE. affected = number of rows updated:
//   - 0 → session doesn't exist, isn't owned by this player, or already ended
//   - 1 → row was active and is now marked ended_at + end_reason
// We collapse all 0-cases to 404; we don't distinguish "not yours" from
// "not found" (avoids info leaks and keeps the SQL atomic).
export type EndSessionResult =
  | { readonly ok: true; readonly affected: number }
  | { readonly ok: false };

// Public shape of an active session row, returned by listSessions. Omits
// player_key (caller already knows their own key) and the ended_at /
// end_reason fields (only active rows are returned). created_at is the
// Postgres TIMESTAMPTZ serialized as ISO 8601.
export type SessionSummary = {
  readonly session_id: string;
  readonly machine_id: string;
  readonly credentials: Credentials;
  readonly parent_session_id: string | null;
  readonly source_ip: string | null;
  readonly created_at: string;
  // Returned by listSessions so consumers (notably SessionContext's
  // rehydration) can filter by category. Always non-null at the DB
  // level (NOT NULL DEFAULT 'ssh').
  readonly kind: SessionKind;
};

export type ListSessionsParams = {
  readonly player_key: string;
};

export type ListSessionsResult =
  | { readonly ok: true; readonly sessions: ReadonlyArray<SessionSummary> }
  | { readonly ok: false };
