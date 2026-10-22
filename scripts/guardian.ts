// The guardian's rounds over the public web — the operator looking after the valley's
// public websites by hand, on rounds nobody can predict.
//
//   patch [name…]   Move every package on each box onto the fix that has shipped for it,
//                   exactly as a root's `apt upgrade` would (`core/guardian/patch.ts`). A
//                   hole whose fix is still inside its patch delay stays open until a later
//                   round. Nobody is evicted, and nothing but the moved versions marks that
//                   the guardian came by. A bricked box is reported and left alone.
//
// A name is a public website's domain (`millbrook.gov`, `findit.io`, `kwikemart.com`) or
// `boards.hireme.io`, whatever its case. With no name, a round walks the patrol: every fixed
// box, then each government and public network's site (`core/guardian/publicBoxes.ts`).
//
// Usage (local):
//   npx dotenv -e .env.development.local -- npx tsx scripts/guardian.ts patch [name…]
//
// In production the operator supplies production's SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//
// Exits 0 when the round ran (bricked boxes included), 1 on a database error (every box
// patched before it stays patched, and the line names the box that failed), 2 on an order
// it refuses or missing env — both before anything is read or written.

import { createClient } from '@supabase/supabase-js';
import {
  boxesNamed,
  decidePatch,
  patchHeader,
  patchLine,
  patchTotal,
  type PatchOutcome,
} from '../src/core/guardian/patch.js';
import type { PublicBox } from '../src/core/guardian/publicBoxes.js';
import type { OwnerPatchRow } from '../src/core/network/materializeMachineFs.js';
import { gameDayAt } from '../src/core/cve/worldClock.js';
import { asEpochMs } from '../src/core/types.js';

const USAGE = 'Usage: guardian.ts patch [name…]';

const [command, ...names] = process.argv.slice(2);
if (command !== 'patch') {
  console.error(USAGE);
  process.exit(2);
}

const order = boxesNamed(names);
if (!order.ok) {
  console.error(order.error);
  console.error(USAGE);
  process.exit(2);
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

const fail = (box: PublicBox, label: string, error: { message: string }): never => {
  console.error(`${box.name}: ${label} failed: ${error.message}`);
  process.exit(1);
};

const patch = async (box: PublicBox, gameDay: number): Promise<PatchOutcome> => {
  const journal = await sr
    .from('patches')
    .select('path, content, owner, permissions, node_type, updated_at, writer_key')
    .eq('machine_id', box.machineId);
  if (journal.error) fail(box, 'reading the journal', journal.error);
  const outcome = decidePatch({
    box,
    journal: journal.data as readonly OwnerPatchRow[] | null,
    gameDay,
  });
  if (outcome.kind === 'upgraded') {
    const written = await sr
      .from('patches')
      .upsert(
        { machine_id: box.machineId, ...outcome.row },
        { onConflict: 'machine_id,path,writer_key' },
      );
    if (written.error) fail(box, 'writing the manifest', written.error);
  }
  return outcome;
};

const main = async () => {
  // One day for the whole round, so a round that runs across midnight patches every box
  // against the same world.
  const gameDay = gameDayAt(asEpochMs(Date.now()));
  console.log(patchHeader(order.boxes.length, new URL(url).host));
  const outcomes: PatchOutcome[] = [];
  for (const box of order.boxes) {
    const outcome = await patch(box, gameDay);
    console.log(`  ${patchLine(box.name, outcome)}`);
    outcomes.push(outcome);
  }
  console.log(patchTotal(outcomes));
  process.exit(0);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
