// Wire-payload smoke for Slice 7.4a — the same-WiFi LAN connect front door. A fellow
// occupant B's `ssh guest@<A's LAN IP>` reaches A's workstation DIRECTLY over the
// shared LAN (no router/NAT). Drives the REAL /api/sessions endpoint
// (authCreateSessionSameLan) against a running `vercel dev` + supabase, seeding the
// home_network_occupants rows + A's workstation sshd pidfile via service_role (as A's
// and B's join + A's `sshd` would).
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - B (a live occupant of X) `ssh guest@<A's LAN IP>` with A's guest pw → 200, a
//     `kind:'ssh'` session row lands on A's WORKSTATION machine id (not B's box).
//   - A wrong password → 401 invalid_credentials, no session row.
//   - A NON-occupant caller (no row for X) → 403 not_an_occupant, refused before auth.
//   - A target LAN IP no occupant owns → 404 host_unreachable.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSameLanConnect.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
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

// --- Identities: A (the target/owner), B (a fellow occupant), C (a non-occupant). ---
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();

const ESSID = 'SHARED-LAN-WIFI';
const A_WS_NAME = 'skylab';
const B_WS_NAME = 'nebuchadnezzar';
const A_WS = computeWorkstationId(A_WS_NAME, alice.publicKeyHex);
const A_LAN = assignHomeNetwork(alice.publicKeyHex, ESSID).localIp; // A's ws LAN ip
const GUEST_PW = workstationGuestPassword(alice.publicKeyHex); // A's ws guest pw

const WORLD_PID = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };

const occupancyRow = (
  owner: ReturnType<typeof generateIdentity>,
  wsName: string,
) => ({
  essid: ESSID,
  owner_key: owner.publicKeyHex,
  workstation_machine_id: computeWorkstationId(wsName, owner.publicKeyHex),
  workstation_username: 'player',
  workstation_machine_name: wsName,
  workstation_root_hash: md5('root-secret'),
});

// Clean slate, then seed A's + B's occupancy rows (as their joins would) and A's
// workstation sshd pidfile (as A's own `sshd` would — a fresh ws is dark until).
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', A_WS);
for (const id of [bob]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}
await sr
  .from('home_network_occupants')
  .insert([occupancyRow(alice, A_WS_NAME), occupancyRow(bob, B_WS_NAME)]);
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

const connect = (
  caller: ReturnType<typeof generateIdentity>,
  fields: Record<string, unknown>,
) =>
  signRequest(caller, 'authCreateSessionSameLan', {
    essid: ESSID,
    target_ip: A_LAN,
    ...fields,
  });

const sessionExists = async (sessionId: string, playerKey: string): Promise<string | null> => {
  const { data } = await sr
    .from('sessions')
    .select('machine_id')
    .eq('session_id', sessionId)
    .eq('player_key', playerKey)
    .maybeSingle();
  return (data as { machine_id?: string } | null)?.machine_id ?? null;
};

// === 1. B (occupant) ssh guest@<A's LAN IP> with A's guest pw → 200 on A's WS. ===
const s1 = await post(
  SESSIONS,
  connect(bob, { session_id: 'samelan-b-1', username: 'guest', password: GUEST_PW }),
);
const landed = await sessionExists('samelan-b-1', bob.publicKeyHex);
check(
  'B (occupant) ssh guest@<A LAN IP> authenticates and lands a session on A’s workstation id',
  s1.status === 200 &&
    (s1.body as { machine_id?: string }).machine_id === A_WS &&
    landed === A_WS,
  `status=${s1.status} machine_id=${(s1.body as { machine_id?: string }).machine_id} landed=${landed}`,
);

// === 2. Wrong password → 401, no session row. ===
const s2 = await post(
  SESSIONS,
  connect(bob, { session_id: 'samelan-b-2', username: 'guest', password: 'not-the-guest-pw' }),
);
const landed2 = await sessionExists('samelan-b-2', bob.publicKeyHex);
check(
  'a wrong password is 401 invalid_credentials and lands no session',
  s2.status === 401 && landed2 === null,
  `status=${s2.status} landed=${landed2}`,
);

// === 3. A NON-occupant caller (no row for X) → 403 not_an_occupant. ===
const s3 = await post(
  SESSIONS,
  connect(carol, { session_id: 'samelan-c-1', username: 'guest', password: GUEST_PW }),
);
check(
  'a non-occupant caller is 403 not_an_occupant (refused before any password check)',
  s3.status === 403 && (s3.body as { error?: string }).error === 'not_an_occupant',
  `status=${s3.status} error=${(s3.body as { error?: string }).error}`,
);

// === 4. A target LAN IP no occupant owns → 404 host_unreachable. ===
const s4 = await post(
  SESSIONS,
  connect(bob, {
    session_id: 'samelan-b-3',
    username: 'guest',
    password: GUEST_PW,
    target_ip: '10.0.0.99',
  }),
);
check(
  'a target LAN IP no occupant owns is 404 host_unreachable',
  s4.status === 404 && (s4.body as { error?: string }).error === 'host_unreachable',
  `status=${s4.status} error=${(s4.body as { error?: string }).error}`,
);

// Cleanup.
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', A_WS);
for (const id of [bob]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
