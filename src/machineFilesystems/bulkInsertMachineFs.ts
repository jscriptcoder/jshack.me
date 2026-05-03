import type { MachineFsRow } from './flattenFileNode';

// Bulk insert into machine_filesystems with conflict-ignored semantics.
// The wiring layer provides a bulkInsertFn that issues:
//
//   INSERT INTO machine_filesystems (...) VALUES (...), (...), ...
//   ON CONFLICT (machine_id, path) DO NOTHING;
//
// — typically via Supabase's `.upsert(rows, { onConflict, ignoreDuplicates: true })`.
//
// "Do nothing" on conflict is load-bearing: existing rows in
// machine_filesystems were either (a) dual-written from a player patch
// (current state — must not clobber with stale base FS) or (b) inserted
// by a prior backfill run (idempotent re-run produces no diff). The
// backfill establishes a floor; live patches always win.
//
// Chunked because Postgres / pgbouncer have practical query-size limits
// and a fully-flattened home-network FS can run into the thousands of
// rows. 500/chunk is comfortably below typical limits while keeping
// round-trips low.

const CHUNK_SIZE = 500;

type RowError = { readonly code?: string; readonly message?: string } | null;

export type BulkInsertMachineFsFn = (
  rows: readonly MachineFsRow[],
) => Promise<{ readonly error: RowError }>;

export type BulkInsertResult =
  | { readonly ok: true; readonly inserted: number }
  | { readonly ok: false };

export const createBulkInsertMachineFs =
  (bulkInsertFn: BulkInsertMachineFsFn) =>
  async (rows: readonly MachineFsRow[]): Promise<BulkInsertResult> => {
    if (rows.length === 0) return { ok: true, inserted: 0 };
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const { error } = await bulkInsertFn(chunk);
      if (error) return { ok: false };
    }
    return { ok: true, inserted: rows.length };
  };
