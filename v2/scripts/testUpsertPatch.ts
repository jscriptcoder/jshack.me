// Wire-payload smoke for POST /api/patches (upsertPatch).
//
// Forges signed envelopes with core/signedRequest and hits a running
// `vercel dev` (default localhost:3100), then verifies DB state with a
// service_role client. This is the integration seam unit tests can't cover
// (envelope → handler → Supabase → wire response). Self-cleaning.
//
// Usage (with v2 supabase + vercel dev running):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/testUpsertPatch.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';

const ENDPOINT = process.env.ENDPOINT ?? 'http://localhost:3100/api/patches';
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

const id = generateIdentity();
const machine = computeWorkstationId('smoke', id.publicKeyHex);
const path = '/home/smoke/probe.txt';

// 1. Own-workstation write succeeds.
const r1 = await post(
  signRequest(id, 'upsertPatch', {
    machine_id: machine,
    path,
    content: 'smoke-content',
    owner: 'smoke',
  }),
);
check(
  'own-workstation upsert → 200',
  r1.status === 200,
  `status=${r1.status} body=${JSON.stringify(r1.body)}`,
);

// 2. Row persisted with the SERVER-stamped writer_key + content.
const persisted = await sr
  .from('patches')
  .select('content, writer_key, owner')
  .eq('writer_key', id.publicKeyHex)
  .eq('machine_id', machine)
  .eq('path', path);
check(
  'row persisted with stamped writer_key + content',
  persisted.data?.length === 1 &&
    persisted.data[0]?.content === 'smoke-content' &&
    persisted.data[0]?.writer_key === id.publicKeyHex,
  `rows=${persisted.data?.length ?? 'undefined'}`,
);

// 3. A machine that isn't the caller's workstation is rejected.
const r3 = await post(
  signRequest(id, 'upsertPatch', {
    machine_id: computeWorkstationId('victim', 'b'.repeat(64)),
    path: '/x',
    content: 'y',
    owner: 'smoke',
  }),
);
check(
  'non-own machine → 403 no_session',
  r3.status === 403 && errorOf(r3.body) === 'no_session',
  `status=${r3.status} error=${errorOf(r3.body)}`,
);

// 4. Tampered signature rejected.
const env4 = signRequest(id, 'upsertPatch', {
  machine_id: machine,
  path,
  content: 'z',
  owner: 'smoke',
});
const r4 = await post({ ...env4, payload: `${env4.payload} ` });
check(
  'tampered signature → 401',
  r4.status === 401,
  `status=${r4.status} error=${errorOf(r4.body)}`,
);

// 5. Client-supplied player_key rejected.
const r5 = await post(
  signRequest(id, 'upsertPatch', {
    machine_id: machine,
    path,
    content: 'z',
    owner: 'smoke',
    player_key: 'forged',
  }),
);
check(
  'client player_key → 400 payload_invalid',
  r5.status === 400 && errorOf(r5.body) === 'payload_invalid',
  `status=${r5.status} error=${errorOf(r5.body)}`,
);

// 6. A directory patch (mkdir-shaped) persists permissions + node_type.
const dirPath = '/home/smoke/proj';
const dirPerms = {
  read: ['root', 'user', 'guest'],
  write: ['root', 'user'],
  execute: ['root', 'user', 'guest'],
};
const r6 = await post(
  signRequest(id, 'upsertPatch', {
    machine_id: machine,
    path: dirPath,
    content: null,
    owner: 'smoke',
    permissions: dirPerms,
    is_new: true,
    node_type: 'directory',
  }),
);
const dirRow = await sr
  .from('patches')
  .select('content, node_type, permissions, is_new')
  .eq('writer_key', id.publicKeyHex)
  .eq('machine_id', machine)
  .eq('path', dirPath);
check(
  'directory patch persists node_type + permissions',
  r6.status === 200 &&
    dirRow.data?.length === 1 &&
    dirRow.data[0]?.node_type === 'directory' &&
    dirRow.data[0]?.content === null &&
    dirRow.data[0]?.is_new === true &&
    JSON.stringify(dirRow.data[0]?.permissions) === JSON.stringify(dirPerms),
  `status=${r6.status} row=${JSON.stringify(dirRow.data?.[0])}`,
);

