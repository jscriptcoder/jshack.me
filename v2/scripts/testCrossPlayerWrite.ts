// Wire-payload smoke for the Story-3 cross-player WRITE (Slice 2) — B modifies A's box.
//
// The headline new behaviour: a SECOND identity (B) holding a guest cross-player
// ssh session on A's REGISTERED workstation writes a file on A's box through the
// real /api/patches endpoint, and the change lands on A's shared journal attributed
// to B — A sees it, and B's own cross-player read sees it. L2 walks A's
// OWNER-materialized tree (rebuilt from the registry identity, decision D6) at B's
// SERVER-session tier, so the guest-writable /tmp succeeds but a root-owned path is
// denied with no row written. A caller with no session is rejected at L1.
//
// Drives the REAL migrated schema + glue end to end against a running `vercel dev`
// + local supabase; seeds A's registry row + B's guest session via service_role.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testCrossPlayerWrite.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeRouterId } from '../src/core/identity/router';
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

const post = async (endpoint: string, envelope: unknown): Promise<{ status: number; body: unknown }> => {
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

type Row = { readonly path: string; readonly content: string | null; readonly writer_key: string };
const patchesOf = (body: unknown): readonly Row[] =>
  (body as { patches?: readonly Row[] } | null)?.patches ?? [];

const get = (tree: Directory, ...segments: readonly string[]): FileNode | undefined => {
  let node: FileNode | undefined = tree;
  for (const segment of segments) {
    if (node === undefined || node.kind !== 'directory') return undefined;
    node = node.entries.get(segment);
  }
  return node;
};

// --- Identities: A (owner), B (guest session on A), C (no session). ---
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();
const A_MACHINE = computeWorkstationId('skylab', alice.publicKeyHex);
const A_PUBLIC_IP = '203.0.113.77';
const ROOT_HASH = md5('alice-root-secret');
const PWNED = '/tmp/pwned';
// World-readable so B's guest cross-player read can see its own write back.
const worldFile = { read: ['root', 'user', 'guest'], write: ['root', 'user', 'guest'], execute: [] };

// Clean slate, then seed A's registry row (as the join would) + B's active guest
// session on A's workstation (as the 2b cross-player login would).
await sr.from('network_registry').delete().eq('public_ip', A_PUBLIC_IP);
await sr.from('patches').delete().eq('machine_id', A_MACHINE);
await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);
await sr.from('network_registry').insert({
  public_ip: A_PUBLIC_IP,
  owner_key: alice.publicKeyHex,
  workstation_machine_id: A_MACHINE,
  router_machine_id: computeRouterId(alice.publicKeyHex),
  essid: 'BEAN-THERE-WIFI',
  workstation_username: 'alice',
  workstation_machine_name: 'skylab',
  workstation_root_hash: ROOT_HASH,
});
await sr.from('sessions').insert({
  session_id: `ssh-bob-${A_PUBLIC_IP}`,
  player_key: bob.publicKeyHex,
  machine_id: A_MACHINE,
  credentials: { username: 'guest', userType: 'guest' },
  kind: 'ssh',
  essid: 'BEAN-THERE-WIFI',
});

// 1. B (guest cross-player session) writes /tmp/pwned on A's box → 200.
const w1 = await post(
  PATCHES,
  signRequest(bob, 'upsertPatch', {
    machine_id: A_MACHINE,
    path: PWNED,
    content: 'owned by B',
    owner: 'guest',
    permissions: worldFile,
    is_new: true,
    node_type: 'file',
  }),
);
check(
  'B (guest) writes /tmp/pwned on A’s box → 200',
  w1.status === 200,
  `status=${w1.status} error=${errorOf(w1.body) ?? '-'}`,
);

// 2. The row persisted on A's shared journal, keyed (A_machine, path, writer_key=B)
//    with a server-stamped updated_at — read directly via service_role.
const { data: rows2 } = await sr
  .from('patches')
  .select('writer_key, content, updated_at')
  .eq('machine_id', A_MACHINE)
  .eq('path', PWNED);
const bRow = (rows2 ?? []).find((row) => row.writer_key === bob.publicKeyHex);
check(
  'row persists on A’s journal, attributed to B, server-stamped',
  rows2?.length === 1 && bRow?.content === 'owned by B' && typeof bRow?.updated_at === 'string',
  `rows=${rows2?.length} writer=${bRow ? 'B' : '-'} content=${bRow?.content} ts=${bRow?.updated_at ?? '-'}`,
);

