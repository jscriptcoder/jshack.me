// Wire-payload smoke for Story 5.3 — brick → dark, BOTH directions. Drives the REAL
// /api/network + /api/sessions + /api/patches endpoints against a running `vercel dev`
// + supabase, seeding A's occupancy + B's root sessions via service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - WS brick (Story 5.3, the new dark-gate): B (root on A's WORKSTATION) `rm
//     /boot/vmlinuz` on A's ws journal → the bricked ws drops its forwarded port from
//     A's public scan and refuses ssh-via-forward (host_unreachable), even though its
//     sshd pidfile lingers. The ROUTER still answers its own :22 (only the forward goes).
//   - ROUTER brick (already shipped, verified live end-to-end): B (root on A's ROUTER)
//     `rm /boot/vmlinuz` on A's router journal → A's whole public IP goes dark (scan
//     host-down, public ssh 404).
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testRouterBrick.ts
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
import { clearPublicIps, seedPublicIps } from './networkFixture';

const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
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

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

const portsOf = (body: unknown): readonly number[] =>
  ((body as { ports?: readonly { port?: number }[] } | null)?.ports ?? [])
    .map((entry) => entry.port)
    .filter((port): port is number => typeof port === 'number');

const foundOf = (body: unknown): boolean => (body as { found?: boolean } | null)?.found === true;

const machineIdOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null
    ? (body as { machine_id?: string }).machine_id
    : undefined;

// --- Identities: A (owner), B (root on A's router AND A's workstation — the attacker
//     who has already escalated on both, seeded here), C (a neutral scanner / public
//     ssh client). ---
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();

const ESSID = 'ABSTERGO-NET';
const A_WS = computeWorkstationId('skylab', alice.publicKeyHex);
const A_ROUTER = computeApGatewayId(ESSID);
const A_PUBLIC_IP = '203.0.113.92';
// A's workstation answers at the address A LEASES on its ESSID, so the NAT forward
// below must name that address — a forward aimed anywhere else reaches no host.
const A_OCTET = 11;
const A_LAN = lanAddressFor(ESSID, A_OCTET); // A's ws LAN ip
const ROOT_HASH = md5('alice-root-secret');
const RULES = '/etc/iptables/rules.v4';
const VMLINUZ = '/boot/vmlinuz';
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };
const WORLD_PID = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };
// A's opt-in: open a forward exposing her workstation sshd on the public :2222.
const FORWARD_RULES = `# /etc/iptables/rules.v4 — NAT port-forward table\nforward 2222 to ${A_LAN}:22\n`;
// Seeded secrets the server recovers for a cross-player public login.
const ROUTER_ADMIN_PW = seedApGatewayAdminPw(ESSID);
const WS_GUEST_PW = workstationGuestPassword(alice.publicKeyHex);

// Clean slate, then seed A's occupancy row (as the join would) + B's ROOT sessions on
// A's ROUTER and A's WORKSTATION (as the escalated `su root` would leave them).
await clearPublicIps(sr, [{ essid: ESSID, publicIp: A_PUBLIC_IP }]);
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('network_lan_leases').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', A_ROUTER);
await sr.from('patches').delete().eq('machine_id', A_WS);
for (const id of [alice, bob, carol]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}
await sr
  .from('network_lan_leases')
  .insert({ essid: ESSID, owner_key: alice.publicKeyHex, octet: A_OCTET });
// The join state a real `registerNetwork` writes: the AP's public IP, plus the owner
// as an OCCUPANT of its ESSID — occupancy is what makes a box reachable.
await seedPublicIps(sr, [{ essid: ESSID, publicIp: A_PUBLIC_IP }]);
await sr.from('home_network_occupants').insert({
  essid: ESSID,
  owner_key: alice.publicKeyHex,
  workstation_machine_id: A_WS,
  workstation_username: 'alice',
  workstation_machine_name: 'skylab',
  workstation_root_hash: ROOT_HASH,
});
await sr.from('sessions').insert([
  {
    // A's own-router session (as her `ssh root@<subnet>.1` login leaves it) so she can
    // write her own NAT forward — the own ROUTER needs a session (only the own
    // WORKSTATION bypasses L1).
    session_id: `ssh-alice-router-${A_PUBLIC_IP}`,
    player_key: alice.publicKeyHex,
    machine_id: A_ROUTER,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid: ESSID,
  },
  {
    session_id: `ssh-bob-router-${A_PUBLIC_IP}`,
    player_key: bob.publicKeyHex,
    machine_id: A_ROUTER,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid: ESSID,
  },
  {
    session_id: `ssh-bob-ws-${A_PUBLIC_IP}`,
    player_key: bob.publicKeyHex,
    machine_id: A_WS,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid: ESSID,
  },
]);

