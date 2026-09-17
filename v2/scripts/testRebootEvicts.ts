// Wire-payload check for the eviction action — `rebootMachine`. Drives the REAL
// /api/sessions endpoint against a running `vercel dev` + supabase, seeding session
// rows via service_role (as the doors would), then asserting the net-new (locally
// untypechecked api/) runtime:
//   - A reboot ends EVERY active row the caller holds on that machine in one act —
//     including one no hop chain on their screen was standing on. That is the whole
//     difference from endSession, and it cannot be proven without a real UPDATE.
//   - The rows come back stamped `rebooted`, not `user_exit`: the record of a player
//     being thrown off must not read like one of them walking away.
//   - A row the same player holds on ANOTHER machine survives. The box went down; the
//     rest of the world did not.
//   - Another player's row on the SAME machine survives for now — reaching it needs a
//     server-derived authority this action does not have yet.
//   - The client popping its hop chain AFTER the reboot cannot rewrite `rebooted` into
//     `user_exit`. Those exits really are sent, milliseconds later, so the update has
//     to refuse an already-closed row.
//   - endSession refuses a caller who NAMES `rebooted`: a box going down is something
//     the server witnessed, not something a caller may claim.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testRebootEvicts.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';

const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
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

const post = async (envelope: unknown): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(SESSIONS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

// The defender runs the reboot; the intruder holds a row on the same box.
const defender = generateIdentity();
const intruder = generateIdentity();

const REBOOTED = 'reboot-wire-box';
const ELSEWHERE = 'reboot-wire-other-box';

const SSH_HOP = 'reboot-wire-ssh';
const SU_ELEVATION = 'reboot-wire-su';
const OFF_BOX = 'reboot-wire-elsewhere';
const INTRUDER_HOP = 'reboot-wire-intruder';

const ALL_IDS = [SSH_HOP, SU_ELEVATION, OFF_BOX, INTRUDER_HOP];

const sessionRow = (
  sessionId: string,
  owner: ReturnType<typeof generateIdentity>,
  machineId: string,
  kind: string,
  username: string,
) => ({
  session_id: sessionId,
  player_key: owner.publicKeyHex,
  machine_id: machineId,
  credentials: { username, userType: username === 'root' ? 'root' : 'user' },
  parent_session_id: null,
  source_ip: null,
  kind,
});

type Row = {
  readonly session_id: string;
  readonly ended_at: string | null;
  readonly end_reason: string | null;
};

const readRows = async (): Promise<readonly Row[]> => {
  const { data } = await sr
    .from('sessions')
    .select('session_id, ended_at, end_reason')
    .in('session_id', ALL_IDS);
  return (data as readonly Row[] | null) ?? [];
};

const rowFor = (rows: readonly Row[], sessionId: string): Row | undefined =>
  rows.find((row) => row.session_id === sessionId);

// Clean slate, then seed. The su elevation is the load-bearing one: it sits on the
// rebooted box with NO hop chain naming it, which is what a session-id-scoped
// eviction would leave behind.
await sr.from('sessions').delete().in('session_id', ALL_IDS);
await sr
  .from('sessions')
  .insert([
    sessionRow(SSH_HOP, defender, REBOOTED, 'ssh', 'neo'),
    sessionRow(SU_ELEVATION, defender, REBOOTED, 'su', 'root'),
    sessionRow(OFF_BOX, defender, ELSEWHERE, 'ssh', 'neo'),
    sessionRow(INTRUDER_HOP, intruder, REBOOTED, 'exploit', 'guest'),
  ]);

// === 1. The reboot is accepted. ===
const rebooted = await post(signRequest(defender, 'rebootMachine', { machine_id: REBOOTED }));
check('a signed reboot of the machine is accepted', rebooted.status === 200, `status=${rebooted.status}`);

const afterReboot = await readRows();

// === 2. Every row the caller held on that box is closed — including the unnamed one. ===
const hop = rowFor(afterReboot, SSH_HOP);
const elevation = rowFor(afterReboot, SU_ELEVATION);
check(
  'the hop the player was standing on is closed',
  hop?.ended_at !== null && hop?.ended_at !== undefined,
  `ended_at=${hop?.ended_at}`,
);
check(
  'a second session on the same box is closed too, though no hop chain named it',
  elevation?.ended_at !== null && elevation?.ended_at !== undefined,
  `ended_at=${elevation?.ended_at}`,
);

// === 3. Closed as an eviction, not as an exit. ===
check(
  'both rows record that the box went down, not that the player left',
  hop?.end_reason === 'rebooted' && elevation?.end_reason === 'rebooted',
  `reasons=${hop?.end_reason},${elevation?.end_reason}`,
);

// === 4. The blast radius stops at the machine, and at the caller. ===
const offBox = rowFor(afterReboot, OFF_BOX);
check(
  'a session on another machine survives the reboot',
  offBox?.ended_at === null,
  `ended_at=${offBox?.ended_at}`,
);
const intruderRow = rowFor(afterReboot, INTRUDER_HOP);
check(
  "another player's session on the same box is not reached yet",
  intruderRow?.ended_at === null,
  `ended_at=${intruderRow?.ended_at}`,
);

// === 5. The hop-chain pops that follow cannot rewrite why the rows closed. ===
const lateExit = await post(signRequest(defender, 'endSession', { session_id: SU_ELEVATION }));
const afterLateExit = await readRows();
const stillEvicted = rowFor(afterLateExit, SU_ELEVATION);
check(
  'a late exit for an already-closed row is accepted without rewriting it',
  lateExit.status === 200 && stillEvicted?.end_reason === 'rebooted',
  `status=${lateExit.status} reason=${stillEvicted?.end_reason}`,
);
check(
  'the eviction timestamp is left alone by that late exit',
  stillEvicted?.ended_at === elevation?.ended_at,
  `before=${elevation?.ended_at} after=${stillEvicted?.ended_at}`,
);

// === 6. A caller cannot claim an eviction of their own. ===
const claimed = await post(
  signRequest(defender, 'endSession', { session_id: OFF_BOX, reason: 'rebooted' }),
);
const afterClaim = await readRows();
check(
  'endSession refuses a caller naming `rebooted` as the reason',
  claimed.status === 400,
  `status=${claimed.status}`,
);
check(
  'the refused claim left the row untouched',
  rowFor(afterClaim, OFF_BOX)?.ended_at === null,
  `ended_at=${rowFor(afterClaim, OFF_BOX)?.ended_at}`,
);

// Cleanup.
await sr.from('sessions').delete().in('session_id', ALL_IDS);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
