// One-time backfill: populate machine_filesystems with the BASE FS for
// every existing world_networks row (findit.io, playground, future
// themed nets). Idempotent — reruns produce no diffs (ON CONFLICT DO
// NOTHING preserves any live patch rows that dual-wrote in the
// meantime).
//
// Usage:
//   npx dotenv -e .env.development.local -- npx tsx scripts/backfillWorldNetworkBaseFs.ts [--dry-run]
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Why this script exists: world_networks rows ship via SQL migrations,
// not via API endpoints, so there's no equivalent to home networks'
// post-create hook in api/join-home-network.ts. Convention: after each
// new world_networks migration row, run this script. The first run
// after the L2 world-networks chunk lands populates every existing
// row; subsequent runs after new themed migrations populate just the
// new row (existing rows are no-ops via ON CONFLICT DO NOTHING).
//
// allRows snapshot: read once at the top and reused for every per-row
// regen. The findit.io generator reads peer rows' search_metadata +
// public_domain to build /etc/findit/index.json — passing the same
// snapshot to every iteration ensures the index is identical across
// regen calls in a single backfill pass.

import './lib/loadEnv';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { regenWorldNetworkRows } from '../src/machineFilesystems/populateWorldNetworkBaseFs';
import { createBulkInsertMachineFs } from '../src/machineFilesystems/bulkInsertMachineFs';
import type { MachineFsRow } from '../src/machineFilesystems/flattenFileNode';
import { WorldNetworkSchema, type WorldNetwork } from '../src/worldNetworks/types';
import { selectGenerator } from '../src/themedNetworks/generators/registry';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes('--dry-run');

if (!url || !serviceKey) {
  console.error(
    'Missing required env vars. Run with:\n  npx dotenv -e .env.development.local -- npx tsx scripts/backfillWorldNetworkBaseFs.ts',
  );
  process.exit(2);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

console.log(`Mode: ${dryRun ? 'DRY-RUN (no writes)' : 'LIVE'}`);

const { data, error } = await supabase
  .from('world_networks')
  .select('public_ip, seed, name, description, theme, public_domain, search_metadata')
  .order('public_ip', { ascending: true });

if (error) {
  console.error('Failed to query world_networks:', error);
  process.exit(1);
}

if (!data?.length) {
  console.log('No world_networks rows found. Nothing to backfill.');
  process.exit(0);
}

// Strict parse: any row that doesn't match the schema is a real
// schema-drift bug worth surfacing. Fail the whole run rather than
// silently skipping — a partial backfill would leave L2 in a half-
// enforced state and re-running wouldn't revisit the bad row (the
// dropped rows it COULD have produced never get a chance to retry).
const parsed = z.array(WorldNetworkSchema).safeParse(data);
if (!parsed.success) {
  console.error('world_networks rows failed schema parse:', parsed.error.issues);
  process.exit(1);
}

const allRows: ReadonlyArray<WorldNetwork> = parsed.data;
console.log(`Found ${allRows.length} world network(s).`);

let totalInserted = 0;
let totalNetworks = 0;
let failed = 0;

for (const row of allRows) {
  totalNetworks++;
  const label = `${row.public_ip} (${row.theme}${row.public_domain ? ' / ' + row.public_domain : ''})`;

  try {
    const rows = await regenWorldNetworkRows({ row, allRows, selectGenerator });
    const machineCount = new Set(rows.map((r) => r.machine_id)).size;

    if (dryRun) {
      console.log(
        `  [dry] ${label}: would insert ${rows.length} rows across ${machineCount} machines`,
      );
      totalInserted += rows.length;
      continue;
    }

    const bulkInsert = createBulkInsertMachineFs(async (chunk: readonly MachineFsRow[]) => {
      const { error: insertError } = await supabase
        .from('machine_filesystems')
        .upsert([...chunk], { onConflict: 'machine_id,path', ignoreDuplicates: true });
      return { error: insertError };
    });

    const result = await bulkInsert(rows);
    if (!result.ok) {
      console.error(`  FAIL ${label}: bulk insert failed`);
      failed++;
      continue;
    }
    console.log(`  OK   ${label}: ${rows.length} rows across ${machineCount} machines`);
    totalInserted += rows.length;
  } catch (e) {
    console.error(`  FAIL ${label}: regen threw —`, e);
    failed++;
  }
}

console.log(
  `\n${totalNetworks} networks processed; ${totalInserted} rows ${dryRun ? 'planned' : 'inserted (or pre-existing)'}; ${failed} failures.`,
);
process.exit(failed === 0 ? 0 : 1);
