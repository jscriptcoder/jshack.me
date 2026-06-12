/**
 * handleListPatches — the pure listPatches endpoint logic (no Vercel, no
 * Supabase). Serves a player their OWN workstation's patch journal so the
 * client can replay it over the regenerated base FS on boot and after writes
 * (reload-durability).
 *
 * L1-gated, same as the write path: the caller may read a machine's journal
 * when it is their OWN workstation (suffix match) OR they hold an active ssh
 * session there — otherwise 403 `no_session`. The query is always scoped to the
 * VERIFIED pubkey's rows, so a forged player_key in the payload would change
 * nothing (no player_key refine). The cross-player three-tier read filter
 * (listPatchesForMachines) is still a later plan.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { authorizeMachineAccess, type FindActiveSession } from './authorizeMachineAccess';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { PatchRow } from './upsertPatch';

export type { PatchRow } from './upsertPatch';

export type ListPatchesQuery = {
  readonly player_key: string;
  readonly machine_id: string;
};

export type ListPatchesDeps = {
  readonly nonceStore: NonceStore;
  readonly findActiveSession: FindActiveSession;
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
  const access = await authorizeMachineAccess(publicKey, payload.machine_id, deps.findActiveSession);
  if (!access.ok) {
    return { status: access.status, body: { error: access.error } };
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
