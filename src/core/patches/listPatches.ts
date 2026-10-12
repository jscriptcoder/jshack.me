/**
 * handleListPatches — the pure listPatches endpoint logic (no Vercel, no
 * Supabase). Serves a machine's patch journal to a client that replays it over a
 * base filesystem it built itself, on boot and after writes (reload-durability).
 *
 * L1-gated, same as the write path: the caller may read a machine's journal
 * when it is their OWN workstation (suffix match) OR they hold an active
 * session there — otherwise 403 `no_session`.
 *
 * A session is not enough on its own. The rows are raw: nothing prunes them to a
 * tier, so they go only to a client that has to rebuild the box — the owner, and a
 * visitor on a machine their session's network generates. Another player's
 * workstation and the access point's own gateway are served as a tree pruned to the
 * session's tier (`resolveCrossPlayerFs`), and a visitor asking for their journal is
 * refused with 403 `permission_denied`: it would hand them every file that pruning
 * removes.
 *
 * The query is scoped to the MACHINE (the shared journal), not to a writer, so
 * every writer's rows on that machine come back; the handler sorts them into
 * chronological replay order before returning (order lives in core, not SQL).
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import { authorizeMachineAccess, type FindActiveSession } from './authorizeMachineAccess.js';
import { generatedBaseFsForMachineId } from '../generation/lanHostIdentity.js';
import { orderPatchesForReplay } from './orderPatchesForReplay.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import type { PatchRow } from './upsertPatch.js';

export type { PatchRow } from './upsertPatch.js';

/** A persisted patch row: the write shape plus the SERVER-stamped `updated_at`
 *  the chronological replay order is derived from. */
export type PersistedPatchRow = PatchRow & { readonly updated_at: string };

export type ListPatchesQuery = {
  readonly machine_id: string;
};

export type ListPatchesDeps = {
  readonly nonceStore: NonceStore;
  readonly findActiveSession: FindActiveSession;
  readonly listPatches: (
    query: ListPatchesQuery,
  ) => Promise<{ readonly data: readonly PersistedPatchRow[] | null; readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

const listPatchesSchema = z.looseObject({
  action: z.literal('listPatches'),
  machine_id: z.string().min(1),
});

export const handleListPatches = async (
  body: unknown,
  deps: ListPatchesDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, listPatchesSchema, {
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
  // The network is the one the session was opened on, read off its row: a caller
  // naming the network themselves could claim whichever one generates the id.
  if (
    access.session !== null &&
    generatedBaseFsForMachineId(access.session.essid, payload.machine_id) === null
  ) {
    return { status: 403, body: { error: 'permission_denied' } };
  }

  const { data, error } = await deps.listPatches({
    machine_id: payload.machine_id,
  });
  if (error) {
    return { status: 500, body: { error: 'list_failed' } };
  }

  return { status: 200, body: { ok: true, patches: orderPatchesForReplay(data ?? []) } };
};