// A opts her workstation in: brings its sshd up + writes the NAT forward on her own
// router (both own-box writes, L1 bypass) so the forward to :2222 is live.
await post(
  PATCHES,
  signRequest(alice, 'upsertPatch', {
    machine_id: A_WS,
    path: '/var/run/sshd.pid',
    content: formatPidfileContent(SERVICE_CATALOG.ssh, 22),
    owner: 'root',
    permissions: WORLD_PID,
    is_new: true,
    node_type: 'file',
  }),
);
await post(
  PATCHES,
  signRequest(alice, 'upsertPatch', {
    machine_id: A_ROUTER,
    path: RULES,
    content: FORWARD_RULES,
    owner: 'root',
    permissions: ROOT_ONLY,
    node_type: 'file',
  }),
);

// === Baseline: the forward is live before any brick. ===

// 1. SCAN: A's public IP shows the router's own :22 PLUS the live forward :2222.
const s1 = await post(NETWORK, signRequest(carol, 'resolvePublicScan', { target: A_PUBLIC_IP }));
const ports1 = portsOf(s1.body);
check(
  'baseline: nmap <A.publicIp> shows :22 (router) + :2222 (live forward)',
  s1.status === 200 && ports1.includes(22) && ports1.includes(2222),
  `status=${s1.status} ports=[${ports1.join(',')}]`,
);

// 2. SSH-via-forward: C logs into A's workstation through the forward → 200 on the ws.
const a2 = await post(
  SESSIONS,
  signRequest(carol, 'authCreateSessionPublic', {
    session_id: `c-ws-pre-${A_PUBLIC_IP}`,
    target: A_PUBLIC_IP,
    username: 'guest',
    password: WS_GUEST_PW,
    port: 2222,
  }),
);
check(
  'baseline: ssh guest@<A.publicIp>:2222 reaches the workstation → 200',
  a2.status === 200 && machineIdOf(a2.body) === A_WS,
  `status=${a2.status} machine=${machineIdOf(a2.body) === A_WS ? 'ws' : (machineIdOf(a2.body) ?? '-')}`,
);

// === Direction 1 — WORKSTATION brick: only the forward goes dark. ===

// 3. B (root on A's ws) bricks it: rm /boot/vmlinuz on A's WORKSTATION journal.
const b3 = await post(
  PATCHES,
  signRequest(bob, 'removePatch', { machine_id: A_WS, path: VMLINUZ, owner: 'root' }),
);
check(
  'B (root) bricks A’s WORKSTATION: rm /boot/vmlinuz → 200',
  b3.status === 200,
  `status=${b3.status} error=${errorOf(b3.body) ?? '-'}`,
);

// 4. SCAN after ws brick: the forward :2222 is gone (bricked ws can't answer), but the
//    router still serves its own :22 — bricking the ws only removes its forwarded ports.
const s4 = await post(NETWORK, signRequest(carol, 'resolvePublicScan', { target: A_PUBLIC_IP }));
const ports4 = portsOf(s4.body);
check(
  'ws brick: nmap <A.publicIp> drops :2222, keeps the router’s :22',
  s4.status === 200 && ports4.includes(22) && !ports4.includes(2222),
  `status=${s4.status} ports=[${ports4.join(',')}]`,
);

// 5. SSH-via-forward after ws brick: a bricked DNAT target is host_unreachable, even
//    with a correct guest password (the boot gate wins over liveness + credentials).
const a5 = await post(
  SESSIONS,
  signRequest(carol, 'authCreateSessionPublic', {
    session_id: `c-ws-post-${A_PUBLIC_IP}`,
    target: A_PUBLIC_IP,
    username: 'guest',
    password: WS_GUEST_PW,
    port: 2222,
  }),
);
check(
  'ws brick: ssh guest@<A.publicIp>:2222 → 404 host_unreachable',
  a5.status === 404 && errorOf(a5.body) === 'host_unreachable',
  `status=${a5.status} error=${errorOf(a5.body) ?? '-'}`,
);

