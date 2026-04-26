import type { InsertSessionResult, SessionRow } from './types.js';

// Adapter that maps Supabase's `.insert(...).select('session_id').single()`
// response onto the InsertSessionResult shape. Factored out of the HTTP
// handler so it can be unit-tested without a live Supabase client.
//
// Unlike ipRegistry's supabaseInsert, there's no PK-conflict handling
// here — session_id is server-generated (gen_random_uuid()) and won't
// collide. Any error → ok: false; the handler maps that to 500.

type InsertRowError = { readonly code?: string; readonly message?: string } | null;

export type InsertRowFn = (row: SessionRow) => Promise<{
  readonly data: { readonly session_id: string } | null;
  readonly error: InsertRowError;
}>;

export const createSupabaseInsertSession =
  (insertRow: InsertRowFn) =>
  async (row: SessionRow): Promise<InsertSessionResult> => {
    const { data, error } = await insertRow(row);
    if (error || !data) return { ok: false };
    return { ok: true, session_id: data.session_id };
  };
