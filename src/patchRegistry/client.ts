import type { Identity } from '../identity/identity.js';
import { signRequest } from '../signedRequest/sign.js';
import type { FileSystemPatch, FilePermissions } from '../filesystem/types.js';
import type { NodeType, UserType } from './types.js';

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

// Wire shape returned from listPatches. Mirrors the server's PatchSummary
// type exactly — kept local to avoid a server→client type leak.
type WirePatch = {
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
const toFileSystemPatch = (wire: WirePatch): FileSystemPatch => ({
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

// ---- listPatches ----------------------------------------------------------

export const listPatches = async (
  identity: Identity,
  fetchImpl: typeof fetch = fetch,
): Promise<ReadonlyArray<FileSystemPatch>> => {
  const envelope = signRequest(identity, 'listPatches', {});
  const response = await postEnvelope(envelope, fetchImpl);
  if (!response.ok) {
    throw new Error(`listPatches failed with status ${response.status}`);
  }
  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null || !('patches' in data)) {
    throw new Error('listPatches returned malformed response (missing patches)');
  }
  const patches = (data as { readonly patches: unknown }).patches;
  if (!Array.isArray(patches)) {
    throw new Error('listPatches returned malformed response (patches is not an array)');
  }
  // Trust the row shape (server-produced). Future hardening could zod-validate.
  return (patches as ReadonlyArray<WirePatch>).map(toFileSystemPatch);
};

// ---- clearTransientPatches ------------------------------------------------

export const clearTransientPatches = async (
  identity: Identity,
  fetchImpl: typeof fetch = fetch,
): Promise<void> => {
  const envelope = signRequest(identity, 'clearTransientPatches', {});
  const response = await postEnvelope(envelope, fetchImpl);
  if (!response.ok) {
    throw new Error(`clearTransientPatches failed with status ${response.status}`);
  }
};

// ---- clearOwnedPatches ----------------------------------------------------

// Wipes the player's patches on machines they own (currently localhost).
// Cross-player patches on other players' machines persist — they're part
// of the shared world. Fired by `reset confirm`.
export const clearOwnedPatches = async (
  identity: Identity,
  fetchImpl: typeof fetch = fetch,
): Promise<void> => {
  const envelope = signRequest(identity, 'clearOwnedPatches', {});
  const response = await postEnvelope(envelope, fetchImpl);
  if (!response.ok) {
    throw new Error(`clearOwnedPatches failed with status ${response.status}`);
  }
};
