// Wire-payload smoke for POST /api/network (resolveCrossPlayerFs) — Story 2, 2c+2d.
//
// The cross-player READ is the security-load-bearing path: a caller fetches A's
// filesystem SERVER-side, pruned to the caller's TIER. The wire IS the threat
// surface, so this forges signed envelopes against a running `vercel dev` and
// asserts the RESPONSE BODY never contains a path the tier may not read. Covers all
// three tiers: owner (full), active guest session (walker filter plus the
// externally-observable allowlist), no session (that allowlist only). A session never
// shows less than none: a page narrowed to root on a workstation and the NAT table of
// the access point's gateway both reach a lower-tier session, root-only as they are.
//
// Seeds A's occupancy row + patches (guest-readable loot, a user-only secret, a
// root-only key file, a web page narrowed to root, the sshd pidfile) and the sessions
// directly via service_role, then drives the real endpoint. Self-cleaning.
//
// Usage (with v2 supabase + vercel dev running):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/testCrossPlayerRead.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentityIn } from '../src/test/factories/identityIn.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { md5 } from '../src/core/generation/md5.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import type { Directory, FileNode } from '../src/core/filesystem/types.js';

const ENDPOINT = process.env.ENDPOINT ?? 'http://localhost:3100/api/network';
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
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

const get = (tree: Directory, ...segments: readonly string[]): FileNode | undefined => {
  let node: FileNode | undefined = tree;
  for (const segment of segments) {
    if (node === undefined || node.kind !== 'directory') return undefined;
    node = node.entries.get(segment);
  }
  return node;
};

// --- Identities: A (owner), B (has a guest session on A), C (no session). ---
const alice = generateIdentityIn(RIDGEMONT);
const bob = generateIdentityIn(RIDGEMONT);
const carol = generateIdentityIn(RIDGEMONT);
const A_MACHINE = computeWorkstationId('skylab', alice.publicKeyHex);
const ROOT_HASH = md5('alice-root-secret');

const worldReadable = { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] };
const userOnly = { read: ['root', 'user'], write: ['root'], execute: ['root'] };
const rootOnly = { read: ['root'], write: ['root'], execute: [] };

// Seed A's occupancy row (as 2a's join would persist it).
await sr.from('home_network_occupants').delete().eq('essid', 'BEAN-THERE-WIFI');
// The join state a real `registerNetwork` writes: the owner as an OCCUPANT of
// its ESSID — occupancy is what makes a box reachable.
await sr.from('home_network_occupants').insert({
  essid: 'BEAN-THERE-WIFI',
  owner_key: alice.publicKeyHex,
  workstation_machine_id: A_MACHINE,
  workstation_username: 'alice',
  workstation_machine_name: 'skylab',
  workstation_root_hash: ROOT_HASH,
});

// Seed A's machine-scoped patches (shared journal): guest-readable loot, user-only
// secret, sshd pidfile — all written by A (writer_key = owner).
await sr.from('patches').delete().eq('machine_id', A_MACHINE);
await sr.from('patches').insert([
  {
    writer_key: alice.publicKeyHex,
    machine_id: A_MACHINE,
    path: '/srv/loot.txt',
    content: 'OWNED_BY_A',
    owner: 'root',
    permissions: worldReadable,
    node_type: 'file',
  },
  {
    writer_key: alice.publicKeyHex,
    machine_id: A_MACHINE,
    path: '/srv/secret.txt',
    content: 'TOP_SECRET',
    owner: 'root',
    permissions: userOnly,
    node_type: 'file',
  },
  {
    writer_key: alice.publicKeyHex,
    machine_id: A_MACHINE,
    path: '/srv/keys.txt',
    content: 'ROOT_KEYS',
    owner: 'root',
    permissions: rootOnly,
    node_type: 'file',
  },
  {
    writer_key: alice.publicKeyHex,
    machine_id: A_MACHINE,
    path: '/var/www/html/staff.html',
    content: 'STAFF_ONLY',
    owner: 'root',
    permissions: rootOnly,
    node_type: 'file',
  },
  {
    writer_key: alice.publicKeyHex,
    machine_id: A_MACHINE,
    path: '/var/run/sshd.pid',
    content: 'sshd:port=22',
    owner: 'root',
    permissions: worldReadable,
    node_type: 'file',
  },
]);

