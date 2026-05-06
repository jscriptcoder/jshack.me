// Bulk variant of supabaseFindActiveSession — returns the requester's
// active credentials for every machine in the requested set, keyed by
// machine_id. The wiring layer (api/patches.ts) issues:
//
//   SELECT machine_id, credentials FROM sessions
//    WHERE player_key = $player_key
//      AND machine_id = ANY($machine_ids)
//      AND ended_at IS NULL
//    ORDER BY created_at DESC;
//
// The read-path filter (handleListPatchesForMachines) consumes this map
// to dispatch tier 2 (session + walker) vs tier 3 (no-session +
// allowlist) per machine_id. Single round-trip vs. one-per-machine.
//
// Stacked sessions: pushSession (su / nested ssh / exploit) doesn't end
// the prior server-side session, so a player can hold multiple active
// rows for the same (player, machine). The SQL ORDER BY created_at DESC
// puts the newest row first; the adapter takes first-write-wins so the
// foreground (most-recent) session's userType drives the filter — the
// same tier the player's UI is in. After exit/popSession, the most
// recent ended_at !=NULL row drops out and the next-newest active row
// becomes foreground naturally.
//
// Strict parse posture mirrors the single-row adapter: any malformed
// credentials JSONB poisons the batch so handler maps to 500 rather
// than acting on partial data. ended_at filter is enforced at the SQL
// layer; the adapter assumes the query already restricts to active
// rows.

import { credentialsSchema, type Credentials } from './types.js';

type RowError = { readonly code?: string; readonly message?: string } | null;

export type FindActiveSessionsBatchParams = {
  readonly player_key: string;
  readonly machine_ids: ReadonlyArray<string>;
};

export type FindActiveSessionsBatchResult =
  | {
      readonly ok: true;
      readonly sessionsByMachine: ReadonlyMap<string, Credentials>;
    }
  | { readonly ok: false };

export type FindActiveSessionsBatchFn = (params: FindActiveSessionsBatchParams) => Promise<{
  readonly data: ReadonlyArray<{
    readonly machine_id: string;
    readonly credentials: unknown;
  }> | null;
  readonly error: RowError;
}>;

export const createSupabaseFindActiveSessionsBatch =
  (query: FindActiveSessionsBatchFn) =>
  async (params: FindActiveSessionsBatchParams): Promise<FindActiveSessionsBatchResult> => {
    if (params.machine_ids.length === 0) {
      return { ok: true, sessionsByMachine: new Map() };
    }
    const { data, error } = await query(params);
    if (error) return { ok: false };
    if (!data) return { ok: true, sessionsByMachine: new Map() };

    const sessionsByMachine = new Map<string, Credentials>();
    for (const row of data) {
      const parsed = credentialsSchema.safeParse(row.credentials);
      if (!parsed.success) return { ok: false };
      // First-write-wins on each machine_id: the SQL ORDER BY created_at
      // DESC put the newest row first, so the foreground session's
      // credentials are kept and any older stacked sessions are skipped.
      if (!sessionsByMachine.has(row.machine_id)) {
        sessionsByMachine.set(row.machine_id, parsed.data);
      }
    }
    return { ok: true, sessionsByMachine };
  };
