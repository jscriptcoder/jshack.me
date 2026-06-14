// Wire-payload smoke for POST /api/network (resolveCrossPlayerFs) — Story 2, slice 2c.
//
// The cross-player READ is the security-load-bearing path: B, holding an active
// session on A's workstation, fetches A's filesystem SERVER-side, pruned to B's tier.
// The wire IS the threat surface, so this forges signed envelopes against a running
// `vercel dev` and asserts the RESPONSE BODY never contains a path B's tier may not
// read — passwd hashes, /root, user-only files — regardless of UI rendering.
//
// Seeds A's registry row + patches (guest-readable loot, a user-only secret, the
// sshd pidfile) and B's guest session directly via service_role, then drives the
// real endpoint. Self-cleaning.
//
// Usage (with v2 supabase + vercel dev running):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/testCrossPlayerRead.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { md5 } from '../src/core/generation/md5';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec';
import type { Directory, FileNode } from '../src/core/filesystem/types';

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
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();
const A_MACHINE = computeWorkstationId('skylab', alice.publicKeyHex);
const A_PUBLIC_IP = '203.0.113.55';
const ROOT_HASH = md5('alice-root-secret');

const worldReadable = { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] };
const userOnly = { read: ['root', 'user'], write: ['root'], execute: ['root'] };

// Seed A's registry row (as 2a's join would persist it).
await sr.from('network_registry').delete().eq('public_ip', A_PUBLIC_IP);
await sr.from('network_registry').insert({
  public_ip: A_PUBLIC_IP,
  owner_key: alice.publicKeyHex,
  workstation_machine_id: A_MACHINE,
  router_machine_id: A_MACHINE,
  forward_table: [{ publicPort: '*', targetMachineId: A_MACHINE }],
  essid: 'BEAN-THERE-WIFI',
  workstation_username: 'alice',
  workstation_machine_name: 'skylab',
  workstation_root_hash: ROOT_HASH,
});

// Seed A's owner-scoped patches: guest-readable loot, user-only secret, sshd pidfile.
await sr.from('patches').delete().eq('player_key', alice.publicKeyHex).eq('machine_id', A_MACHINE);
await sr.from('patches').insert([
  { player_key: alice.publicKeyHex, machine_id: A_MACHINE, path: '/srv/loot.txt', content: 'OWNED_BY_A', owner: 'root', permissions: worldReadable, node_type: 'file' },
  { player_key: alice.publicKeyHex, machine_id: A_MACHINE, path: '/srv/secret.txt', content: 'TOP_SECRET', owner: 'root', permissions: userOnly, node_type: 'file' },
  { player_key: alice.publicKeyHex, machine_id: A_MACHINE, path: '/var/run/sshd.pid', content: 'sshd:port=22', owner: 'root', permissions: worldReadable, node_type: 'file' },
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
const tree1 = r1.status === 200 ? deserializeTree((r1.body as { tree: SerializedDirectory }).tree) : null;
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
    !wire1.includes(ROOT_HASH) &&
    tree1 !== null &&
    get(tree1, 'srv', 'secret.txt') === undefined &&
    get(tree1, 'etc', 'passwd') === undefined &&
    get(tree1, 'root') === undefined,
  `secret=${wire1.includes('TOP_SECRET')} hash=${wire1.includes(ROOT_HASH)} passwd=${tree1 ? get(tree1, 'etc', 'passwd') !== undefined : 'n/a'}`,
);

// 3. A caller with NO session on A's box is denied (tier-2 gate; tier-3 is 2d).
const r3 = await post(signRequest(carol, 'resolveCrossPlayerFs', { machine_id: A_MACHINE }));
check(
  'no-session caller → 403 no_session',
  r3.status === 403 && errorOf(r3.body) === 'no_session',
  `status=${r3.status} error=${errorOf(r3.body)}`,
);

// 4. An unregistered machine → 404 host_unreachable.
const r4 = await post(
  signRequest(bob, 'resolveCrossPlayerFs', { machine_id: computeWorkstationId('ghost', 'e'.repeat(64)) }),
);
check(
  'unregistered machine → 404 host_unreachable',
  r4.status === 404 && errorOf(r4.body) === 'host_unreachable',
  `status=${r4.status} error=${errorOf(r4.body)}`,
);

// 5. Tampered signature rejected before any lookup.
const env5 = signRequest(bob, 'resolveCrossPlayerFs', { machine_id: A_MACHINE });
const r5 = await post({ ...env5, payload: `${env5.payload} ` });
check('tampered signature → 401', r5.status === 401, `status=${r5.status} error=${errorOf(r5.body)}`);

// 6. Client-supplied player_key rejected.
const r6 = await post(
  signRequest(bob, 'resolveCrossPlayerFs', { machine_id: A_MACHINE, player_key: 'forged' }),
);
check(
  'client player_key → 400',
  r6.status === 400,
  `status=${r6.status} error=${errorOf(r6.body)}`,
);

// Cleanup.
await sr.from('network_registry').delete().eq('public_ip', A_PUBLIC_IP);
await sr.from('patches').delete().eq('player_key', alice.publicKeyHex);
await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