// Seed B's active guest session on A's workstation (as 2b's login would write it).
const bobSession = `ssh-bob-${Date.now()}`;
await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);
await sr.from('sessions').insert({
  session_id: bobSession,
  player_key: bob.publicKeyHex,
  machine_id: A_MACHINE,
  credentials: { username: 'guest', userType: 'guest' },
  kind: 'ssh',
  essid: 'BEAN-THERE-WIFI',
});

// 1. B (guest session) reads A's box → 200, sees A's real guest-readable file.
const r1 = await post(signRequest(bob, 'resolveCrossPlayerFs', { machine_id: A_MACHINE }));
const tree1 =
  r1.status === 200 ? deserializeTree((r1.body as { tree: SerializedDirectory }).tree) : null;
const loot = tree1 ? get(tree1, 'srv', 'loot.txt') : undefined;
check(
  'B (guest) reads A’s real guest-readable file',
  r1.status === 200 && loot?.kind === 'file' && loot.content === 'OWNED_BY_A',
  `status=${r1.status} loot=${loot?.kind === 'file' ? loot.content : 'absent'}`,
);

// 2. The wire body never leaks a forbidden path/content (the threat surface).
const wire1 = JSON.stringify(r1.body);
check(
  'wire omits the user-only secret, the root hash, /etc/passwd, and /root',
  !wire1.includes('TOP_SECRET') &&
    !wire1.includes('ROOT_KEYS') &&
    !wire1.includes(ROOT_HASH) &&
    tree1 !== null &&
    get(tree1, 'srv', 'secret.txt') === undefined &&
    get(tree1, 'srv', 'keys.txt') === undefined &&
    get(tree1, 'etc', 'passwd') === undefined &&
    get(tree1, 'root') === undefined,
  `secret=${wire1.includes('TOP_SECRET')} hash=${wire1.includes(ROOT_HASH)} passwd=${tree1 ? get(tree1, 'etc', 'passwd') !== undefined : 'n/a'}`,
);

// 2b. A page somebody narrowed to root still reaches the guest session: the web server
// hands it to anyone outside, so holding a session must not hide it. It arrives with
// its own permissions, which is what keeps the shell from printing it.
const page1 = tree1 ? get(tree1, 'var', 'www', 'html', 'staff.html') : undefined;
check(
  'B (guest) is served the page narrowed to root, still readable by root alone',
  page1?.kind === 'file' &&
    page1.content === 'STAFF_ONLY' &&
    JSON.stringify(page1.perms.read) === '["root"]',
  `page=${page1?.kind === 'file' ? page1.content : 'absent'} read=${JSON.stringify(page1?.perms.read)}`,
);

// 3. Tier 3 — a caller with NO session on A's box sees ONLY the externally-
// observable allowlist: the sshd pidfile leaks (port liveness), but the guest-
// readable loot, the user-only secret, /etc/passwd and /root all default-deny.
const r3 = await post(signRequest(carol, 'resolveCrossPlayerFs', { machine_id: A_MACHINE }));
const tree3 =
  r3.status === 200 ? deserializeTree((r3.body as { tree: SerializedDirectory }).tree) : null;
const wire3 = JSON.stringify(r3.body);
const pid3 = tree3 ? get(tree3, 'var', 'run', 'sshd.pid') : undefined;
check(
  'tier 3 (no session) → 200 allowlist-only: pidfile leaks, everything else default-denies',
  r3.status === 200 &&
    pid3?.kind === 'file' &&
    tree3 !== null &&
    get(tree3, 'srv', 'loot.txt') === undefined &&
    get(tree3, 'srv', 'secret.txt') === undefined &&
    get(tree3, 'etc', 'passwd') === undefined &&
    get(tree3, 'root') === undefined &&
    !wire3.includes('OWNED_BY_A') &&
    !wire3.includes('TOP_SECRET') &&
    !wire3.includes(ROOT_HASH),
  `status=${r3.status} pid=${pid3?.kind === 'file' ? 'present' : 'absent'} loot=${tree3 ? get(tree3, 'srv', 'loot.txt') !== undefined : 'n/a'} secret=${wire3.includes('TOP_SECRET')}`,
);

// 3a. Everything the caller with no session was served, the guest session was served too.
const filesOf = (directory: Directory, prefix: string): readonly string[] =>
  [...directory.entries].flatMap(([name, node]) =>
    node.kind === 'directory' ? filesOf(node, `${prefix}/${name}`) : [`${prefix}/${name}`],
  );
const strangerFiles = tree3 ? filesOf(tree3, '') : [];
const heldBack = tree1
  ? strangerFiles.filter((file) => !filesOf(tree1, '').includes(file))
  : ['n/a'];
