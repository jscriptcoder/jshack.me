import { z } from 'zod';

// Permitted user roles inside the game world. Mirrors session/types.
// Kept local instead of importing so the registry stays a self-contained
// boundary module (handler + adapters can move without dragging session
// types along).
export const USER_TYPES = ['root', 'user', 'guest'] as const;
export type UserType = (typeof USER_TYPES)[number];

export const NODE_TYPES = ['file', 'directory'] as const;
export type NodeType = (typeof NODE_TYPES)[number];

// FilePermissions wire shape — Unix-style allow lists per mode. Mirrors
// the FilePermissions type from src/filesystem/types but defined here in
// schema form. Strict: rejects unknown fields.
export const filePermissionsSchema = z
  .object({
    read: z.array(z.enum(USER_TYPES)).readonly(),
    write: z.array(z.enum(USER_TYPES)).readonly(),
    execute: z.array(z.enum(USER_TYPES)).readonly(),
  })
  .strict();

export type FilePermissions = z.infer<typeof filePermissionsSchema>;

// Common envelope fields shared by all five action schemas. Inlined per
// action (rather than extended) so each .strict() schema can reject any
// stray fields the client sneaks in.
const baseEnvelopeFields = {
  ts: z.number().int(),
  nonce: z.string().regex(/^[0-9a-f]{32}$/i),
};

// upsertPatch — write or create a patch row. UPSERT on the natural key
// (player_key, machine_id, path). content === null with !is_new means
// "the base filesystem file at this path is hidden/deleted" — we still
// keep a row because reload replays patches over regenerated filesystems.
export const upsertPatchSignedPayloadSchema = z
  .object({
    action: z.literal('upsertPatch'),
    ...baseEnvelopeFields,
    machine_id: z.string().min(1).max(256),
    path: z.string().min(1).max(4096),
    content: z.string().nullable(),
    owner: z.enum(USER_TYPES),
    permissions: filePermissionsSchema.optional(),
    is_new: z.boolean().optional(),
    node_type: z.enum(NODE_TYPES).optional(),
  })
  .strict();

export type UpsertPatchPayload = z.infer<typeof upsertPatchSignedPayloadSchema>;

// removePatch — hard-delete the row + descendants (DELETE WHERE
// path = X OR path LIKE X/%). Used when the player removes a file they
// had created via patch (isNew), or a directory whose children also need
// to disappear.
export const removePatchSignedPayloadSchema = z
  .object({
    action: z.literal('removePatch'),
    ...baseEnvelopeFields,
    machine_id: z.string().min(1).max(256),
    path: z.string().min(1).max(4096),
  })
  .strict();

export type RemovePatchPayload = z.infer<typeof removePatchSignedPayloadSchema>;

// listPatchesForMachines — return all patches for the supplied machines
// from any author. Cross-player read path: the world is one shared
// persistent state, so rehydration on a shared machine should surface
// every player's mutations, not just my own. Capped at 100 machine_ids
// per request — the player's current view (localhost + home + mission
// machines) is well under that today.
export const listPatchesForMachinesSignedPayloadSchema = z
  .object({
    action: z.literal('listPatchesForMachines'),
    ...baseEnvelopeFields,
    machine_ids: z.array(z.string().min(1).max(256)).min(1).max(100),
  })
  .strict();

export type ListPatchesForMachinesPayload = z.infer<
  typeof listPatchesForMachinesSignedPayloadSchema
>;

// clearOwnedPatches — DELETE WHERE player_key=me AND machine_id=$workstation_id.
// Fired by `reset confirm` before page reload, wiping the player's own
// workstation patches without touching the shared world. The client sends
// its workstation_id (= suffixed hostname) explicitly; the server cross-
// checks it against the verified player_key (the workstation_id IS
// derived from the player_key, so a forged workstation_id would not match
// and we'd no-op silently).
//
// Why scoped to "owned": cross-player patches — e.g., Player A deleted
// a file on Player B's workstation — represent gameplay actions in a
// shared world. A player resetting their game shouldn't undo the things
// they did to OTHER players' machines. The workstation_id is what makes
// this scoping correct under the eliminated-localhost model: the player
// can only wipe rows that THEIR identity owns AND whose machine_id is
// THEIR workstation. As more "ownership" arrives (home network slots,
// mission instances), the server-side WHERE will grow accordingly.
export const clearOwnedPatchesSignedPayloadSchema = z
  .object({
    action: z.literal('clearOwnedPatches'),
    ...baseEnvelopeFields,
    workstation_id: z.string().min(1).max(256),
  })
  .strict();

export type ClearOwnedPatchesPayload = z.infer<typeof clearOwnedPatchesSignedPayloadSchema>;

