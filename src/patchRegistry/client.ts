import type { Identity } from '../identity/identity.js';
import { signRequest } from '../signedRequest/sign.js';
import type { FileNode, FileSystemPatch, FilePermissions } from '../filesystem/types.js';
import type {
  CrackCredentialsResult,
  ExploitReadKind,
  HydraBatchService,
  NodeType,
  UserType,
} from './types.js';

// Browser-side wrappers for POST /api/patches. Single endpoint with
// action-dispatch — each wrapper signs an envelope with the matching
// `action` field and POSTs it.
//
// Pattern mirrors src/sessionRegistry/client.ts and
// src/ipRegistry/client.ts. All five functions accept an injectable
// `fetch` for testability.
//
// Conversion direction:
//   client (camelCase, FileSystemPatch type)  ↔  wire (snake_case)
// The wrappers handle that translation in both directions so callers
// only ever see FileSystemPatch.

const PATCHES_URL = '/api/patches';

const postEnvelope = async (envelope: unknown, fetchImpl: typeof fetch): Promise<Response> =>
  fetchImpl(PATCHES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });

// ---- camelCase → snake_case (client → wire) -------------------------------

type UpsertPayload = {
  readonly machine_id: string;
  readonly path: string;
  readonly content: string | null;
  readonly owner: UserType;
  readonly permissions?: FilePermissions;
  readonly is_new?: boolean;
  readonly node_type?: NodeType;
};

const toUpsertPayload = (patch: FileSystemPatch): UpsertPayload => ({
  machine_id: patch.machineId,
  path: patch.path,
  content: patch.content,
  owner: patch.owner,
  ...(patch.permissions !== undefined && { permissions: patch.permissions }),
  ...(patch.isNew !== undefined && { is_new: patch.isNew }),
  ...(patch.nodeType !== undefined && { node_type: patch.nodeType }),
});

// ---- snake_case → camelCase (wire → client) -------------------------------

// Wire shape returned from listPatchesForMachines (and the broadcast
// payload in realtime.ts). Mirrors the server's PatchSummary type
// exactly — kept local to avoid a server→client type leak.
export type WirePatch = {
  readonly machine_id: string;
  readonly path: string;
  readonly content: string | null;
  readonly owner: UserType;
  readonly permissions: FilePermissions | null;
  readonly is_new: boolean;
  readonly node_type: NodeType;
};

// Convert wire shape to FileSystemPatch. Wire fields are always
// populated (DB defaults applied); we *omit* the optional client fields
// when they would carry the default value, so the resulting patch
// matches what broadcastAndRecordPatch produced on the writing side.
//
//   permissions === null         → omit (FileSystemPatch.permissions is optional)
//   is_new === false             → omit (FileSystemPatch.isNew is `?: true` literal)
//   node_type === 'file'         → omit (the implicit default)
//
// Exported so the realtime subscription path (subscribeToMachine) can
// reuse the same conversion — broadcast payloads share the wire shape.
export const toFileSystemPatch = (wire: WirePatch): FileSystemPatch => ({
  machineId: wire.machine_id,
  path: wire.path,
  content: wire.content,
  owner: wire.owner,
  ...(wire.permissions !== null && { permissions: wire.permissions }),
  ...(wire.is_new && { isNew: true as const }),
  ...(wire.node_type !== 'file' && { nodeType: wire.node_type }),
});

// ---- upsertPatch ----------------------------------------------------------

export const upsertPatch = async (
  identity: Identity,
  patch: FileSystemPatch,
  fetchImpl: typeof fetch = fetch,
): Promise<void> => {
  const envelope = signRequest(identity, 'upsertPatch', { ...toUpsertPayload(patch) });
  const response = await postEnvelope(envelope, fetchImpl);
  if (!response.ok) {
    throw new Error(`upsertPatch failed with status ${response.status}`);
  }
  // 200 has empty body — discard.
};

// ---- removePatch ----------------------------------------------------------

export type RemovePatchRequest = {
  readonly machineId: string;
  readonly path: string;
};

