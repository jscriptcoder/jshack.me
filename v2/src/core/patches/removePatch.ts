/**
 * handleRemovePatch — the pure removePatch endpoint logic (no Vercel, no
 * Supabase). The api/ glue injects Supabase-backed lookups/deletes; tests
 * inject mocks.
 *
 * Deletion is server-authoritative and TOMBSTONE-ALWAYS on the shared journal:
 * the client just asks to remove a path, and the server, for every removal:
 *
 *   1. DELETEs the caller's own row at the path + every descendant row (so a
 *      recursively removed directory leaves no orphaned child patches, and a
 *      stale child row can't resurrect part of the subtree on replay).
 *   2. UPSERTs a `content: null` deletion marker at the path — a timestamped
 *      deletion EVENT keyed to the caller's `(machine_id, path, writer_key)`.
 *
 * Why tombstone even a player-created node (rather than a bare hard-delete): on
 * the shared journal one path can carry rows from MULTIPLE writers. Hard-deleting
 * only the caller's row would let a concurrent writer's row keep the file alive
 * after replay — the deletion would silently fail. A tombstone is a write that
 * wins chronologically (server-stamped `updated_at`), so a later owner re-create
 * still wins over it, and an earlier concurrent write loses to it. The row is
 * bounded: one per (machine_id, path, writer_key), so the marker is the writer's
 * single row flipping to null, not unbounded cruft.
 *
 * The `writer_key` is server-stamped from the VERIFIED pubkey (never a client
 * claim); the schema rejects a client-supplied player_key/writer_key outright.
 * L1-gated like the write path: own workstation (suffix match) OR an active ssh
 * session on the target; L2 (cross-player) requires write perm at the login tier.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { authorizeMachineAccess, type FindActiveSession } from './authorizeMachineAccess';
import {
  enforceRemoteWriteL2,
  type FindRegistryByMachineId,
  type ListMachinePatches,
} from './remoteWritePermission';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { PatchRow } from './upsertPatch';

export type PatchTreeQuery = {
  readonly writer_key: string;
  readonly machine_id: string;
  readonly path: string;
};

export type RemovePatchDeps = {
  readonly nonceStore: NonceStore;
  readonly findActiveSession: FindActiveSession;
  readonly listMachinePatches: ListMachinePatches;
  /** Reverse-look-up a registered foreign workstation by its machine_id — shared
   *  with the write path's L2 cross-player branch (D6). */
  readonly findRegistryByMachineId: FindRegistryByMachineId;
  /** Delete the row at `path` AND every row beneath it (`path/...`). */
  readonly deletePatchTree: (query: PatchTreeQuery) => Promise<{ readonly error: unknown }>;
  /** Record the `content: null` deletion marker (the tombstone). */
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

const removePatchSchema = z
  .looseObject({
    action: z.literal('removePatch'),
    machine_id: z.string().min(1),
    path: z.string().min(1),
    owner: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload) && !('writer_key' in payload));

const failed: HandlerResponse = { status: 500, body: { error: 'remove_failed' } };

export const handleRemovePatch = async (
  body: unknown,
  deps: RemovePatchDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, removePatchSchema, {
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

  // L2: removing (unlinking) a node on a remote host needs write permission at
  // the login's tier, same as a write (own-box bypasses — session is null).
  const denial = await enforceRemoteWriteL2({
    publicKey,
    machineId: payload.machine_id,
    path: payload.path,
    session: access.session,
    listMachinePatches: deps.listMachinePatches,
    findRegistryByMachineId: deps.findRegistryByMachineId,
  });
  if (denial) {
    return { status: denial.status, body: { error: denial.error } };
  }

  const query: PatchTreeQuery = {
    writer_key: publicKey,
    machine_id: payload.machine_id,
    path: payload.path,
  };

  const { error: deleteError } = await deps.deletePatchTree(query);
  if (deleteError) return failed;

  // Tombstone-always: a delete records a content:null marker (a timestamped
  // deletion EVENT) regardless of whether the caller's row was player-created.
  // On the shared journal a bare hard-delete would lose that event, so a
  // CONCURRENT writer's row for the same path could keep the file alive after
  // replay. The marker is keyed to the caller's own (machine_id, path,
  // writer_key) row; descendant rows were already cleared above.
  const { error: upsertError } = await deps.upsertPatch({
    writer_key: publicKey,
    machine_id: payload.machine_id,
    path: payload.path,
    content: null,
    owner: payload.owner,
    is_new: false,
  });
  if (upsertError) return failed;

  return { status: 200, body: { ok: true } };
};
