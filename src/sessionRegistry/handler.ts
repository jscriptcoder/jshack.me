import {
  AUTH_REQUIRED_KINDS,
  sessionsSignedPayloadSchema,
  type AuthRequiredKind,
  type EndSessionParams,
  type EndSessionResult,
  type InsertSessionResult,
  type ListSessionsParams,
  type ListSessionsResult,
  type SessionsPayload,
  type SessionRow,
} from './types.js';
import type { RateLimiter } from '../ipRegistry/rateLimit.js';
import {
  verifySignedRequest,
  type VerifyFailureReason,
  type VerifyResult,
} from '../signedRequest/verify.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import type {
  FindEtcPasswdContentParams,
  FindEtcPasswdContentResult,
} from './supabaseFindEtcPasswdContent.js';
import type {
  FindVirtualUsersConfContentParams,
  FindVirtualUsersConfContentResult,
} from './supabaseFindVirtualUsersConfContent.js';
import type { FindFsContentParams, FindFsContentResult } from './supabaseFindFsContent.js';
import { deriveUserTypeFromEtcPasswd, getEtcPasswdHash } from '../filesystem/etcPasswdHelpers.js';
import { findVirtualUserHash } from '../filesystem/virtualUsersConfHelpers.js';
import { findMysqlCredential } from '../filesystem/mysqlDataHelpers.js';
import { findRedisRequirepass } from '../filesystem/redisConfHelpers.js';
import { findSnmpRwCommunity } from '../filesystem/snmpConfHelpers.js';
import { parseNcPid } from '../filesystem/ncPidHelpers.js';
import { md5 } from '../utils/md5.js';

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly headers?: Record<string, string>;
};

export type HandlerDeps = {
  readonly insertSession: (row: SessionRow) => Promise<InsertSessionResult>;
  readonly endSession: (params: EndSessionParams) => Promise<EndSessionResult>;
  readonly listSessions: (params: ListSessionsParams) => Promise<ListSessionsResult>;
  readonly findEtcPasswdContent: (
    params: FindEtcPasswdContentParams,
  ) => Promise<FindEtcPasswdContentResult>;
  // kind:'ftp' branch of authCreateSession reads
  // /etc/vsftpd/virtual_users.conf as an overlay on top of /etc/passwd.
  readonly findVirtualUsersConfContent: (
    params: FindVirtualUsersConfContentParams,
  ) => Promise<FindVirtualUsersConfContentResult>;
  // Generic (path-parameterized) FS content lookup, used by the
  // mysql / redis / snmp arms (each reads a different credential file).
  // The per-file adapters above stay for back-compat with their existing
  // test suites; a future unification can collapse them.
  readonly findFsContent: (params: FindFsContentParams) => Promise<FindFsContentResult>;
  readonly rateLimiter: RateLimiter;
  readonly nonceStore: NonceStore;
  readonly now?: () => number;
};

// HTTP status mapping for verifySignedRequest failures. Auth-class
// problems (signature, replay, ts skew) get 401; structural problems
// get 400. Mirrors api/allocate-ip's mapping — kept local for now;
// candidate for extraction in a later refactor pass.
const STATUS_BY_VERIFY_REASON: Record<VerifyFailureReason, number> = {
  envelope_invalid: 400,
  payload_malformed: 400,
  payload_invalid: 400,
  signature_invalid: 401,
  timestamp_skew: 401,
  replay: 401,
};

// Pure request handler for POST /api/sessions. Single endpoint with
// action-dispatch:
//
//   1. Verify the signed envelope against the discriminated-union schema
//      (createSession / endSession / future actions). The verify path is
//      shared — every action gets identical signature + replay + ts checks.
//   2. Rate-limit on the verified pubkey (per-pubkey, like allocate-ip).
//   3. Dispatch on `verified.payload.action` to the per-action branch.
//
// player_key on every write is server-stamped from the verified pubkey.
// Strict schemas reject any client-supplied `player_key` field.
export const handleSessionsRequest = async (
  envelope: unknown,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(envelope, sessionsSignedPayloadSchema, {
    nonceStore: deps.nonceStore,
    now: deps.now,
  });
  if (!verified.ok) {
    return {
      status: STATUS_BY_VERIFY_REASON[verified.reason],
      body: { error: verified.reason },
    };
  }

  const limit = await deps.rateLimiter(verified.publicKey);
  if (!limit.allowed) {
    return {
      status: 429,
      body: { error: 'rate_limited' },
      headers: { 'Retry-After': String(limit.retryAfterSeconds) },
    };
  }

  // verified is narrowed to VerifyResult<SessionsPayload> (success); the
  // dispatch helpers narrow further by `action`.
  return dispatchAction(verified, deps);
};