export const removePatch = async (
  identity: Identity,
  request: RemovePatchRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<void> => {
  const envelope = signRequest(identity, 'removePatch', {
    machine_id: request.machineId,
    path: request.path,
  });
  const response = await postEnvelope(envelope, fetchImpl);
  if (!response.ok) {
    throw new Error(`removePatch failed with status ${response.status}`);
  }
  // 200 returns { affected }, but callers don't need it for the
  // fire-and-forget pattern. Discard.
};

// ---- listPatchesForMachines -----------------------------------------------

// Cross-player read: returns all patches for the supplied machines from
// any author. machine_id is the filter so the shared world surfaces.
// Server orders by updated_at ASC so the array order is the application
// order — `applyPatches` reduce-order yields last-write-wins per
// (machine_id, path).
export const listPatchesForMachines = async (
  identity: Identity,
  machine_ids: ReadonlyArray<string>,
  fetchImpl: typeof fetch = fetch,
): Promise<ReadonlyArray<FileSystemPatch>> => {
  const envelope = signRequest(identity, 'listPatchesForMachines', {
    machine_ids: [...machine_ids],
  });
  const response = await postEnvelope(envelope, fetchImpl);
  if (!response.ok) {
    throw new Error(`listPatchesForMachines failed with status ${response.status}`);
  }
  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null || !('patches' in data)) {
    throw new Error('listPatchesForMachines returned malformed response (missing patches)');
  }
  const patches = (data as { readonly patches: unknown }).patches;
  if (!Array.isArray(patches)) {
    throw new Error('listPatchesForMachines returned malformed response (patches is not an array)');
  }
  return (patches as ReadonlyArray<WirePatch>).map(toFileSystemPatch);
};

// ---- clearOwnedPatches ----------------------------------------------------

