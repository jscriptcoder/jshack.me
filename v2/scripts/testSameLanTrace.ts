// Wire-payload smoke for Slice 7.5a — a same-WiFi LAN connect (and the su that follows)
// leaves a truthful trace on the TARGET's shared WORKSTATION auth.log, sourced from the
// attacker's LAN IP. Drives the REAL /api/sessions endpoints (authCreateSessionSameLan +
// suElevate) against a running `vercel dev` + supabase, seeding A's occupancy + registry
// rows + A's sshd pidfile via service_role (as A's and B's joins + A's `sshd` would).
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - B (a live occupant of X) `ssh guest@<A's LAN IP>` (correct pw) → ONE `Accepted
//     password for guest from <B's LAN IP>` line on A's WORKSTATION auth.log, keyed by
//     A's OWNER writer_key (decision 1), naming A's workstation hostname.
//   - A wrong password → `Failed password for guest from <B's LAN IP>` still lands
//     (sshd logs both outcomes); 401.
//   - The source is B's LAN IP — NOT B's home public IP, NOT a forged client source_ip.
//   - B `su root` on A → the existing su path records `Successful su for root by guest`
//     (no source IP) in the SAME owner-keyed row (reused machinery, verified end-to-end).
//   - Keystone: the sshd lines AND the su line coexist in ONE owner-keyed row.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSameLanTrace.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeRouterId } from '../src/core/identity/router';
import { assignHomeNetwork } from '../src/core/network/homeNetwork';
import { formatPidfileContent } from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { md5 } from '../src/core/generation/md5';
import { workstationGuestPassword } from '../src/core/generation/workstationFs';

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

/** Read a machine's auth.log row keyed by the OWNER's writer_key — the single canonical
 *  row the system writes its sshd + su lines to (decision 1). */
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

// --- Identities: A (the target/owner), B (a fellow occupant + attacker), C (a non-occupant). ---
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();

const ESSID = 'SAME-LAN-TRACE-WIFI';
const A_WS_NAME = 'skylab';
const B_WS_NAME = 'nebuchadnezzar';
const A_WS = computeWorkstationId(A_WS_NAME, alice.publicKeyHex);
const A_ROUTER = computeRouterId(alice.publicKeyHex);
const A_LAN = assignHomeNetwork(alice.publicKeyHex, ESSID).localIp; // A's ws LAN ip
const B_LAN = assignHomeNetwork(bob.publicKeyHex, ESSID).localIp; // B's LAN ip — the source
const B_PUBLIC = assignHomeNetwork(bob.publicKeyHex, ESSID).publicIp; // must NOT appear
const GUEST_PW = workstationGuestPassword(alice.publicKeyHex); // A's ws guest pw
const A_ROOT_PW = 'root-secret'; // matches the seeded workstation_root_hash below
const FORGED_SOURCE = '203.0.113.250'; // a client-claimed source_ip the server must ignore

const WORLD_PID = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };

const occupancyRow = (owner: ReturnType<typeof generateIdentity>, wsName: string) => ({
  essid: ESSID,
  owner_key: owner.publicKeyHex,
  workstation_machine_id: computeWorkstationId(wsName, owner.publicKeyHex),
  workstation_username: 'player',
  workstation_machine_name: wsName,
  workstation_root_hash: md5(A_ROOT_PW),
});

// A's registry row — what the su path resolves by machine_id (the WiFi join upserts both
// the occupancy AND the registry; this wire-check seeds both so the su half can run).
const registryRow = {
  public_ip: assignHomeNetwork(alice.publicKeyHex, ESSID).publicIp,
  owner_key: alice.publicKeyHex,
  workstation_machine_id: A_WS,
  router_machine_id: A_ROUTER,
  essid: ESSID,
  workstation_username: 'player',
  workstation_machine_name: A_WS_NAME,
  workstation_root_hash: md5(A_ROOT_PW),
};

// Clean slate, then seed A's + B's occupancy rows, A's registry row, and A's workstation
// sshd pidfile (a fresh ws is dark until its `sshd` starts).
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('network_registry').delete().eq('public_ip', registryRow.public_ip);
await sr.from('patches').delete().eq('machine_id', A_WS);
for (const id of [bob, carol]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}
await sr
  .from('home_network_occupants')
  .insert([occupancyRow(alice, A_WS_NAME), occupancyRow(bob, B_WS_NAME)]);
