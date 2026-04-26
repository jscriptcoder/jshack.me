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
    read: z.array(z.enum(USER_TYPES)),
    write: z.array(z.enum(USER_TYPES)),
    execute: z.array(z.enum(USER_TYPES)),
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

// listPatches — return all patches for this player on rehydration.
export const listPatchesSignedPayloadSchema = z
  .object({
    action: z.literal('listPatches'),
    ...baseEnvelopeFields,
  })
  .strict();

export type ListPatchesPayload = z.infer<typeof listPatchesSignedPayloadSchema>;

// clearTransientPatches — DELETE WHERE machine_id <> 'localhost'. Fired
// on mission/home scene transitions; mirrors the existing PERSISTENT_-
// MACHINE_KEYS filter in FileSystemContext.tsx.
export const clearTransientPatchesSignedPayloadSchema = z
  .object({
    action: z.literal('clearTransientPatches'),
    ...baseEnvelopeFields,
  })
  .strict();

export type ClearTransientPatchesPayload = z.infer<typeof clearTransientPatchesSignedPayloadSchema>;

// clearOwnedPatches — DELETE WHERE player_key=me AND machine_id='localhost'.
// Fired by `reset confirm` before page reload, wiping the player's own
// localhost patches without touching the shared world.
//
// Why scoped to "owned" (currently localhost only): cross-player
// patches — e.g., Player A deleted a file on Player B's machine —
// represent gameplay actions in a shared world. A player resetting
// their game shouldn't undo the things they did to OTHER players'
// machines. As more "ownership" arrives (home network slots, mission
// instances), the server-side WHERE will grow accordingly.
export const clearOwnedPatchesSignedPayloadSchema = z
  .object({
    action: z.literal('clearOwnedPatches'),
    ...baseEnvelopeFields,
  })
  .strict();

export type ClearOwnedPatchesPayload = z.infer<typeof clearOwnedPatchesSignedPayloadSchema>;

// Combined schema for /api/patches — discriminated by `action`. Adding
// a new action: extend this union and add a dispatch arm in handler.ts.
export const patchesSignedPayloadSchema = z.discriminatedUnion('action', [
  upsertPatchSignedPayloadSchema,
  removePatchSignedPayloadSchema,
  listPatchesSignedPayloadSchema,
  clearTransientPatchesSignedPayloadSchema,
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
export type RemovePatchParams = {
  readonly player_key: string;
  readonly machine_id: string;
  readonly path: string;
};

// affected = rows actually deleted. Useful for telemetry / debugging
// but never gates a 4xx (a no-op delete is success: idempotent removal
// of a path that already had no patches).
export type RemovePatchResult =
  | { readonly ok: true; readonly affected: number }
  | { readonly ok: false };

export type ListPatchesParams = {
  readonly player_key: string;
};

// Public shape returned from listPatches. Omits player_key (caller
// already knows their own key) and timestamps. Permissions and is_new /
// node_type are returned in their DB-default-applied shape so the
// client wrapper has fewer special cases when converting back to the
// FileSystemPatch type.
export type PatchSummary = {
  readonly machine_id: string;
  readonly path: string;
  readonly content: string | null;
  readonly owner: UserType;
  readonly permissions: FilePermissions | null;
  readonly is_new: boolean;
  readonly node_type: NodeType;
};

export type ListPatchesResult =
  | { readonly ok: true; readonly patches: ReadonlyArray<PatchSummary> }
  | { readonly ok: false };

export type ClearPatchesParams = {
  readonly player_key: string;
};

export type ClearPatchesResult =
  | { readonly ok: true; readonly affected: number }
  | { readonly ok: false };
