/**
 * handleRemovePatch — the pure removePatch endpoint logic (no Vercel, no
 * Supabase). The api/ glue injects Supabase-backed lookups/deletes; tests
 * inject mocks.
 *
 * Deletion is server-authoritative: the `patches` table is the source of truth
 * for whether a node is player-created (`is_new`) or a base-FS node, so the
 * client just asks to remove a path and the server decides how:
 *
 *   - The node has an `is_new` patch row → DELETE the row + every descendant
 *     row. The base FS never had this node, so a tombstone would be pointless
 *     cruft; replaying an empty journal already omits it.
 *   - Otherwise (a base-FS file, a modified-base file, or no row at all) →
 *     DELETE any descendant rows, then UPSERT a `content: null` deletion marker
 *     so the base node stays hidden after the journal replays.
 *
 * Descendant cleanup is unconditional — a file has none, and a recursively
 * removed directory must not leave orphaned child patches behind. `player_key`
 * is server-stamped from the VERIFIED pubkey (never a client claim); the schema
 * rejects a client-supplied player_key outright. L1-gated like the write path:
 * own workstation (suffix match) OR an active ssh session on the target.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { authorizeMachineAccess, type FindActiveSession } from './authorizeMachineAccess';
import { enforceRemoteWriteL2, type ListMachinePatches } from './remoteWritePermission';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { PatchRow } from './upsertPatch';

export type PatchTreeQuery = {
  readonly player_key: string;
  readonly machine_id: string;
  readonly path: string;
};

export type FindPatchResult = {
  readonly data: { readonly is_new: boolean } | null;
  readonly error: unknown;
};

export type RemovePatchDeps = {
  readonly nonceStore: NonceStore;
  readonly findActiveSession: FindActiveSession;
  readonly listMachinePatches: ListMachinePatches;
  /** Look up the row at the exact path (to read its `is_new` flag). */
  readonly findPatch: (query: PatchTreeQuery) => Promise<FindPatchResult>;
  /** Delete the row at `path` AND every row beneath it (`path/...`). */
  readonly deletePatchTree: (query: PatchTreeQuery) => Promise<{ readonly error: unknown }>;
  /** Record the `content: null` deletion marker for a base/modified node. */
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
  .refine((payload) => !('player_key' in payload));

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
  const access = await authorizeMachineAccess(publicKey, payload.machine_id, deps.findActiveSession);
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
  });
  if (denial) {
    return { status: denial.status, body: { error: denial.error } };
  }

  const query: PatchTreeQuery = {
    player_key: publicKey,
    machine_id: payload.machine_id,
    path: payload.path,
  };

  const lookup = await deps.findPatch(query);
  if (lookup.error) return failed;

  const { error: deleteError } = await deps.deletePatchTree(query);
  if (deleteError) return failed;

  // A player-created node leaves nothing behind; a base/modified node needs a
  // tombstone so the base FS stays hidden on replay.
  if (!lookup.data?.is_new) {
    const { error: upsertError } = await deps.upsertPatch({
      player_key: publicKey,
      machine_id: payload.machine_id,
      path: payload.path,
      content: null,
      owner: payload.owner,
      is_new: false,
    });
    if (upsertError) return failed;
  }

  return { status: 200, body: { ok: true } };
};
