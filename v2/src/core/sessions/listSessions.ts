/**
 * handleListSessions — the pure listSessions endpoint logic (no Vercel, no
 * Supabase). Returns the caller's OWN active sessions so the hop chain can be
 * rebuilt on boot.
 *
 * Thin by design: verify the signed envelope → confirm own workstation →
 * server-stamp `player_key` from the VERIFIED pubkey → return what the scoped
 * query gives back. Two concerns live OUTSIDE this handler on purpose:
 *   - the `ended_at IS NULL` active filter is in the SQL glue (api/sessions),
 *   - ordering by `created_at` is done defensively in the `sessionRehydrate`
 *     rebuild, so correctness never depends on the server's row order.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { isOwnWorkstation } from '../identity/workstation';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { UserType } from '../types';
import type { SessionKind } from '../commands/types';

export type SessionSummary = {
  readonly session_id: string;
  readonly machine_id: string;
  readonly credentials: { readonly username: string; readonly userType: UserType };
  readonly parent_session_id: string | null;
  readonly source_ip: string | null;
  readonly kind: SessionKind;
  /** ISO-8601 timestamp the DB stamped at insert. */
  readonly created_at: string;
};

export type ListSessionsQuery = {
  readonly player_key: string;
  readonly machine_id: string;
};

export type ListSessionsDeps = {
  readonly nonceStore: NonceStore;
  readonly listSessions: (
    query: ListSessionsQuery,
  ) => Promise<{ readonly data: readonly SessionSummary[] | null; readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

const listSessionsSchema = z
  .looseObject({
    action: z.literal('listSessions'),
    machine_id: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload));

export const handleListSessions = async (
  body: unknown,
  deps: ListSessionsDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, listSessionsSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }

  const { publicKey, payload } = verified;
  if (!isOwnWorkstation(payload.machine_id, publicKey)) {
    return { status: 403, body: { error: 'no_session' } };
  }

  const { data, error } = await deps.listSessions({
    player_key: publicKey,
    machine_id: payload.machine_id,
  });
  if (error) {
    return { status: 500, body: { error: 'read_failed' } };
  }

  return { status: 200, body: { sessions: data ?? [] } };
};
