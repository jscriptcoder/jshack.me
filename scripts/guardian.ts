// The guardian's rounds over the public web — the operator looking after the valley's
// public websites by hand, on rounds nobody can predict.
//
//   patch [name…]     Move every package on each box onto the fix that has shipped for it,
//                     exactly as a root's `apt upgrade` would (`core/guardian/patch.ts`). A
//                     hole whose fix is still inside its patch delay stays open until a later
//                     round. Nobody is evicted, and nothing but the moved versions marks that
//                     the guardian came by. A bricked box is reported and left alone.
//
//   restore <name…>   Put each box back as generated, then patch it — a reinstall from
//                     current media (`core/guardian/restore.ts`). A restore is a REBOOT, in
//                     this order, and the order is the safety:
//                       1. END every open session on the box, whoever holds it, as
//                          `rebooted`, and every session stacked on those as
//                          `upstream_lost` — the same ends an in-world reboot writes. Once
//                          the rows are closed, the box's active-session gate refuses every
//                          write from a shell that was standing on the old box, so nothing
//                          written mid-restore survives onto the clean one.
//                       2. DELETE its whole journal: the defaced page, the rolled-back
//                          manifest, the poisoned logs and a brick's `/boot` tombstone.
//                       3. WRITE the patched manifest and a fresh boot marker, as the box
//                          itself. The marker is what tells a terminal already standing on the
//                          box that it went down.
//                     Only the box the name is served from: the gateway and every other box
//                     on its network keep what they hold. A fixed site's tables (boards,
//                     stories, threads, the ledger) are not its journal and stay. There is no
//                     kern.log line: a reboot names the in-world address that ordered it,
//                     and the operator has none. Safe to run again.
//
// A name is a public website's domain (`millbrook.gov`, `findit.io`, `kwikemart.com`) or
// `boards.hireme.io`, whatever its case. With no name, a patch walks the patrol: every fixed
// box, then each government and public network's site (`core/guardian/publicBoxes.ts`). A
// restore always names its boxes.
//
// Usage (local):
//   npx dotenv -e .env.development.local -- npx tsx scripts/guardian.ts patch [name…]
//   npx dotenv -e .env.development.local -- npx tsx scripts/guardian.ts restore <name…>
//
// In production the operator supplies production's SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//
// Exits 0 when the round ran (bricked boxes included), 1 on a database error (every box
// done before it stays done, and the line names the box and the step that failed), 2 on an
// order it refuses or missing env — both before anything is read or written.

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  boxesNamed,
  decidePatch,
  patchHeader,
  patchLine,
  patchTotal,
  type BoxesOrder,
  type PatchOutcome,
} from '../src/core/guardian/patch.js';
import {
  decideRestore,
  restoreHeader,
  restoreLine,
  restoreOrder,
  restoreTotal,
} from '../src/core/guardian/restore.js';
import type { PublicBox } from '../src/core/guardian/publicBoxes.js';
import type { OwnerPatchRow } from '../src/core/network/materializeMachineFs.js';
import {
  endChainsAbove,
  type EndedSession,
  type EndSessionsAbove,
} from '../src/core/sessions/upstreamLost.js';
import { gameDayAt } from '../src/core/cve/worldClock.js';
import { asEpochMs } from '../src/core/types.js';

const USAGE = 'Usage: guardian.ts patch [name…] | restore <name…>';

const [command, ...names] = process.argv.slice(2);
const order: BoxesOrder | undefined =
  command === 'patch' ? boxesNamed(names) : command === 'restore' ? restoreOrder(names) : undefined;
if (order === undefined) {
  console.error(USAGE);
  process.exit(2);
}
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

/** One rung of a chain standing on a closed session: that player's open rows above it. */
const endSessionsAbove: EndSessionsAbove = async ({ player_key, parent_ids, reason }) => {
  const { data, error } = await sr
    .from('sessions')
    .update({ ended_at: new Date().toISOString(), end_reason: reason })
    .eq('player_key', player_key)
    .in('parent_session_id', [...parent_ids])
    .is('ended_at', null)
    .select('session_id');
  return { data: data?.map((row) => row.session_id as string) ?? null, error };
};

const restore = async (box: PublicBox, gameDay: number): Promise<string> => {
  const ended = await sr
    .from('sessions')
    .update({ ended_at: new Date().toISOString(), end_reason: 'rebooted' })
    .eq('machine_id', box.machineId)
    .is('ended_at', null)
    .select('session_id, player_key');
  if (ended.error) fail(box, 'closing sessions', ended.error);
  const onBox = (ended.data ?? []) as readonly EndedSession[];
  const chains = await endChainsAbove(endSessionsAbove, onBox);
  if (!chains.ok)
    return fail(box, 'closing the sessions stacked on it', { message: 'database error' });

  const removed = await sr.from('patches').delete().eq('machine_id', box.machineId).select('path');
  if (removed.error) fail(box, 'emptying the journal', removed.error);

  const { patch: patched, rows } = decideRestore({ box, gameDay, bootId: randomUUID() });
  const written = await sr.from('patches').upsert(
    rows.map((row) => ({ machine_id: box.machineId, ...row })),
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (written.error) fail(box, 'writing the clean box', written.error);

  return restoreLine(box.name, {
    closed: onBox.length + chains.closed.size,
    removed: removed.data?.length ?? 0,
    patch: patched,
  });
};

const patchRound = async (boxes: readonly PublicBox[], gameDay: number) => {
  console.log(patchHeader(boxes.length, new URL(url).host));
  const outcomes: PatchOutcome[] = [];
  for (const box of boxes) {
    const outcome = await patch(box, gameDay);
    console.log(`  ${patchLine(box.name, outcome)}`);
    outcomes.push(outcome);
  }
  console.log(patchTotal(outcomes));
};

const restoreRound = async (boxes: readonly PublicBox[], gameDay: number) => {
  console.log(restoreHeader(boxes.length, new URL(url).host));
  for (const box of boxes) console.log(`  ${await restore(box, gameDay)}`);
  console.log(restoreTotal(boxes.length));
};

const main = async () => {
  // One day for the whole round, so a round that runs across midnight treats every box
  // against the same world.
  const gameDay = gameDayAt(asEpochMs(Date.now()));
  if (command === 'restore') await restoreRound(order.boxes, gameDay);
  else await patchRound(order.boxes, gameDay);
  process.exit(0);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
