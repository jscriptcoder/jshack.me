// One-time backfill: populate machine_filesystems with the BASE FS for
// every existing workstations row. Idempotent — reruns produce no diffs
// (ON CONFLICT DO NOTHING preserves any live patch rows that dual-wrote
// in the meantime).
//
// Usage:
//   npx dotenv -e .env.development.local -- npx tsx scripts/backfillWorkstationBaseFs.ts [--dry-run]
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Why this script exists: workstations created BEFORE the L2 own-
// workstation backfill landed have no machine_filesystems rows for
// their base FS, so L2 today falls back to "allow" (the leaf-only gap)
// — the highest-severity open L2 attack window pre-launch. Running
// this once after deploy populates them; /api/register-workstation
// handles go-forward registrations automatically. Mirror of
// scripts/backfillHomeNetworkBaseFs.ts and ...WorldNetworkBaseFs.ts.

import { createClient } from '@supabase/supabase-js';
import { regenWorkstationRows } from '../src/machineFilesystems/populateWorkstationBaseFs';
import { createBulkInsertMachineFs } from '../src/machineFilesystems/bulkInsertMachineFs';
import type { MachineFsRow } from '../src/machineFilesystems/flattenFileNode';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes('--dry-run');

if (!url || !serviceKey) {
  console.error(
    'Missing required env vars. Run with:\n  npx dotenv -e .env.development.local -- npx tsx scripts/backfillWorkstationBaseFs.ts',
  );
  process.exit(2);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

console.log(`Mode: ${dryRun ? 'DRY-RUN (no writes)' : 'LIVE'}`);

const { data: workstations, error } = await supabase
  .from('workstations')
  .select('player_key, workstation_name, username')
  .order('created_at', { ascending: true });

if (error) {
  console.error('Failed to query workstations:', error);
  process.exit(1);
}

if (!workstations?.length) {
  console.log('No workstations rows found. Nothing to backfill.');
  process.exit(0);
}

console.log(`Found ${workstations.length} workstation(s).`);

let totalInserted = 0;
let totalWorkstations = 0;
let failed = 0;

for (const ws of workstations) {
  const playerKey = ws.player_key as string;
  const workstationName = ws.workstation_name as string;
  const username = ws.username as string;
  totalWorkstations++;

  try {
    const rows = regenWorkstationRows({ playerKey, workstationName, username });
    const machineId = rows[0]?.machine_id ?? '?';

    if (dryRun) {
      console.log(`  [dry] ${machineId}: would insert ${rows.length} rows`);
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
      console.error(`  FAIL ${machineId}: bulk insert failed`);
      failed++;
      continue;
    }
    console.log(`  OK   ${machineId}: ${rows.length} rows`);
    totalInserted += rows.length;
  } catch (e) {
    console.error(`  FAIL ${playerKey.slice(0, 12)}…: regen threw —`, e);
    failed++;
  }
}

console.log(
  `\n${totalWorkstations} workstations processed; ${totalInserted} rows ${
    dryRun ? 'planned' : 'inserted (or pre-existing)'
  }; ${failed} failures.`,
);
process.exit(failed === 0 ? 0 : 1);
