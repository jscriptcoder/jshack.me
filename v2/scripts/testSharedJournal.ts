// Wire-payload smoke for the Story-3 shared-journal PK flip (Slice 1).
//
// Exercises the REAL migrated schema + glue end to end against a running
// `vercel dev` + local supabase:
//   1. own-box write via /api/patches upsertPatch stamps writer_key and persists
//      (read back via listPatches) — proves the write glue + writer_key column;
//   2. a re-edit of the same path is an onConflict UPDATE (one row, new content,
//      updated_at bumped by the BEFORE UPDATE trigger) — not a duplicate row;
//   3. a SECOND writer's row on the SAME (machine_id, path) coexists, and the
//      machine-scoped read replays them chronologically so the later updated_at
//      wins — the headline shared-journal behaviour, attributed by writer_key.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSharedJournal.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
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

const alice = generateIdentity();
const bob = generateIdentity();
const A_MACHINE = computeWorkstationId('skylab', alice.publicKeyHex);
const A_PUBLIC_IP = '203.0.113.66';
const ROOT_HASH = md5('alice-root-secret');
const NOTES = '/home/alice/notes.txt';
const filePerms = { read: ['root', 'user'], write: ['root', 'user'], execute: [] };

// A registered network so the owner can read its own box via resolveCrossPlayerFs.
await sr.from('network_public_ips').delete().eq('public_ip', A_PUBLIC_IP);
await sr.from('home_network_occupants').delete().eq('essid', 'BEAN-THERE-WIFI');
await sr.from('patches').delete().eq('machine_id', A_MACHINE);
// The join state a real `registerNetwork` writes: the AP's public IP, plus the owner
// as an OCCUPANT of its ESSID — occupancy is what makes a box reachable.
await sr.from('network_public_ips').insert({ essid: 'BEAN-THERE-WIFI', public_ip: A_PUBLIC_IP });
await sr.from('home_network_occupants').insert({
  essid: 'BEAN-THERE-WIFI',
  owner_key: alice.publicKeyHex,
  workstation_machine_id: A_MACHINE,
  workstation_username: 'alice',
  workstation_machine_name: 'skylab',
  workstation_root_hash: ROOT_HASH,
});

// 1. Own-box write via the real endpoint → readback shows it, stamped writer_key = A.
const w1 = await post(
  PATCHES,
  signRequest(alice, 'upsertPatch', {
    machine_id: A_MACHINE,
    path: NOTES,
    content: 'v1',
    owner: 'alice',
    permissions: filePerms,
    is_new: true,
    node_type: 'file',
  }),
);
const l1 = await post(PATCHES, signRequest(alice, 'listPatches', { machine_id: A_MACHINE }));
const row1 = patchesOf(l1.body).find((row) => row.path === NOTES);
check(
  'own-box write persists, stamped writer_key = A',
  w1.status === 200 && row1?.content === 'v1' && row1.writer_key === alice.publicKeyHex,
  `write=${w1.status} content=${row1?.content} writer=${row1?.writer_key === alice.publicKeyHex ? 'A' : row1?.writer_key}`,
);

// 2. Re-edit the same path → onConflict UPDATE (one row, new content), not a dupe.
const w2 = await post(
  PATCHES,
  signRequest(alice, 'upsertPatch', {
    machine_id: A_MACHINE,
    path: NOTES,
    content: 'v2',
    owner: 'alice',
    permissions: filePerms,
    node_type: 'file',
  }),
);
const l2 = await post(PATCHES, signRequest(alice, 'listPatches', { machine_id: A_MACHINE }));
const aliceRows = patchesOf(l2.body).filter(
  (row) => row.path === NOTES && row.writer_key === alice.publicKeyHex,
);
check(
  're-edit is an onConflict update (single A row, content v2)',
  w2.status === 200 && aliceRows.length === 1 && aliceRows[0]?.content === 'v2',
  `write=${w2.status} rows=${aliceRows.length} content=${aliceRows[0]?.content}`,
);

// 3. A SECOND writer (B) writes the SAME path with a LATER server timestamp
//    (seeded directly; cross-player WRITE through the endpoint is Slice 2). The
//    machine-scoped read replays both chronologically → B's later write wins.
await sr.from('patches').insert({
  writer_key: bob.publicKeyHex,
  machine_id: A_MACHINE,
  path: NOTES,
  content: 'v3_by_B',
  owner: 'alice',
  permissions: filePerms,
  node_type: 'file',
  updated_at: '2099-01-01T00:00:00.000000+00:00',
});
const r3 = await post(
  NETWORK,
  signRequest(alice, 'resolveCrossPlayerFs', { machine_id: A_MACHINE }),
);
const tree3 =
  r3.status === 200 ? deserializeTree((r3.body as { tree: SerializedDirectory }).tree) : null;
const notes3 = tree3 ? get(tree3, 'home', 'alice', 'notes.txt') : undefined;
check(
  'multi-writer combine: later writer (B) wins the materialized content',
  r3.status === 200 && notes3?.kind === 'file' && notes3.content === 'v3_by_B',
  `status=${r3.status} content=${notes3?.kind === 'file' ? notes3.content : 'absent'}`,
);

// 4. Both writers' rows coexist on the one machine, attributed by writer_key.
const l4 = await post(PATCHES, signRequest(alice, 'listPatches', { machine_id: A_MACHINE }));
const notesRows = patchesOf(l4.body).filter((row) => row.path === NOTES);
const writers = new Set(notesRows.map((row) => row.writer_key));
check(
  'both writers’ rows coexist for the path, attributed',
  notesRows.length === 2 && writers.has(alice.publicKeyHex) && writers.has(bob.publicKeyHex),
  `rows=${notesRows.length} writers=${writers.size}`,
);

// Cleanup.
await sr.from('network_public_ips').delete().eq('public_ip', A_PUBLIC_IP);
await sr.from('home_network_occupants').delete().eq('essid', 'BEAN-THERE-WIFI');
await sr.from('patches').delete().eq('machine_id', A_MACHINE);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
