import type { InsertResult, IpRow } from './types.js';

// Postgres error code for unique_violation — thrown when an INSERT hits the
// PK constraint on public_ips.ip. Treat this as 'conflict' so the allocator
// re-rolls.
const PG_UNIQUE_VIOLATION = '23505';

type InsertRowError = { readonly code?: string; readonly message?: string } | null;

export type InsertRowFn = (row: IpRow) => Promise<{ readonly error: InsertRowError }>;

// Adapter that maps Supabase insert errors onto the InsertResult enum.
// Factored out of the HTTP handler so it can be unit-tested without a live
// Supabase client.
export const createSupabaseInsertIp =
  (insertRow: InsertRowFn) =>
  async (row: IpRow): Promise<InsertResult> => {
    const { error } = await insertRow(row);
    if (error === null) return 'ok';
    if (error.code === PG_UNIQUE_VIOLATION) return 'conflict';
    return 'error';
  };
