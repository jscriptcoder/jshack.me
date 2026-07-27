// Wire-payload smoke: bricking a shared AP gateway kills the WAN but leaves the LAN
// alive. Drives the REAL /api/network + /api/sessions + /api/patches endpoints against
// a running `vercel dev` + supabase.
//
// Since the gateway became ONE shared machine per ESSID, a brick is no longer one
// player's private loss — it is a permanent scar on a network every current and future
// occupant shares. That makes the blast radius the thing worth pinning down: a brick
// must take the AP's public IP dark FOREVER without erasing the network behind it, or a
// single early griefer could delete an access point from the world for everyone.
//
// The model: an access point is radio + switch + router in one box. Bricking it kills
// the ROUTER (WAN routing and the box's own management plane, on every interface);
// radio and switching are dumb and survive. So:
//   DARK  — public scan, public ssh, and ssh to the gateway from INSIDE its own LAN.
//   ALIVE — the ESSID still admits new joiners, occupants still scan the subnet, and
//           occupant-to-occupant ssh still works.
//
// The own-LAN direction is what this slice added: the own-LAN handler used to auth
// against the purely regenerated base FS, which cannot carry a /boot tombstone, so a
// bricked gateway kept serving ssh to every occupant. Only a live endpoint proves the
// api/ adapter feeds it the journal — `tsc` cannot see a missing dep wiring.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testGatewayBrickLanAlive.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { lanAddressFor } from '../src/core/network/lanAddress';
import { generateHomeLan } from '../src/core/generation/generateHomeLan';
import { formatPidfileContent } from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { md5 } from '../src/core/generation/md5';
import { seedApGatewayAdminPw } from '../src/core/generation/routerFs';
import { workstationGuestPassword } from '../src/core/generation/workstationFs';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

const results: { readonly pass: boolean }[] = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
};

const post = async (endpoint: string, envelope: unknown) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const errorOf = (body: unknown): string | undefined =>
  (body as { error?: string } | null)?.error;
const portsOf = (body: unknown): readonly number[] =>
  (body as { ports?: readonly { port: number }[] } | null)?.ports?.map((p) => p.port) ?? [];
const foundOf = (body: unknown): boolean => (body as { found?: boolean } | null)?.found === true;
const machineIdOf = (body: unknown): string | undefined =>
  (body as { machine_id?: string } | null)?.machine_id;

// --- Identities: A + B are occupants of one AP; C joins AFTER the brick; D scans from
//     outside. B is the griefer who roots the shared gateway and bricks it. ---
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();
const dave = generateIdentity();

const ESSID = 'BRICKED-AP-WIFI';
const A_WS_NAME = 'skylab';
const B_WS_NAME = 'nebuchadnezzar';
const C_WS_NAME = 'discovery';
const A_WS = computeWorkstationId(A_WS_NAME, alice.publicKeyHex);
const GATEWAY = computeApGatewayId(ESSID);
/** The address the server ISSUED this occupant on join — read back from the lease it
 *  allocated, never re-derived. The lease is the address of record; deriving one here
 *  would be asserting against a second source of truth. */
const leasedAddress = async (owner: ReturnType<typeof generateIdentity>): Promise<string> => {
  const { data } = await sr
    .from('network_lan_leases')
    .select('octet')
    .eq('essid', ESSID)
    .eq('owner_key', owner.publicKeyHex)
    .maybeSingle();
  const octet = (data as { octet: number } | null)?.octet;
  if (octet === undefined) throw new Error(`no lan lease for ${owner.publicKeyHex.slice(0, 8)}`);
  return lanAddressFor(ESSID, octet);
};
const A_GUEST_PW = workstationGuestPassword(alice.publicKeyHex);
const ADMIN_PW = seedApGatewayAdminPw(ESSID);
const VMLINUZ = '/boot/vmlinuz';
const WORLD_PID = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };

/** The `.1` of the ESSID's LAN — the shared AP gateway, the same address for every
 *  occupant. */
