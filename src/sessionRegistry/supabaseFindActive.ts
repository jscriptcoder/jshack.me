// Adapter for the L1 patch-validation gate's session lookup. Translates
// a Supabase select-by-(player_key, machine_id, ended_at IS NULL) response
// into a discriminated FindActiveSessionResult.
//
// The wiring layer (api/patches.ts) issues:
//
//   SELECT session_id, credentials FROM sessions
//    WHERE player_key = $player_key
//      AND machine_id = $machine_id
//      AND ended_at IS NULL
//    LIMIT 1;
//
// hitting the existing `sessions_active_by_player_idx` partial index.
// L1 only consumes `exists`; L2 (Step 6+) consumes the parsed
// credentials to drive the shared permission walker. Strict zod parse
// of the credentials JSONB ensures stored mis-shapes (legacy rows or
// hand-written ones) fail closed at this boundary instead of leaking
// upstream as `userType: undefined`.

import { credentialsSchema, type Credentials } from './types.js';

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
//
// On exists: true the verified credentials (username, userType) are
// returned so the L2 walker can key its decision on a trusted server-
// side projection. The credentials field is omitted from exists: false
// to keep the shape narrow at the type level.
export type FindActiveSessionResult =
  | { readonly ok: true; readonly exists: false }
  | { readonly ok: true; readonly exists: true; readonly credentials: Credentials }
  | { readonly ok: false };

export type FindActiveSessionFn = (params: FindActiveSessionParams) => Promise<{
  readonly data: ReadonlyArray<{
    readonly session_id: string;
    readonly credentials: unknown;
  }> | null;
  readonly error: RowError;
}>;

export const createSupabaseFindActiveSession =
  (query: FindActiveSessionFn) =>
  async (params: FindActiveSessionParams): Promise<FindActiveSessionResult> => {
    const { data, error } = await query(params);
    if (error) return { ok: false };
    const row = data?.[0];
    if (!row) return { ok: true, exists: false };
    const parsed = credentialsSchema.safeParse(row.credentials);
    if (!parsed.success) return { ok: false };
    return { ok: true, exists: true, credentials: parsed.data };
  };
