import type { ListSessionsParams, ListSessionsResult, SessionSummary } from './types.js';

// Adapter that maps Supabase's `.select(...)` response onto the
// ListSessionsResult shape. The actual query lives in api/sessions.ts
// (where we have a real supabase-js client); this module just normalizes
// the result.
//
// SQL effectively:
//   SELECT session_id, machine_id, credentials, parent_session_id,
//          source_ip, created_at
//     FROM sessions
//    WHERE player_key = $player_key
//      AND ended_at IS NULL
//    ORDER BY created_at ASC
//
// Empty result is success — players with no active sessions get
// { ok: true, sessions: [] }, not an error.

type QueryRowError = { readonly code?: string; readonly message?: string } | null;

export type QueryRowsFn = (params: ListSessionsParams) => Promise<{
  readonly data: ReadonlyArray<SessionSummary> | null;
  readonly error: QueryRowError;
}>;

export const createSupabaseListSessions =
  (queryRows: QueryRowsFn) =>
  async (params: ListSessionsParams): Promise<ListSessionsResult> => {
    const { data, error } = await queryRows(params);
    if (error) return { ok: false };
    return { ok: true, sessions: data ?? [] };
  };
