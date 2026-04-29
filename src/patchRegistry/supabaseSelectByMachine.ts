import type {
  ListPatchesForMachinesParams,
  ListPatchesForMachinesResult,
  PatchSummary,
} from './types.js';

// Adapter that maps a Supabase
// `.select(...).in('machine_id', ids).order('updated_at', { ascending: true })`
// response onto the ListPatchesForMachinesResult shape. Factored out of
// the HTTP handler so it can be unit-tested without a live Supabase
// client.
//
// Cross-player read path: rows can come from any player who has written
// to one of the requested machines. The adapter is shape-only — it does
// NOT reorder. The caller (api/patches.ts) must apply ORDER BY
// updated_at ASC at the SQL layer so client-side `applyPatches`
// reduce-order yields last-write-wins per (machine_id, path).
//
// Empty result and null-data both map to `{ ok: true, patches: [] }` —
// "no patches yet" is success, not failure. Any error → ok: false; the
// handler maps that to 500.

type RowError = { readonly code?: string; readonly message?: string } | null;

export type SelectPatchesForMachinesFn = (params: ListPatchesForMachinesParams) => Promise<{
  readonly data: ReadonlyArray<PatchSummary> | null;
  readonly error: RowError;
}>;

export const createSupabaseListPatchesForMachines =
  (selectRows: SelectPatchesForMachinesFn) =>
  async (params: ListPatchesForMachinesParams): Promise<ListPatchesForMachinesResult> => {
    const { data, error } = await selectRows(params);
    if (error) return { ok: false };
    return { ok: true, patches: data ?? [] };
  };
