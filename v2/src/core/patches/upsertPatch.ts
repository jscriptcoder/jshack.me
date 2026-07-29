/**
 * handleUpsertPatch — the pure upsertPatch endpoint logic (no Vercel, no
 * Supabase). The api/ glue injects a real Supabase-backed `upsertPatch` and a
 * nonce store; tests inject mocks.
 *
 * Flow: verify the signed envelope → L1-authorize the target machine (own
 * workstation by suffix match, OR an active ssh session there) → server-stamp
 * writer_key from the VERIFIED pubkey (never a client claim) → upsert. The
 * payload schema rejects a client-supplied player_key/writer_key outright.
 *
 * Shared journal (Story 3): a row is keyed `(machine_id, path, writer_key)`, so
 * `writer_key` is the PROVENANCE of this row (who wrote it) — multiple writers'
 * edits to one file coexist and replay chronologically. The own-box read keys on
 * `machine_id` (the machine owns the journal), not on the writer.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { authorizeMachineAccess, type FindActiveSession } from './authorizeMachineAccess';
import { contentHash } from './contentHash';
import { orderPatchesForReplay } from './orderPatchesForReplay';
import {
  enforceRemoteWriteL2,
  type FindOccupantWorkstationByMachineId,
  type ListMachinePatches,
} from './remoteWritePermission';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { UserType } from '../types';

export type FilePermissionsRow = {
  readonly read: readonly UserType[];
  readonly write: readonly UserType[];
  readonly execute: readonly UserType[];
};

export type PatchRow = {
  /** Provenance: the player who wrote this row (PK component with machine_id +
   *  path). Server-stamped from the verified pubkey, never a client claim. */
  readonly writer_key: string;
  readonly machine_id: string;
  readonly path: string;
  readonly content: string | null;
  readonly owner: string;
  readonly permissions?: FilePermissionsRow;
  readonly is_new?: boolean;
  readonly node_type?: 'file' | 'directory';
};

/** One persisted row for a single path: the content a reader would materialize
 *  from it, plus what the replay order is decided on. */
export type PathPatchRow = {
  readonly content: string | null;
  readonly updated_at: string;
  readonly writer_key: string;
};

export type ListPathPatchesResult = {
  readonly data: readonly PathPatchRow[] | null;
  readonly error: unknown;
};

export type UpsertPatchDeps = {
  readonly nonceStore: NonceStore;
  readonly findActiveSession: FindActiveSession;
  readonly listMachinePatches: ListMachinePatches;
  /** Every writer's rows for the ONE path being written — how the save's claimed
   *  base is checked against what the machine actually holds. Path-scoped rather
   *  than reusing the machine-wide L2 read, which an own-workstation write never
   *  performs. */
  readonly listPathPatches: (query: {
    readonly machine_id: string;
    readonly path: string;
  }) => Promise<ListPathPatchesResult>;
  /** Reverse-look-up a registered foreign workstation by its machine_id — the L2
   *  cross-player branch (D6) rebuilds the owner's tree from this. */
  /** Same-LAN fallback for L2 when no occupancy row exists (a shared-AP occupant evicted
   *  by a later joiner) — resolves the workstation from the occupancy table. */
  readonly findOccupantWorkstationByMachineId: FindOccupantWorkstationByMachineId;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the always-present envelope fields (action/ts/nonce) pass through;
// the refine rejects a client-supplied player_key/writer_key (the server stamps
// the writer from the verified pubkey).
const userTypeSchema = z.enum(['root', 'user', 'guest']);
const permissionsSchema = z.object({
  read: z.array(userTypeSchema),
  write: z.array(userTypeSchema),
  execute: z.array(userTypeSchema),
});

const upsertPatchSchema = z
  .looseObject({
    action: z.literal('upsertPatch'),
    machine_id: z.string().min(1),
    path: z.string().min(1),
    content: z.string().nullable(),
    owner: z.string().min(1),
    permissions: permissionsSchema.optional(),
    is_new: z.boolean().optional(),
    node_type: z.enum(['file', 'directory']).optional(),
    /** The fingerprint of the content this save was written against. Optional:
     *  a caller that was never shown content to overwrite (a `>` redirect,
     *  `touch`) sends none and writes unconditionally. */
    base_hash: z.string().min(1).optional(),
  })
  .refine((payload) => !('player_key' in payload) && !('writer_key' in payload));

/** Refuse a save that would replace content its author was never shown — an
 *  editor holding a buffer from before another occupant wrote the same file.
 *
 *  The row compared against is the one a READER materializes (`orderPatchesForReplay`,
 *  same-instant ties broken on writer_key), because that is what the player was
 *  looking at; picking any other row would reject saves that raced nothing. No
 *  rows means nobody has written the path since the world was generated, and the
 *  generated filesystem is the same for every viewer, so there is nothing unseen.
 *  A deletion marker holds no content to compare: the save agrees with the world
 *  only if it too expects the file to be absent. */
const rejectModifiedSinceOpen = async (
  payload: {
    readonly machine_id: string;
    readonly path: string;
    readonly base_hash?: string | undefined;
    readonly is_new?: boolean | undefined;
  },
  listPathPatches: UpsertPatchDeps['listPathPatches'],
): Promise<HandlerResponse | undefined> => {
  if (payload.base_hash === undefined) return undefined;
  const { data, error } = await listPathPatches({
    machine_id: payload.machine_id,
    path: payload.path,
  });
  if (error) return { status: 500, body: { error: 'base_check_failed' } };
  const materialized = orderPatchesForReplay(data ?? []).at(-1);
  if (materialized === undefined) return undefined;
  const stillHoldsWhatTheAuthorSaw =
    materialized.content === null
      ? payload.is_new === true
      : contentHash(materialized.content) === payload.base_hash;
  if (stillHoldsWhatTheAuthorSaw) return undefined;
  return { status: 409, body: { error: 'modified_since_open' } };
};

export const handleUpsertPatch = async (
  body: unknown,
  deps: UpsertPatchDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, upsertPatchSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }

  const { publicKey, payload } = verified;
  const access = await authorizeMachineAccess(
    publicKey,
    payload.machine_id,
    deps.findActiveSession,
  );
  if (!access.ok) {
    return { status: access.status, body: { error: access.error } };
  }

  // L2: a remote write is further constrained to the login's tier (own-box
  // bypasses — `access.session` is null there).
  const denial = await enforceRemoteWriteL2({
    machineId: payload.machine_id,
    path: payload.path,
    session: access.session,
    listMachinePatches: deps.listMachinePatches,
    findOccupantWorkstationByMachineId: deps.findOccupantWorkstationByMachineId,
  });
  if (denial) {
    return { status: denial.status, body: { error: denial.error } };
  }

  // After the permission gates, never before: a caller who may not write this
  // path at all must not learn whether somebody else has been editing it.
  const modified = await rejectModifiedSinceOpen(payload, deps.listPathPatches);
  if (modified) {
    return modified;
  }

  const { error } = await deps.upsertPatch({
    writer_key: publicKey,
    machine_id: payload.machine_id,
    path: payload.path,
    content: payload.content,
    owner: payload.owner,
    ...(payload.permissions ? { permissions: payload.permissions } : {}),
    ...(payload.is_new !== undefined ? { is_new: payload.is_new } : {}),
    ...(payload.node_type ? { node_type: payload.node_type } : {}),
  });
  if (error) {
    return { status: 500, body: { error: 'upsert_failed' } };
  }

  return { status: 200, body: { ok: true } };
};