await sr.from('network_registry').insert([registryRow]);
await sr.from('patches').insert([
  {
    machine_id: A_WS,
    path: '/var/run/sshd.pid',
    content: formatPidfileContent(SERVICE_CATALOG.ssh, 22),
    owner: 'root',
    permissions: WORLD_PID,
    node_type: 'file',
    writer_key: alice.publicKeyHex,
    updated_at: new Date().toISOString(),
  },
]);

const connect = (caller: ReturnType<typeof generateIdentity>, fields: Record<string, unknown>) =>
  signRequest(caller, 'authCreateSessionSameLan', {
    essid: ESSID,
    target_ip: A_LAN,
    source_ip: FORGED_SOURCE,
    ...fields,
  });

// === 1. B (occupant) ssh guest@<A LAN IP> (correct pw) → 200 + Accepted line from B's LAN IP. ===
const s1 = await post(
  SESSIONS,
  connect(bob, { session_id: 'samelan-trace-1', username: 'guest', password: GUEST_PW }),
);
const log1 = await readAuthLog(A_WS, alice.publicKeyHex);
check('B (occupant) ssh guest@<A LAN IP> authenticates (correct pw)', s1.status === 200, `status=${s1.status}`);
check(
  'A’s WORKSTATION auth.log records "Accepted password for guest from <B’s LAN IP>", naming the workstation',
  log1.includes(`Accepted password for guest from ${B_LAN}`) && log1.includes(`${A_WS_NAME} sshd[`),
  `line=${lastLine(log1)}`,
);

// === 2. Wrong password → 401, but the rejected attempt still lands a Failed line. ===
const s2 = await post(
  SESSIONS,
  connect(bob, { session_id: 'samelan-trace-2', username: 'guest', password: 'not-the-guest-pw' }),
);
const log2 = await readAuthLog(A_WS, alice.publicKeyHex);
check(
  'a wrong password is 401 yet records "Failed password for guest from <B’s LAN IP>"',
  s2.status === 401 && log2.includes(`Failed password for guest from ${B_LAN}`),
  `status=${s2.status} line=${lastLine(log2)}`,
);

// === 3. The source is B's LAN IP — never B's home PUBLIC IP, never the forged client source_ip. ===
check(
  'the trace source is B’s LAN IP, not B’s home public IP and not the forged client source_ip',
  log2.includes(B_LAN) && !log2.includes(B_PUBLIC) && !log2.includes(FORGED_SOURCE),
  `lanIp=${B_LAN} publicAbsent=${!log2.includes(B_PUBLIC)} forgedAbsent=${!log2.includes(FORGED_SOURCE)}`,
);

// === 4. B su root on A (from guest) → 200 + Successful su line (NO source IP) in the same row. ===
const s4 = await post(
  SESSIONS,
  signRequest(bob, 'suElevate', {
    session_id: 'su-samelan-1',
    machine_id: A_WS,
    username: 'root',
    password: A_ROOT_PW,
    from_user: 'guest',
  }),
);
const log4 = await readAuthLog(A_WS, alice.publicKeyHex);
const suLine = lastLine(log4);
check(
  'B su root on A records "Successful su for root by guest" with NO source IP (su lines are IP-less)',
  s4.status === 200 &&
    suLine.includes('Successful su for root by guest') &&
    suLine.includes(`${A_WS_NAME} su[`) &&
    !suLine.includes(B_LAN),
  `line=${suLine}`,
);

// === 5. Keystone: the sshd lines AND the su line coexist in ONE owner-keyed row. ===
check(
  'the sshd (connect) lines and the su line all accrete into the one owner-keyed row',
  log4.includes(`Accepted password for guest from ${B_LAN}`) &&
    log4.includes(`Failed password for guest from ${B_LAN}`) &&
    log4.includes('Successful su for root by guest'),
  `lines=${log4.trim().split('\n').length}`,
);

// Cleanup.
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('network_registry').delete().eq('public_ip', registryRow.public_ip);
await sr.from('patches').delete().eq('machine_id', A_WS);
for (const id of [bob, carol]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
