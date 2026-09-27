// Operator restore for FINDIT.IO — returns a rooted or defaced findit to its generated
// state. The operator runs it by hand; nothing in the world heals findit on its own.
//
// A restore is a REBOOT. It happens in this order, and the order is the safety:
//
//   1. END every open session on findit. Once the rows are closed, findit's active-session
//      gate refuses every write from a shell that was standing on the old box, so nothing
//      written mid-restore can survive onto the clean one.
//   2. DELETE every patch row on findit — its journal. This is what undoes a defaced front
//      page, a planted manifest, a poisoned log: the box returns to exactly what
//      `buildFinditFs()` generates. A brick goes with them, because a brick is only the
//      `/boot` tombstone in that journal.
//   3. WRITE one fresh boot marker. It is the only thing that can tell a terminal already
//      standing on findit that the box went down — the row lives in the journal just
//      emptied, so a shell that ignored the closed session would otherwise never notice.
//      Written under findit's own stable network key, the key its logs accrete under.
//
// The logs are wiped with everything else, so the clean box starts with empty logs like a
// reinstalled one. There is no kern.log line: a reboot names the in-world address that
// ordered it, and the operator has none. Running it on a findit nobody has touched closes
// nothing, deletes nothing, and leaves a fresh marker — harmless.
//
// Usage (local):
//   npx dotenv -e .env.development.local -- npx tsx scripts/restoreFindit.ts
//
// In production the operator supplies production's SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//
// Exits 0 on success, 1 on a database error, 2 on missing env.

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { computeApGatewayId } from '../src/core/identity/router';
import { FINDIT_NETWORK } from '../src/core/generation/finditNetwork';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter';
import { BOOT_ID_OWNER, BOOT_ID_PATH, BOOT_ID_PERMISSIONS } from '../src/core/boot/bootId';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

const finditMachineId = computeApGatewayId(FINDIT_NETWORK);

const fail = (label: string, error: { message: string }): never => {
  console.error(`${label} failed: ${error.message}`);
  process.exit(1);
};

const main = async () => {
  console.log(`Restoring findit.io (machine ${finditMachineId})`);

  // 1. Close every open session on findit, whoever holds it — the same act a reboot
  //    performs, recorded the same way.
  const ended = await sr
    .from('sessions')
    .update({ ended_at: new Date().toISOString(), end_reason: 'rebooted' })
    .eq('machine_id', finditMachineId)
    .is('ended_at', null)
    .select('session_id');
  if (ended.error) fail('closing sessions', ended.error);
  console.log(`  closed ${ended.data?.length ?? 0} open session(s)`);

  // 2. Empty the journal — the defacement, the planted manifest, the logs, all of it.
  const removed = await sr
    .from('patches')
    .delete()
    .eq('machine_id', finditMachineId)
    .select('path');
  if (removed.error) fail('emptying the journal', removed.error);
  console.log(`  removed ${removed.data?.length ?? 0} patch row(s)`);

  // 3. Leave the boot marker, under findit's own network key.
  const bootId = randomUUID();
  const marked = await sr.from('patches').upsert(
    {
      machine_id: finditMachineId,
      path: BOOT_ID_PATH,
      content: `${bootId}\n`,
      owner: BOOT_ID_OWNER,
      permissions: BOOT_ID_PERMISSIONS,
      node_type: 'file',
      writer_key: apGatewayLogWriterKey(FINDIT_NETWORK),
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (marked.error) fail('writing the boot marker', marked.error);
  console.log(`  fresh boot marker ${bootId}`);

  console.log('findit.io restored.');
  process.exit(0);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