const AP_GATEWAY_IP =
  generateHomeLan(ESSID).hosts.find((host) => Number(host.ip.split('.')[3]) === 1)?.ip ?? '';

const join = (owner: ReturnType<typeof generateIdentity>, wsName: string) =>
  signRequest(owner, 'registerNetwork', {
    essid: ESSID,
    workstation_machine_id: computeWorkstationId(wsName, owner.publicKeyHex),
    workstation_username: 'player',
    workstation_machine_name: wsName,
    workstation_root_hash: md5('root-secret'),
  });

// Clean slate for this ESSID.
await sr.from('network_public_ips').delete().eq('essid', ESSID);
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('network_lan_leases').delete().eq('essid', ESSID);
await sr.from('network_registry').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', GATEWAY);
await sr.from('patches').delete().eq('machine_id', A_WS);
for (const id of [alice, bob, carol, dave]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}

// A and B join the SAME AP through the real endpoint — one shared gateway, one shared
// public IP, two occupancy rows.
await post(NETWORK, join(alice, A_WS_NAME));
await post(NETWORK, join(bob, B_WS_NAME));

const A_LAN = await leasedAddress(alice);
const B_LAN = await leasedAddress(bob);

const allocated = await sr
  .from('network_public_ips')
  .select('public_ip')
  .eq('essid', ESSID)
  .maybeSingle();
const PUBLIC_IP = (allocated.data as { public_ip?: string } | null)?.public_ip ?? '';
check(
  'setup: the AP allocated one shared public IP for the ESSID',
  PUBLIC_IP.length > 0,
  `public_ip=${PUBLIC_IP || '-'}`,
);

// A's sshd comes up so B has something to reach over the LAN (a fresh box is dark).
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

// B has already rooted the shared gateway (as his `ssh root@<.1>` + crack would leave it).
await sr.from('sessions').insert([
  {
    session_id: `ssh-bob-gw-${ESSID}`,
    player_key: bob.publicKeyHex,
    machine_id: GATEWAY,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid: ESSID,
  },
]);

// === Baseline: before the brick, the gateway answers on both sides. ===

const s0 = await post(NETWORK, signRequest(dave, 'resolvePublicScan', { target: PUBLIC_IP }));
check(
  'baseline: nmap <AP public IP> finds the gateway serving :22',
  s0.status === 200 && foundOf(s0.body) && portsOf(s0.body).includes(22),
  `status=${s0.status} found=${foundOf(s0.body)} ports=[${portsOf(s0.body).join(',')}]`,
);

const l0 = await post(
  SESSIONS,
  signRequest(alice, 'authCreateSession', {
    session_id: `a-gw-baseline-${ESSID}`,
    essid: ESSID,
    target_ip: AP_GATEWAY_IP,
    username: 'root',
    password: ADMIN_PW,
    parent_session_id: null,
    source_ip: A_LAN,
  }),
);
const userTypeOf = (body: unknown): string | undefined =>
  (body as { userType?: string } | null)?.userType;
check(
  'baseline: A ssh root@<own .1> from inside the LAN → 200 root on the shared gateway',
  l0.status === 200 && userTypeOf(l0.body) === 'root',
  `status=${l0.status} userType=${userTypeOf(l0.body) ?? '-'} error=${errorOf(l0.body) ?? '-'}`,
);

// === The brick: B (root on the shared gateway) rm /boot/vmlinuz through the real path. ===

const brick = await post(
  PATCHES,
  signRequest(bob, 'removePatch', { machine_id: GATEWAY, path: VMLINUZ, owner: 'root' }),
);
check(
  'B (root) bricks the SHARED AP gateway: rm /boot/vmlinuz → 200',
  brick.status === 200,
  `status=${brick.status} error=${errorOf(brick.body) ?? '-'}`,
);

// === DARK: the WAN, and the gateway box itself on every interface. ===

