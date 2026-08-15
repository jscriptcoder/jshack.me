/**
 * handleEndSession — the pure endSession endpoint logic (no Vercel, no
 * Supabase). Marks a pushed session ended (sets `ended_at`) when the player
 * `exit`s it, so a de-elevation survives a refresh: the next `listSessions`
 * omits it and the hop chain rebuilds without it.
 *
 * Ownership is enforced by SCOPING the update to the verified `player_key`
 * (stamped from the envelope, never a client claim): a caller can only end
 * their OWN sessions. A `session_id` that doesn't belong to the caller updates
 * zero rows — a harmless no-op — so the handler stays idempotent (200). The
 * `ended_at`/`end_reason` stamp itself lives in the SQL glue (api/sessions).
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import type { NonceStore } from '../signedRequest/nonceStore';

/** Why a session stopped. `user_exit` is the player closing it themselves —
 *  `exit` from a hop, `quit` from an ftp prompt. `abandoned` is a boot finding no
 *  owner for an active parallel session and closing it on the lost terminal's
 *  behalf. A closed enum rather than free text: the client picks the value, so
 *  the column must not become somewhere a client can write whatever it likes. */
export const END_REASONS = ['user_exit', 'abandoned'] as const;
export type EndReason = (typeof END_REASONS)[number];

export type EndSessionParams = {
  readonly session_id: string;
  readonly player_key: string;
  readonly reason: EndReason;
};

export type EndSessionDeps = {
  readonly nonceStore: NonceStore;
  readonly endSession: (params: EndSessionParams) => Promise<{ readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

const endSessionSchema = z
  .looseObject({
    action: z.literal('endSession'),
    session_id: z.string().min(1),
    // Absent means the ordinary case, so every shipped caller keeps working
    // unchanged and only the boot sweep has to say what it is doing.
    reason: z.enum(END_REASONS).default('user_exit'),
  })
  .refine((payload) => !('player_key' in payload));

export const handleEndSession = async (
  body: unknown,
  deps: EndSessionDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, endSessionSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }

  const { publicKey, payload } = verified;
  const { error } = await deps.endSession({
    session_id: payload.session_id,
    player_key: publicKey,
    reason: payload.reason,
  });
  if (error) {
    return { status: 500, body: { error: 'update_failed' } };
  }

  return { status: 200, body: { ok: true } };
};
