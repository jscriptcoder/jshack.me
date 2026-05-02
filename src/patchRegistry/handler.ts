import {
  patchesSignedPayloadSchema,
  type ClearPatchesParams,
  type ClearPatchesResult,
  type ListPatchesForMachinesParams,
  type ListPatchesForMachinesResult,
  type PatchRow,
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
import { canWrite } from '../filesystem/permissionWalker.js';
import { deriveHostnameSuffix } from '../homeNetworks/homeNetworkHelpers.js';

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

// Ambient log-path predicate: writes under /var/log/ bypass L1.
//
// Recon (nmap, curl, hydra, gobuster, ssh-fail, etc.) leaves logs on
// the target machine without the actor having an active session there
// — the network records the probe as a side effect. L1 was designed
// for "I logged in, I'm mutating this machine" mutations; ambient log
// appends are a different write class.
//
// Server-controlled and path-prefix based: client cannot opt out of
// L1 by spoofing a non-log path; the predicate runs on the verified
// payload.path. Bypass applies ONLY to upsertPatch — covering tracks
// (removePatch on a log file) still needs a real session on the box.
//
// See project_multiplayer_cross_player_visibility memory for the
// broader "everyone sees everyone's changes" rule that makes log
// trail-leaving load-bearing for multiplayer gameplay.
const isAmbientLogPath = (path: string): boolean => path.startsWith('/var/log/');

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
  const row: PatchRow = {
    player_key: publicKey,
    machine_id,
    path,
    content: sanitizeContent(content),
    owner,
    ...(permissions !== undefined && { permissions }),
    ...(is_new !== undefined && { is_new }),
    ...(node_type !== undefined && { node_type }),
  };

  // Dual-write into machine_filesystems UNLESS this is the player's own
  // workstation (own-box patches are excluded from machine_filesystems
  // by design — see the L2 plan and the migration header).
  const dualWrite = !isOwnWorkstationOnServer(machine_id, publicKey);
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

  const result = await deps.removePatch({
    player_key: publicKey,
    machine_id: payload.machine_id,
    path: payload.path,
    dual_write: !isOwnWorkstationOnServer(payload.machine_id, publicKey),
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

// Cross-player read path: returns all patches written to the supplied
// machines from any author. No L1 session gate — the world's
// persistent state on a shared machine is visible to everyone who can
// route to it. Knowing the machine_id is the gate; visibility-rule
// enforcement lands in a future PR (blocked on the home-network
// occupants table).
//
// publicKey is forwarded to the adapter for telemetry/audit but no
// longer narrows the SQL — every machine_id is per-player unique by
// construction now (workstation = suffixed hostname; mission instance =
// IP registry; LAN occupant = hostname column). See
// ListPatchesForMachinesParams for the rationale.
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
  return { status: 200, body: { patches: result.patches } };
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
