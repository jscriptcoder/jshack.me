import type { EndSessionParams, EndSessionResult } from './types.js';

// Adapter that maps Supabase's `.update(...)...select(...)` response onto
// the EndSessionResult shape. The actual update query lives in api/sessions.ts
// (where we have a real supabase-js client); this module just normalizes
// the result.
//
// SQL effectively:
//   UPDATE sessions
//      SET ended_at = NOW(), end_reason = $reason
//    WHERE session_id = $session_id
//      AND player_key = $player_key      -- non-owner attempts → 0 rows
//      AND ended_at IS NULL              -- already-ended → 0 rows
//    RETURNING session_id
//
// affected reflects the number of rows the WHERE matched. The handler maps
// affected = 0 → 404 (collapses "not found", "not yours", "already ended").

type UpdateRowError = { readonly code?: string; readonly message?: string } | null;

export type EndSessionRowFn = (params: EndSessionParams) => Promise<{
  readonly data: ReadonlyArray<{ readonly session_id: string }> | null;
  readonly error: UpdateRowError;
}>;

export const createSupabaseEndSession =
  (endRow: EndSessionRowFn) =>
  async (params: EndSessionParams): Promise<EndSessionResult> => {
    const { data, error } = await endRow(params);
    if (error) return { ok: false };
    return { ok: true, affected: data?.length ?? 0 };
  };
