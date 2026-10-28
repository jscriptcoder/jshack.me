// The guardian's rounds over the public web — the operator looking after the valley's
// public websites by hand, on rounds nobody can predict.
//
//   report [name…]    Read each box and say how it stands, writing nothing
//                     (`core/guardian/report.ts`): how many packages a patch would move
//                     today, and whether a player has done more than visit — an open
//                     session on it, a write that is not the box's own log line or the
//                     guardian's, or a brick. What the operator reads before picking the boxes
//                     to restore.
//
//   patch [name…]     Move every package on each box onto the fix that has shipped for it,
//                     exactly as a root's `apt upgrade` would (`core/guardian/patch.ts`). A
//                     hole whose fix is still inside its patch delay stays open until a later
//                     round. Then every account on the box gets a fresh password, drawn here
//                     from the pool it was generated from (`core/guardian/rotate.ts`), with
//                     the `passwd` line for each on its auth.log: a seeded password is one a
//                     player who decodes the bundle can work out, a drawn one is not. Nobody
//                     is evicted. A bricked box is reported and left alone.
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
//                       3. WRITE the patched manifest, fresh passwords and a fresh boot marker,
//                          as the box itself. The marker is what tells a terminal already
//                          standing on the box that it went down.
//                     Only the box the name is served from: the gateway and every other box
//                     on its network keep what they hold. A fixed site's tables (boards,
//                     stories, threads, the ledger) are not its journal and stay. There is no
//                     kern.log line: a reboot names the in-world address that ordered it,
//                     and the operator has none. Safe to run again.
//
// A name is a public website's domain (`millbrook.gov`, `findit.io`, `kwikemart.com`) or
// `boards.hireme.io`, whatever its case. With no name, a patch walks the patrol: every fixed
// box, then each government and public network's site (`core/guardian/publicBoxes.ts`), for
// a report as for a patch. A restore always names its boxes.
//
// Usage (local):
//   npx dotenv -e .env.development.local -- npx tsx scripts/guardian.ts report [name…]
//   npx dotenv -e .env.development.local -- npx tsx scripts/guardian.ts patch [name…]
//   npx dotenv -e .env.development.local -- npx tsx scripts/guardian.ts restore <name…>
//
// In production the operator supplies production's SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//
// Exits 0 when the round ran (bricked boxes included), 1 on a database error (every box
// done before it stays done, and the line names the box and the step that failed), 2 on an
// order it refuses or missing env — both before anything is read or written.

import { randomInt, randomUUID } from 'node:crypto';
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
import {
  decideReport,
  reportHeader,
  reportLine,
  reportTotal,
  type Report,
} from '../src/core/guardian/report.js';
import type { PublicBox } from '../src/core/guardian/publicBoxes.js';
import { decideRotation, type PasswordDraw } from '../src/core/guardian/rotate.js';
import { CRACKABLE_PASSWORDS, UNCRACKABLE_HASHES } from '../src/core/generation/passwordPools.js';
import { md5 } from '../src/core/generation/md5.js';
import type { OwnerPatchRow } from '../src/core/network/materializeMachineFs.js';
import {
  endChainsAbove,
  type EndedSession,
  type EndSessionsAbove,
} from '../src/core/sessions/upstreamLost.js';
import { gameDayAt } from '../src/core/cve/worldClock.js';
import { asEpochMs } from '../src/core/types.js';

const USAGE = 'Usage: guardian.ts report [name…] | patch [name…] | restore <name…>';

const [command, ...names] = process.argv.slice(2);
const order: BoxesOrder | undefined =
  command === 'report' || command === 'patch'
    ? boxesNamed(names)
    : command === 'restore'
      ? restoreOrder(names)
      : undefined;
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

/** One entry of `pool`, drawn by the operating system: a seeded draw would only be a new
 *  shortcut for whoever decodes the seed. */
