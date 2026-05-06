import { z } from 'zod';
import { filePermissionsSchema, type FilePermissions, type UserType } from './types.js';

// Bulk variant of supabaseFindMachineFs — fetches every (machine_id,
// path, owner, permissions) row whose machine_id is in the requested
// set, in a single SQL round-trip. The read-path filter
// (handleListPatchesForMachines) needs perms for both target paths and
// every ancestor on each requested machine; calling the single-row
// adapter once per (machine, path) would be O(rows × depth) round-trips.
//
// Strict parse posture matches the single-row adapter: any malformed
// row poisons the batch with ok: false. The handler then short-circuits
// to 500 rather than acting on partial data — preferable to silently
// permitting rows that the walker can't reason about.
//
// Empty machine_ids short-circuits without hitting the DB. Some Postgres
// setups reject `WHERE machine_id IN ()` as a syntax error; even where
// they don't, the round-trip is wasted.

type RowError = { readonly code?: string; readonly message?: string } | null;

const userTypeSchema = z.enum(['root', 'user', 'guest']);

export type FindMachineFsBatchParams = {
  readonly machine_ids: ReadonlyArray<string>;
};

export type MachineFsRow = {
  readonly machine_id: string;
  readonly path: string;
  readonly owner: UserType;
  readonly permissions: FilePermissions;
};

export type FindMachineFsBatchResult =
  | { readonly ok: true; readonly rows: ReadonlyArray<MachineFsRow> }
  | { readonly ok: false };

export type FindMachineFsBatchFn = (params: FindMachineFsBatchParams) => Promise<{
  readonly data: ReadonlyArray<{
    readonly machine_id: unknown;
    readonly path: unknown;
    readonly owner: unknown;
    readonly permissions: unknown;
  }> | null;
  readonly error: RowError;
}>;

const machineFsBatchRowSchema = z
  .object({
    machine_id: z.string().min(1),
    path: z.string().min(1),
    owner: userTypeSchema,
    permissions: filePermissionsSchema,
  })
  .strict();

export const createSupabaseFindMachineFsBatch =
  (query: FindMachineFsBatchFn) =>
  async (params: FindMachineFsBatchParams): Promise<FindMachineFsBatchResult> => {
    if (params.machine_ids.length === 0) return { ok: true, rows: [] };
    const { data, error } = await query(params);
    if (error) return { ok: false };
    if (!data) return { ok: true, rows: [] };
    const parsed = z.array(machineFsBatchRowSchema).safeParse(data);
    if (!parsed.success) return { ok: false };
    return { ok: true, rows: parsed.data };
  };
