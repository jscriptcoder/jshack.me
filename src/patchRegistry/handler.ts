import {
  patchesSignedPayloadSchema,
  type ClearPatchesParams,
  type ClearPatchesResult,
  type ListPatchesForMachinesParams,
  type ListPatchesForMachinesResult,
  type PatchRow,
  type PatchSummary,
  type PatchesPayload,
  type RemovePatchParams,
  type RemovePatchResult,
  type UpsertPatchResult,
} from './types.js';
import type { RateLimiter } from '../ipRegistry/rateLimit.js';
import {
  verifySignedRequest,
  type VerifyFailureReason,
  type VerifyResult,
} from '../signedRequest/verify.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import type {
  FindActiveSessionParams,
  FindActiveSessionResult,
} from '../sessionRegistry/supabaseFindActive.js';
import type { Credentials } from '../sessionRegistry/types.js';
import type { FindMachineFsParams, FindMachineFsResult } from './supabaseFindMachineFs.js';
import type {
  FindMachineFsBatchParams,
  FindMachineFsBatchResult,
} from './supabaseFindMachineFsBatch.js';
import type {
  FindActiveSessionsBatchParams,
  FindActiveSessionsBatchResult,
} from '../sessionRegistry/supabaseFindActiveBatch.js';
import type {
  FindWorkstationsByNameParams,
  FindWorkstationsByNameResult,
} from './supabaseFindWorkstationsByName.js';
import type {
  FindFsContentBatchParams,
  FindFsContentBatchResult,
} from './supabaseFindFsContentBatch.js';
import { canRead, canWrite } from '../filesystem/permissionWalker.js';
import { defaultPermissionsForNode } from '../filesystem/defaultPermissions.js';
import {
  computeWorkstationId,
  deriveHostnameSuffix,
  parseWorkstationId,
} from '../homeNetworks/homeNetworkHelpers.js';
import { filterReadablePatches } from './readFilter.js';
import { shouldProjectFsContent } from '../machineFilesystems/projectedContentPaths.js';
import { generateLocalhost } from '../generation/generateLocalhost.js';
import { overlayProjectedContent } from '../filesystem/baseFsOverlay.js';
import { filterFileNodeForRead } from '../filesystem/baseFsFilter.js';
import { applyPatches } from '../filesystem/fileSystemUtils.js';
import type { FileNode, FilePermissions, FileSystemPatch } from '../filesystem/types.js';
import { parseVirtualUsersConf } from '../generation/ftpCredentials.js';

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly headers?: Record<string, string>;
};

