// Wire-check — does a root wipe of a log on a box the wiper does not own STICK, or does
// the next line the system appends bring the wiped lines back?
//
// The logs of an ownerless box accrete under the network's own key (`ap:<essid>`). A
// player's truncate or `rm` lands under the PLAYER's key. The system appender reads the
// network's row, not what a reader materializes, so it may rebuild the log from the
// pre-wipe content. This drives the real endpoints to find out:
//
//   1. B `ssh root@<gateway public ip>` → an `Accepted` line on the gateway's auth.log.
//   2. B truncates auth.log (an editor save / `> auth.log` — an upsert with '').
//      A reader now sees an empty log.
//   3. C fails a login on the same gateway → the system appends a `Failed` line.
//      A wipe that sticks shows ONLY C's line; a resurrection shows B's line again.
//   4–5. The same with `rm` (a removePatch tombstone) instead of a truncate.
//
// "What a reader sees" is the row `orderPatchesForReplay` puts last among every writer's
// rows for the path, as the client fold does — read through the real `listPatches`.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testLogWipeSticks.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { md5 } from '../src/core/generation/md5.js';
import { seedApGatewayAdminPw } from '../src/core/generation/routerFs.js';
import { orderPatchesForReplay } from '../src/core/patches/orderPatchesForReplay.js';
import { publicAddressOf } from './publicAddressOf.js';

const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

const results: { readonly pass: boolean }[] = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
};

const post = async (
  endpoint: string,
  envelope: unknown,
): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const AUTH_LOG = '/var/log/auth.log';
const ROOT_RW = { read: ['root'], write: ['root'], execute: [] };

const TARGET_ESSID = 'TYRELL-CORP';
const B_ESSID = 'UPSTAIRS-NEIGHBOR';
const C_ESSID = 'CASA-DE-RAMIREZ';
const GATEWAY = computeApGatewayId(TARGET_ESSID);
const GATEWAY_IP = publicAddressOf(TARGET_ESSID);
const ADMIN_PW = seedApGatewayAdminPw(TARGET_ESSID);
const B_PUBLIC_IP = publicAddressOf(B_ESSID);
const C_PUBLIC_IP = publicAddressOf(C_ESSID);

const bob = generateIdentity();
const carol = generateIdentity();

const occupantRow = (
  owner: ReturnType<typeof generateIdentity>,
  essid: string,
  wsName: string,
) => ({
  essid,
  owner_key: owner.publicKeyHex,
  workstation_machine_id: computeWorkstationId(wsName, owner.publicKeyHex),
  workstation_username: 'player',
  workstation_machine_name: wsName,
  workstation_root_hash: md5('root-secret'),
});

const seed = async (table: string, rows: readonly Record<string, unknown>[], label: string) => {
  const { error } = await sr.from(table).insert(rows);
  if (error) {
    console.error(`FATAL: ${table} insert (${label}) failed:`, error.message);
    process.exit(1);
  }
};

// The gateway is ESSID-seeded, so its machine_id is the same on every run: clean it at
// SETUP, or a previous run's rows answer this run's assertions.
await sr.from('home_network_occupants').delete().in('essid', [TARGET_ESSID, B_ESSID, C_ESSID]);
await sr.from('patches').delete().eq('machine_id', GATEWAY);
for (const id of [bob, carol]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}
await seed(
  'home_network_occupants',
  [occupantRow(bob, B_ESSID, 'nebuchadnezzar'), occupantRow(carol, C_ESSID, 'serenity')],
  'attackers',
);

const login = (actor: ReturnType<typeof generateIdentity>, sessionId: string, password: string) =>
  post(
    SESSIONS,
    signRequest(actor, 'authCreateSessionPublic', {
      session_id: sessionId,
      target: GATEWAY_IP,
      username: 'root',
      password,
    }),
  );

type ListedRow = {
  readonly path: string;
  readonly content: string | null;
  readonly updated_at: string;
  readonly writer_key: string;
};

/** The auth.log a reader holding a session materializes: every writer's row for the
 *  path, replayed in order, the last one winning. `null` = absent (a tombstone). */
