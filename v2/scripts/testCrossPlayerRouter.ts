// Wire-payload smoke for Story 5.2 — B attacks A's ROUTER (cross-player router
// takeover). Drives the REAL /api/network + /api/patches endpoints against a running
// `vercel dev` + supabase, seeding A's registry + B's sessions via service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - Slice 5.2.1 READ: resolveCrossPlayerFs resolves a ROUTER machine_id (the
//     discriminated registry reverse-lookup matching router_machine_id) and
//     materializes the ROUTER tree (rules.v4 present, root-only appliance → no guest).
//   - Slice 5.2.2 WRITE: upsertPatch on A's router id takes the L2 foreign-router
//     branch (buildRouterBaseFs(owner_key)), so B (root) writes A's rules.v4; it
//     persists to A's shared ROUTER journal attributed to B, and A's public scan
//     reflects the new forward.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testCrossPlayerRouter.ts
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
import { md5 } from '../src/core/generation/md5';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec';
import type { Directory, FileNode } from '../src/core/filesystem/types';

const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
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

const treeOf = (body: unknown): Directory | null => {
  const tree = (body as { tree?: SerializedDirectory } | null)?.tree;
  return tree ? deserializeTree(tree) : null;
};

const get = (tree: Directory, ...segments: readonly string[]): FileNode | undefined => {
  let node: FileNode | undefined = tree;
  for (const segment of segments) {
    if (node === undefined || node.kind !== 'directory') return undefined;
    node = node.entries.get(segment);
  }
  return node;
};
const fileContent = (node: FileNode | undefined): string | null =>
  node?.kind === 'file' ? node.content : null;

// --- Identities: A (owner), B (root session on A's ROUTER), C (no session),
//     D (a non-root session on A's router — should be denied). ---
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();
const dave = generateIdentity();

const ESSID = 'ABSTERGO-NET';
const A_WS = computeWorkstationId('skylab', alice.publicKeyHex);
const A_ROUTER = computeApGatewayId(ESSID);
const A_PUBLIC_IP = '203.0.113.91';
// A's workstation answers at the address A LEASES on its ESSID, so the NAT forward
// below must name that address — a forward aimed anywhere else reaches no host.
const A_OCTET = 11;
const A_LAN = lanAddressFor(ESSID, A_OCTET); // A's ws LAN ip
const ROOT_HASH = md5('alice-root-secret');
const RULES = '/etc/iptables/rules.v4';
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };
const WORLD_PID = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };
// B's edit: open a forward exposing A's workstation sshd on the public :2222.
const FORWARD_RULES = `# /etc/iptables/rules.v4 — NAT port-forward table\nforward 2222 to ${A_LAN}:22\n`;

// Clean slate, then seed A's registry row (as the join would) + B's ROOT session on
// A's ROUTER (as the 5.1.2 `ssh root@<A.publicIp>` login would), D's guest session on
// the router (the denial case), and B's guest session on A's WORKSTATION (regression).
await sr.from('network_public_ips').delete().eq('public_ip', A_PUBLIC_IP);
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('network_lan_leases').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', A_ROUTER);
await sr.from('patches').delete().eq('machine_id', A_WS);
for (const id of [bob, carol, dave]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}
await sr
  .from('network_lan_leases')
  .insert({ essid: ESSID, owner_key: alice.publicKeyHex, octet: A_OCTET });
// The join state a real `registerNetwork` writes: the AP's public IP, plus the owner
// as an OCCUPANT of its ESSID — occupancy is what makes a box reachable.
await sr.from('network_public_ips').insert({ essid: ESSID, public_ip: A_PUBLIC_IP });
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
    session_id: `ssh-bob-router-${A_PUBLIC_IP}`,
    player_key: bob.publicKeyHex,
    machine_id: A_ROUTER,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid: ESSID,
  },
  {
    session_id: `ssh-dave-router-${A_PUBLIC_IP}`,
    player_key: dave.publicKeyHex,
    machine_id: A_ROUTER,
    credentials: { username: 'guest', userType: 'guest' },
    kind: 'ssh',
    essid: ESSID,
  },
  {
    session_id: `ssh-bob-ws-${A_PUBLIC_IP}`,
    player_key: bob.publicKeyHex,
    machine_id: A_WS,
    credentials: { username: 'guest', userType: 'guest' },
    kind: 'ssh',
    essid: ESSID,
  },
]);

// A brings her workstation sshd up (own-box write, L1 bypass) so a forward to it
// shows live in B's later scan.
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

// 1. READ (5.2.1): B (root session on A's router) resolves A's ROUTER FS → the router
//    tree, not the workstation. rules.v4 present; root-only appliance → no `guest`.
const r1 = await post(NETWORK, signRequest(bob, 'resolveCrossPlayerFs', { machine_id: A_ROUTER }));
const tree1 = r1.status === 200 ? treeOf(r1.body) : null;
const rules1 = tree1 ? fileContent(get(tree1, 'etc', 'iptables', 'rules.v4')) : null;
const passwd1 = tree1 ? fileContent(get(tree1, 'etc', 'passwd')) : '';
check(
  'B (root) reads A’s ROUTER tree: rules.v4 present, root-only (no guest)',
  r1.status === 200 && rules1 !== null && !(passwd1 ?? '').includes('guest'),
  `status=${r1.status} rules=${rules1 === null ? 'absent' : 'present'} guestInPasswd=${(passwd1 ?? '').includes('guest')}`,
);

