// One-time backfill: populate machine_filesystems with the BASE FS for
// every existing home_networks row. Idempotent — reruns produce no
// diffs (ON CONFLICT DO NOTHING preserves any live patch rows that
// dual-wrote in the meantime).
//
// Usage:
//   npx dotenv -e .env.development.local -- npx tsx scripts/backfillHomeNetworkBaseFs.ts [--dry-run]
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Why this script exists: home_networks created BEFORE the L2 base-FS
// backfill landed have no machine_filesystems rows for their base FS,
// so L2 today falls back to "allow" (the leaf-only gap). Running this
// once after deploy populates them; the new createNetwork hook handles
// go-forward home networks automatically. World networks need an
// analogous script (deferred follow-up). Mission machines stay leaf-
// only until server-side mission_instances lands (also deferred —
// captured in plans/l2-patch-validation.md).

import { createClient } from '@supabase/supabase-js';
import { regenHomeNetworkRows } from '../src/machineFilesystems/populateHomeNetworkBaseFs';
import { createBulkInsertMachineFs } from '../src/machineFilesystems/bulkInsertMachineFs';
import type { MachineFsRow } from '../src/machineFilesystems/flattenFileNode';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes('--dry-run');

if (!url || !serviceKey) {
  console.error(
    'Missing required env vars. Run with:\n  npx dotenv -e .env.development.local -- npx tsx scripts/backfillHomeNetworkBaseFs.ts',
  );
  process.exit(2);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

console.log(`Mode: ${dryRun ? 'DRY-RUN (no writes)' : 'LIVE'}`);

const { data: networks, error } = await supabase
  .from('home_networks')
  .select('public_ip, seed, essid_template')
  .order('created_at', { ascending: true });

if (error) {
  console.error('Failed to query home_networks:', error);
  process.exit(1);
}

if (!networks?.length) {
  console.log('No home_networks rows found. Nothing to backfill.');
  process.exit(0);
}

console.log(`Found ${networks.length} home network(s).`);

let totalInserted = 0;
let totalNetworks = 0;
let failed = 0;

for (const net of networks) {
  const publicIp = net.public_ip as string;
  const seed = net.seed as string;
  const essidTemplate = net.essid_template as string;
  totalNetworks++;

  try {
    const rows = await regenHomeNetworkRows({ seed, publicIp });
    const machineCount = new Set(rows.map((r) => r.machine_id)).size;

    if (dryRun) {
      console.log(
        `  [dry] ${publicIp} (${essidTemplate}): would insert ${rows.length} rows across ${machineCount} machines`,
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
      console.error(`  FAIL ${publicIp}: bulk insert failed`);
      failed++;
      continue;
    }
    console.log(
      `  OK   ${publicIp} (${essidTemplate}): ${rows.length} rows across ${machineCount} machines`,
    );
    totalInserted += rows.length;
  } catch (e) {
    console.error(`  FAIL ${publicIp}: regen threw —`, e);
    failed++;
  }
}

console.log(
  `\n${totalNetworks} networks processed; ${totalInserted} rows ${dryRun ? 'planned' : 'inserted (or pre-existing)'}; ${failed} failures.`,
);
process.exit(failed === 0 ? 0 : 1);
