// Wire-payload smoke for the rule that a box is on one network at a time. The game's
// `nmcli` refuses a second join while connected; the server holds the same line for a
// request that skips the game, and for a disconnect whose fire-and-forget leave never
// landed: a join takes the box off every OTHER network first, exactly as a disconnect.
//
// The bug this pins: the join wrote a second occupancy row and removed none, so the box
// stayed reachable on the first WiFi, and its visitors' sessions stayed open there,
// while the player's own tools acted from the second.
//
// Drives the REAL endpoints against a running `vercel dev` + supabase:
//   - B, C and A join NET_ONE via /api/network (registerNetwork).
//   - B `ssh guest@<A's LAN IP>` via /api/sessions (authCreateSessionSameLan), and hops
//     on from A's box; A is root on their own box.
//   - A joins NET_ONE again: nothing moves, nobody is thrown off.
//   - A joins NET_TWO with no disconnect in between.
//   - A now occupies NET_TWO alone. B's shell on A's box closed as the box leaving its
//     network, the hop B made from it went down with it, and A's own root shell did not.
//     C no longer sees A on NET_ONE, and B cannot log in at A's old address.
//
// Net-new under test (the locally-untypechecked api/ runtime): that the join's delete
// is scoped to the caller's OTHER networks (`neq essid`), names the box it moved, and
// that the session closers it now shares with the disconnect run on the join's path.
//
// Usage (with v2 supabase + vercel dev running on 3100, JSHACK_ADMIT_LAB_NETWORKS=1):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testOneNetworkAtATime.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { lanAddressFor } from '../src/core/network/lanAddress.js';
import { formatPidfileContent } from '../src/core/services/pidfile.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { md5 } from '../src/core/generation/md5.js';
import { workstationGuestHash } from '../src/core/generation/workstationFs.js';
import { plaintextFor } from '../src/test/passwords.js';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
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

type Identity = ReturnType<typeof generateIdentity>;

// A (who moves), B (who stands on A's box), C (a bystander who stays on NET_ONE).
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();

const NET_ONE = 'ONE-NETWORK-FIRST';
const NET_TWO = 'ONE-NETWORK-SECOND';
const A_WS_NAME = 'quarantine';
const A_WS = computeWorkstationId(A_WS_NAME, alice.publicKeyHex);

const B_SHELL = 'one-network-b-1';
const B_HOP_FROM_A = 'one-network-b-hop-from-a';
const A_OWN_ROOT = 'one-network-a-own-su';
const B_RETRY = 'one-network-b-2';

const join = (owner: Identity, wsName: string, essid: string) =>
  signRequest(owner, 'registerNetwork', {
    essid,
    workstation_machine_id: computeWorkstationId(wsName, owner.publicKeyHex),
    workstation_username: 'player',
    workstation_machine_name: wsName,
    workstation_root_hash: md5('root-secret'),
  });

const leasedAddress = async (owner: Identity, essid: string): Promise<string> => {
  const { data } = await sr
    .from('network_lan_leases')
    .select('octet')
    .eq('essid', essid)
    .eq('owner_key', owner.publicKeyHex)
    .maybeSingle();
  const octet = (data as { octet: number } | null)?.octet;
  if (octet === undefined) throw new Error(`no lan lease for ${owner.publicKeyHex.slice(0, 8)}`);
  return lanAddressFor(essid, octet);
};

/** The networks this player's box occupies, sorted. */
const occupiedBy = async (owner: Identity): Promise<readonly string[]> => {
  const { data } = await sr
    .from('home_network_occupants')
    .select('essid')
    .eq('owner_key', owner.publicKeyHex);
  return ((data ?? []) as { essid: string }[]).map((row) => row.essid).sort();
};

/** `open`, the reason a closed row carries, or `missing`. */
const sessionState = async (sessionId: string): Promise<string> => {
  const { data } = await sr
    .from('sessions')
    .select('ended_at, end_reason')
    .eq('session_id', sessionId)
    .maybeSingle();
  const row = data as { ended_at: string | null; end_reason: string | null } | null;
  if (row === null) return 'missing';
  return row.ended_at === null ? 'open' : (row.end_reason ?? 'closed');
};

const sshAsBob = (sessionId: string, targetIp: string) =>
  post(
    SESSIONS,
    signRequest(bob, 'authCreateSessionSameLan', {
      session_id: sessionId,
      essid: NET_ONE,
      target_ip: targetIp,
      username: 'guest',
      password: plaintextFor(workstationGuestHash(alice.publicKeyHex)),
    }),
  );

const occupantIdsSeenBy = async (viewer: Identity, essid: string): Promise<readonly string[]> => {
  const response = await post(NETWORK, signRequest(viewer, 'resolveOccupants', { essid }));
  const occupants =
    (response.body as { occupants?: readonly { workstation_machine_id: string }[] } | null)
      ?.occupants ?? [];
  return occupants.map((occupant) => occupant.workstation_machine_id);
};

