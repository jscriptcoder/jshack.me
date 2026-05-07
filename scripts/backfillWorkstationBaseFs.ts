// Structural backfill: populate machine_filesystems with the BASE FS
// for every existing workstations row. Idempotent — reruns produce no
// diffs (ON CONFLICT DO NOTHING preserves any live rows from the
// register-workstation flow).
//
// Usage:
//   npx dotenv -e .env.development.local -- npx tsx scripts/backfillWorkstationBaseFs.ts [--dry-run]
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// IMPORTANT — content limitation (PR 1 of plans/cross-player-base-fs-
// replication.md): regenWorkstationRows now requires a real seed
// (read from the workstations row) AND a real rootPassword. The
// rootPassword is NEVER persisted server-side, so a backfill cannot
// reproduce the projected /etc/passwd content correctly. This script
// uses a sentinel rootPassword and relies on `ignoreDuplicates: true`
// to PRESERVE existing /etc/passwd content set by the live register
// flow. The script's purpose has narrowed to:
//
//   - Structural row backfill (paths/owners/permissions) for
//     workstations whose machine_filesystems rows are missing — e.g.
//     after a schema change that adds rows but not content.
//   - It will NOT correctly populate /etc/passwd content for rows
//     that don't already exist — those need to be re-registered via
//     the live IntroScreen flow.
//
// In practice, post-PR-1 (DB wipe + re-register), every workstation
// row has correct content via the live flow, and this script becomes
// a safety net for future structural-only backfills.

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

// Sentinel rootPassword. Live /etc/passwd content (correct hash) is
// preserved by the bulk-insert's ignoreDuplicates flag; this value
// only lands when no existing row exists (rare partial-failure case)
// and the player must re-register to fix.
const SENTINEL_ROOT_PASSWORD = 'BACKFILL_PLACEHOLDER';

const { data: workstations, error } = await supabase
  .from('workstations')
  .select('player_key, workstation_name, username, seed')
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
  const seed = ws.seed as string;
  totalWorkstations++;

  try {
    const rows = regenWorkstationRows({
      playerKey,
      workstationName,
      username,
      seed,
      rootPassword: SENTINEL_ROOT_PASSWORD,
    });
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
