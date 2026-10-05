/**
 * An in-memory `sessions` table standing in for the SQL glue, so a test reads back
 * WHY each row closed rather than which calls were made:
 *
 *     const table = sessionTable([sessionRow({ session_id: 'hop-p', machine_id: BOX })]);
 *     await handleRebootMachine(envelope, makeDeps(table));
 *     expect(table.reasonOf('hop-p')).toBe('rebooted');
 *
 * Every update touches only rows still open, as the real ones do (`ended_at IS NULL`),
 * so a row keeps the first reason it was closed with.
 */

import type { EndReason } from '../../core/sessions/endSession.js';
import type { SessionSummary } from '../../core/sessions/listSessions.js';
import type {
  EndedSession,
  EndSessionsAboveParams,
  FindEndedSessionsQuery,
} from '../../core/sessions/upstreamLost.js';

export type SessionRow = SessionSummary & {
  readonly player_key: string;
  /** Set on a row that was already closed before the test acts. */
  readonly ended?: EndReason;
};

export const sessionRow = (over: Partial<SessionRow> = {}): SessionRow => ({
  session_id: 'ssh-root-1700000000000',
  player_key: 'bob-key',
  machine_id: 'darkstar-12345678',
  credentials: { username: 'root', userType: 'root' },
  parent_session_id: 'seed-session',
  source_ip: null,
  kind: 'ssh',
  created_at: '2026-06-07T14:32:01.000Z',
  essid: 'TYRELL-CORP',
  ...over,
});

const summaryOf = ({
  player_key: _player,
  ended: _ended,
  ...summary
}: SessionRow): SessionSummary => summary;

export const sessionTable = (rows: readonly SessionRow[]) => {
  const reasons = new Map<string, EndReason>(
    rows.flatMap((row) => (row.ended === undefined ? [] : [[row.session_id, row.ended] as const])),
  );
  const isOpen = (row: SessionRow): boolean => !reasons.has(row.session_id);
  const close = (matching: readonly SessionRow[], reason: EndReason): readonly SessionRow[] => {
    matching.forEach((row) => reasons.set(row.session_id, reason));
    return matching;
  };

  return {
    /** Why the row closed, or `undefined` while it is still open. */
    reasonOf: (sessionId: string): EndReason | undefined => reasons.get(sessionId),

    endMachineSessions: async (params: { machine_id: string; reason: EndReason }) => ({
      data: close(
        rows.filter((row) => isOpen(row) && row.machine_id === params.machine_id),
        params.reason,
      ).map((row): EndedSession => ({ session_id: row.session_id, player_key: row.player_key })),
      error: null,
    }),

    endSessionsAbove: async (params: EndSessionsAboveParams) => ({
      data: close(
        rows.filter(
          (row) =>
            isOpen(row) &&
            row.player_key === params.player_key &&
            row.parent_session_id !== null &&
            params.parent_ids.includes(row.parent_session_id),
        ),
        params.reason,
      ).map((row) => row.session_id),
      error: null,
    }),

    findEndedSessions: async (query: FindEndedSessionsQuery) => ({
      data: rows
        .filter(
          (row) =>
            !isOpen(row) &&
            row.player_key === query.player_key &&
            query.session_ids.includes(row.session_id),
        )
        .map((row) => row.session_id),
      error: null,
    }),

    listSessions: async (query: { player_key: string }) => ({
      data: rows.filter((row) => isOpen(row) && row.player_key === query.player_key).map(summaryOf),
      error: null,
    }),
  };
};
