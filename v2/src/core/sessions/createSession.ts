/**
 * handleCreateSession — the pure createSession endpoint logic (no Vercel, no
 * Supabase). Records a pushed shell session (today only `su`) into the
 * server-authoritative `sessions` table so the hop chain survives a refresh.
 *
 * Flow mirrors `handleAppendAuthLog`: verify the signed envelope → confirm the
 * target is the caller's OWN workstation → server-stamp `player_key` from the
 * VERIFIED pubkey → insert the row. The payload schema rejects a client-supplied
 * `player_key` outright (the server stamps it). The `session_id` is client-minted
 * (the Session.id) so a later `endSession` can target the exact row without the
 * client having to await a server-generated id.
 *
 * Scope: `su` is same-machine, so the own-workstation gate is the whole auth
 * boundary and `source_ip` is null. Cross-machine `ssh` (credential validation
 * against a foreign passwd, real `source_ip`, cascade-end) is a later epic.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { isOwnWorkstation } from '../identity/workstation';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { UserType } from '../types';
import type { SessionKind } from '../commands/types';

export type SessionRow = {
  readonly session_id: string;
  readonly player_key: string;
  readonly machine_id: string;
  readonly credentials: { readonly username: string; readonly userType: UserType };
  readonly parent_session_id: string | null;
  readonly source_ip: string | null;
  readonly kind: SessionKind;
};

export type CreateSessionDeps = {
  readonly nonceStore: NonceStore;
  readonly insertSession: (row: SessionRow) => Promise<{ readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the always-present envelope fields (action/ts/nonce) pass through;
// the refine rejects a client-supplied player_key (the server stamps it).
const createSessionSchema = z
  .looseObject({
    action: z.literal('createSession'),
    session_id: z.string().min(1),
    machine_id: z.string().min(1),
    credentials: z.object({
      username: z.string().min(1),
      userType: z.enum(['guest', 'user', 'root']),
    }),
    // Only `su` is produced today (same-machine elevation). `ssh` and the other
    // kinds widen this with their own tests when they land — accepting them now
    // would be untested, speculative validation surface.
    kind: z.literal('su'),
    parent_session_id: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload));

export const handleCreateSession = async (
  body: unknown,
  deps: CreateSessionDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, createSessionSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }

  const { publicKey, payload } = verified;
  if (!isOwnWorkstation(payload.machine_id, publicKey)) {
    return { status: 403, body: { error: 'no_session' } };
  }

  const { error } = await deps.insertSession({
    session_id: payload.session_id,
    player_key: publicKey,
    machine_id: payload.machine_id,
    credentials: payload.credentials,
    parent_session_id: payload.parent_session_id ?? null,
    source_ip: null,
    kind: payload.kind,
  });
  if (error) {
    return { status: 500, body: { error: 'insert_failed' } };
  }

  return { status: 200, body: { ok: true } };
};
