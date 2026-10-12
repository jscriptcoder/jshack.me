/**
 * handleListPatches — the pure listPatches endpoint logic (no Vercel, no
 * Supabase). Serves a workstation's patch journal to its owner, who replays it over
 * the base filesystem their own client builds, on boot and after writes
 * (reload-durability).
 *
 * The owner and nobody else. The rows are raw: every writer's, at any permission, with
 * nothing pruning them to a tier. So they go to the one caller entitled to all of them,
 * which is the player whose workstation it is (server-side suffix match on the verified
 * key). Every other box is read as the tree `resolveCrossPlayerFs` builds and prunes,
 * and a caller asking for the rows behind one gets a single answer, 403
 * `permission_denied`, whatever session they hold there. No session is looked up,
 * because none would change it.
 *
 * The query is scoped to the MACHINE (the shared journal), not to a writer, so
 * every writer's rows on that machine come back; the handler sorts them into
 * chronological replay order before returning (order lives in core, not SQL).
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import { isOwnWorkstation } from '../identity/workstation.js';
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
  if (!isOwnWorkstation(payload.machine_id, publicKey)) {
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
