/**
 * handleUpsertPatch — the pure upsertPatch endpoint logic (no Vercel, no
 * Supabase). The api/ glue injects a real Supabase-backed `upsertPatch` and a
 * nonce store; tests inject mocks.
 *
 * Flow: verify the signed envelope → confirm the target is the caller's OWN
 * workstation (server-side suffix match; sessions for other machines are a
 * later plan) → server-stamp player_key from the VERIFIED pubkey (never a
 * client claim) → upsert. The payload schema rejects a client-supplied
 * player_key outright.
 */

import { z } from 'zod';
import { verifySignedRequest, type VerifyFailureReason } from '../signedRequest/verify';
import { isOwnWorkstation } from '../identity/workstation';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { UserType } from '../types';

export type FilePermissionsRow = {
  readonly read: readonly UserType[];
  readonly write: readonly UserType[];
  readonly execute: readonly UserType[];
};

export type PatchRow = {
  readonly player_key: string;
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
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the always-present envelope fields (action/ts/nonce) pass through;
// the refine rejects a client-supplied player_key (the server stamps it).
// permissions / is_new / node_type are deliberately NOT validated here yet —
// they're added with tests when mkdir/redirect (slice 5/6) first send them.
const upsertPatchSchema = z
  .looseObject({
    action: z.literal('upsertPatch'),
    machine_id: z.string().min(1),
    path: z.string().min(1),
    content: z.string().nullable(),
    owner: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload));

// Auth/structural failures → distinct HTTP statuses (401 vs 400).
const STATUS_BY_REASON: Record<VerifyFailureReason, number> = {
  envelope_invalid: 400,
  payload_malformed: 400,
  payload_invalid: 400,
  signature_invalid: 401,
  timestamp_skew: 401,
  replay: 401,
};

export const handleUpsertPatch = async (
  body: unknown,
  deps: UpsertPatchDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, upsertPatchSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_REASON[verified.reason], body: { error: verified.reason } };
  }

  const { publicKey, payload } = verified;
  if (!isOwnWorkstation(payload.machine_id, publicKey)) {
    return { status: 403, body: { error: 'no_session' } };
  }

  const { error } = await deps.upsertPatch({
    player_key: publicKey,
    machine_id: payload.machine_id,
    path: payload.path,
    content: payload.content,
    owner: payload.owner,
  });
  if (error) {
    return { status: 500, body: { error: 'upsert_failed' } };
  }

  return { status: 200, body: { ok: true } };
};