// 7. listPatches reads back the caller's own-workstation journal.
const r7 = await post(signRequest(id, 'listPatches', { machine_id: machine }));
const listed =
  (r7.body as { patches?: { path: string; node_type?: string }[] } | null)?.patches ?? [];
check(
  'listPatches returns own rows (file + dir)',
  r7.status === 200 &&
    listed.some((row) => row.path === path) &&
    listed.some((row) => row.path === dirPath && row.node_type === 'directory'),
  `status=${r7.status} count=${listed.length}`,
);

// 8. listPatches for a machine the caller doesn't own is rejected.
const r8 = await post(
  signRequest(id, 'listPatches', { machine_id: computeWorkstationId('victim', 'c'.repeat(64)) }),
);
check(
  'listPatches non-own machine → 403 no_session',
  r8.status === 403 && errorOf(r8.body) === 'no_session',
  `status=${r8.status} error=${errorOf(r8.body)}`,
);

// 9. removePatch of an is_new file DELETES the row (no tombstone left behind).
const newFile = '/home/smoke/scratch.txt';
await post(
  signRequest(id, 'upsertPatch', {
    machine_id: machine,
    path: newFile,
    content: '',
    owner: 'smoke',
    is_new: true,
    node_type: 'file',
  }),
);
const r9 = await post(
  signRequest(id, 'removePatch', { machine_id: machine, path: newFile, owner: 'smoke' }),
);
const afterNewDelete = await sr
  .from('patches')
  .select('path')
  .eq('writer_key', id.publicKeyHex)
  .eq('machine_id', machine)
  .eq('path', newFile);
check(
  'removePatch of is_new file → row DELETED (no tombstone)',
  r9.status === 200 && afterNewDelete.data?.length === 0,
  `status=${r9.status} rows=${afterNewDelete.data?.length ?? 'undefined'}`,
);

// 10. removePatch of an is_new directory also drops its is_new descendants.
const newDir = '/home/smoke/cache';
const newChild = '/home/smoke/cache/item.txt';
for (const [p, type] of [
  [newDir, 'directory'],
  [newChild, 'file'],
] as const) {
  await post(
    signRequest(id, 'upsertPatch', {
      machine_id: machine,
      path: p,
      content: type === 'directory' ? null : '',
      owner: 'smoke',
      is_new: true,
      node_type: type,
    }),
  );
}
const r10 = await post(
  signRequest(id, 'removePatch', { machine_id: machine, path: newDir, owner: 'smoke' }),
);
const afterDirDelete = await sr
  .from('patches')
  .select('path')
  .eq('writer_key', id.publicKeyHex)
  .eq('machine_id', machine)
  .like('path', `${newDir}%`);
check(
  'removePatch of is_new dir → row + descendants DELETED',
  r10.status === 200 && afterDirDelete.data?.length === 0,
  `status=${r10.status} rows=${afterDirDelete.data?.length ?? 'undefined'}`,
);

// 11. removePatch of a base/modified file (is_new=false) leaves a null tombstone.
const baseFile = '/home/smoke/baseish.txt';
await post(
  signRequest(id, 'upsertPatch', {
    machine_id: machine,
    path: baseFile,
    content: 'modified-base',
    owner: 'smoke',
  }),
); // no is_new → DB default false (stands in for a modified base-FS file)
const r11 = await post(
  signRequest(id, 'removePatch', { machine_id: machine, path: baseFile, owner: 'smoke' }),
);
const tombstone = await sr
  .from('patches')
  .select('content')
  .eq('writer_key', id.publicKeyHex)
  .eq('machine_id', machine)
  .eq('path', baseFile);
check(
  'removePatch of base file → null deletion marker persists',
  r11.status === 200 && tombstone.data?.length === 1 && tombstone.data[0]?.content === null,
  `status=${r11.status} row=${JSON.stringify(tombstone.data?.[0])}`,
);

// 12. removePatch targeting a non-own machine is rejected.
const r12 = await post(
  signRequest(id, 'removePatch', {
    machine_id: computeWorkstationId('victim', 'd'.repeat(64)),
    path: '/x',
    owner: 'smoke',
  }),
);
check(
  'removePatch non-own machine → 403 no_session',
  r12.status === 403 && errorOf(r12.body) === 'no_session',
  `status=${r12.status} error=${errorOf(r12.body)}`,
);

// Cleanup.
await sr.from('patches').delete().eq('writer_key', id.publicKeyHex);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