// 6. CONTRAST: the ROUTER is untouched — C still logs into it on :22 with the admin pw.
const a6 = await post(
  SESSIONS,
  signRequest(carol, 'authCreateSessionPublic', {
    session_id: `c-router-up-${A_PUBLIC_IP}`,
    target: A_PUBLIC_IP,
    username: 'root',
    password: ROUTER_ADMIN_PW,
  }),
);
check(
  'ws brick: ssh root@<A.publicIp>:22 still authenticates on the router → 200',
  a6.status === 200 && machineIdOf(a6.body) === A_ROUTER,
  `status=${a6.status} machine=${machineIdOf(a6.body) === A_ROUTER ? 'router' : (machineIdOf(a6.body) ?? '-')}`,
);

// === Direction 2 — ROUTER brick: the whole public IP goes dark. ===

// 7. B (root on A's router) bricks it: rm /boot/vmlinuz on A's ROUTER journal.
const b7 = await post(
  PATCHES,
  signRequest(bob, 'removePatch', { machine_id: A_ROUTER, path: VMLINUZ, owner: 'root' }),
);
check(
  'B (root) bricks A’s ROUTER: rm /boot/vmlinuz → 200',
  b7.status === 200,
  `status=${b7.status} error=${errorOf(b7.body) ?? '-'}`,
);

// 8. SCAN after router brick: A's whole public IP is dark — host-down, no ports at all.
const s8 = await post(NETWORK, signRequest(carol, 'resolvePublicScan', { target: A_PUBLIC_IP }));
check(
  'router brick: nmap <A.publicIp> → host down, no ports (whole IP dark)',
  s8.status === 200 && !foundOf(s8.body) && portsOf(s8.body).length === 0,
  `status=${s8.status} found=${foundOf(s8.body)} ports=[${portsOf(s8.body).join(',')}]`,
);

// 9. SSH after router brick: even the router's own :22 is refused → 404 (dark to everyone).
const a9 = await post(
  SESSIONS,
  signRequest(carol, 'authCreateSessionPublic', {
    session_id: `c-router-dark-${A_PUBLIC_IP}`,
    target: A_PUBLIC_IP,
    username: 'root',
    password: ROUTER_ADMIN_PW,
  }),
);
check(
  'router brick: ssh root@<A.publicIp>:22 → 404 host_unreachable (whole IP dark)',
  a9.status === 404 && errorOf(a9.body) === 'host_unreachable',
  `status=${a9.status} error=${errorOf(a9.body) ?? '-'}`,
);

// 10. OWN-LAN ssh after the router brick: a bricked box is dark from INSIDE its own
//     LAN too, not just from the WAN. A herself `ssh root@<her .1>` with the correct
//     seeded admin password → 404. Before this gate the own-LAN handler authenticated
//     against the purely regenerated base FS, which cannot carry a /boot tombstone, so
//     a bricked gateway kept serving ssh to every occupant of its own network.
const gatewayHost = generateHomeLan(ESSID).hosts.find(
  (host) => Number(host.ip.split('.')[3]) === 1,
);
const a10 = await post(
  SESSIONS,
  signRequest(alice, 'authCreateSession', {
    session_id: `a-ownlan-dark-${A_PUBLIC_IP}`,
    essid: ESSID,
    target_ip: gatewayHost?.ip ?? '',
    username: 'root',
    password: ROUTER_ADMIN_PW,
    parent_session_id: null,
    source_ip: A_LAN,
  }),
);
check(
  'router brick: ssh root@<own .1> from INSIDE the LAN → 404 host_unreachable',
  a10.status === 404 && errorOf(a10.body) === 'host_unreachable',
  `status=${a10.status} error=${errorOf(a10.body) ?? '-'} target=${gatewayHost?.ip ?? '-'}`,
);

// Cleanup.
await clearPublicIps(sr, [{ essid: ESSID, publicIp: A_PUBLIC_IP }]);
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('network_lan_leases').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', A_ROUTER);
await sr.from('patches').delete().eq('machine_id', A_WS);
for (const id of [alice, bob, carol]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
