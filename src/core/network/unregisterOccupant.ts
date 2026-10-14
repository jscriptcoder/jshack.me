/**
 * handleUnregisterOccupant — the disconnect half of the occupancy lifecycle. Leaving
 * a WiFi network removes the player's occupancy row so they vanish from the LAN
 * (unreachable same-LAN, matching real WiFi).
 *
 * The delete is scoped to (essid, owner_key) where `owner_key` is server-stamped
 * from the verified pubkey — a caller can only ever remove its OWN row, never
 * another occupant's (dropping the owner_key scope would wipe every occupant of the
 * AP). Idempotent: a repeat disconnect deletes nothing and still succeeds, so the
 * client can fire this best-effort without tracking whether a row exists.
 *
 * Only wired into the explicit `nmcli disconnect` — closing the tab leaves the row
 * (you stay connected, consistent with ESSID rehydration on reload).
 *
 * A box that leaves the network drops every connection through it. The session rows other
 * players hold on the box close with the occupancy row, and so does every session they
 * opened from it, because a row that outlived the box's place on the WiFi kept placing
 * its holder on that network, at no address: every door they knocked on from it
 * recorded `unknown`. The owner's rows on every OTHER machine close too: each was opened
 * across the network the box just left, and one left open still answered a request
 * signed outside the game. The owner's own rows on their box stay open — taking a
 * machine off the WiFi is not logging out of it. The row is deleted FIRST, so nobody can
 * log in between the two steps and keep a session the disconnect was meant to end.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import type { EndReason } from '../sessions/endSession.js';
import {
  endChainsAbove,
  type EndedSession,
  type EndSessionsAbove,
} from '../sessions/upstreamLost.js';

export type LeavingBoxParams = {
  readonly machine_id: string;
  /** Whose box it is: their rows on it stay open, and their rows anywhere else close. */
  readonly owner_key: string;
  readonly reason: EndReason;
};

export type UnregisterOccupantDeps = {
  readonly nonceStore: NonceStore;
  /** Answers with the row it removed, which names the box that just left; `null` when
   *  the caller was not on that network. */
  readonly deleteOccupant: (query: {
    readonly essid: string;
    readonly owner_key: string;
  }) => Promise<{
    readonly data: { readonly workstation_machine_id: string } | null;
    readonly error: unknown;
  }>;
  /** Close every open row on the box that is not its owner's, answering with the rows
   *  it closed, which are where the chains above them start. */
  readonly endVisitorSessions: (
    params: LeavingBoxParams,
  ) => Promise<{ readonly data: readonly EndedSession[] | null; readonly error: unknown }>;
  /** Close every open row the owner holds on any machine but the box, answering with the
   *  rows it closed: each was opened across the network the box just left. */
  readonly endOwnSessionsAway: (
    params: LeavingBoxParams,
  ) => Promise<{ readonly data: readonly EndedSession[] | null; readonly error: unknown }>;
  readonly endSessionsAbove: EndSessionsAbove;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

export type DropConnectionsDeps = Pick<
  UnregisterOccupantDeps,
  'endVisitorSessions' | 'endOwnSessionsAway' | 'endSessionsAbove'
>;

/**
 * Close every connection that ran through a box that just left a network, both ways:
 * other players' rows on it, the owner's rows on every other machine, and every chain
 * built on any of those. The owner's own rows on the box stay open. `false` when any of
 * it could not be closed. Shared by the disconnect and by a join that moves the box off
 * the network it was on.
 */
export const dropConnectionsThrough = async (
  deps: DropConnectionsDeps,
  box: { readonly machine_id: string; readonly owner_key: string },
): Promise<boolean> => {
  const visitors = await deps.endVisitorSessions({ ...box, reason: 'network_left' });
  if (visitors.error) return false;
  const ownAway = await deps.endOwnSessionsAway({ ...box, reason: 'network_left' });
  if (ownAway.error) return false;
  const chains = await endChainsAbove(deps.endSessionsAbove, [
    ...(visitors.data ?? []),
    ...(ownAway.data ?? []),
  ]);
  return chains.ok;
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

  const left = await deps.deleteOccupant({ essid: payload.essid, owner_key: publicKey });
  if (left.error) {
    return { status: 500, body: { error: 'occupant_delete_failed' } };
  }
  if (left.data === null) return { status: 200, body: { ok: true } };

  // Loud, as a reboot's is: a disconnect that left a visitor's row open tells the owner
  // they are clear while the visitor still stands on their network.
  const dropped = await dropConnectionsThrough(deps, {
    machine_id: left.data.workstation_machine_id,
    owner_key: publicKey,
  });
  if (!dropped) {
    return { status: 500, body: { error: 'sessions_end_failed' } };
  }
  return { status: 200, body: { ok: true } };
};
