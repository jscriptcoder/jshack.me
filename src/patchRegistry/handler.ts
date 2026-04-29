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
import { PERSISTENT_MACHINE_ID } from './supabaseDelete.js';
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

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly headers?: Record<string, string>;
};

export type HandlerDeps = {
  readonly upsertPatch: (row: PatchRow) => Promise<UpsertPatchResult>;
  readonly removePatch: (params: RemovePatchParams) => Promise<RemovePatchResult>;
  readonly listPatchesForMachines: (
    params: ListPatchesForMachinesParams,
  ) => Promise<ListPatchesForMachinesResult>;
  readonly clearTransientPatches: (params: ClearPatchesParams) => Promise<ClearPatchesResult>;
  readonly clearOwnedPatches: (params: ClearPatchesParams) => Promise<ClearPatchesResult>;
  // L1 of the patch-validation layer cake: confirms the verified player
  // has an active session on the target machine before we record the
  // mutation. Read of the existing `sessions` table — see
  // sessionRegistry/supabaseFindActive.ts for the adapter and
  // project_multiplayer_security_model memory for the broader design.
  readonly findActiveSession: (params: FindActiveSessionParams) => Promise<FindActiveSessionResult>;
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
//      clearTransientPatches / clearOwnedPatches). The verify path is
//      shared — every action gets identical signature + replay + ts
//      checks.
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
      return handleListPatchesForMachines(payload, deps);
    case 'clearTransientPatches':
      return handleClearTransientPatches(publicKey, deps);
    case 'clearOwnedPatches':
      return handleClearOwnedPatches(publicKey, deps);
  }
};

// L1 patch-validation gate: every mutating action (upsertPatch /
// removePatch) on a non-localhost machine MUST be backed by an active
// session row for this player on that machine. localhost is exempt —
// the player always "owns" their own box.
//
// Returns a HandlerResponse to short-circuit the caller, or null to
// allow the caller to proceed. Centralized here so both upsert and
// remove gate identically and a future fourth mutating action would
// just call this same helper.
//
// Distinguished failure modes:
//   - findActiveSession returns ok: false → 500 session_lookup_failed
//     (the lookup itself broke; we can't decide either way safely)
//   - findActiveSession returns ok: true, exists: false → 403 no_session
//     (lookup succeeded; player has no session on this machine)
const requireActiveSession = async (
  publicKey: string,
  machine_id: string,
  deps: HandlerDeps,
): Promise<HandlerResponse | null> => {
  if (machine_id === PERSISTENT_MACHINE_ID) return null;
  const result = await deps.findActiveSession({ player_key: publicKey, machine_id });
  if (!result.ok) {
    return { status: 500, body: { error: 'session_lookup_failed' } };
  }
  if (!result.exists) {
    return { status: 403, body: { error: 'no_session' } };
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

  const result = await deps.upsertPatch(row);
  if (!result.ok) {
    return { status: 500, body: { error: 'upsert_failed' } };
  }
  return { status: 200, body: {} };
};

const handleRemovePatch = async (
  publicKey: string,
  payload: Extract<PatchesPayload, { action: 'removePatch' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const gate = await requireActiveSession(publicKey, payload.machine_id, deps);
  if (gate) return gate;

  const result = await deps.removePatch({
    player_key: publicKey,
    machine_id: payload.machine_id,
    path: payload.path,
  });
  if (!result.ok) {
    return { status: 500, body: { error: 'remove_failed' } };
  }
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
// publicKey is intentionally unused for filtering — `verifySignedRequest`
// already gated on auth, so the caller is some authenticated player; the
// rows returned do not depend on which.
const handleListPatchesForMachines = async (
  payload: Extract<PatchesPayload, { action: 'listPatchesForMachines' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const result = await deps.listPatchesForMachines({ machine_ids: payload.machine_ids });
  if (!result.ok) {
    return { status: 500, body: { error: 'query_failed' } };
  }
  return { status: 200, body: { patches: result.patches } };
};

const handleClearTransientPatches = async (
  publicKey: string,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const result = await deps.clearTransientPatches({ player_key: publicKey });
  if (!result.ok) {
    return { status: 500, body: { error: 'clear_failed' } };
  }
  return { status: 200, body: { affected: result.affected } };
};

const handleClearOwnedPatches = async (
  publicKey: string,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const result = await deps.clearOwnedPatches({ player_key: publicKey });
  if (!result.ok) {
    return { status: 500, body: { error: 'clear_failed' } };
  }
  return { status: 200, body: { affected: result.affected } };
};