// Combined schema for /api/patches — discriminated by `action`. Adding
// a new action: extend this union and add a dispatch arm in handler.ts.
export const patchesSignedPayloadSchema = z.discriminatedUnion('action', [
  upsertPatchSignedPayloadSchema,
  removePatchSignedPayloadSchema,
  listPatchesForMachinesSignedPayloadSchema,
  clearOwnedPatchesSignedPayloadSchema,
]);

export type PatchesPayload = z.infer<typeof patchesSignedPayloadSchema>;

// --- Internal types between handler and adapters ---

// Server-stamped row shape for upsert. player_key comes from the
// verified pubkey, never the client.
export type PatchRow = {
  readonly player_key: string;
  readonly machine_id: string;
  readonly path: string;
  readonly content: string | null;
  readonly owner: UserType;
  readonly permissions?: FilePermissions;
  readonly is_new?: boolean;
  readonly node_type?: NodeType;
};

export type UpsertPatchResult = { readonly ok: true } | { readonly ok: false };

// removePatch params — player_key from verified pubkey + the natural-
// key fields the client supplied. The adapter handles the descendant-
// prefix expansion server-side.
//
// dual_write controls whether the SQL function also drops the matching
// machine_filesystems rows in the same transaction. The handler sets it
// to false for own-workstation deletes (the player's own box is excluded
// from machine_filesystems by design — see the L2 plan and the
// 20260502220000_machine_filesystems migration header).
export type RemovePatchParams = {
  readonly player_key: string;
  readonly machine_id: string;
  readonly path: string;
  readonly dual_write: boolean;
};

// affected = rows actually deleted. Useful for telemetry / debugging
// but never gates a 4xx (a no-op delete is success: idempotent removal
// of a path that already had no patches).
export type RemovePatchResult =
  | { readonly ok: true; readonly affected: number }
  | { readonly ok: false };

// Public shape returned from listPatchesForMachines. Omits player_key
// (caller doesn't need to know who wrote each row at this layer) and
// timestamps. Permissions and is_new / node_type are returned in their
// DB-default-applied shape so the client wrapper has fewer special
// cases when converting back to the FileSystemPatch type.
export type PatchSummary = {
  readonly machine_id: string;
  readonly path: string;
  readonly content: string | null;
  readonly owner: UserType;
  readonly permissions: FilePermissions | null;
  readonly is_new: boolean;
  readonly node_type: NodeType;
};

// Realtime broadcast payload — a HINT, not a full patch. After every
// successful upsertPatch / removePatch the server publishes
// `{ machine_id, originator_key }` on `patches:<machine_id>`. Receivers
// trigger a `listPatchesForMachines` refetch to obtain authoritative
// state for the affected machine; receivers whose `originator_key`
// matches their own pubkey skip the refetch (their local optimistic
// apply + cross-tab BroadcastChannel already covered it).
//
// Why a hint, not the full payload: the broadcast channel is anon-
// publishable from the browser bundle, so any client could forge a
// `patch_change` event with fake content. By shipping only "something
// changed" + "who changed it", forgery becomes harmless — a forged
// hint just causes a refetch that returns server truth. See
// project_realtime_publish_authorization memory for the threat model.
export type PatchHint = {
  readonly machine_id: string;
  readonly originator_key: string;
};

// Cross-player read params. Caller (handler) supplies:
//   - machine_ids: the set of machines whose patches the player wants.
//   - player_key:  the verified caller pubkey, server-stamped (NOT
//                  present on the wire envelope). Retained for telemetry/
//                  audit; the SQL no longer filters on it now that
//                  every machine_id is per-player unique by construction
//                  (workstation = suffixed hostname; mission instance =
//                  IP registry; LAN occupant = hostname column).
//
//                  Pre-elimination, this filter blocked neighbors from
//                  reading each other's localhost rows through the
//                  shared 'localhost' literal — that special case is
//                  gone. See plan/eliminate-localhost-machine-id.md.
export type ListPatchesForMachinesParams = {
  readonly machine_ids: ReadonlyArray<string>;
  readonly player_key: string;
};

// Result: rows can come from multiple players for the requested
// machines. Server orders by updated_at ASC so client `applyPatches`
// reduce-order yields last-write-wins per (machine_id, path).
export type ListPatchesForMachinesResult =
  | { readonly ok: true; readonly patches: ReadonlyArray<PatchSummary> }
  | { readonly ok: false };

// Params for clearOwnedPatches. The workstation_id is supplied by the
// client (sent in the signed envelope) and matched against the player_key
// the server verified — under the eliminated-localhost model the
// workstation_id IS derived from the player_key (computePlayerHostname),
// so a forged workstation_id won't have rows owned by THIS player_key
// and the DELETE is a harmless no-op.
export type ClearPatchesParams = {
  readonly player_key: string;
  readonly workstation_id: string;
};

export type ClearPatchesResult =
  | { readonly ok: true; readonly affected: number }
  | { readonly ok: false };
