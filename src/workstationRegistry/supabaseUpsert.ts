import type { UpsertWorkstationResult, WorkstationRow } from './types.js';

// Adapter that maps Supabase's upsert + read-back flow onto
// UpsertWorkstationResult. Factored out of the HTTP handler so it can
// be unit-tested without a live Supabase client (mirrors
// sessionRegistry/supabaseInsert.ts and ipRegistry/supabaseInsert.ts).
//
// The flow:
//   1. INSERT ... ON CONFLICT (player_key) DO NOTHING via Supabase's
//      `.upsert(row, { onConflict: 'player_key', ignoreDuplicates: true })
//      .select('*')`. When the row is fresh, .select returns it; on
//      conflict, ignoreDuplicates drops the row silently and .select
//      returns an empty array.
//   2. If the insert returned 0 rows, SELECT the existing row to read
//      back (workstation_name, username) for the idempotency
//      comparison the handler does.
//
// Either DB call failing collapses to ok: false; the handler maps that
// to 500 upsert_failed. We don't try to distinguish "PK conflict" from
// other errors — the result type only carries what the handler needs
// to decide between 201/200/409.

type RowError = { readonly code?: string; readonly message?: string } | null;

export type UpsertRowFn = (row: WorkstationRow) => Promise<{
  readonly data: ReadonlyArray<WorkstationRow> | null;
  readonly error: RowError;
}>;

export type SelectExistingFn = (player_key: string) => Promise<{
  readonly data: WorkstationRow | null;
  readonly error: RowError;
}>;

export const createSupabaseUpsertWorkstation =
  (upsertRow: UpsertRowFn, selectExisting: SelectExistingFn) =>
  async (row: WorkstationRow): Promise<UpsertWorkstationResult> => {
    const { data: insertedRows, error: insertError } = await upsertRow(row);
    if (insertError) return { ok: false };
    if (insertedRows && insertedRows.length > 0) {
      return { ok: true, inserted: true };
    }

    // Conflict-dropped — read back the existing row so the handler can
    // compare immutable fields.
    const { data: existing, error: selectError } = await selectExisting(row.player_key);
    if (selectError || !existing) return { ok: false };
    return {
      ok: true,
      inserted: false,
      existing: {
        workstation_name: existing.workstation_name,
        username: existing.username,
      },
    };
  };