const s1 = await post(NETWORK, signRequest(dave, 'resolvePublicScan', { target: PUBLIC_IP }));
check(
  'WAN dark: nmap <AP public IP> → host down, no ports',
  s1.status === 200 && !foundOf(s1.body) && portsOf(s1.body).length === 0,
  `status=${s1.status} found=${foundOf(s1.body)} ports=[${portsOf(s1.body).join(',')}]`,
);

const p1 = await post(
  SESSIONS,
  signRequest(dave, 'authCreateSessionPublic', {
    session_id: `d-public-dark-${ESSID}`,
    target: PUBLIC_IP,
    username: 'root',
    password: ADMIN_PW,
  }),
);
check(
  'WAN dark: ssh root@<AP public IP> → 404 host_unreachable, correct password and all',
  p1.status === 404 && errorOf(p1.body) === 'host_unreachable',
  `status=${p1.status} error=${errorOf(p1.body) ?? '-'}`,
);

const l1 = await post(
  SESSIONS,
  signRequest(alice, 'authCreateSession', {
    session_id: `a-gw-dark-${ESSID}`,
    essid: ESSID,
    target_ip: AP_GATEWAY_IP,
    username: 'root',
    password: ADMIN_PW,
    parent_session_id: null,
    source_ip: A_LAN,
  }),
);
check(
  'box dark: A ssh root@<own .1> from INSIDE the LAN → 404 host_unreachable',
  l1.status === 404 && errorOf(l1.body) === 'host_unreachable',
  `status=${l1.status} error=${errorOf(l1.body) ?? '-'}`,
);

// === ALIVE: the network behind the dead box. ===

const lan1 = await post(
  SESSIONS,
  signRequest(bob, 'authCreateSessionSameLan', {
    session_id: `b-samelan-${ESSID}`,
    essid: ESSID,
    target_ip: A_LAN,
    username: 'guest',
    password: A_GUEST_PW,
    parent_session_id: null,
    source_ip: B_LAN,
  }),
);
check(
  'LAN alive: B ssh guest@<A LAN IP> occupant-to-occupant → 200 on A’s workstation',
  lan1.status === 200 && machineIdOf(lan1.body) === A_WS,
  `status=${lan1.status} error=${errorOf(lan1.body) ?? '-'}`,
);

const subnet = A_LAN.split('.').slice(0, 3).join('.');
// `nmapScan` is served by /api/patches (it writes kern.log traces), not /api/network.
const scan1 = await post(
  PATCHES,
  signRequest(bob, 'nmapScan', {
    essid: ESSID,
    target: `${subnet}.0/24`,
    source_ip: B_LAN,
  }),
);
check(
  'LAN alive: B nmap <subnet>/24 from inside still scans the LAN → 200',
  scan1.status === 200,
  `status=${scan1.status} error=${errorOf(scan1.body) ?? '-'}`,
);

const join1 = await post(NETWORK, join(carol, C_WS_NAME));
const occupants = await sr.from('home_network_occupants').select('owner_key').eq('essid', ESSID);
check(
  'LAN alive: a NEW player can still join the bricked AP → 200, three occupants',
  join1.status === 200 && (occupants.data ?? []).length === 3,
  `status=${join1.status} occupants=${(occupants.data ?? []).length}`,
);

// === Permanence: the scar does not heal on a later join. ===

const s2 = await post(NETWORK, signRequest(dave, 'resolvePublicScan', { target: PUBLIC_IP }));
check(
  'permanent: the AP public IP is still dark after a fresh join',
  s2.status === 200 && !foundOf(s2.body) && portsOf(s2.body).length === 0,
  `status=${s2.status} found=${foundOf(s2.body)} ports=[${portsOf(s2.body).join(',')}]`,
);

// Cleanup.
await sr.from('network_public_ips').delete().eq('essid', ESSID);
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('network_lan_leases').delete().eq('essid', ESSID);
await sr.from('network_registry').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', GATEWAY);
await sr.from('patches').delete().eq('machine_id', A_WS);
for (const id of [alice, bob, carol, dave]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
