import type { ListPatchesParams, ListPatchesResult, PatchSummary } from './types.js';

// Adapter that maps a Supabase `.select(...).eq('player_key', me)`
// response onto the ListPatchesResult shape. Factored out of the HTTP
// handler so it can be unit-tested without a live Supabase client.
//
// Empty result and null-data both map to `{ ok: true, patches: [] }` —
// "no patches yet" is success, not failure. Any error → ok: false; the
// handler maps that to 500.

type RowError = { readonly code?: string; readonly message?: string } | null;

export type SelectPatchesFn = (params: ListPatchesParams) => Promise<{
  readonly data: ReadonlyArray<PatchSummary> | null;
  readonly error: RowError;
}>;

export const createSupabaseListPatches =
  (selectRows: SelectPatchesFn) =>
  async (params: ListPatchesParams): Promise<ListPatchesResult> => {
    const { data, error } = await selectRows(params);
    if (error) return { ok: false };
    return { ok: true, patches: data ?? [] };
  };