check(
  'a guest session is served every file a caller with no session is',
  strangerFiles.includes('/var/www/html/staff.html') && heldBack.length === 0,
  `stranger=${strangerFiles.length} files, held back from the session=${JSON.stringify(heldBack)}`,
);

// 3b. Tier 1 — the OWNER (A) reads its own box in full: even the user-only secret
// and /etc/passwd (with A's real root hash) are returned. Ownership trumps tier.
const r3b = await post(signRequest(alice, 'resolveCrossPlayerFs', { machine_id: A_MACHINE }));
const tree3b =
  r3b.status === 200 ? deserializeTree((r3b.body as { tree: SerializedDirectory }).tree) : null;
const secret3b = tree3b ? get(tree3b, 'srv', 'secret.txt') : undefined;
const passwd3b = tree3b ? get(tree3b, 'etc', 'passwd') : undefined;
check(
  'tier 1 (owner) → 200 FULL tree: user-only secret + /etc/passwd present',
  r3b.status === 200 &&
    secret3b?.kind === 'file' &&
    secret3b.content === 'TOP_SECRET' &&
    passwd3b?.kind === 'file' &&
    passwd3b.content.includes(ROOT_HASH),
  `status=${r3b.status} secret=${secret3b?.kind === 'file' ? 'present' : 'absent'} passwd=${passwd3b?.kind === 'file' ? 'present' : 'absent'}`,
);

// 4. An unregistered machine → 404 host_unreachable.
const r4 = await post(
  signRequest(bob, 'resolveCrossPlayerFs', {
    machine_id: computeWorkstationId('ghost', 'e'.repeat(64)),
  }),
);
check(
  'unregistered machine → 404 host_unreachable',
  r4.status === 404 && errorOf(r4.body) === 'host_unreachable',
  `status=${r4.status} error=${errorOf(r4.body)}`,
);

// 5. Tampered signature rejected before any lookup.
const env5 = signRequest(bob, 'resolveCrossPlayerFs', { machine_id: A_MACHINE });
const r5 = await post({ ...env5, payload: `${env5.payload} ` });
check(
  'tampered signature → 401',
  r5.status === 401,
  `status=${r5.status} error=${errorOf(r5.body)}`,
);

// 6. Client-supplied player_key rejected.
const r6 = await post(
  signRequest(bob, 'resolveCrossPlayerFs', { machine_id: A_MACHINE, player_key: 'forged' }),
);
check(
  'client player_key → 400',
  r6.status === 400,
  `status=${r6.status} error=${errorOf(r6.body)}`,
);

// 7. The access point's gateway keeps its NAT table root-only, and a scan from outside
// reveals what it forwards. A lower-tier session there is served the file as it is.
const GATEWAY = computeApGatewayId('BEAN-THERE-WIFI');
const gatewayHolders: string[] = [];
for (const userType of ['guest', 'user'] as const) {
  const holder = generateIdentityIn(RIDGEMONT);
  gatewayHolders.push(holder.publicKeyHex);
  await sr.from('sessions').insert({
    session_id: `gw-${userType}-${Date.now()}`,
    player_key: holder.publicKeyHex,
    machine_id: GATEWAY,
    credentials: { username: userType, userType },
    kind: 'ssh',
    essid: 'BEAN-THERE-WIFI',
  });
  const served = await post(signRequest(holder, 'resolveCrossPlayerFs', { machine_id: GATEWAY }));
  const gatewayTree =
    served.status === 200
      ? deserializeTree((served.body as { tree: SerializedDirectory }).tree)
      : null;
  const rules = gatewayTree ? get(gatewayTree, 'etc', 'iptables', 'rules.v4') : undefined;
  check(
    `a ${userType} session on the access point's gateway is served rules.v4, readable by root alone`,
    served.status === 200 &&
      rules?.kind === 'file' &&
      JSON.stringify(rules.perms.read) === '["root"]' &&
      gatewayTree !== null &&
      get(gatewayTree, 'root') === undefined,
    `status=${served.status} rules=${rules?.kind ?? 'absent'} read=${JSON.stringify(rules?.perms.read)}`,
  );
}

// Cleanup.
await sr.from('home_network_occupants').delete().eq('essid', 'BEAN-THERE-WIFI');
await sr.from('patches').delete().eq('machine_id', A_MACHINE);
await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);
for (const key of gatewayHolders) await sr.from('sessions').delete().eq('player_key', key);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