// 3. A reloads (own-box, machine-scoped read) and sees B's file, attributed to B.
const l3 = await post(PATCHES, signRequest(alice, 'listPatches', { machine_id: A_MACHINE }));
const aSees = patchesOf(l3.body).find((row) => row.path === PWNED);
check(
  'A’s own-box read sees B’s write, attributed to B',
  l3.status === 200 && aSees?.content === 'owned by B' && aSees.writer_key === bob.publicKeyHex,
  `status=${l3.status} content=${aSees?.content} writer=${aSees?.writer_key === bob.publicKeyHex ? 'B' : aSees?.writer_key ?? '-'}`,
);

// 4. B's own cross-player read (resolveCrossPlayerFs) materializes its write too.
const r4 = await post(NETWORK, signRequest(bob, 'resolveCrossPlayerFs', { machine_id: A_MACHINE }));
const tree4 = r4.status === 200 ? deserializeTree((r4.body as { tree: SerializedDirectory }).tree) : null;
const pwned4 = tree4 ? get(tree4, 'tmp', 'pwned') : undefined;
check(
  'B’s cross-player read sees /tmp/pwned',
  r4.status === 200 && pwned4?.kind === 'file' && pwned4.content === 'owned by B',
  `status=${r4.status} content=${pwned4?.kind === 'file' ? pwned4.content : 'absent'}`,
);

// 5. Boundary: B (guest) writing a root-owned path → 403 permission_denied, NO row.
const w5 = await post(
  PATCHES,
  signRequest(bob, 'upsertPatch', {
    machine_id: A_MACHINE,
    path: '/etc/passwd',
    content: 'guest::0:0::/root:/bin/bash',
    owner: 'guest',
  }),
);
const { data: rows5 } = await sr
  .from('patches')
  .select('writer_key')
  .eq('machine_id', A_MACHINE)
  .eq('path', '/etc/passwd');
check(
  'B (guest) denied writing /etc/passwd on A’s box → 403, no row',
  w5.status === 403 && errorOf(w5.body) === 'permission_denied' && (rows5?.length ?? 0) === 0,
  `status=${w5.status} error=${errorOf(w5.body)} rows=${rows5?.length ?? 0}`,
);

// 6. No session: C writing on A's box → 403 no_session (L1), NO row.
const w6 = await post(
  PATCHES,
  signRequest(carol, 'upsertPatch', {
    machine_id: A_MACHINE,
    path: '/tmp/by-carol',
    content: 'should not land',
    owner: 'guest',
  }),
);
const { data: rows6 } = await sr
  .from('patches')
  .select('writer_key')
  .eq('machine_id', A_MACHINE)
  .eq('writer_key', carol.publicKeyHex);
check(
  'C (no session) write → 403 no_session, no row',
  w6.status === 403 && errorOf(w6.body) === 'no_session' && (rows6?.length ?? 0) === 0,
  `status=${w6.status} error=${errorOf(w6.body)} rows=${rows6?.length ?? 0}`,
);

// 7. Boundary (create gap): B (guest) creating a NEW file under root-only /root →
//    403, NO row. The CONTAINING dir gates the create, closing the
//    create-anywhere gap (a guest can't plant a file in a dir it can't write).
const w7 = await post(
  PATCHES,
  signRequest(bob, 'upsertPatch', {
    machine_id: A_MACHINE,
    path: '/root/implant',
    content: 'persistence',
    owner: 'guest',
    is_new: true,
    node_type: 'file',
  }),
);
const { data: rows7 } = await sr
  .from('patches')
  .select('writer_key')
  .eq('machine_id', A_MACHINE)
  .eq('path', '/root/implant');
check(
  'B (guest) denied creating /root/implant on A’s box → 403, no row',
  w7.status === 403 && errorOf(w7.body) === 'permission_denied' && (rows7?.length ?? 0) === 0,
  `status=${w7.status} error=${errorOf(w7.body)} rows=${rows7?.length ?? 0}`,
);

// 8. Boundary (create gap): B (guest) creating a NEW file inside A's OWN home dir →
//    403, NO row (HOME_DIR excludes guest from write + traverse).
const homeSecret = '/home/alice/secret';
const w8 = await post(
  PATCHES,
  signRequest(bob, 'upsertPatch', {
    machine_id: A_MACHINE,
    path: homeSecret,
    content: 'in your home',
    owner: 'guest',
    is_new: true,
    node_type: 'file',
  }),
);
const { data: rows8 } = await sr
  .from('patches')
  .select('writer_key')
  .eq('machine_id', A_MACHINE)
  .eq('path', homeSecret);
