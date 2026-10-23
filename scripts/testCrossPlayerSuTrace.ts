// Wire-payload smoke for Story 6.3 — a cross-player `su` leaves a truthful auth.log
// trace on the TARGET's shared WORKSTATION record. Drives the REAL /api/sessions
// endpoint (suElevate) against a running `vercel dev` + supabase, seeding A's
// registry row via service_role (as A's join/config would).
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - B (already ssh'd into A as guest) `su root` (correct root pw) → ONE `Successful
//     su for root by guest` line lands on A's WORKSTATION auth.log, keyed by A's OWNER
//     writer_key, naming A's workstation machine name.
//   - A wrong password → `FAILED su for root by guest` line still lands (su logs both
//     outcomes); 401.
//   - su lines carry the `by <from>` user off the caller's session row, never one the
//     request names (no source IP).
//   - Keystone: a SECOND attacker (C), switching from a different local user, accretes
//     its own line into the SAME owner-keyed row instead of collapsing it under the
//     last-write-wins fold.
//   - A caller with no session on the box is refused and writes nothing.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testCrossPlayerSuTrace.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { generateIdentityIn } from '../src/test/factories/identityIn.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { md5 } from '../src/core/generation/md5.js';

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

/** Read a machine's auth.log row keyed by the OWNER's writer_key — the single
 *  canonical row the system writes its su lines to. */
const readAuthLog = async (machineId: string, ownerKey: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', AUTH_LOG)
    .eq('writer_key', ownerKey)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};

const lastLine = (log: string): string => log.trim().split('\n').slice(-1)[0] ?? '(empty)';

// --- Identities: A (the target/owner), B + C (two attackers standing on A's box). ---
const alice = generateIdentityIn(RIDGEMONT);
const bob = generateIdentityIn(RIDGEMONT);
const carol = generateIdentityIn(RIDGEMONT);

const A_ESSID = 'ABSTERGO-NET';
const A_WS_NAME = 'skylab';
const A_WS = computeWorkstationId(A_WS_NAME, alice.publicKeyHex);
const A_ROOT_PW = 'root-secret'; // matches the seeded workstation_root_hash below

// The join state a real `registerNetwork` writes: A as an OCCUPANT of its ESSID.
// Occupancy is what makes A's box reachable at all.
const occupantRow = {
  essid: A_ESSID,
  owner_key: alice.publicKeyHex,
  workstation_machine_id: A_WS,
  workstation_username: 'player',
  workstation_machine_name: A_WS_NAME,
  workstation_root_hash: md5(A_ROOT_PW),
};

// Clean slate, then seed A's occupancy row (as A's join would) and the shell each
// attacker's login would have left on A's box: `su` is typed into a shell, and the
// account the line names is the one that shell's row holds. su needs no forward or
// pidfile — it targets A's workstation directly by machine_id.
await sr.from('home_network_occupants').delete().eq('essid', A_ESSID);
await sr.from('patches').delete().eq('machine_id', A_WS);
for (const id of [bob, carol]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}
await sr.from('home_network_occupants').insert([occupantRow]);
const shellOn = (
  attacker: ReturnType<typeof generateIdentity>,
  account: { readonly username: string; readonly userType: 'user' | 'guest' },
) => ({
  session_id: `su-trace-ssh-${attacker.publicKeyHex.slice(0, 12)}`,
  player_key: attacker.publicKeyHex,
  machine_id: A_WS,
  credentials: account,
  kind: 'ssh',
  essid: A_ESSID,
});
const seeded = await sr
  .from('sessions')
  .insert([
    shellOn(bob, { username: 'guest', userType: 'guest' }),
    shellOn(carol, { username: 'visitor', userType: 'user' }),
  ]);
if (seeded.error) {
  console.error('could not seed sessions:', seeded.error);
  process.exit(1);
}

const suElevate = (
  attacker: ReturnType<typeof generateIdentity>,
  fields: Record<string, unknown>,
) =>
  signRequest(attacker, 'suElevate', {
    machine_id: A_WS,
    ...fields,
  });

// === 1. Wrong root pw → 401, but the rejected attempt still lands a FAILED line. ===
// First, while B's shell is still the guest one: once B is root, no password is asked for.
const s1 = await post(
  SESSIONS,
  suElevate(bob, {
    session_id: 'su-b-1',
    username: 'root',
    password: 'not-the-root-pw',
  }),
);
const log1 = await readAuthLog(A_WS, alice.publicKeyHex);
check(
  'a wrong password is 401 yet records "FAILED su for root by guest", naming the workstation',
  s1.status === 401 &&
    log1.includes('FAILED su for root by guest') &&
    log1.includes(`${A_WS_NAME} su[`),
  `status=${s1.status} line=${lastLine(log1)}`,
);

// === 2. B su root (correct pw, from guest) → 200 + Successful line on A's WS auth.log. ===
const s2 = await post(
  SESSIONS,
  suElevate(bob, {
    session_id: 'su-b-2',
    username: 'root',
    password: A_ROOT_PW,
    // Ignored: the line names the account on B's session row, not one B claims.
    from_user: 'somebody-else',
  }),
);
const log2 = await readAuthLog(A_WS, alice.publicKeyHex);
check('B su root on A’s workstation elevates (correct pw)', s2.status === 200, `status=${s2.status}`);
check(
  'A’s WORKSTATION auth.log records "Successful su for root by guest", whatever account the request names',
  log2.includes('Successful su for root by guest') && !log2.includes('somebody-else'),
  `line=${lastLine(log2)}`,
);

// === 3. Keystone: a SECOND attacker (C), switching from a DIFFERENT local user, ===
// ===    accretes its own line into the SAME owner-keyed workstation row.        ===
const s3 = await post(
  SESSIONS,
  suElevate(carol, {
    session_id: 'su-c-1',
    username: 'root',
    password: A_ROOT_PW,
  }),
);
const log3 = await readAuthLog(A_WS, alice.publicKeyHex);
check(
  'both B’s (by guest) and C’s (by visitor) su lines coexist in the one owner-keyed row (no last-write-wins collapse)',
  s3.status === 200 &&
    log3.includes('Successful su for root by guest') &&
    log3.includes('Successful su for root by visitor'),
  `lines=${log3.trim().split('\n').length}`,
);

// === 4. A caller with no shell on the box is refused and writes nothing. ===
const dave = generateIdentityIn(RIDGEMONT);
const before = await readAuthLog(A_WS, alice.publicKeyHex);
const s4 = await post(
  SESSIONS,
  suElevate(dave, {
    session_id: 'su-d-1',
    username: 'root',
    password: A_ROOT_PW,
  }),
);
const after = await readAuthLog(A_WS, alice.publicKeyHex);
check(
  'su by a caller with no session on the box is 403 no_session and writes no trace',
  s4.status === 403 && before === after,
  `status=${s4.status} logUnchanged=${before === after}`,
);

// Cleanup.
await sr.from('home_network_occupants').delete().eq('essid', A_ESSID);
await sr.from('patches').delete().eq('machine_id', A_WS);
for (const id of [bob, carol]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