const dispatchAction = async (
  verified: Extract<VerifyResult<SessionsPayload>, { ok: true }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const { payload, publicKey } = verified;
  switch (payload.action) {
    case 'createSession':
      return handleCreateSession(publicKey, payload, deps);
    case 'endSession':
      return handleEndSession(publicKey, payload, deps);
    case 'listSessions':
      return handleListSessions(publicKey, deps);
    case 'authCreateSession':
      return handleAuthCreateSession(publicKey, payload, deps);
  }
};

const isAuthRequiredKind = (kind: string): kind is AuthRequiredKind =>
  (AUTH_REQUIRED_KINDS as readonly string[]).includes(kind);

const handleCreateSession = async (
  publicKey: string,
  payload: Extract<SessionsPayload, { action: 'createSession' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const { machine_id, credentials, parent_session_id, source_ip, kind } = payload;

  // Auth-required kinds (ssh/scp/su) cannot mint sessions through
  // createSession — those must prove credentials via authCreateSession.
  // Closing this hole prevents a forge caller from
  // claiming userType:'root' for username='root' (matches /etc/passwd,
  // bypasses the userType-validation branch below) without ever
  // proving the password.
  if (isAuthRequiredKind(kind)) {
    return { status: 403, body: { error: 'use_authcreatesession' } };
  }

  // Server-side userType validation. Read the live /etc/passwd content
  // for the target machine; if it has an entry for the claimed username,
  // derive the canonical userType and reject on mismatch (a malicious
  // client claiming userType: 'root' for what is actually a guest login
  // is the threat PR #122 closed for /etc/passwd-backed users).
  //
  // No-op cases (permit the claim, envelope-trusted tier):
  //   - fsLookup.found === false: /etc/passwd not projected for this
  //     machine (mission machines today, blocked on mission_instances).
  //   - derived === undefined: /etc/passwd has no entry for the claimed
  //     username. The kinds that REACH this validation (effect_one_shot,
  //     exploit, nc) all use synthetic placeholders ('msf', shell-effect
  //     usernames, pidfile sentinels) by design — their tier comes from
  //     the CVE envelope, not from /etc/passwd. Auth-required kinds
  //     (ssh/scp/su/ftp/mysql/redis/snmp) are blocked at the gate above
  //     and validate through authCreateSession's per-kind credential
  //     adapter instead. So "no entry" is never a real threat here.
  //
  // Sabotage-via-garble (an attacker who CVE'd B's /etc/passwd into
  // mush) is still enforced — but via authCreateSession, which IS the
  // path real player logins take. Garble breaks login; it doesn't (and
  // shouldn't) break CVE effects, since CVEs bypass auth by definition.
  const fsLookup = await deps.findEtcPasswdContent({ machine_id });
  if (!fsLookup.ok) {
    return { status: 500, body: { error: 'fs_lookup_failed' } };
  }
  if (fsLookup.found) {
    const derived = deriveUserTypeFromEtcPasswd(fsLookup.content, credentials.username);
    if (derived !== undefined && derived !== credentials.userType) {
      return { status: 400, body: { error: 'usertype_mismatch' } };
    }
  }

  const row: SessionRow = {
    player_key: publicKey,
    machine_id,
    credentials,
    kind,
    ...(parent_session_id !== undefined && { parent_session_id }),
    ...(source_ip !== undefined && { source_ip }),
  };

  const result = await deps.insertSession(row);
  if (!result.ok) {
    return { status: 500, body: { error: 'insert_failed' } };
  }
  return { status: 200, body: { session_id: result.session_id } };
};

// Server-authoritative auth + session creation. Each auth-required kind
// validates against a different credential file:
//
//   ssh / scp / su  → /etc/passwd
//   ftp             → /etc/vsftpd/virtual_users.conf overlay + /etc/passwd
//                     fallback; userType from /etc/passwd
//   mysql           → /var/lib/mysql/data.json; userType from JSON
//   redis           → /etc/redis/redis.conf requirepass; shared secret,
//                     sentinel `username:'redis'`, userType `'root'`
//   snmp            → /etc/snmp/snmpd.conf rwcommunity; shared secret,
//                     sentinel `username:'snmp'`, userType `'root'`
//
// All credential failure modes — wrong password, missing user, missing
// file, sabotaged file, fingerprint mismatch — collapse to one
// `401 invalid_credentials` response. Distinguishing them on the wire
// would leak machine state and username existence to forge-envelope
// probers (hydra-style brute force, account enumeration).
const handleAuthCreateSession = async (
  publicKey: string,
  payload: Extract<SessionsPayload, { action: 'authCreateSession' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  // Shared-secret kinds short-circuit before /etc/passwd lookup
  // (their sentinel usernames don't appear in /etc/passwd, and userType
  // is fixed at protocol-handler level).
  if (payload.kind === 'mysql') return handleMysqlAuth(publicKey, payload, deps);
  if (payload.kind === 'redis') return handleRedisAuth(publicKey, payload, deps);
  if (payload.kind === 'snmp') return handleSnmpAuth(publicKey, payload, deps);
  // nc backdoor short-circuits too. Reads the listener's pidfile
  // and derives credentials from its content; never touches /etc/passwd
  // (the nc listener tier is independent of the system user table).
  if (payload.kind === 'nc') return handleNcAuth(publicKey, payload, deps);

  const { machine_id, kind, username, auth, parent_session_id, source_ip } = payload;

  const fsLookup = await deps.findEtcPasswdContent({ machine_id });
  if (!fsLookup.ok) {
    return { status: 500, body: { error: 'fs_lookup_failed' } };
  }

  // Missing /etc/passwd → cannot validate (userType underivable). Return
  // invalid_credentials so callers can't distinguish "machine has no FS"
  // from "wrong password" via the response.
  const content = fsLookup.found ? fsLookup.content : null;
  const userType = deriveUserTypeFromEtcPasswd(content, username);
  if (userType === undefined) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  // Hash for password matching. /etc/passwd may carry an empty hash for
  // users with no system password (e.g. the player's own user on a
  // freshly registered workstation — see generateLocalhost). Empty
  // means "no system credential" — for ssh/scp/su that's a hard reject;
  // for ftp the virtual_users.conf overlay can still authenticate.
  const etcPasswdHash = getEtcPasswdHash(content, username);
  let expectedHash: string | undefined = etcPasswdHash;

  if (kind === 'ftp') {
    // FTP does not support `.ssh_keys` saved-key auth — reject early.
    // Same response code as wrong-password (no info leak).
    if (auth.method !== 'password') {
      return { status: 401, body: { error: 'invalid_credentials' } };
    }
    const vuLookup = await deps.findVirtualUsersConfContent({ machine_id });
    if (!vuLookup.ok) {
      return { status: 500, body: { error: 'fs_lookup_failed' } };
    }
    const vuContent = vuLookup.found ? vuLookup.content : null;
    const vuHash = findVirtualUserHash(vuContent, username);
    if (vuHash !== undefined) {
      expectedHash = vuHash;
    }
    // If virtual_users.conf has no entry (or file is missing/empty),
    // fall through to /etc/passwd hash — mirrors authenticateFtpInline
    // precedence in src/hooks/useAuthentication.ts.
  }

  // No usable credential anywhere — reject. For ssh/scp/su this collapses
  // the empty-hash case (system user with no password); for ftp it
  // catches "user in /etc/passwd, absent from overlay, empty system
  // hash" — neither path can authenticate.
  if (expectedHash === undefined) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  // pidfile method has no shape on /etc/passwd-validated kinds —
  // dropped here. The nc-kind shortcut above is the only caller for
  // method:'pidfile', so other kinds reject it the same way as a
  // wrong password (no info leak about which methods are supported).
  if (auth.method === 'pidfile') {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const authValid =
    auth.method === 'password'
      ? md5(auth.password) === expectedHash
      : auth.fingerprint === md5(`${username}:${auth.targetIp}:${expectedHash}`);

  if (!authValid) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const row: SessionRow = {
    player_key: publicKey,
    machine_id,
    // userType comes from /etc/passwd (server-derived), NOT from any
    // client claim — clients can't promote themselves to root by lying.
    credentials: { username, userType },
    kind,
    ...(parent_session_id !== undefined && { parent_session_id }),
    ...(source_ip !== undefined && { source_ip }),
  };

  const result = await deps.insertSession(row);
  if (!result.ok) {
    return { status: 500, body: { error: 'insert_failed' } };
  }
  return {
    status: 201,
    body: { session_id: result.session_id, userType },
  };
};

// ---- MySQL / Redis / SNMP ---------------------------------------------
//
// Each protocol reads its own credential file; userType comes from
// the credential file (mysql) or is fixed at the protocol level
// (redis, snmp — shared-secret model). All collapse failure modes to
// 401 invalid_credentials per the no-info-leak rule.

const MYSQL_DATA_PATH = '/var/lib/mysql/data.json';
const REDIS_CONF_PATH = '/etc/redis/redis.conf';
const SNMP_CONF_PATH = '/etc/snmp/snmpd.conf';

const handleMysqlAuth = async (
  publicKey: string,
  payload: Extract<SessionsPayload, { action: 'authCreateSession' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const { machine_id, username, auth, parent_session_id, source_ip } = payload;

  // MySQL is password-only — savedKey rejected (no .ssh_keys for mysql).
  if (auth.method !== 'password') {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const fsLookup = await deps.findFsContent({ machine_id, path: MYSQL_DATA_PATH });
  if (!fsLookup.ok) {
    return { status: 500, body: { error: 'fs_lookup_failed' } };
  }
  const content = fsLookup.found ? fsLookup.content : null;
  const cred = findMysqlCredential(content, username);
  if (cred === undefined) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }
  if (md5(auth.password) !== cred.passwordHash) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const row: SessionRow = {
    player_key: publicKey,
    machine_id,
    credentials: { username, userType: cred.userType },
    kind: 'mysql',
    ...(parent_session_id !== undefined && { parent_session_id }),
    ...(source_ip !== undefined && { source_ip }),
  };

  const result = await deps.insertSession(row);
  if (!result.ok) {
    return { status: 500, body: { error: 'insert_failed' } };
  }
  return {
    status: 201,
    body: { session_id: result.session_id, userType: cred.userType },
  };
};

const handleRedisAuth = async (
  publicKey: string,
  payload: Extract<SessionsPayload, { action: 'authCreateSession' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const { machine_id, auth, parent_session_id, source_ip } = payload;

  if (auth.method !== 'password') {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const fsLookup = await deps.findFsContent({ machine_id, path: REDIS_CONF_PATH });
  if (!fsLookup.ok) {
    return { status: 500, body: { error: 'fs_lookup_failed' } };
  }
  const content = fsLookup.found ? fsLookup.content : null;
  const requirepass = findRedisRequirepass(content);
  // No requirepass directive (auth disabled at the daemon level) →
  // mirror real Redis: anyone with network access gets in at full
  // privilege. Skip the password compare and fall through to session
  // insert. Without this, SET/DEL writes against no-requirepass redis
  // targets hit L1's no_session gate (the client has no sessionId
  // because it never authenticated). The client is expected to send
  // a sentinel password (any non-empty string satisfies the schema)
  // when the local conf shows no requirepass.
  if (requirepass !== undefined && auth.password !== requirepass) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const row: SessionRow = {
    player_key: publicKey,
    machine_id,
    // Sentinel username — Redis has no username concept. userType 'root'
    // mirrors the AUTH'd-in semantics: full keyspace access.
    credentials: { username: 'redis', userType: 'root' },
    kind: 'redis',
    ...(parent_session_id !== undefined && { parent_session_id }),
    ...(source_ip !== undefined && { source_ip }),
  };

  const result = await deps.insertSession(row);
  if (!result.ok) {
    return { status: 500, body: { error: 'insert_failed' } };
  }
  return {
    status: 201,
    body: { session_id: result.session_id, userType: 'root' as const },
  };
};

const handleSnmpAuth = async (
  publicKey: string,
  payload: Extract<SessionsPayload, { action: 'authCreateSession' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const { machine_id, auth, parent_session_id, source_ip } = payload;

  if (auth.method !== 'password') {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const fsLookup = await deps.findFsContent({ machine_id, path: SNMP_CONF_PATH });
  if (!fsLookup.ok) {
    return { status: 500, body: { error: 'fs_lookup_failed' } };
  }
  const content = fsLookup.found ? fsLookup.content : null;
  const rwCommunity = findSnmpRwCommunity(content);
  if (rwCommunity === undefined) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }
  if (auth.password !== rwCommunity) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const row: SessionRow = {
    player_key: publicKey,
    machine_id,
    // Sentinel username — SNMP communities have no username. userType
    // 'root' reflects rwcommunity's read-write privilege; rocommunity
    // doesn't go through this path (snmpwalk is sessionless).
    credentials: { username: 'snmp', userType: 'root' },
    kind: 'snmp',
    ...(parent_session_id !== undefined && { parent_session_id }),
    ...(source_ip !== undefined && { source_ip }),
  };

  const result = await deps.insertSession(row);
  if (!result.ok) {
    return { status: 500, body: { error: 'insert_failed' } };
  }
  return {
    status: 201,
    body: { session_id: result.session_id, userType: 'root' as const },
  };
};

// ---- nc backdoor pidfile ----------------------------------------------
//
// Reads /var/run/nc-<port>.pid from machine_filesystems and derives
// session credentials from the content line written by `nc -l`
// (src/commands/nc.ts → createNcPidContent). userType is server-derived
// from the pidfile, never trusted from the envelope. The auth method
// MUST be 'pidfile' — password / savedKey are rejected up front so
// callers can't fall back to /etc/passwd if a pidfile is missing.

const ncPidfilePath = (port: number): string => `/var/run/nc-${port}.pid`;

const handleNcAuth = async (
  publicKey: string,
  payload: Extract<SessionsPayload, { action: 'authCreateSession' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const { machine_id, auth, parent_session_id, source_ip } = payload;

  if (auth.method !== 'pidfile') {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const fsLookup = await deps.findFsContent({
    machine_id,
    path: ncPidfilePath(auth.port),
  });
  if (!fsLookup.ok) {
    return { status: 500, body: { error: 'fs_lookup_failed' } };
  }
  const content = fsLookup.found ? fsLookup.content : null;
  const parsed = parseNcPid(content);
  if (parsed === undefined) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const row: SessionRow = {
    player_key: publicKey,
    machine_id,
    // Credentials come from the parsed pidfile, never from the envelope.
    // The envelope's `username` field is a sentinel for nc — clients
    // typically send 'nc' but it is ignored here.
    credentials: { username: parsed.username, userType: parsed.userType },
    kind: 'nc',
    ...(parent_session_id !== undefined && { parent_session_id }),
    ...(source_ip !== undefined && { source_ip }),
  };

  const result = await deps.insertSession(row);
  if (!result.ok) {
    return { status: 500, body: { error: 'insert_failed' } };
  }
  return {
    status: 201,
    body: {
      session_id: result.session_id,
      username: parsed.username,
      userType: parsed.userType,
      homePath: parsed.homePath,
    },
  };
};

const handleEndSession = async (
  publicKey: string,
  payload: Extract<SessionsPayload, { action: 'endSession' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const result = await deps.endSession({
    session_id: payload.session_id,
    player_key: publicKey,
    reason: payload.reason,
  });
  if (!result.ok) {
    return { status: 500, body: { error: 'update_failed' } };
  }
  if (result.affected === 0) {
    // Collapses three cases into one 404 (intentional, see plan):
    //   - session_id doesn't exist
    //   - session belongs to another player_key
    //   - session is already ended
    // Atomic SQL UPDATE filter handles all three; no info leak.
    return { status: 404, body: { error: 'session_not_found' } };
  }
  return { status: 200, body: {} };
};

const handleListSessions = async (
  publicKey: string,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const result = await deps.listSessions({ player_key: publicKey });
  if (!result.ok) {
    return { status: 500, body: { error: 'query_failed' } };
  }
  return { status: 200, body: { sessions: result.sessions } };
};
