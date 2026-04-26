import type { RemovePatchParams, RemovePatchResult } from './types.js';

// Adapter for removing a patch by exact path AND descendants (paths
// nested under it). The wiring layer issues a single DELETE with a
// PostgREST `.or()` filter:
//
//   DELETE FROM patches
//    WHERE player_key = $player_key
//      AND machine_id = $machine_id
//      AND (path = $path OR path LIKE $path_prefix || '%')
//
// We compute path_prefix here (one place) so both the exact-path arm
// and the descendant arm of the OR see consistent semantics. A path
// that already ends with '/' is left alone; otherwise we append '/' so
// the LIKE doesn't accidentally match siblings (e.g., "/foo" must not
// match "/foobar"). Used for:
//   - isNew-cleanup deletions (file the player created via patch and
//     then removed — never existed in the base fs, no marker needed)
//   - directory removals where children must also disappear

type RowError = { readonly code?: string; readonly message?: string } | null;

// Arg passed to the underlying supabase delete. Pre-computed
// path_prefix saves the wiring layer from re-deriving it.
export type DeletePatchesArg = {
  readonly player_key: string;
  readonly machine_id: string;
  readonly path: string;
  readonly path_prefix: string;
};

export type DeletePatchesFn = (arg: DeletePatchesArg) => Promise<{
  readonly data: ReadonlyArray<{ readonly path: string }> | null;
  readonly error: RowError;
}>;

export const createSupabaseRemovePatch =
  (deleteRows: DeletePatchesFn) =>
  async (params: RemovePatchParams): Promise<RemovePatchResult> => {
    const path_prefix = params.path.endsWith('/') ? params.path : params.path + '/';
    const { data, error } = await deleteRows({
      player_key: params.player_key,
      machine_id: params.machine_id,
      path: params.path,
      path_prefix,
    });
    if (error) return { ok: false };
    return { ok: true, affected: data?.length ?? 0 };
  };
