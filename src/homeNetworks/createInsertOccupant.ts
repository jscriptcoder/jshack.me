import type { HomeNetworkOccupantRow, InsertOccupantResult } from './types.js';

// Postgres error code for unique_violation. The schema has three unique
// constraints on home_network_occupants:
//   - PRIMARY KEY (network_id, player_key) — race after idempotent pre-check
//   - UNIQUE (network_id, lan_ip)          — random allocation collision (retry)
//   - UNIQUE (network_id, hostname)        — identity-derived collision (bail)
// We discriminate by the constraint/column name in the error so the handler
// can route correctly (retry vs bail).
const PG_UNIQUE_VIOLATION = '23505';

type InsertRowError = {
  readonly code?: string;
  readonly message?: string;
  readonly details?: string;
} | null;

export type InsertOccupantRowFn = (
  row: HomeNetworkOccupantRow,
) => Promise<{ readonly error: InsertRowError }>;

// Adapter that maps Supabase insert errors onto InsertOccupantResult. Mirrors
// createSupabaseInsertIp from src/ipRegistry — factored out of the HTTP
// handler so it can be unit-tested without a live Supabase client.
//
// Constraint detection is substring-based on the error message: Postgres
// auto-names unique constraints `<table>_<col1>_<col2>_..._key`, so the
// presence of `lan_ip` or `hostname` in the message reliably distinguishes
// the two retryable-vs-bail outcomes.
export const createInsertOccupant =
  (insertRow: InsertOccupantRowFn) =>
  async (row: HomeNetworkOccupantRow): Promise<InsertOccupantResult> => {
    const { error } = await insertRow(row);
    if (error === null) return 'ok';
    if (error.code !== PG_UNIQUE_VIOLATION) return 'error';
    const message = error.message ?? '';
    if (message.includes('lan_ip')) return 'lan_ip_conflict';
    if (message.includes('hostname')) return 'hostname_conflict';
    return 'error';
  };