// 2. WRITE (5.2.2): B (root) writes A's rules.v4 → 200 (L2 foreign-router branch).
const w2 = await post(
  PATCHES,
  signRequest(bob, 'upsertPatch', {
    machine_id: A_ROUTER,
    path: RULES,
    content: FORWARD_RULES,
    owner: 'root',
    permissions: ROOT_ONLY,
    node_type: 'file',
  }),
);
check(
  'B (root) writes A’s /etc/iptables/rules.v4 → 200',
  w2.status === 200,
  `status=${w2.status} error=${errorOf(w2.body) ?? '-'}`,
);

// 3. PERSIST: the row landed on A's ROUTER journal, attributed to B, server-stamped.
const { data: rows3 } = await sr
  .from('patches')
  .select('writer_key, content, updated_at')
  .eq('machine_id', A_ROUTER)
  .eq('path', RULES);
const bRow = (rows3 ?? []).find((row) => row.writer_key === bob.publicKeyHex);
check(
  'rules.v4 persists on A’s ROUTER journal, attributed to B, server-stamped',
  bRow?.content === FORWARD_RULES && typeof bRow?.updated_at === 'string',
  `rows=${rows3?.length ?? 0} writer=${bRow ? 'B' : '-'} ts=${bRow?.updated_at ?? '-'}`,
);

// 4. READ-BACK: B's cross-player router read now reflects its own edit.
const r4 = await post(NETWORK, signRequest(bob, 'resolveCrossPlayerFs', { machine_id: A_ROUTER }));
const rules4 =
  r4.status === 200 ? fileContent(get(treeOf(r4.body)!, 'etc', 'iptables', 'rules.v4')) : null;
check(
  'B’s router read reflects its rules.v4 edit',
  rules4 === FORWARD_RULES,
  `status=${r4.status} match=${rules4 === FORWARD_RULES}`,
);

// 5. SCAN reflects (headline): any scanner of A's public IP now sees :2222 (the new
//    forward) alongside the router's own :22 — A's ws sshd is up, so the forward is live.
const s5 = await post(NETWORK, signRequest(carol, 'resolvePublicScan', { target: A_PUBLIC_IP }));
const ports5 = portsOf(s5.body);
check(
  'after B’s edit, nmap <A.publicIp> shows the new :2222 (+ router’s :22)',
  s5.status === 200 && ports5.includes(2222) && ports5.includes(22),
  `status=${s5.status} ports=[${ports5.join(',')}]`,
);

// 6. BOUNDARY (no session): C writing A's router rules.v4 → 403 no_session (L1), no row.
const w6 = await post(
  PATCHES,
  signRequest(carol, 'upsertPatch', {
    machine_id: A_ROUTER,
    path: RULES,
    content: 'forward 9999 to 10.0.0.5:22\n',
    owner: 'root',
  }),
);
const { data: rows6 } = await sr
  .from('patches')
  .select('writer_key')
  .eq('machine_id', A_ROUTER)
  .eq('writer_key', carol.publicKeyHex);
check(
  'C (no session) write to A’s router → 403 no_session, no row',
  w6.status === 403 && errorOf(w6.body) === 'no_session' && (rows6?.length ?? 0) === 0,
  `status=${w6.status} error=${errorOf(w6.body)} rows=${rows6?.length ?? 0}`,
);

// 7. BOUNDARY (non-root): D (a guest session on the router) writing the root-only
//    rules.v4 → 403 permission_denied (L2 tier gate), no row.
const w7 = await post(
  PATCHES,
  signRequest(dave, 'upsertPatch', {
    machine_id: A_ROUTER,
    path: RULES,
    content: 'forward 8888 to 10.0.0.6:22\n',
    owner: 'root',
  }),
);
const { data: rows7 } = await sr
  .from('patches')
  .select('writer_key')
  .eq('machine_id', A_ROUTER)
  .eq('writer_key', dave.publicKeyHex);
check(
  'D (guest session) denied writing A’s router rules.v4 → 403 permission_denied, no row',
  w7.status === 403 && errorOf(w7.body) === 'permission_denied' && (rows7?.length ?? 0) === 0,
  `status=${w7.status} error=${errorOf(w7.body)} rows=${rows7?.length ?? 0}`,
);

// 8. REGRESSION: the same reverse-lookup still resolves a WORKSTATION id — B (guest
//    session on A's ws) reads A's workstation tree, NOT a router. At the guest tier
//    /home/alice is correctly pruned, so assert a guest-readable workstation marker
//    (/bin) is present AND the router-only /etc/iptables is absent (proves ws, not router).
const r8 = await post(NETWORK, signRequest(bob, 'resolveCrossPlayerFs', { machine_id: A_WS }));
const tree8 = r8.status === 200 ? treeOf(r8.body) : null;
const hasBin = tree8 !== null && get(tree8, 'bin')?.kind === 'directory';
const hasIptables = tree8 !== null && get(tree8, 'etc', 'iptables') !== undefined;
check(
  'workstation read still works: B reads A’s WORKSTATION tree (/bin present, no router /etc/iptables)',
  r8.status === 200 && hasBin && !hasIptables,
  `status=${r8.status} bin=${hasBin ? 'present' : 'absent'} iptables=${hasIptables ? 'present' : 'absent'}`,
);

// Cleanup.
await sr.from('network_public_ips').delete().eq('public_ip', A_PUBLIC_IP);
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('network_lan_leases').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', A_ROUTER);
await sr.from('patches').delete().eq('machine_id', A_WS);
for (const id of [bob, carol, dave]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
