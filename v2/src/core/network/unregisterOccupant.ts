/**
 * handleUnregisterOccupant — the disconnect half of the occupancy lifecycle
 * (Story 7, slice 7.2b). Leaving a WiFi network removes the player's occupancy row
 * so they vanish from the LAN (unreachable same-LAN, matching real WiFi).
 *
 * The delete is scoped to (essid, owner_key) where `owner_key` is server-stamped
 * from the verified pubkey — a caller can only ever remove its OWN row, never
 * another occupant's (dropping the owner_key scope would wipe every occupant of the
 * AP). Idempotent: a repeat disconnect deletes nothing and still succeeds, so the
 * client can fire this best-effort without tracking whether a row exists.
 *
 * Only wired into the explicit `nmcli disconnect` — closing the tab leaves the row
 * (you stay connected, consistent with ESSID rehydration on reload).
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import type { NonceStore } from '../signedRequest/nonceStore';

export type UnregisterOccupantDeps = {
  readonly nonceStore: NonceStore;
  readonly deleteOccupant: (query: {
    readonly essid: string;
    readonly owner_key: string;
  }) => Promise<{ readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the envelope fields pass through; the refine keeps the codebase-wide
// posture that a client never claims identity — the caller IS the verified pubkey,
// so an owner_key/player_key in the payload is a forgery attempt.
const unregisterOccupantSchema = z
  .looseObject({
    action: z.literal('unregisterOccupant'),
    essid: z.string().min(1),
  })
  .refine((payload) => !('owner_key' in payload) && !('player_key' in payload));

export const handleUnregisterOccupant = async (
  body: unknown,
  deps: UnregisterOccupantDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, unregisterOccupantSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  const { error } = await deps.deleteOccupant({ essid: payload.essid, owner_key: publicKey });
  if (error) {
    return { status: 500, body: { error: 'occupant_delete_failed' } };
  }
  return { status: 200, body: { ok: true } };
};
