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
import { enforceRemoteWriteL2, type ListMachinePatches } from './remoteWritePermission';
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

export type UpsertPatchDeps = {
  readonly nonceStore: NonceStore;
  readonly findActiveSession: FindActiveSession;
  readonly listMachinePatches: ListMachinePatches;
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
  })
  .refine((payload) => !('player_key' in payload) && !('writer_key' in payload));

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
  const access = await authorizeMachineAccess(publicKey, payload.machine_id, deps.findActiveSession);
  if (!access.ok) {
    return { status: access.status, body: { error: access.error } };
  }

  // L2: a remote write is further constrained to the login's tier (own-box
  // bypasses — `access.session` is null there).
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
