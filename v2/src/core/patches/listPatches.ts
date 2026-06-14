/**
 * handleListPatches — the pure listPatches endpoint logic (no Vercel, no
 * Supabase). Serves a player their OWN workstation's patch journal so the
 * client can replay it over the regenerated base FS on boot and after writes
 * (reload-durability).
 *
 * L1-gated, same as the write path: the caller may read a machine's journal
 * when it is their OWN workstation (suffix match) OR they hold an active ssh
 * session there — otherwise 403 `no_session`. The query is scoped to the
 * MACHINE (the shared journal — Story 3 PK flip), not to a writer, so every
 * writer's rows on that machine come back; the handler sorts them into
 * chronological replay order before returning (D3 — order in core, not SQL).
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { authorizeMachineAccess, type FindActiveSession } from './authorizeMachineAccess';
import { orderPatchesForReplay } from './orderPatchesForReplay';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { PatchRow } from './upsertPatch';

export type { PatchRow } from './upsertPatch';

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
  const access = await authorizeMachineAccess(publicKey, payload.machine_id, deps.findActiveSession);
  if (!access.ok) {
    return { status: access.status, body: { error: access.error } };
  }

  const { data, error } = await deps.listPatches({
    machine_id: payload.machine_id,
  });
  if (error) {
    return { status: 500, body: { error: 'list_failed' } };
  }

  return { status: 200, body: { ok: true, patches: orderPatchesForReplay(data ?? []) } };
};
