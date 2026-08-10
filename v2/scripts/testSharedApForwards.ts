// Wire-payload smoke for the shared-AP NAT surface — EVERY occupant of one access
// point is forward-reachable, not just one of them. Drives the REAL /api/network +
// /api/sessions endpoints against a running `vercel dev` + supabase, seeding two
// occupants' join state (public IP, leases, occupancy) via service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - The public scan lists the gateway's own :22 PLUS a live forward for EACH
//     occupant that published one — resolved through `network_lan_leases` +
//     `home_network_occupants` read by essid, not a single-occupant lookup.
//   - `ssh -p <forwarded port>` lands on the occupant who LEASES the address that
//     forward names, and validates against THAT box's passwd — so one occupant's
//     credentials do not open another's forward.
//   - The auth.log trace lands on the box the forward reached, under ITS owner's key.
//   - Occupancy is still the reachability test: an occupant who leaves the WiFi keeps
//     the lease but loses the forward, while the other occupant's stays up.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSharedApForwards.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { lanAddressFor } from '../src/core/network/lanAddress';
import { formatPidfileContent } from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { workstationGuestPassword } from '../src/core/generation/workstationFs';
import { md5 } from '../src/core/generation/md5';
import { clearPublicIps, seedPublicIps } from './networkFixture';

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

const portsOf = (body: unknown): readonly number[] =>
  ((body as { ports?: readonly { port?: number }[] } | null)?.ports ?? [])
    .map((entry) => entry.port)
    .filter((port): port is number => typeof port === 'number');

const machineOf = (body: unknown): string | undefined =>
  (body as { machine_id?: string } | null)?.machine_id;

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

const AUTH_LOG = '/var/log/auth.log';

/** Read a machine's auth.log row keyed by the OWNER's writer_key — the row the system
 *  accretes every attacker's line into. */
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

// --- Identities: A + B share ONE access point; C is an outsider who scans and attacks
//     it from elsewhere. ---
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();

const ESSID = 'SYNDICATE-MESH';
const C_ESSID = 'CYBERDYNE-GUEST';
const AP_GATEWAY = computeApGatewayId(ESSID);
const AP_PUBLIC_IP = '203.0.113.94';
const C_PUBLIC_IP = '192.0.2.94';

const A_WS_NAME = 'skylab';
const B_WS_NAME = 'nebuchadnezzar';
const A_WS = computeWorkstationId(A_WS_NAME, alice.publicKeyHex);
const B_WS = computeWorkstationId(B_WS_NAME, bob.publicKeyHex);
// Two distinct leases on the one `/24`. A holds the LOWER octet — she joined first, so
// under the old single-host NAT lookup B's forward was the only reachable one and A's
// was dead. Both must work now.
const A_OCTET = 21;
const B_OCTET = 34;
const A_LAN = lanAddressFor(ESSID, A_OCTET);
const B_LAN = lanAddressFor(ESSID, B_OCTET);

const A_GUEST_PW = workstationGuestPassword(alice.publicKeyHex);
const B_GUEST_PW = workstationGuestPassword(bob.publicKeyHex);

const RULES = '/etc/iptables/rules.v4';
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };
const WORLD_PID = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };
// One shared gateway, one shared NAT table, one line per occupant.
const FORWARD_RULES = [
  '# /etc/iptables/rules.v4 — NAT port-forward table',
  `forward 2222 to ${A_LAN}:22`,
  `forward 3333 to ${B_LAN}:22`,
  '',
].join('\n');

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

const sshdPidRow = (machineId: string, ownerKey: string) => ({
  machine_id: machineId,
  path: '/var/run/sshd.pid',
  content: formatPidfileContent(SERVICE_CATALOG.ssh, 22),
  owner: 'root',
  permissions: WORLD_PID,
  node_type: 'file',
  writer_key: ownerKey,
  updated_at: new Date().toISOString(),
});

const clean = async () => {
  await clearPublicIps(sr, [
    { essid: ESSID, publicIp: AP_PUBLIC_IP },
    { essid: C_ESSID, publicIp: C_PUBLIC_IP },
  ]);
  await sr.from('home_network_occupants').delete().in('essid', [ESSID, C_ESSID]);
  // Leases are permanent by design, so a re-run would otherwise find the octets held.
  await sr.from('network_lan_leases').delete().in('essid', [ESSID, C_ESSID]);
  for (const machineId of [AP_GATEWAY, A_WS, B_WS]) {
    await sr.from('patches').delete().eq('machine_id', machineId);
  }
  await sr.from('sessions').delete().eq('player_key', carol.publicKeyHex);
};

// Clean slate, then seed the join state a real `registerNetwork` writes for all three
// players — the AP's public IP, each occupant's lease, then the occupancy row — plus the
// gateway's shared NAT table and both occupants' running sshd.
await clean();
await seedPublicIps(sr, [
  { essid: ESSID, publicIp: AP_PUBLIC_IP },
  { essid: C_ESSID, publicIp: C_PUBLIC_IP },
]);
await sr.from('network_lan_leases').insert([
  { essid: ESSID, owner_key: alice.publicKeyHex, octet: A_OCTET },
  { essid: ESSID, owner_key: bob.publicKeyHex, octet: B_OCTET },
  { essid: C_ESSID, owner_key: carol.publicKeyHex, octet: 42 },
]);
await sr
  .from('home_network_occupants')
  .insert([
    occupantRow(alice, ESSID, A_WS_NAME),
    occupantRow(bob, ESSID, B_WS_NAME),
    occupantRow(carol, C_ESSID, 'serenity'),
  ]);
