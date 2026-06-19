// Wire-payload smoke for Story 6.3 — a cross-player `su` leaves a truthful auth.log
// trace on the TARGET's shared WORKSTATION record. Drives the REAL /api/sessions
// endpoint (suElevate) against a running `vercel dev` + supabase, seeding A's
// registry row via service_role (as A's join/config would).
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - B (already ssh'd into A as guest) `su root` (correct root pw) → ONE `Successful
//     su for root by guest` line lands on A's WORKSTATION auth.log, keyed by A's OWNER
//     writer_key (decision 1), naming A's workstation machine name.
//   - A wrong password → `FAILED su for root by guest` line still lands (su logs both
//     outcomes); 401.
//   - su lines carry the `by <from>` user from the payload (no source IP).
//   - Keystone: a SECOND attacker (C), switching from a different local user, accretes
//     its own line into the SAME owner-keyed row instead of collapsing it under the
//     last-write-wins fold.
//   - host_unreachable (unregistered machine id) writes nothing.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testCrossPlayerSuTrace.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeRouterId } from '../src/core/identity/router';
import { md5 } from '../src/core/generation/md5';

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
 *  canonical row the system writes its su lines to (decision 1). */
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
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();

const A_ESSID = 'ABSTERGO-NET';
const A_WS_NAME = 'skylab';
const A_WS = computeWorkstationId(A_WS_NAME, alice.publicKeyHex);
const A_ROUTER = computeRouterId(alice.publicKeyHex);
const A_PUBLIC_IP = '203.0.113.94';
const A_ROOT_PW = 'root-secret'; // matches the seeded workstation_root_hash below

const registryRow = {
  public_ip: A_PUBLIC_IP,
  owner_key: alice.publicKeyHex,
  workstation_machine_id: A_WS,
  router_machine_id: A_ROUTER,
  essid: A_ESSID,
  workstation_username: 'player',
  workstation_machine_name: A_WS_NAME,
  workstation_root_hash: md5(A_ROOT_PW),
};

// Clean slate, then seed A's registry row (as A's join would). su needs no forward or
// pidfile — it targets A's workstation directly by machine_id.
await sr.from('network_registry').delete().eq('public_ip', A_PUBLIC_IP);
await sr.from('patches').delete().eq('machine_id', A_WS);
for (const id of [bob, carol]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}
await sr.from('network_registry').insert([registryRow]);

const suElevate = (
  attacker: ReturnType<typeof generateIdentity>,
  fields: Record<string, unknown>,
) =>
  signRequest(attacker, 'suElevate', {
    machine_id: A_WS,
    ...fields,
  });

// === 1. B su root (correct pw, from guest) → 200 + Successful line on A's WS auth.log. ===
const s1 = await post(
  SESSIONS,
  suElevate(bob, {
    session_id: 'su-b-1',
    username: 'root',
    password: A_ROOT_PW,
    from_user: 'guest',
  }),
);
const log1 = await readAuthLog(A_WS, alice.publicKeyHex);
check('B su root on A’s workstation elevates (correct pw)', s1.status === 200, `status=${s1.status}`);
check(
  'A’s WORKSTATION auth.log records "Successful su for root by guest", naming the workstation',
  log1.includes('Successful su for root by guest') && log1.includes(`${A_WS_NAME} su[`),
  `line=${lastLine(log1)}`,
);

// === 2. Wrong root pw → 401, but the rejected attempt still lands a FAILED line. ===
const s2 = await post(
  SESSIONS,
  suElevate(bob, {
    session_id: 'su-b-2',
    username: 'root',
    password: 'not-the-root-pw',
    from_user: 'guest',
  }),
);
const log2 = await readAuthLog(A_WS, alice.publicKeyHex);
check(
  'a wrong password is 401 yet records "FAILED su for root by guest"',
  s2.status === 401 && log2.includes('FAILED su for root by guest'),
  `status=${s2.status} line=${lastLine(log2)}`,
);

// === 3. Keystone: a SECOND attacker (C), switching from a DIFFERENT local user, ===
// ===    accretes its own line into the SAME owner-keyed workstation row.        ===
const s3 = await post(
  SESSIONS,
  suElevate(carol, {
    session_id: 'su-c-1',
    username: 'root',
    password: A_ROOT_PW,
    from_user: 'visitor',
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

// === 4. host_unreachable (unregistered machine id) writes nothing. ===
const before = await readAuthLog(A_WS, alice.publicKeyHex);
const s4 = await post(
  SESSIONS,
  signRequest(bob, 'suElevate', {
    session_id: 'su-b-x-1',
    machine_id: 'workstation-does-not-exist',
    username: 'root',
    password: A_ROOT_PW,
    from_user: 'guest',
  }),
);
const after = await readAuthLog(A_WS, alice.publicKeyHex);
check(
  'su against an unregistered machine id is 404 host_unreachable and writes no trace',
  s4.status === 404 && before === after,
  `status=${s4.status} logUnchanged=${before === after}`,
);

// Cleanup.
await sr.from('network_registry').delete().eq('public_ip', A_PUBLIC_IP);
await sr.from('patches').delete().eq('machine_id', A_WS);
for (const id of [bob, carol]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
