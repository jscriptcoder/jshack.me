// Wire-payload check for a chain breaking where a hop goes down. Drives the REAL
// /api/sessions endpoint against a running `vercel dev` + supabase, seeding session
// rows via service_role (as the doors would), then asserting the net-new api/ glue:
//   - Bob's chain runs P → Q → a gateway R, with an ftp transfer held off R. Bob reboots
//     P from his root shell there: P's row ends `rebooted`, and every leg above it — Q,
//     R and the ftp — ends `upstream_lost`, which only a real UPDATE … RETURNING walked
//     rung by rung can show.
//   - A chain of Bob's own that never passed through P stays open, and so does Carol's
//     chain on Q: the box went down, not the network.
//   - The cascade stays inside each player's own chain. Every first hop names the same
//     parent (`seed-session`, the base login, which has no row) and a session id is
//     whatever its client minted — so Mallory's crafted row CALLED `seed-session`,
//     closed by the reboot, takes her own chain with it and nobody else's.
//   - endSession refuses a caller who NAMES `upstream_lost`.
//   - A session whose parent has ended — the orphan a failed cascade would leave — is
//     ended by the next listSessions, with everything above it, and is not listed.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testChainBreaks.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';

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

const bob = generateIdentity();
const carol = generateIdentity();
const mallory = generateIdentity();

const P_ESSID = 'CHAIN-WIRE-P';
const Q_ESSID = 'CHAIN-WIRE-Q';
const R_ESSID = 'CHAIN-WIRE-R';
const P_BOX = 'chain-wire-p-box';
const Q_BOX = 'chain-wire-q-box';
const R_GATEWAY = 'chain-wire-r-gateway';

// The placeholder every first hop names as its parent: the base login, which has no row.
const BASE_LOGIN = 'seed-session';

const P_HOP = 'chain-wire-bob-p';
const Q_HOP = 'chain-wire-bob-q';
const R_HOP = 'chain-wire-bob-r';
const R_FTP = 'chain-wire-bob-r-ftp';
const BOB_ELSEWHERE = 'chain-wire-bob-elsewhere';
const CAROL_Q = 'chain-wire-carol-q';
const CAROL_R = 'chain-wire-carol-r';
const MALLORY_Q = 'chain-wire-mallory-q';
const ORPHAN = 'chain-wire-bob-orphan';
const ORPHAN_ABOVE = 'chain-wire-bob-orphan-above';

const ALL_IDS = [
  P_HOP,
  Q_HOP,
  R_HOP,
  R_FTP,
  BOB_ELSEWHERE,
  CAROL_Q,
  CAROL_R,
  MALLORY_Q,
  ORPHAN,
  ORPHAN_ABOVE,
  BASE_LOGIN,
];