check(
  'B (guest) denied creating /home/alice/secret on A’s box → 403, no row',
  w8.status === 403 && errorOf(w8.body) === 'permission_denied' && (rows8?.length ?? 0) === 0,
  `status=${w8.status} error=${errorOf(w8.body)} rows=${rows8?.length ?? 0}`,
);

// 9. Cross-player rm (Slice 4): B (guest) deletes /tmp/pwned on A's box → 200, and
//    the row flips to a content:null TOMBSTONE keyed (A_machine, path, writer_key=B)
//    — tombstone-always, not a hard delete (so a concurrent writer can't keep it alive).
const rm9 = await post(
  PATCHES,
  signRequest(bob, 'removePatch', { machine_id: A_MACHINE, path: PWNED, owner: 'guest' }),
);
const { data: rows9 } = await sr
  .from('patches')
  .select('writer_key, content')
  .eq('machine_id', A_MACHINE)
  .eq('path', PWNED);
const bTomb = (rows9 ?? []).find((row) => row.writer_key === bob.publicKeyHex);
check(
  'B (guest) rm /tmp/pwned on A’s box → 200, row is a content:null tombstone (writer=B)',
  rm9.status === 200 && rows9?.length === 1 && bTomb?.content === null,
  `status=${rm9.status} rows=${rows9?.length} content=${bTomb ? String(bTomb.content) : '-'}`,
);

// 10. A's box now materializes /tmp/pwned as GONE (B's cross-player read agrees).
const r10 = await post(NETWORK, signRequest(bob, 'resolveCrossPlayerFs', { machine_id: A_MACHINE }));
const tree10 = r10.status === 200 ? deserializeTree((r10.body as { tree: SerializedDirectory }).tree) : null;
check(
  'after B’s rm, /tmp/pwned is gone from A’s materialized box',
  r10.status === 200 && (tree10 ? get(tree10, 'tmp', 'pwned') : undefined) === undefined,
  `status=${r10.status} node=${tree10 && get(tree10, 'tmp', 'pwned') ? 'present' : 'absent'}`,
);

// 11. Chronological delete-then-recreate: A (owner) re-creates /tmp/pwned with a LATER
//     server timestamp → it wins over B's earlier tombstone (the file reappears).
const w11 = await post(
  PATCHES,
  signRequest(alice, 'upsertPatch', {
    machine_id: A_MACHINE,
    path: PWNED,
    content: 'recreated by A',
    owner: 'alice',
    permissions: worldFile,
    is_new: true,
    node_type: 'file',
  }),
);
const r11 = await post(NETWORK, signRequest(bob, 'resolveCrossPlayerFs', { machine_id: A_MACHINE }));
const tree11 = r11.status === 200 ? deserializeTree((r11.body as { tree: SerializedDirectory }).tree) : null;
const pwned11 = tree11 ? get(tree11, 'tmp', 'pwned') : undefined;
check(
  'A re-creates /tmp/pwned (later ts) → wins over B’s tombstone (file reappears)',
  w11.status === 200 && pwned11?.kind === 'file' && pwned11.content === 'recreated by A',
  `write=${w11.status} content=${pwned11?.kind === 'file' ? pwned11.content : 'absent'}`,
);

// 12. Boundary: B (guest) rm of a root-owned path → 403 permission_denied, no tombstone.
const rm12 = await post(
  PATCHES,
  signRequest(bob, 'removePatch', { machine_id: A_MACHINE, path: '/etc/passwd', owner: 'root' }),
);
const { data: rows12 } = await sr
  .from('patches')
  .select('writer_key')
  .eq('machine_id', A_MACHINE)
  .eq('path', '/etc/passwd');
check(
  'B (guest) denied rm /etc/passwd on A’s box → 403, no tombstone',
  rm12.status === 403 && errorOf(rm12.body) === 'permission_denied' && (rows12?.length ?? 0) === 0,
  `status=${rm12.status} error=${errorOf(rm12.body)} rows=${rows12?.length ?? 0}`,
);

// Cleanup.
await sr.from('network_registry').delete().eq('public_ip', A_PUBLIC_IP);
await sr.from('patches').delete().eq('machine_id', A_MACHINE);
await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
