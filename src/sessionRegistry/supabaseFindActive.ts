// Adapter for the L1 patch-validation gate's session lookup. Translates
// a Supabase `.select('session_id').eq(...).is('ended_at', null).limit(1)`
// response into a discriminated FindActiveSessionResult.
//
// The wiring layer (api/patches.ts) issues:
//
//   SELECT session_id FROM sessions
//    WHERE player_key = $player_key
//      AND machine_id = $machine_id
//      AND ended_at IS NULL
//    LIMIT 1;
//
// hitting the existing `sessions_active_by_player_idx` partial index.
// We don't need the row contents — only "does at least one row exist?".

type RowError = { readonly code?: string; readonly message?: string } | null;

export type FindActiveSessionParams = {
  readonly player_key: string;
  readonly machine_id: string;
};

// Discriminated union — `ok: false` distinguishes a DB error (the
// lookup itself failed, returns 500) from `ok: true, exists: false`
// (lookup succeeded, no session, returns 403). Don't collapse the
// two: a server outage masquerading as 403 would mislead clients,
// and 500 fail-open (treating DB error as exists:true) breaks the
// security boundary.
export type FindActiveSessionResult =
  | { readonly ok: true; readonly exists: boolean }
  | { readonly ok: false };

export type FindActiveSessionFn = (params: FindActiveSessionParams) => Promise<{
  readonly data: ReadonlyArray<{ readonly session_id: string }> | null;
  readonly error: RowError;
}>;

export const createSupabaseFindActiveSession =
  (query: FindActiveSessionFn) =>
  async (params: FindActiveSessionParams): Promise<FindActiveSessionResult> => {
    const { data, error } = await query(params);
    if (error) return { ok: false };
    return { ok: true, exists: (data?.length ?? 0) > 0 };
  };
