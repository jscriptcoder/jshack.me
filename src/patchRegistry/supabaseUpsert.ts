import type { PatchRow, UpsertPatchResult } from './types.js';

// Adapter that maps Supabase's RPC response onto the UpsertPatchResult
// shape. Factored out of the HTTP handler so it can be unit-tested
// without a live Supabase client.
//
// The actual UPSERT lives in the `upsert_patch_with_fs` plpgsql function
// (wired in api/patches.ts), which writes to `patches` and conditionally
// dual-writes to `machine_filesystems` in the same transaction. The
// dualWrite flag is computed by the handler — false for own-workstation
// patches (excluded from machine_filesystems by design), true otherwise.
// Any error → ok: false; the handler maps that to 500.

type RowError = { readonly code?: string; readonly message?: string } | null;

export type UpsertRowFn = (
  row: PatchRow,
  dualWrite: boolean,
) => Promise<{
  readonly error: RowError;
}>;

export const createSupabaseUpsertPatch =
  (upsertRow: UpsertRowFn) =>
  async (row: PatchRow, dualWrite: boolean): Promise<UpsertPatchResult> => {
    const { error } = await upsertRow(row, dualWrite);
    if (error) return { ok: false };
    return { ok: true };
  };