const readerView = async (): Promise<{ content: string | null; writers: string }> => {
  const listed = await post(PATCHES, signRequest(bob, 'listPatches', { machine_id: GATEWAY }));
  const rows = ((listed.body as { patches?: ListedRow[] } | null)?.patches ?? []).filter(
    (row) => row.path === AUTH_LOG,
  );
  const ordered = orderPatchesForReplay(rows);
  const last = ordered.at(-1);
  return {
    content: last === undefined ? null : last.content,
    writers: ordered
      .map(
        (row) =>
          `${row.writer_key.slice(0, 12)}(${row.content === null ? 'rm' : row.content.length})`,
      )
      .join(' → '),
  };
};

const show = (content: string | null): string =>
  content === null ? '(absent)' : content === '' ? '(empty)' : JSON.stringify(content);

// === 1. B logs in as root → an Accepted line naming B. ===
const bLogin = await login(bob, 'ssh-b-wipe-1', ADMIN_PW);
check('B ssh root@<gateway> succeeds', bLogin.status === 200, `status=${bLogin.status}`);
const afterLogin = await readerView();
check(
  'the gateway auth.log names B',
  afterLogin.content?.includes(`Accepted password for root from ${B_PUBLIC_IP}`) === true,
  `${show(afterLogin.content)}  rows: ${afterLogin.writers}`,
);

// === 2. B truncates the log (what an editor save or `> auth.log` sends). ===
const truncate = await post(
  PATCHES,
  signRequest(bob, 'upsertPatch', {
    machine_id: GATEWAY,
    path: AUTH_LOG,
    content: '',
    owner: 'root',
    permissions: ROOT_RW,
    node_type: 'file',
  }),
);
check('B (root) may truncate auth.log', truncate.status === 200, `status=${truncate.status}`);
const afterTruncate = await readerView();
check(
  'right after the truncate a reader sees an empty log',
  afterTruncate.content === '',
  `${show(afterTruncate.content)}  rows: ${afterTruncate.writers}`,
);

// === 3. C fails a login → the system appends one Failed line. ===
const cFail = await login(carol, 'ssh-c-wipe-1', 'not-the-password');
check('C wrong password is refused', cFail.status === 401, `status=${cFail.status}`);
const afterAppend = await readerView();
check(
  'the next appended line lands (C is named)',
  afterAppend.content?.includes(`Failed password for root from ${C_PUBLIC_IP}`) === true,
  `${show(afterAppend.content)}  rows: ${afterAppend.writers}`,
);
check(
  'the TRUNCATE STICKS: B’s wiped line does not come back',
  afterAppend.content?.includes(B_PUBLIC_IP) === false,
  `${show(afterAppend.content)}`,
);

// === 4. B removes the log outright (`rm`, a tombstone). ===
const remove = await post(
  PATCHES,
  signRequest(bob, 'removePatch', { machine_id: GATEWAY, path: AUTH_LOG, owner: 'root' }),
);
check('B (root) may rm auth.log', remove.status === 200, `status=${remove.status}`);
const afterRemove = await readerView();
check(
  'right after the rm a reader sees no log',
  afterRemove.content === null,
  `${show(afterRemove.content)}  rows: ${afterRemove.writers}`,
);

// === 5. C fails again → the next appended line. ===
const cFailAgain = await login(carol, 'ssh-c-wipe-2', 'still-not-it');
check(
  'C second wrong password is refused',
  cFailAgain.status === 401,
  `status=${cFailAgain.status}`,
);
const afterSecondAppend = await readerView();
const failedLines = (afterSecondAppend.content ?? '')
  .split('\n')
  .filter((line) => line.includes('Failed password')).length;
check(
  'the RM STICKS: the new log holds only the line written after it',
  afterSecondAppend.content !== null &&
    !afterSecondAppend.content.includes(B_PUBLIC_IP) &&
    failedLines === 1,
  `${show(afterSecondAppend.content)}  rows: ${afterSecondAppend.writers}`,
);

// Teardown — the gateway's rows and both attackers' state.
await sr.from('patches').delete().eq('machine_id', GATEWAY);
await sr.from('home_network_occupants').delete().in('essid', [B_ESSID, C_ESSID]);
for (const id of [bob, carol]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
