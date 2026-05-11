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
    // Previously optional with a server-side default of 'ssh' for
    // back-compat with early pushSession callers; now all callers must
    // specify kind explicitly. Auth-required kinds (ssh/scp/su) sent
    // here are rejected by the handler with 403
    // use_authcreatesession — they must use authCreateSession.
    kind: z.enum(SESSION_KINDS),
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

// Subset of SESSION_KINDS that authCreateSession accepts. Auth-required
// kinds — those whose session creation MUST be gated by a credential
// check against the server-projected credential file(s) on the target.
// Other kinds (exploit, effect_one_shot) keep using `createSession`
// because their tier comes from a different trust source (signed
// envelope tier).
//
// Per-kind credential file + auth shape:
//   ssh / scp / su → /etc/passwd (username + password OR savedKey).
//   ftp            → /etc/vsftpd/virtual_users.conf overlay, falls back
//                    to /etc/passwd; userType from /etc/passwd. password
//                    only (savedKey rejected).
//   mysql          → /var/lib/mysql/data.json (multi-user JSON);
//                    userType comes from the JSON entry. password only.
//   redis          → /etc/redis/redis.conf requirepass (shared secret;
//                    no username concept — wire payload uses sentinel
//                    `username:'redis'`); userType `'root'` on match.
//   snmp           → /etc/snmp/snmpd.conf rwcommunity (shared secret;
//                    sentinel `username:'snmp'`); userType `'root'` on
//                    match (snmpset path; rocommunity stays read-only/
//                    sessionless until /api/exploit-read).
export const AUTH_REQUIRED_KINDS = ['ssh', 'scp', 'su', 'ftp', 'mysql', 'redis', 'snmp'] as const;
export type AuthRequiredKind = (typeof AUTH_REQUIRED_KINDS)[number];

// Superset of AUTH_REQUIRED_KINDS. authCreateSession's wire schema
// accepts these kinds; AUTH_REQUIRED_KINDS is the subset for which
// createSession is rejected (forge-bypass closure).
//
//   nc → /var/run/nc-<port>.pid (line `nc:port=X,user=Y,userType=Z,
//        home=W`); method:'pidfile'. Server reads pidfile from
//        machine_filesystems and derives credentials. NOT in
//        AUTH_REQUIRED_KINDS yet — `createSession({kind:'nc'})` keeps
//        working for the msfconsole shell_limited path until that gap
//        is closed with effect-grant validation.
export const AUTH_CREATABLE_KINDS = [...AUTH_REQUIRED_KINDS, 'nc'] as const;
export type AuthCreatableKind = (typeof AUTH_CREATABLE_KINDS)[number];

// Auth method — discriminated union on `method`. Mutual exclusion of
// password vs savedKey vs pidfile is enforced structurally; each
// method's .strict() arm rejects the other arms' fields.
//
// savedKey carries `targetIp` because the client-side fingerprint
// derivation in src/hooks/useAuthentication.ts is
// md5(`${username}:${targetIP}:${hash}`) — the IP the user typed
// (pre-NAT). The server must mirror that exact derivation, so the
// targetIp the client used is part of the proof shape, not derivable
// from machine_id alone (NAT can map an external IP to a different
// machine_id).
//
// pidfile carries `port` so the server can build the path
// `/var/run/nc-<port>.pid` and read the pidfile content from
// machine_filesystems. No username/password is sent — the pidfile
// content is the credential, and the server parses
// `nc:port=X,user=Y,userType=Z,home=W` to derive the row.
export const authMethodSchema = z.discriminatedUnion('method', [
  z
    .object({
      method: z.literal('password'),
      password: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      method: z.literal('savedKey'),
      fingerprint: z.string().min(1).max(128),
      targetIp: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      method: z.literal('pidfile'),
      port: z.number().int().min(1).max(65535),
    })
    .strict(),
]);

export type AuthMethod = z.infer<typeof authMethodSchema>;

// Schema for authCreateSession — atomic credential-validation +
// session-creation for ssh/scp/su. The server reads the target
// machine's /etc/passwd from machine_filesystems, validates the auth
// method against it, derives userType from the parsed entry, and
// inserts the session row. The wire payload deliberately does NOT
// carry a userType — server-derived only, never trusted from clients.
export const authCreateSessionSignedPayloadSchema = z
  .object({
    action: z.literal('authCreateSession'),
    ts: z.number().int(),
    nonce: z.string().regex(/^[0-9a-f]{32}$/i),
    machine_id: z.string().min(1).max(256),
    kind: z.enum(AUTH_CREATABLE_KINDS),
    username: z.string().min(1).max(64),
    auth: authMethodSchema,
    parent_session_id: z.string().uuid().optional(),
    source_ip: z.string().min(1).max(256).optional(),
  })
  .strict();

export type AuthCreateSessionPayload = z.infer<typeof authCreateSessionSignedPayloadSchema>;

// Combined schema for /api/sessions — discriminated by `action`. Adding a
// new action: extend this union and add a dispatch arm in handler.ts.
export const sessionsSignedPayloadSchema = z.discriminatedUnion('action', [
  createSessionSignedPayloadSchema,
  endSessionSignedPayloadSchema,
  listSessionsSignedPayloadSchema,
  authCreateSessionSignedPayloadSchema,
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