// Wipes the player's patches on the workstation they own. Cross-player
// patches on other players' machines persist — they're part of the
// shared world. Fired by `reset confirm`.
//
// `workstationId` is the player's suffixed hostname (computePlayerHostname's
// output) — same value used as the storage key for the player's own
// filesystem. Server cross-checks it against the verified player_key
// (the suffix is identity-derived, so only the real owner can target
// the right rows; a forged value DELETEs nothing).
export const clearOwnedPatches = async (
  identity: Identity,
  workstationId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> => {
  const envelope = signRequest(identity, 'clearOwnedPatches', {
    workstation_id: workstationId,
  });
  const response = await postEnvelope(envelope, fetchImpl);
  if (!response.ok) {
    throw new Error(`clearOwnedPatches failed with status ${response.status}`);
  }
};

// ---- getBaseFs ------------------------------------------------------------
//
// Cross-player workstation base FS replication (PR 6 of plans/cross-
// player-base-fs-replication.md). Eager bulk-fetch on session establish:
// when A authenticates onto B's workstation, useFileSystemSync calls
// this wrapper, the server regenerates B's FS (filtered by A's session
// userType), and the result is merged into A's local fileSystems map.
//
// Returns the FileNode tree on 200 with non-null baseFs, null on
// 200-with-null OR on 404 (workstation_not_found is a soft failure —
// "no FS to merge" — not an error).
//
// All other non-2xx statuses throw. 400 unsupported_machine_type is a
// caller bug (we should only call this for workstation_id patterns);
// 401/429/500 are infrastructure-level errors that bubble up to the
// caller's catch and are silently logged in useFileSystemSync.

export const getBaseFs = async (
  identity: Identity,
  machineId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FileNode | null> => {
  const envelope = signRequest(identity, 'getBaseFs', { machine_id: machineId });
  const response = await postEnvelope(envelope, fetchImpl);

  if (response.status === 200) {
    const data: unknown = await response.json();
    if (typeof data !== 'object' || data === null || !('baseFs' in data)) {
      throw new Error('getBaseFs returned malformed response (missing baseFs)');
    }
    const baseFs = (data as { readonly baseFs: unknown }).baseFs;
    if (baseFs === null) return null;
    // Trust the server's tree shape — it produced it from generateLocalhost.
    return baseFs as FileNode;
  }

  if (response.status === 404) {
    // workstation_not_found is treated as "nothing to merge" — caller
    // doesn't get an exception, just keeps the (empty) state.
    return null;
  }

  throw new Error(`getBaseFs failed with status ${response.status}`);
};

// ---- exploitRead ---------------------------------------------------------
//
// Single-path read against a cross-player workstation at the caller's
// active session userType (PR 7 of plans/cross-player-base-fs-replication.md).
// Used by msfconsole's file_read / dir_list CVE flow on cross-player
// workstation targets — wraps the call inside withTransientSession
// (kind='effect_one_shot') first so the server sees an active session
// at the CVE-granted tier.
//
// Return shape pivots on `kind`:
//   file_read → string content (null on permission denied / missing path)
//   dir_list  → string[] entries (null on permission denied / non-dir)
//
// Errors: 400/401/403/404/429/500 all throw — the legitimate flow on
// cross-player workstations always has an effect_one_shot session
// active, so 403 no_session indicates a forge attempt or a session
// timing race the caller should surface.

export const exploitRead = async (
  identity: Identity,
  machineId: string,
  path: string,
  kind: ExploitReadKind,
  fetchImpl: typeof fetch = fetch,
): Promise<string | readonly string[] | null> => {
  const envelope = signRequest(identity, 'exploitRead', { machine_id: machineId, path, kind });
  const response = await postEnvelope(envelope, fetchImpl);

  if (response.status !== 200) {
    throw new Error(`exploitRead failed with status ${response.status}`);
  }

  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null) {
    throw new Error('exploitRead returned malformed response');
  }

  if (kind === 'file_read') {
    if (!('content' in data)) {
      throw new Error('exploitRead returned malformed response (missing content)');
    }
    const content = (data as { readonly content: unknown }).content;
    if (content === null) return null;
    if (typeof content !== 'string') {
      throw new Error('exploitRead returned malformed content (not string|null)');
    }
    return content;
  }

  // dir_list
  if (!('entries' in data)) {
    throw new Error('exploitRead returned malformed response (missing entries)');
  }
  const entries = (data as { readonly entries: unknown }).entries;
  if (entries === null) return null;
  if (!Array.isArray(entries) || !entries.every((e) => typeof e === 'string')) {
    throw new Error('exploitRead returned malformed entries (not string[]|null)');
  }
  return entries;
};

// PR 8 of plans/cross-player-base-fs-replication.md — batched hydra
// against a cross-player workstation. Caller sends md5(plaintext)
// candidate hashes; server reads the projected credential file and
// returns matches. Raw stored hashes never cross the wire — only
// candidates the client already knows.
//
// Errors: 400/404/500 throw (caller bug / server outage). 200 returns
// the result type as-is, callers handle empty hits as "no match in this
// batch" and continue iterating.
export const crackCredentials = async (
  identity: Identity,
  machineId: string,
  service: HydraBatchService,
  candidateHashes: readonly string[],
  userFilter: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  readonly hits: ReadonlyArray<{ readonly username: string; readonly matched_hash: string }>;
  readonly attempts: number;
}> => {
  const envelope = signRequest(identity, 'crackCredentials', {
    machine_id: machineId,
    service,
    candidate_hashes: candidateHashes,
    ...(userFilter !== undefined && { user_filter: userFilter }),
  });
  const response = await postEnvelope(envelope, fetchImpl);

  if (response.status !== 200) {
    throw new Error(`crackCredentials failed with status ${response.status}`);
  }

  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null) {
    throw new Error('crackCredentials returned malformed response');
  }

  if (!('hits' in data)) {
    throw new Error('crackCredentials returned malformed response (missing hits)');
  }
  if (!('attempts' in data)) {
    throw new Error('crackCredentials returned malformed response (missing attempts)');
  }
  const hits = (data as { readonly hits: unknown }).hits;
  const attempts = (data as { readonly attempts: unknown }).attempts;
  if (!Array.isArray(hits)) {
    throw new Error('crackCredentials returned malformed hits (not array)');
  }
  if (typeof attempts !== 'number') {
    throw new Error('crackCredentials returned malformed attempts (not number)');
  }
  // Type-check each hit row — defensive against a malicious server
  // (would only matter if the API surface gets reused outside this codebase).
  const validatedHits = hits.map((h, i) => {
    if (typeof h !== 'object' || h === null) {
      throw new Error(`crackCredentials hit[${i}] is not an object`);
    }
    if (typeof (h as { username: unknown }).username !== 'string') {
      throw new Error(`crackCredentials hit[${i}].username is not a string`);
    }
    if (typeof (h as { matched_hash: unknown }).matched_hash !== 'string') {
      throw new Error(`crackCredentials hit[${i}].matched_hash is not a string`);
    }
    return h as { readonly username: string; readonly matched_hash: string };
  });

  return { hits: validatedHits, attempts };
};

// Re-export the result type for callers that want to import it
// alongside the wrapper. Mirrors the pattern other action types follow.
export type { CrackCredentialsResult };
