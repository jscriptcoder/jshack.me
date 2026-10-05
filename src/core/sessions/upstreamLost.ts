/**
 * A chain breaks where a hop goes down, and nowhere else. Each session a player
 * pushes names the one beneath it (`parent_session_id`), so when a session ends for
 * a reason the player did not choose, every session stacked above it through that
 * hop ends too — `upstream_lost`, a reason only the server ever writes.
 */

import type { EndReason } from './endSession.js';

/** A row a server-side act just closed, and whose it was. */
export type EndedSession = {
  readonly session_id: string;
  readonly player_key: string;
};

export type EndSessionsAboveParams = {
  readonly player_key: string;
  readonly parent_ids: readonly string[];
  readonly reason: EndReason;
};

/** Close that player's open rows whose parent is one of `parent_ids`, answering
 *  with the ids it closed. */
export type EndSessionsAbove = (
  params: EndSessionsAboveParams,
) => Promise<{ readonly data: readonly string[] | null; readonly error: unknown }>;

export type FindEndedSessionsQuery = {
  readonly player_key: string;
  readonly session_ids: readonly string[];
};

/** Which of `session_ids` name a row of this player's that has ended. */
export type FindEndedSessions = (
  query: FindEndedSessionsQuery,
) => Promise<{ readonly data: readonly string[] | null; readonly error: unknown }>;

/** On success, every session the walk closed. */
export type ChainsEnded =
  | { readonly ok: true; readonly closed: ReadonlySet<string> }
  | { readonly ok: false };

/**
 * End every open session stacked above `ended`, one rung at a time, until a rung
 * closes nothing. It terminates because each rung closes only rows still open.
 *
 * Kept inside each player's own chain: every first hop names the same parent (the
 * base login, which has no row) and a session id is whatever its client minted, so
 * a crafted row closed here must reach nobody's sessions but its owner's.
 */
export const endChainsAbove = async (
  endSessionsAbove: EndSessionsAbove,
  ended: readonly EndedSession[],
): Promise<ChainsEnded> => {
  const players = [...new Set(ended.map((row) => row.player_key))];
  const closed = new Set<string>();
  for (const playerKey of players) {
    let rung = ended.filter((row) => row.player_key === playerKey).map((row) => row.session_id);
    while (rung.length > 0) {
      const { data, error } = await endSessionsAbove({
        player_key: playerKey,
        parent_ids: rung,
        reason: 'upstream_lost',
      });
      if (error) return { ok: false };
      rung = [...(data ?? [])];
      rung.forEach((sessionId) => closed.add(sessionId));
    }
  }
  return { ok: true, closed };
};
