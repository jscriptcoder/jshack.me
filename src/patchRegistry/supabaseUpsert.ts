import type { PatchRow, UpsertPatchResult } from './types.js';

// Adapter that maps Supabase's `.upsert(row, { onConflict: ... })`
// response onto the UpsertPatchResult shape. Factored out of the HTTP
// handler so it can be unit-tested without a live Supabase client.
//
// The actual `ON CONFLICT (player_key, machine_id, path) DO UPDATE`
// happens at the wiring layer (api/patches.ts); here we only translate
// the response. Any error → ok: false; the handler maps that to 500.

type RowError = { readonly code?: string; readonly message?: string } | null;

export type UpsertRowFn = (row: PatchRow) => Promise<{
  readonly error: RowError;
}>;

export const createSupabaseUpsertPatch =
  (upsertRow: UpsertRowFn) =>
  async (row: PatchRow): Promise<UpsertPatchResult> => {
    const { error } = await upsertRow(row);
    if (error) return { ok: false };
    return { ok: true };
  };