const sessionRow = (row: {
  readonly sessionId: string;
  readonly owner: ReturnType<typeof generateIdentity>;
  readonly machineId: string;
  readonly parent: string | null;
  readonly essid: string;
  readonly kind?: string;
}) => ({
  session_id: row.sessionId,
  player_key: row.owner.publicKeyHex,
  machine_id: row.machineId,
  credentials: { username: 'root', userType: 'root' },
  parent_session_id: row.parent,
  source_ip: null,
  kind: row.kind ?? 'ssh',
  essid: row.essid,
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

const reasonOf = (rows: readonly Row[], sessionId: string): string =>
  rows.find((row) => row.session_id === sessionId)?.end_reason ?? 'open';

const wipeWorld = async () => {
  await sr.from('sessions').delete().in('session_id', ALL_IDS);
  await sr.from('patches').delete().eq('machine_id', P_BOX);
};

// Cleared at setup as well as teardown: the ids are fixed across runs, so a crashed
// run would leave rows the next one reads as its own.
await wipeWorld();

const seeded = await sr.from('sessions').insert([
  sessionRow({
    sessionId: P_HOP,
    owner: bob,
    machineId: P_BOX,
    parent: BASE_LOGIN,
    essid: P_ESSID,
  }),
  sessionRow({ sessionId: Q_HOP, owner: bob, machineId: Q_BOX, parent: P_HOP, essid: Q_ESSID }),
  sessionRow({ sessionId: R_HOP, owner: bob, machineId: R_GATEWAY, parent: Q_HOP, essid: R_ESSID }),
  sessionRow({
    sessionId: R_FTP,
    owner: bob,
    machineId: R_GATEWAY,
    parent: R_HOP,
    essid: R_ESSID,
    kind: 'ftp',
  }),
  sessionRow({
    sessionId: BOB_ELSEWHERE,
    owner: bob,
    machineId: Q_BOX,
    parent: BASE_LOGIN,
    essid: Q_ESSID,
  }),
  sessionRow({
    sessionId: CAROL_Q,
    owner: carol,
    machineId: Q_BOX,
    parent: BASE_LOGIN,
    essid: Q_ESSID,
  }),
  sessionRow({
    sessionId: CAROL_R,
    owner: carol,
    machineId: R_GATEWAY,
    parent: CAROL_Q,
    essid: R_ESSID,
  }),
  // Mallory's crafted row, named like the base login every first hop points at.
  sessionRow({
    sessionId: BASE_LOGIN,
    owner: mallory,
    machineId: P_BOX,
    parent: null,
    essid: P_ESSID,
  }),
  sessionRow({
    sessionId: MALLORY_Q,
    owner: mallory,
    machineId: Q_BOX,
    parent: BASE_LOGIN,
    essid: Q_ESSID,
  }),
]);
if (seeded.error) throw new Error(`session seed failed: ${seeded.error.message}`);

// 1. Bob reboots P from his root shell there.
const reboot = await post(signRequest(bob, 'rebootMachine', { machine_id: P_BOX }));
const afterReboot = await readRows();
check(
  'the reboot is accepted',
  reboot.status === 200,
  `status=${reboot.status} ${JSON.stringify(reboot.body)}`,
);
check(
  "Bob's session on P ends rebooted",
  reasonOf(afterReboot, P_HOP) === 'rebooted',
  reasonOf(afterReboot, P_HOP),
);
check(
  'every leg Bob built through P ends upstream_lost, the ftp off R included',
  [Q_HOP, R_HOP, R_FTP].every((id) => reasonOf(afterReboot, id) === 'upstream_lost'),
  [Q_HOP, R_HOP, R_FTP].map((id) => `${id}=${reasonOf(afterReboot, id)}`).join(' '),
);
check(
  "Bob's chain that never passed through P stays open",
  reasonOf(afterReboot, BOB_ELSEWHERE) === 'open',
  reasonOf(afterReboot, BOB_ELSEWHERE),
);
check(
  "Carol's chain on Q stays open",
  reasonOf(afterReboot, CAROL_Q) === 'open' && reasonOf(afterReboot, CAROL_R) === 'open',
  `${reasonOf(afterReboot, CAROL_Q)} / ${reasonOf(afterReboot, CAROL_R)}`,
);
check(
  "Mallory's row named like the base login takes her own chain, and nobody else's",
  reasonOf(afterReboot, BASE_LOGIN) === 'rebooted' &&
    reasonOf(afterReboot, MALLORY_Q) === 'upstream_lost',
  `${reasonOf(afterReboot, BASE_LOGIN)} / ${reasonOf(afterReboot, MALLORY_Q)}`,
);

// 2. No caller may claim the chain broke under them.
const claimed = await post(
  signRequest(bob, 'endSession', { session_id: BOB_ELSEWHERE, reason: 'upstream_lost' }),
);
const afterClaim = await readRows();
check(
  'endSession refuses a caller naming upstream_lost',
  claimed.status === 400 && reasonOf(afterClaim, BOB_ELSEWHERE) === 'open',
  `status=${claimed.status} ${reasonOf(afterClaim, BOB_ELSEWHERE)}`,
);

// 3. An orphan, as a failed cascade would leave one: open, standing on an ended hop.
const orphans = await sr.from('sessions').insert([
  sessionRow({ sessionId: ORPHAN, owner: bob, machineId: Q_BOX, parent: P_HOP, essid: Q_ESSID }),
  sessionRow({
    sessionId: ORPHAN_ABOVE,
    owner: bob,
    machineId: R_GATEWAY,
    parent: ORPHAN,
    essid: R_ESSID,
  }),
]);
if (orphans.error) throw new Error(`orphan seed failed: ${orphans.error.message}`);

const listed = await post(signRequest(bob, 'listSessions', {}));
const listedIds = (
  (listed.body as { sessions?: readonly { session_id: string }[] } | null)?.sessions ?? []
).map((row) => row.session_id);
const afterList = await readRows();
check(
  'listSessions lists the chain that holds and not the orphans',
  listed.status === 200 &&
    listedIds.includes(BOB_ELSEWHERE) &&
    !listedIds.includes(ORPHAN) &&
    !listedIds.includes(ORPHAN_ABOVE),
  `status=${listed.status} [${listedIds.join(', ')}]`,
);
check(
  'and ends the orphan and everything above it upstream_lost',
  reasonOf(afterList, ORPHAN) === 'upstream_lost' &&
    reasonOf(afterList, ORPHAN_ABOVE) === 'upstream_lost',
  `${reasonOf(afterList, ORPHAN)} / ${reasonOf(afterList, ORPHAN_ABOVE)}`,
);

// Cleanup.
await wipeWorld();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