const drawFrom = (pool: readonly string[]): string => {
  const entry = pool[randomInt(pool.length)];
  if (entry === undefined) throw new Error('an empty password pool');
  return entry;
};

const draw: PasswordDraw = {
  crackable: () => md5(drawFrom(CRACKABLE_PASSWORDS)),
  uncrackable: () => drawFrom(UNCRACKABLE_HASHES),
};

const fail = (box: PublicBox, label: string, error: { message: string }): never => {
  console.error(`${box.name}: ${label} failed: ${error.message}`);
  process.exit(1);
};

const journalOf = async (box: PublicBox): Promise<readonly OwnerPatchRow[] | null> => {
  const journal = await sr
    .from('patches')
    .select('path, content, owner, permissions, node_type, updated_at, writer_key')
    .eq('machine_id', box.machineId);
  if (journal.error) fail(box, 'reading the journal', journal.error);
  return journal.data as readonly OwnerPatchRow[] | null;
};

const report = async (box: PublicBox, gameDay: number): Promise<Report> => {
  const journal = await journalOf(box);
  const open = await sr
    .from('sessions')
    .select('credentials')
    .eq('machine_id', box.machineId)
    .is('ended_at', null)
    .order('created_at', { ascending: true });
  if (open.error) fail(box, 'reading the open sessions', open.error);
  const accounts = ((open.data ?? []) as readonly { credentials: { username: string } }[]).map(
    (row) => row.credentials.username,
  );
  return decideReport({ box, journal, openSessions: accounts, gameDay });
};

type Patched = { readonly outcome: PatchOutcome; readonly passwords: number };

const patch = async (box: PublicBox, gameDay: number): Promise<Patched> => {
  const journal = await journalOf(box);
  const outcome = decidePatch({ box, journal, gameDay });
  const rotation = decideRotation({ box, journal, draw, now: Date.now() });
  const rows = [...(outcome.kind === 'upgraded' ? [outcome.row] : []), ...rotation.rows];
  if (rows.length > 0) {
    const written = await sr.from('patches').upsert(
      rows.map((row) => ({ machine_id: box.machineId, ...row })),
      { onConflict: 'machine_id,path,writer_key' },
    );
    if (written.error) fail(box, 'writing the manifest and passwords', written.error);
  }
  return { outcome, passwords: rotation.accounts.length };
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

  const {
    patch: patched,
    rotation,
    rows,
  } = decideRestore({ box, gameDay, bootId: randomUUID(), draw, now: Date.now() });
  const written = await sr.from('patches').upsert(
    rows.map((row) => ({ machine_id: box.machineId, ...row })),
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (written.error) fail(box, 'writing the clean box', written.error);

  return restoreLine(box.name, {
    closed: onBox.length + chains.closed.size,
    removed: removed.data?.length ?? 0,
    patch: patched,
    passwords: rotation.accounts.length,
  });
};

const reportRound = async (boxes: readonly PublicBox[], gameDay: number) => {
  console.log(reportHeader(boxes.length, new URL(url).host));
  const reports: Report[] = [];
  for (const box of boxes) {
    const read = await report(box, gameDay);
    console.log(`  ${reportLine(box.name, read)}`);
    reports.push(read);
  }
  console.log(reportTotal(reports));
};

const patchRound = async (boxes: readonly PublicBox[], gameDay: number) => {
  console.log(patchHeader(boxes.length, new URL(url).host));
  const done: Patched[] = [];
  for (const box of boxes) {
    const patched = await patch(box, gameDay);
    console.log(`  ${patchLine(box.name, patched.outcome, patched.passwords)}`);
    done.push(patched);
  }
  console.log(
    patchTotal(
      done.map(({ outcome }) => outcome),
      done.reduce((sum, { passwords }) => sum + passwords, 0),
    ),
  );
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
  if (command === 'report') await reportRound(order.boxes, gameDay);
  else if (command === 'restore') await restoreRound(order.boxes, gameDay);
  else await patchRound(order.boxes, gameDay);
  process.exit(0);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