const clean = async () => {
  for (const essid of [NET_ONE, NET_TWO]) {
    await sr.from('home_network_occupants').delete().eq('essid', essid);
    await sr.from('network_lan_leases').delete().eq('essid', essid);
  }
  await sr.from('patches').delete().eq('machine_id', A_WS);
  await sr.from('sessions').delete().in('player_key', [bob.publicKeyHex, alice.publicKeyHex]);
};

await clean();

await post(NETWORK, join(bob, 'watchtower', NET_ONE));
await post(NETWORK, join(carol, 'lighthouse', NET_ONE));
const joinedOne = await post(NETWORK, join(alice, A_WS_NAME, NET_ONE));
check(
  'A joins NET_ONE',
  joinedOne.status === 200,
  `status=${joinedOne.status} body=${JSON.stringify(joinedOne.body)}`,
);
const A_LAN = await leasedAddress(alice, NET_ONE);

// A's `sshd` holds port 22, so B has a door to knock on.
const seeded = await sr.from('patches').insert({
  machine_id: A_WS,
  path: '/var/run/sshd.pid',
  content: formatPidfileContent(SERVICE_CATALOG.ssh, 22),
  owner: 'root',
  permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
  node_type: 'file',
  writer_key: alice.publicKeyHex,
  updated_at: new Date().toISOString(),
});
if (seeded.error) {
  console.error(`FATAL: journal seed failed: ${seeded.error.message}`);
  process.exit(1);
}

// === 1. B logs in to A's box over NET_ONE. ===
const login = await sshAsBob(B_SHELL, A_LAN);
check(
  'B lands a guest session on A’s box over NET_ONE',
  login.status === 200 && (login.body as { machine_id?: string }).machine_id === A_WS,
  `status=${login.status} body=${JSON.stringify(login.body)}`,
);

// B hops on from A's box, and A is root on their own machine.
const stacked = await sr.from('sessions').insert([
  {
    session_id: B_HOP_FROM_A,
    player_key: bob.publicKeyHex,
    machine_id: 'web-01-cafef00d',
    credentials: { username: 'guest', userType: 'guest' },
    kind: 'ssh',
    essid: NET_ONE,
    parent_session_id: B_SHELL,
  },
  {
    session_id: A_OWN_ROOT,
    player_key: alice.publicKeyHex,
    machine_id: A_WS,
    credentials: { username: 'root', userType: 'root' },
    kind: 'su',
    essid: NET_ONE,
  },
]);
if (stacked.error) {
  console.error(`FATAL: session seed failed: ${stacked.error.message}`);
  process.exit(1);
}

// === 2. Joining the network A is already on moves nothing. ===
const rejoined = await post(NETWORK, join(alice, A_WS_NAME, NET_ONE));
check(
  'A re-joining NET_ONE keeps A on NET_ONE and B’s shell open',
  rejoined.status === 200 &&
    JSON.stringify(await occupiedBy(alice)) === JSON.stringify([NET_ONE]) &&
    (await sessionState(B_SHELL)) === 'open',
  `status=${rejoined.status} networks=${JSON.stringify(await occupiedBy(alice))} shell=${await sessionState(B_SHELL)}`,
);

// === 3. A joins NET_TWO with no disconnect in between. ===
const joinedTwo = await post(NETWORK, join(alice, A_WS_NAME, NET_TWO));
const localIpTwo = (joinedTwo.body as { local_ip?: string } | null)?.local_ip;
check(
  'A joins NET_TWO and is given an address there',
  joinedTwo.status === 200 &&
    typeof localIpTwo === 'string' &&
    localIpTwo === (await leasedAddress(alice, NET_TWO)),
  `status=${joinedTwo.status} body=${JSON.stringify(joinedTwo.body)}`,
);
check(
  'A’s box occupies NET_TWO alone: the join took it off NET_ONE',
  JSON.stringify(await occupiedBy(alice)) === JSON.stringify([NET_TWO]),
  `networks=${JSON.stringify(await occupiedBy(alice))}`,
);

// === 4. The box left NET_ONE, so every connection held to it through NET_ONE dropped. ===
check(
  'B’s session on A’s box is closed, recorded as the box leaving its network',
  (await sessionState(B_SHELL)) === 'network_left',
  `session=${await sessionState(B_SHELL)}`,
);
check(
  'the session B opened from A’s box went down with it',
  (await sessionState(B_HOP_FROM_A)) === 'upstream_lost',
  `session=${await sessionState(B_HOP_FROM_A)}`,
);
check(
  'A’s own root shell on their own box is still open',
  (await sessionState(A_OWN_ROOT)) === 'open',
  `session=${await sessionState(A_OWN_ROOT)}`,
);

// === 5. On NET_ONE, A's box is gone. ===
const seenByCarol = await occupantIdsSeenBy(carol, NET_ONE);
check(
  'C no longer sees A’s box among NET_ONE’s occupants',
  !seenByCarol.includes(A_WS) && seenByCarol.length === 1,
  `occupants=${JSON.stringify(seenByCarol)}`,
);
const retry = await sshAsBob(B_RETRY, A_LAN);
check(
  'B cannot log in at A’s old NET_ONE address',
  retry.status !== 200 && (await sessionState(B_RETRY)) === 'missing',
  `status=${retry.status} body=${JSON.stringify(retry.body)}`,
);

await clean();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
