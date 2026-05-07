import type { PatchRow, UpsertPatchResult } from './types.js';
import { shouldProjectFsContent } from '../machineFilesystems/projectedContentPaths.js';

// Adapter that maps Supabase's RPC response onto the UpsertPatchResult
// shape. Factored out of the HTTP handler so it can be unit-tested
// without a live Supabase client.
//
// The actual UPSERT lives in the `upsert_patch_with_fs` plpgsql function
// (wired in api/patches.ts), which writes to `patches` and conditionally
// dual-writes to `machine_filesystems` in the same transaction. The
// dualWrite flag is computed by the handler — false for own-workstation
// patches (excluded from machine_filesystems by design), true otherwise.
//
// projectFsContent is computed here from the path: true only for paths
// in the FS projection allowlist (currently /etc/passwd). The SQL
// function reads the flag and stores content selectively, keeping the
// machine_filesystems table tight for the bulk of non-projected paths.
// Any error → ok: false; the handler maps that to 500.

type RowError = { readonly code?: string; readonly message?: string } | null;

export type UpsertRowFn = (
  row: PatchRow,
  dualWrite: boolean,
  projectFsContent: boolean,
) => Promise<{
  readonly error: RowError;
}>;

export const createSupabaseUpsertPatch =
  (upsertRow: UpsertRowFn) =>
  async (row: PatchRow, dualWrite: boolean): Promise<UpsertPatchResult> => {
    const projectFsContent = shouldProjectFsContent(row.path);
    const { error } = await upsertRow(row, dualWrite, projectFsContent);
    if (error) return { ok: false };
    return { ok: true };
  };