export type HandlerDeps = {
  readonly upsertPatch: (row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>;
  readonly removePatch: (params: RemovePatchParams) => Promise<RemovePatchResult>;
  readonly listPatchesForMachines: (
    params: ListPatchesForMachinesParams,
  ) => Promise<ListPatchesForMachinesResult>;
  readonly clearOwnedPatches: (params: ClearPatchesParams) => Promise<ClearPatchesResult>;
  // L1 of the patch-validation layer cake: confirms the verified player
  // has an active session on the target machine before we record the
  // mutation. Read of the existing `sessions` table — see
  // sessionRegistry/supabaseFindActive.ts for the adapter and
  // project_multiplayer_security_model memory for the broader design.
  // The returned credentials (when exists: true) feed L2's walker.
  readonly findActiveSession: (params: FindActiveSessionParams) => Promise<FindActiveSessionResult>;
  // L2 of the patch-validation layer cake: confirms the active session's
  // credentials have permission for the requested mutation on the
  // target file. Read of `machine_filesystems` — see
  // supabaseFindMachineFs.ts for the adapter. Today's wiring is
  // leaf-only (target check, no parent chain) and permissive when no row
  // exists; full enforcement requires base-FS backfill of
  // machine_filesystems (see Step 7+ of the L2 plan).
  readonly findMachineFs: (params: FindMachineFsParams) => Promise<FindMachineFsResult>;
  // Bulk variants used exclusively by handleListPatchesForMachines for
  // the three-tier read filter. Single SQL round-trip each (vs N
  // per-machine calls).
  readonly findMachineFsBatch: (
    params: FindMachineFsBatchParams,
  ) => Promise<FindMachineFsBatchResult>;
  readonly findActiveSessionsBatch: (
    params: FindActiveSessionsBatchParams,
  ) => Promise<FindActiveSessionsBatchResult>;
  // PR 6 of plans/cross-player-base-fs-replication.md — adapters for
  // getBaseFs. findWorkstationsByName resolves the workstation row that
  // owns a workstation_id (handler does suffix verification in TS).
  // findFsContentBatch fetches projected-path content for the overlay
  // step (real /etc/passwd hash, vsftpd, mysql, redis, snmp, nc-pidfiles).
  readonly findWorkstationsByName: (
    params: FindWorkstationsByNameParams,
  ) => Promise<FindWorkstationsByNameResult>;
  readonly findFsContentBatch: (
    params: FindFsContentBatchParams,
  ) => Promise<FindFsContentBatchResult>;
  // Realtime hint broadcast: fired after each successful upsertPatch /
  // removePatch so subscribed clients on shared machines refetch live.
  // The payload is just (machine_id, originator_key) — receivers do
  // the actual data fetch via listPatchesForMachines. Forging the hint
  // cannot corrupt UI state because there's no content to inject. Fire-
  // and-forget — broadcast failures are swallowed inside
  // publishPatchChange and don't affect the HTTP response.
  // See patchRegistry/broadcast.ts and the
  // project_realtime_publish_authorization memory.
  readonly publishPatchChange: (machine_id: string, originator_key: string) => Promise<void>;
  readonly rateLimiter: RateLimiter;
  readonly nonceStore: NonceStore;
  readonly now?: () => number;
};

// HTTP status mapping for verifySignedRequest failures. Auth-class
// problems (signature, replay, ts skew) get 401; structural problems
// get 400. Mirrors api/sessions and api/allocate-ip — kept local for
// now; candidate for extraction in the Step 9 refactor pass.
const STATUS_BY_VERIFY_REASON: Record<VerifyFailureReason, number> = {
  envelope_invalid: 400,
  payload_malformed: 400,
  payload_invalid: 400,
  signature_invalid: 401,
  timestamp_skew: 401,
  replay: 401,
};

// Pure request handler for POST /api/patches. Single endpoint with
// action-dispatch:
//
//   1. Verify the signed envelope against the discriminated-union
//      schema (upsertPatch / removePatch / listPatchesForMachines /
//      clearOwnedPatches). The verify path is shared — every action
//      gets identical signature + replay + ts checks.
//   2. Rate-limit on the verified pubkey (per-pubkey, like sessions).
//   3. Dispatch on `verified.payload.action` to the per-action branch.
//
// player_key on every write is server-stamped from the verified
// pubkey. Strict schemas reject any client-supplied `player_key` field.
export const handlePatchesRequest = async (
  envelope: unknown,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(envelope, patchesSignedPayloadSchema, {
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

  return dispatchAction(verified, deps);
};

const dispatchAction = async (
  verified: Extract<VerifyResult<PatchesPayload>, { ok: true }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const { payload, publicKey } = verified;
  switch (payload.action) {
    case 'upsertPatch':
      return handleUpsertPatch(publicKey, payload, deps);
    case 'removePatch':
      return handleRemovePatch(publicKey, payload, deps);
    case 'listPatchesForMachines':
      return handleListPatchesForMachines(publicKey, payload, deps);
    case 'clearOwnedPatches':
      return handleClearOwnedPatches(publicKey, payload, deps);
    case 'getBaseFs':
      return handleGetBaseFs(publicKey, payload, deps);
    case 'exploitRead':
      return handleExploitRead(publicKey, payload, deps);
    case 'crackCredentials':
      return handleCrackCredentials(publicKey, payload, deps);
  }
};

// Detects whether a machine_id refers to the verified player's OWN
// workstation. Under the eliminated-localhost model the workstation_id
// is `${workstationName}-${first-8-hex(sha256(player_key))}` (computed
// client-side by computePlayerHostname). The suffix is identity-derived,
// so we can verify ownership server-side without knowing the workstation
// name — any machine_id ending in the player's expected suffix can ONLY
// be that player's workstation (other players have different suffixes;
// mission/world IPs don't carry the suffix shape at all).
//
// Pre-elimination this check was a literal `=== 'localhost'` bypass.
// The new shape preserves the gameplay invariant ("a player owns their
// own workstation, no session needed for self-writes") while also being
// per-player unique in storage.
const isOwnWorkstationOnServer = (machineId: string, playerKey: string): boolean => {
  const expectedSuffix = deriveHostnameSuffix(`ed25519:${playerKey}`);
  return machineId.endsWith(`-${expectedSuffix}`);
};

// L1 + L2 patch-validation gate.
//
// L1: every mutating action on a remote machine MUST be backed by an
// active session row for this player on that machine. The player's own
// workstation is exempt — the player always "owns" their own box, no
// session needed.
//
// L2: the session's verified credentials MUST have permission for the
// requested mutation on the target path. Looks up the target node in
// machine_filesystems and runs the shared permission walker
// (filesystem/permissionWalker). Today's check is leaf-only (no parent
// chain) and permissive when the target has no row in
// machine_filesystems — full parent-chain enforcement requires base-FS
// backfill into machine_filesystems (Step 7+ of the L2 plan, currently
// scoped to backfill from existing patches only).
//
// Both gates short-circuit by returning a HandlerResponse; a successful
// gate returns null. Distinguished failure modes (so client/playtest
// can tell what went wrong without leaking implementation details):
//   - findActiveSession returns ok: false → 500 session_lookup_failed
//   - findActiveSession returns ok: true, exists: false → 403 no_session
//   - findMachineFs returns ok: false → 500 fs_lookup_failed
//   - walker denies → 403 permission_denied
//
// Reason field distinguishes L1 ('no_session') from L2
// ('permission_denied') — load-bearing for telemetry / playtest debugging.
const requireActiveSession = async (
  publicKey: string,
  machine_id: string,
  deps: HandlerDeps,
): Promise<HandlerResponse | null> => {
  if (isOwnWorkstationOnServer(machine_id, publicKey)) return null;
  const result = await deps.findActiveSession({ player_key: publicKey, machine_id });
  if (!result.ok) {
    return { status: 500, body: { error: 'session_lookup_failed' } };
  }
  if (!result.exists) {
    return { status: 403, body: { error: 'no_session' } };
  }
  return null;
};

// Fetches the active session's credentials for L2. Returns null when the
// caller is on their own workstation (own-box bypass — L2 not applicable)
// or when the lookup fails — caller must already have run requireActiveSession,
// so a missing session here is treated as a server error rather than 403.
const fetchSessionCredentials = async (
  publicKey: string,
  machine_id: string,
  deps: HandlerDeps,
): Promise<
  { readonly response: HandlerResponse } | { readonly credentials: Credentials | null }
> => {
  if (isOwnWorkstationOnServer(machine_id, publicKey)) return { credentials: null };
  const result = await deps.findActiveSession({ player_key: publicKey, machine_id });
  if (!result.ok) {
    return { response: { status: 500, body: { error: 'session_lookup_failed' } } };
  }
  if (!result.exists) {
    // Should be unreachable if requireActiveSession ran first. Fail closed.
    return { response: { status: 403, body: { error: 'no_session' } } };
  }
  return { credentials: result.credentials };
};

// L2 enforcement: walker decision on (target, mode, userType). Skipped
// when credentials is null (own-workstation bypass). Permissive fallback
// when machine_filesystems has no row for the path (documented gap).
const enforceL2 = async (
  credentials: Credentials | null,
  machine_id: string,
  path: string,
  deps: HandlerDeps,
): Promise<HandlerResponse | null> => {
  if (!credentials) return null;
  const fsResult = await deps.findMachineFs({ machine_id, path });
  if (!fsResult.ok) {
    return { status: 500, body: { error: 'fs_lookup_failed' } };
  }
  if (!fsResult.found) return null;
  const decision = canWrite({
    userType: credentials.userType,
    target: fsResult.node.permissions,
    parentChain: [],
  });
  if (!decision.allowed) {
    return { status: 403, body: { error: 'permission_denied' } };
  }
  return null;
};

// Postgres TEXT columns reject NUL bytes (U+0000) — error code 22P05
// "unsupported Unicode escape sequence". Mock binary file contents in
// the game (e.g., /usr/bin/nmap's '\x7fELF\0\0\0...' placeholder) carry
// them. Replace with U+FFFD (Unicode REPLACEMENT CHARACTER) before
// sending to the upsert adapter — lossy for binary fidelity but the
// game doesn't depend on byte-exact round-trip; apt-installed binaries
// stay executable from gameplay's perspective.
//
// Sanitization at the handler (vs the client wrapper) is defense-in-
// depth: any signed envelope, including hand-crafted Burp/curl ones,
// gets cleaned before the DB sees it. Attackers can't trigger 500s
// with deliberate NUL injection.
const sanitizeContent = (content: string | null): string | null =>
  content === null ? null : content.replaceAll('\u0000', '\uFFFD');

// Ambient log-path predicate: explicit allowlist of canonical log
// files that bypass L1.
//
// Recon (nmap, curl, hydra, gobuster, ssh-fail, etc.) leaves logs on
// the target machine without the actor having an active session there
// — the network records the probe as a side effect. L1 was designed
// for "I logged in, I'm mutating this machine" mutations; ambient log
// appends are a different write class.
//
// Allowlist (not a `/var/log/` prefix) so a forged envelope can't
// plant arbitrary files under /var/log/ on a machine the actor
// doesn't own. Every entry here is a real writer somewhere in the
// codebase — adding a new logger means adding a new entry. Predicate
// runs on the verified payload.path; client cannot spoof.
//
// Bypass applies ONLY to upsertPatch — covering tracks (removePatch
// on a log file) still needs a real session on the box.
//
// See project_multiplayer_cross_player_visibility memory for the
// broader "everyone sees everyone's changes" rule that makes log
// trail-leaving load-bearing for multiplayer gameplay.
const AMBIENT_LOG_FILES: ReadonlySet<string> = new Set([
  '/var/log/auth.log', // ssh, scp, su, hydra-ssh
  '/var/log/access.log', // curl, gobuster, http CVEs
  '/var/log/kern.log', // nmap
  '/var/log/vsftpd.log', // ftp, hydra-ftp, ftp CVEs
  '/var/log/mysql.log', // mysql, hydra-mysql, mysql CVEs
  '/var/log/redis.log', // redis, hydra-redis, redis CVEs
  '/var/log/mail.log', // mail CVEs
  '/var/log/syslog', // nc, hydra-telnet, generic CVE fallback
]);

const isAmbientLogPath = (path: string): boolean => AMBIENT_LOG_FILES.has(path);

const handleUpsertPatch = async (
  publicKey: string,
  payload: Extract<PatchesPayload, { action: 'upsertPatch' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  if (!isAmbientLogPath(payload.path)) {
    const gate = await requireActiveSession(publicKey, payload.machine_id, deps);
    if (gate) return gate;

    // L2: walker decision on the target path's stored permissions.
    // Ambient log writes bypass both L1 and L2 (no associated session).
    const credsResult = await fetchSessionCredentials(publicKey, payload.machine_id, deps);
    if ('response' in credsResult) return credsResult.response;
    const l2Gate = await enforceL2(credsResult.credentials, payload.machine_id, payload.path, deps);
    if (l2Gate) return l2Gate;
  }

  const { machine_id, path, content, owner, permissions, is_new, node_type } = payload;
  // Fill in default permissions when the client omitted them on a
  // create. Without this, the dual-write to machine_filesystems
  // skipped (NOT NULL guard on permissions in the SQL function),
  // which left the file invisible to L2: subsequent writes to that
  // path fell through to the leaf-only "no row → allow" path. A
  // malicious client could exploit this by deliberately omitting
  // permissions to land files outside L2's enforcement.
  //
  // Defaults match the client's applyPatches branch via the shared
  // defaultPermissions module — server and client agree on the
  // resulting FilePermissions for a given (owner, node_type).
  const effectiveNodeType = node_type ?? 'file';
  const effectivePermissions = permissions ?? defaultPermissionsForNode(owner, effectiveNodeType);
  const row: PatchRow = {
    player_key: publicKey,
    machine_id,
    path,
    content: sanitizeContent(content),
    owner,
    permissions: effectivePermissions,
    ...(is_new !== undefined && { is_new }),
    node_type: effectiveNodeType,
  };

  // Dual-write into machine_filesystems UNLESS this is the player's own
  // workstation (own-box patches are excluded from machine_filesystems
  // by design — see the L2 plan and the migration header).
  //
  // Exception: paths in FS_PROJECTED_CONTENT_PATHS must dual-write even
  // on own-workstation. Cross-player auth flows (PR 5 nc-pidfile, PRs
  // 2-4 SSH/FTP/etc.) read those paths server-side via findFsContent;
  // skipping projection for self-writes leaves the row absent → server
  // returns 401 invalid_credentials when another player tries to nc /
  // ssh / ftp into us. The set is small (auth-critical files only) so
  // the storage-overhead concern that motivated the original exclusion
  // doesn't apply.
  const isOwn = isOwnWorkstationOnServer(machine_id, publicKey);
  const dualWrite = !isOwn || shouldProjectFsContent(path);
  const result = await deps.upsertPatch(row, dualWrite);
  if (!result.ok) {
    return { status: 500, body: { error: 'upsert_failed' } };
  }
  // Realtime hint: notify subscribers that this machine has changes,
  // along with who originated the change. Receivers use originator_key
  // to skip self-induced refetches; everyone else refetches via
  // listPatchesForMachines for authoritative state.
  await deps.publishPatchChange(machine_id, publicKey);
  return { status: 200, body: {} };
};

const handleRemovePatch = async (
  publicKey: string,
  payload: Extract<PatchesPayload, { action: 'removePatch' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const gate = await requireActiveSession(publicKey, payload.machine_id, deps);
  if (gate) return gate;

  // L2: walker decision on the target path's stored permissions. Remove
  // is a write operation per the gameplay model — you need write on the
  // file (for content removal) or on the parent dir (for unlinking).
  // The leaf-only check focuses on the file's own write list; parent-dir
  // enforcement is deferred to a future step that requires base-FS
  // backfill of machine_filesystems.
  const credsResult = await fetchSessionCredentials(publicKey, payload.machine_id, deps);
  if ('response' in credsResult) return credsResult.response;
  const l2Gate = await enforceL2(credsResult.credentials, payload.machine_id, payload.path, deps);
  if (l2Gate) return l2Gate;

  // Same projected-path exception as upsertPatch — own-workstation
  // removes of /etc/passwd, /var/run/*.pid, etc. must dual-delete or
  // the cross-player projection lingers stale.
  const isOwn = isOwnWorkstationOnServer(payload.machine_id, publicKey);
  const result = await deps.removePatch({
    player_key: publicKey,
    machine_id: payload.machine_id,
    path: payload.path,
    dual_write: !isOwn || shouldProjectFsContent(payload.path),
  });
  if (!result.ok) {
    return { status: 500, body: { error: 'remove_failed' } };
  }
  // Realtime hint: notify subscribers that this machine changed.
  // Receivers refetch via listPatchesForMachines and the absence of
  // the row in the response is the deletion signal — no need to ship
  // a tombstone payload over Realtime.
  await deps.publishPatchChange(payload.machine_id, publicKey);
  // affected = 0 is success — idempotent removal of a path that already
  // had no patches (and no descendants).
  return { status: 200, body: { affected: result.affected } };
};

// Cross-player read path with per-row privacy filtering.
//
// The SQL select returns all patches for the requested machine_ids
// (knowing the machine_id is the discovery gate). The three-tier
// filter then drops rows the requester wouldn't be allowed to read
// in-game:
//
//   Tier 1 — Owner of own workstation → keep all.
//   Tier 2 — Has session on the machine → walker.canRead with full
//            ancestor chain. Drop if denied. Leaf-only fallback when
//            machine_filesystems has no row for the path (parity with
//            L2 writes).
//   Tier 3 — No session → matchesReadAllowlist + default-deny.
//
// Two extra round-trips (findMachineFsBatch + findActiveSessionsBatch)
// run in parallel after the SQL select. Either failing maps to 500 with
// a distinct error code so the caller can tell what broke.
//
// player_key is forwarded to the SQL adapter for telemetry/audit but no
// longer narrows the SELECT — every machine_id is per-player unique by
// construction (workstation = suffixed hostname; mission instance = IP
// registry; LAN occupant = hostname column). See
// ListPatchesForMachinesParams for the rationale.
//
// Threat model: without this filter, anyone who can sign a request and
// name a discoverable machine_id can pull /root/*, wallet keys, and
// /etc/passwd hashes (passwords live inline in /etc/passwd in this
// game) — breaking the wallet-defense gameplay premise that requires
// cracking root before stealing the wallet.
const handleListPatchesForMachines = async (
  publicKey: string,
  payload: Extract<PatchesPayload, { action: 'listPatchesForMachines' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const result = await deps.listPatchesForMachines({
    machine_ids: payload.machine_ids,
    player_key: publicKey,
  });
  if (!result.ok) {
    return { status: 500, body: { error: 'query_failed' } };
  }

  const [sessionsRes, fsRes] = await Promise.all([
    deps.findActiveSessionsBatch({
      player_key: publicKey,
      machine_ids: payload.machine_ids,
    }),
    deps.findMachineFsBatch({ machine_ids: payload.machine_ids }),
  ]);
  if (!sessionsRes.ok) {
    return { status: 500, body: { error: 'session_lookup_failed' } };
  }
  if (!fsRes.ok) {
    return { status: 500, body: { error: 'fs_lookup_failed' } };
  }

  const fsByMachine = new Map<string, Map<string, FilePermissions>>();
  for (const row of fsRes.rows) {
    const inner = fsByMachine.get(row.machine_id) ?? new Map<string, FilePermissions>();
    inner.set(row.path, row.permissions);
    fsByMachine.set(row.machine_id, inner);
  }

  const sessionLookup = (machine_id: string) =>
    sessionsRes.sessionsByMachine.get(machine_id) ?? null;
  const fsLookup = (machine_id: string, path: string) =>
    fsByMachine.get(machine_id)?.get(path) ?? null;

  const filtered = filterReadablePatches(result.patches, publicKey, sessionLookup, fsLookup);
  return { status: 200, body: { patches: filtered } };
};

// Cross-checks the supplied workstation_id against the verified
// player_key — under the eliminated-localhost model the workstation_id
// IS derived from the player_key (computePlayerHostname →
// `${workstationName}-${first-8-hex(player_key)}`), so a forged
// workstation_id from another player wouldn't have its suffix match.
// We don't reject hard on mismatch (could be a legitimate name change
// in the future, or a renamed workstation); we just rely on the
// natural no-op behavior — DELETE filters BOTH player_key AND
// workstation_id, so a wrong workstation_id deletes nothing.
const handleClearOwnedPatches = async (
  publicKey: string,
  payload: Extract<PatchesPayload, { action: 'clearOwnedPatches' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const result = await deps.clearOwnedPatches({
    player_key: publicKey,
    workstation_id: payload.workstation_id,
  });
  if (!result.ok) {
    return { status: 500, body: { error: 'clear_failed' } };
  }
  return { status: 200, body: { affected: result.affected } };
};

// PR 6 of plans/cross-player-base-fs-replication.md — eager bulk-fetch
// of a workstation's base FileNode tree, regenerated server-side from
// the workstations row's stored seed and tier-filtered for the caller.
//
// Three tiers (mirrors the read-path filter for patches):
//   1. Owner       — workstation_id suffix matches caller's player_key:
//                    return full FS unfiltered.
//   2. Session     — caller has an active session row on this machine:
//                    walk every (path, owner, permissions) through
//                    permissionWalker at the session's userType; drop
//                    anything the user couldn't reach in-game.
//   3. No session  — return baseFs:null. Defense in depth: eager fetch
//                    is post-auth in the client; pre-auth callers get
//                    nothing.
//
// Workstation regen uses a placeholder rootPassword because the real
// rootPassword isn't persisted server-side (decision #2 in the plan).
// The overlay step then replaces /etc/passwd content (and any other
// projected-path content) with what's actually stored in
// machine_filesystems — so the FS A receives matches the FS the
// server's auth path validates against.
//
// Non-workstation machine_ids (IPv4, mission instance keys, etc.) get
// 400 unsupported_machine_type. NPC home/world networks and missions
// have separate paths (deferred per the plan's scope clarification).

// Sentinel rootPassword for regen. Whatever value lands at /etc/passwd
// from the regen is overwritten by the overlay; the sentinel just gives
// generateLocalhost something well-formed to hash. If the projection is
// missing /etc/passwd for some reason (data inconsistency), the leaked
// content is `md5('GET_BASE_FS_SENTINEL')` — useless for cracking the
// real root password.
const GET_BASE_FS_SENTINEL_ROOT_PASSWORD = 'GET_BASE_FS_SENTINEL';

const collectProjectedPathsFromTree = (root: FileNode): readonly string[] => {
  const paths: string[] = [];
  const walk = (node: FileNode, basePath: string): void => {
    if (node.type === 'file') {
      if (shouldProjectFsContent(basePath)) paths.push(basePath);
      return;
    }
    if (!node.children) return;
    for (const [name, child] of Object.entries(node.children)) {
      const childPath = basePath === '/' ? `/${name}` : `${basePath}/${name}`;
      walk(child, childPath);
    }
  };
  walk(root, '/');
  return paths;
};

const handleGetBaseFs = async (
  publicKey: string,
  payload: Extract<PatchesPayload, { action: 'getBaseFs' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const parsed = parseWorkstationId(payload.machine_id);
  if (!parsed) {
    return { status: 400, body: { error: 'unsupported_machine_type' } };
  }

  const wsResult = await deps.findWorkstationsByName({ workstation_name: parsed.name });
  if (!wsResult.ok) {
    return { status: 500, body: { error: 'workstation_lookup_failed' } };
  }
  // Multiple players could choose the same workstation_name; the
  // identity-derived suffix disambiguates. Find the row whose computed
  // workstation_id matches the requested machine_id.
  const matchingRow = wsResult.rows.find(
    (r) => computeWorkstationId(r.workstation_name, r.player_key) === payload.machine_id,
  );
  if (!matchingRow) {
    return { status: 404, body: { error: 'workstation_not_found' } };
  }

  // Regen the base FS via generateLocalhost. The /etc/passwd content
  // here has the placeholder hash; the overlay step replaces it with
  // what's actually stored in machine_filesystems' projection.
  const regen = generateLocalhost(
    {
      seed: matchingRow.seed,
      workstationName: matchingRow.workstation_name,
      username: matchingRow.username,
      rootPassword: GET_BASE_FS_SENTINEL_ROOT_PASSWORD,
    },
    payload.machine_id,
  );

  // Collect every regen-tree path that's a projected target, fetch them
  // in one round-trip, overlay onto the regen tree.
  const projectedPaths = collectProjectedPathsFromTree(regen.fileSystem);
  const fsResult = await deps.findFsContentBatch({
    machine_id: payload.machine_id,
    paths: projectedPaths,
  });
  if (!fsResult.ok) {
    return { status: 500, body: { error: 'fs_lookup_failed' } };
  }
  const overlaid = overlayProjectedContent(regen.fileSystem, fsResult.contentByPath);

  // Tier dispatch. Owner short-circuits — no session needed for the
  // player's own workstation, and no filtering applies (the player can
  // see their whole box).
  if (isOwnWorkstationOnServer(payload.machine_id, publicKey)) {
    return { status: 200, body: { baseFs: overlaid } };
  }

  const sessionResult = await deps.findActiveSession({
    player_key: publicKey,
    machine_id: payload.machine_id,
  });
  if (!sessionResult.ok) {
    return { status: 500, body: { error: 'session_lookup_failed' } };
  }
  if (!sessionResult.exists) {
    // Defense in depth: pre-auth callers get nothing. The eager-fetch
    // path on the client only fires post-session, so this branch only
    // exposes a forge attempt — return null instead of structurally
    // empty so the malformed-response path on the client is distinct.
    return { status: 200, body: { baseFs: null } };
  }
  const filtered = filterFileNodeForRead(overlaid, sessionResult.credentials.userType);
  return { status: 200, body: { baseFs: filtered } };
};

// Wire-shape (snake_case, all fields present per DB defaults) →
// FileSystemPatch (camelCase, optional fields omitted when at default)
// for applyPatches consumption. Mirrors the camelCase conversion
// listPatchesForMachines does client-side; lives here because the
// exploitRead handler is the only server-side caller of applyPatches.
const patchSummaryToFileSystemPatch = (row: PatchSummary): FileSystemPatch => ({
  machineId: row.machine_id,
  path: row.path,
  content: row.content,
  owner: row.owner,
  ...(row.permissions !== null && { permissions: row.permissions }),
  ...(row.is_new && { isNew: true as const }),
  ...(row.node_type !== 'file' && { nodeType: row.node_type }),
});

// Walk an overlaid base-FS tree from the root to `path`, returning the
// resolved node (or null if a segment is missing / a non-directory is
// traversed) and the parent permission chain in the shape permissionWalker
// expects (root-to-immediate-parent). Mirrors the chain construction
// readFilter does for patch rows, but built directly from the FileNode
// tree we already have in memory — no extra SQL round-trip needed.
const resolveNodeAndParentChain = (
  root: FileNode,
  path: string,
): {
  readonly node: FileNode | null;
  readonly parentChain: readonly FilePermissions[];
} => {
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return { node: root, parentChain: [] };

  const parentChain: FilePermissions[] = [];
  let current: FileNode = root;
  for (const segment of segments) {
    if (current.type !== 'directory' || !current.children) {
      return { node: null, parentChain };
    }
    parentChain.push(current.permissions);
    const child = current.children[segment];
    if (!child) {
      return { node: null, parentChain };
    }
    current = child;
  }
  return { node: current, parentChain };
};

// PR 7 of plans/cross-player-base-fs-replication.md — single-path
// read against a cross-player workstation's base FS at the caller's
// effective tier.
//
// Tier source: the active `effect_one_shot` session row's user_type
// (minted by `withTransientSession` on the client when the CVE fires).
// NEVER read from the wire envelope — the schema explicitly rejects a
// `tier` field. This makes the trust source identical to writeRemoteFile
// + upsertPatch, which already establishes that an attacker can mint
// any tier via createSession (the cross-player threat model documented
// in project_multiplayer_security_model already accepts that).
//
// Steps 1-4 mirror handleGetBaseFs (same regen + projection overlay
// pipeline). Step 5 diverges: navigate the overlaid tree to the
// requested path and apply file_read or dir_list semantics, mirroring
// useFileSystemReaders.readFileFromMachine / listDirectoryFromMachine
// for byte-identical behaviour with the local path on NPC machines.
const handleExploitRead = async (
  publicKey: string,
  payload: Extract<PatchesPayload, { action: 'exploitRead' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const parsed = parseWorkstationId(payload.machine_id);
  if (!parsed) {
    return { status: 400, body: { error: 'unsupported_machine_type' } };
  }

  const wsResult = await deps.findWorkstationsByName({ workstation_name: parsed.name });
  if (!wsResult.ok) {
    return { status: 500, body: { error: 'workstation_lookup_failed' } };
  }
  const matchingRow = wsResult.rows.find(
    (r) => computeWorkstationId(r.workstation_name, r.player_key) === payload.machine_id,
  );
  if (!matchingRow) {
    return { status: 404, body: { error: 'workstation_not_found' } };
  }

  const regen = generateLocalhost(
    {
      seed: matchingRow.seed,
      workstationName: matchingRow.workstation_name,
      username: matchingRow.username,
      rootPassword: GET_BASE_FS_SENTINEL_ROOT_PASSWORD,
    },
    payload.machine_id,
  );

  const projectedPaths = collectProjectedPathsFromTree(regen.fileSystem);
  const fsResult = await deps.findFsContentBatch({
    machine_id: payload.machine_id,
    paths: projectedPaths,
  });
  if (!fsResult.ok) {
    return { status: 500, body: { error: 'fs_lookup_failed' } };
  }
  const overlaid = overlayProjectedContent(regen.fileSystem, fsResult.contentByPath);

  // Tier dispatch — owner reads at root (full access, no session needed,
  // mirrors getBaseFs). Cross-player MUST have an active session; the
  // legitimate flow always does (withTransientSession mints one before
  // calling). 403 closes the forge case where someone signs an
  // exploitRead without first creating the session.
  let effectiveUserType: Credentials['userType'];
  if (isOwnWorkstationOnServer(payload.machine_id, publicKey)) {
    effectiveUserType = 'root';
  } else {
    const sessionResult = await deps.findActiveSession({
      player_key: publicKey,
      machine_id: payload.machine_id,
    });
    if (!sessionResult.ok) {
      return { status: 500, body: { error: 'session_lookup_failed' } };
    }
    if (!sessionResult.exists) {
      return { status: 403, body: { error: 'no_session' } };
    }
    effectiveUserType = sessionResult.credentials.userType;
  }

  // Layer the patches table on top of the regen+overlay tree. Without
  // this, files the target player created post-NEW-GAME (e.g.
  // `/root/secret.txt`) are invisible — they live in `patches`, not in
  // the regen tree. Mirrors how the CLIENT merges getBaseFs +
  // listPatchesForMachines via applyPatches in useFileSystemSync.
  //
  // All patches for the machine are layered regardless of author —
  // cross-player visibility means any player's writes on this machine
  // are part of the shared persistent state. Per-tier read filtering
  // happens at the walker step below; applyPatches is just the structural
  // merge.
  const patchesResult = await deps.listPatchesForMachines({
    machine_ids: [payload.machine_id],
    player_key: publicKey,
  });
  if (!patchesResult.ok) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const merged = applyPatches(
    { [payload.machine_id]: overlaid },
    patchesResult.patches.map(patchSummaryToFileSystemPatch),
  )[payload.machine_id]!;

  const resolved = resolveNodeAndParentChain(merged, payload.path);

  if (payload.kind === 'file_read') {
    if (!resolved.node || resolved.node.type !== 'file') {
      return { status: 200, body: { content: null } };
    }
    const decision = canRead({
      userType: effectiveUserType,
      target: resolved.node.permissions,
      parentChain: resolved.parentChain,
    });
    if (!decision.allowed) {
      return { status: 200, body: { content: null } };
    }
    return { status: 200, body: { content: resolved.node.content ?? '' } };
  }

  // dir_list — mirror listDirectoryFromMachine: canRead on the directory
  // gates the listing; entries are sorted child names (no recursion).
  if (!resolved.node || resolved.node.type !== 'directory') {
    return { status: 200, body: { entries: null } };
  }
  const decision = canRead({
    userType: effectiveUserType,
    target: resolved.node.permissions,
    parentChain: resolved.parentChain,
  });
  if (!decision.allowed) {
    return { status: 200, body: { entries: null } };
  }
  const entries = Object.keys(resolved.node.children ?? {}).sort();
  return { status: 200, body: { entries } };
};

// PR 8 of plans/cross-player-base-fs-replication.md — batched hydra
// credential cracking against a cross-player workstation.
//
// Caller sends md5(plaintext) hashes for a wordlist batch; server reads
// the projected credential file (for ssh: /etc/passwd; for ftp:
// /etc/vsftpd/virtual_users.conf overlay + /etc/passwd fallback), then
// returns the {username, matched_hash} pairs whose stored hash appears
// in the candidate set. Client reverse-looks-up the plaintext from its
// own wordlist.
//
// No session check — hydra is the PRE-auth tool. The threat model: a
// forge-envelope attacker can already brute-force any wordlist they
// invent, so server-side hash matching leaks no more than a real
// brute-force attempt would. The natural per-batch network RTT is the
// rate limit; per-batch SERVER_MAX_HYDRA_BATCH_SIZE caps work.
//
// Why we skip regen + applyPatches here (unlike exploitRead): credential
// paths are in FS_PROJECTED_CONTENT_PATHS, so every patch that mutates
// them dual-writes the new content to machine_filesystems.content
// (upsert_patch_with_fs honours project_fs_content). findFsContentBatch
// therefore returns the post-patch state directly — no need to layer the
// patches table on top. password_reset rolls land here naturally because
// the patch's content arrives via the same dual-write path. See
// `project_projected_paths_dual_write` memory.
const handleCrackCredentials = async (
  _publicKey: string,
  payload: Extract<PatchesPayload, { action: 'crackCredentials' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const parsed = parseWorkstationId(payload.machine_id);
  if (!parsed) {
    return { status: 400, body: { error: 'unsupported_machine_type' } };
  }

  const wsResult = await deps.findWorkstationsByName({ workstation_name: parsed.name });
  if (!wsResult.ok) {
    return { status: 500, body: { error: 'workstation_lookup_failed' } };
  }
  const matchingRow = wsResult.rows.find(
    (r) => computeWorkstationId(r.workstation_name, r.player_key) === payload.machine_id,
  );
  if (!matchingRow) {
    return { status: 404, body: { error: 'workstation_not_found' } };
  }

  const paths =
    payload.service === 'ftp' ? ['/etc/passwd', '/etc/vsftpd/virtual_users.conf'] : ['/etc/passwd'];
  const fsResult = await deps.findFsContentBatch({
    machine_id: payload.machine_id,
    paths,
  });
  if (!fsResult.ok) {
    return { status: 500, body: { error: 'fs_lookup_failed' } };
  }

  // Build the (username → hash) map from /etc/passwd, then overlay
  // virtual_users.conf for FTP. Mirrors authenticateFtpInline precedence
  // and the SSH/FTP handlers in sessionRegistry/handler.ts.
  const userHashes = new Map<string, string>();
  const passwdContent = fsResult.contentByPath.get('/etc/passwd') ?? '';
  passwdContent.split('\n').forEach((line) => {
    const [username, hash] = line.split(':');
    if (username && hash) {
      userHashes.set(username, hash);
    }
  });

  if (payload.service === 'ftp') {
    const vuContent = fsResult.contentByPath.get('/etc/vsftpd/virtual_users.conf') ?? '';
    if (vuContent.length > 0) {
      parseVirtualUsersConf(vuContent).forEach((v) => {
        userHashes.set(v.username, v.passwordHash);
      });
    }
  }

  // Optional user_filter — drop everyone except the named user.
  const effectiveUsers =
    payload.user_filter !== undefined
      ? new Map(
          userHashes.has(payload.user_filter)
            ? [[payload.user_filter, userHashes.get(payload.user_filter)!]]
            : [],
        )
      : userHashes;

  // Normalize both sides to lowercase before comparing. md5() in this
  // repo emits lowercase; the schema accepts mixed-case (case-insensitive
  // regex), so we defend against a polite client that uppercased the
  // hex digits.
  const candidateSet = new Set(payload.candidate_hashes.map((h) => h.toLowerCase()));
  const hits: { readonly username: string; readonly matched_hash: string }[] = [];
  for (const [username, hash] of effectiveUsers) {
    if (candidateSet.has(hash.toLowerCase())) {
      hits.push({ username, matched_hash: hash });
    }
  }

  // attempts = users × candidates, matching how real hydra reports
  // total work. Empty users (sabotaged /etc/passwd) → 0 attempts so
  // the client sees an honest "we tried nothing" rather than a falsely
  // confident "we tried N and found nothing."
  const attempts = effectiveUsers.size * payload.candidate_hashes.length;
  return { status: 200, body: { hits, attempts } };
};
