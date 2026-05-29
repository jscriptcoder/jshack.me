/**
 * handleListPatches — the pure listPatches endpoint logic (no Vercel, no
 * Supabase). Serves a player their OWN workstation's patch journal so the
 * client can replay it over the regenerated base FS on boot and after writes
 * (reload-durability).
 *
 * Own-workstation only: the cross-player three-tier read filter
 * (listPatchesForMachines) is a later plan. Here the query is always scoped to
 * the VERIFIED pubkey's rows for a machine the caller owns (suffix match), so
 * there is nothing to leak — a forged player_key in the payload would change
 * nothing, which is why this read carries no player_key refine.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { isOwnWorkstation } from '../identity/workstation';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { PatchRow } from './upsertPatch';

export type { PatchRow } from './upsertPatch';

export type ListPatchesQuery = {
  readonly player_key: string;
  readonly machine_id: string;
};

export type ListPatchesDeps = {
  readonly nonceStore: NonceStore;
  readonly listPatches: (
    query: ListPatchesQuery,
  ) => Promise<{ readonly data: readonly PatchRow[] | null; readonly error: unknown }>;
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
  if (!isOwnWorkstation(payload.machine_id, publicKey)) {
    return { status: 403, body: { error: 'no_session' } };
  }

  const { data, error } = await deps.listPatches({
    player_key: publicKey,
    machine_id: payload.machine_id,
  });
  if (error) {
    return { status: 500, body: { error: 'list_failed' } };
  }

  return { status: 200, body: { ok: true, patches: data ?? [] } };
};