await sr.from('patches').insert([
  {
    machine_id: AP_GATEWAY,
    path: RULES,
    content: FORWARD_RULES,
    owner: 'root',
    permissions: ROOT_ONLY,
    node_type: 'file',
    writer_key: alice.publicKeyHex,
    updated_at: new Date().toISOString(),
  },
  sshdPidRow(A_WS, alice.publicKeyHex),
  sshdPidRow(B_WS, bob.publicKeyHex),
]);

const sshLogin = (attacker: ReturnType<typeof generateIdentity>, fields: Record<string, unknown>) =>
  signRequest(attacker, 'authCreateSessionPublic', { target: AP_PUBLIC_IP, ...fields });

// === 1. The public scan shows BOTH occupants' forwards alongside the gateway's :22. ===
const scan = await post(NETWORK, signRequest(carol, 'resolvePublicScan', { target: AP_PUBLIC_IP }));
const ports = portsOf(scan.body);
check(
  'nmap <AP public IP> lists the gateway :22 AND both occupants’ forwards (:2222, :3333)',
  scan.status === 200 && [22, 2222, 3333].every((port) => ports.includes(port)),
  `status=${scan.status} ports=[${ports.join(',')}]`,
);

// === 2. Each forwarded port lands on the occupant leasing the address it names. ===
const onAlice = await post(
  SESSIONS,
  sshLogin(carol, {
    session_id: 'ssh-c-a-2222',
    username: 'guest',
    password: A_GUEST_PW,
    port: 2222,
  }),
);
check(
  'ssh -p 2222 lands on A’s workstation (the LOWER-octet lease — dead under the old lookup)',
  onAlice.status === 200 && machineOf(onAlice.body) === A_WS,
  `status=${onAlice.status} machine=${machineOf(onAlice.body) ?? '-'}`,
);

const onBob = await post(
  SESSIONS,
  sshLogin(carol, {
    session_id: 'ssh-c-b-3333',
    username: 'guest',
    password: B_GUEST_PW,
    port: 3333,
  }),
);
check(
  'ssh -p 3333 lands on B’s workstation — one gateway, two forwards, two boxes',
  onBob.status === 200 && machineOf(onBob.body) === B_WS,
  `status=${onBob.status} machine=${machineOf(onBob.body) ?? '-'}`,
);

// === 3. Each forward validates against ITS OWN box's passwd. ===
const wrongBox = await post(
  SESSIONS,
  sshLogin(carol, {
    session_id: 'ssh-c-x-2222',
    username: 'guest',
    password: B_GUEST_PW,
    port: 2222,
  }),
);
check(
  'B’s guest password on A’s forwarded port is 401 — the passwd checked is the box reached',
  wrongBox.status === 401 && errorOf(wrongBox.body) === 'invalid_credentials',
  `status=${wrongBox.status} error=${errorOf(wrongBox.body) ?? '-'}`,
);

// === 4. The trace lands on the box the forward reached, under ITS owner's key. ===
const bobLog = await readAuthLog(B_WS, bob.publicKeyHex);
check(
  'the :3333 login is recorded on B’s workstation auth.log under B’s own writer_key',
  bobLog.includes('Accepted password for guest') && bobLog.includes(B_WS_NAME),
  `line=${bobLog.trim().split('\n').slice(-1)[0] ?? '(empty)'}`,
);

// === 5. Occupancy is still the reachability test: B leaves the WiFi (his lease stays,
//        permanently) and only HIS forward goes dark. ===
await sr
  .from('home_network_occupants')
  .delete()
  .eq('essid', ESSID)
  .eq('owner_key', bob.publicKeyHex);

const scanAfter = await post(
  NETWORK,
  signRequest(carol, 'resolvePublicScan', { target: AP_PUBLIC_IP }),
);
const portsAfter = portsOf(scanAfter.body);
check(
  'after B disconnects, his :3333 is gone from the public IP but A’s :2222 stands',
  scanAfter.status === 200 &&
    !portsAfter.includes(3333) &&
    portsAfter.includes(2222) &&
    portsAfter.includes(22),
  `status=${scanAfter.status} ports=[${portsAfter.join(',')}]`,
);

const onDeparted = await post(
  SESSIONS,
  sshLogin(carol, {
    session_id: 'ssh-c-b-3333-gone',
    username: 'guest',
    password: B_GUEST_PW,
    port: 3333,
  }),
);
check(
  'ssh -p 3333 to the departed occupant is host_unreachable, though his lease still names the address',
  onDeparted.status === 404 && errorOf(onDeparted.body) === 'host_unreachable',
  `status=${onDeparted.status} error=${errorOf(onDeparted.body) ?? '-'}`,
);

const stillAlice = await post(
  SESSIONS,
  sshLogin(carol, {
    session_id: 'ssh-c-a-2222-again',
    username: 'guest',
    password: A_GUEST_PW,
    port: 2222,
  }),
);
check(
  'A’s forward still authenticates after B left — one occupant leaving does not close another’s door',
  stillAlice.status === 200 && machineOf(stillAlice.body) === A_WS,
  `status=${stillAlice.status} machine=${machineOf(stillAlice.body) ?? '-'}`,
);

await clean();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
