// Wire-check for the size of one signed write (POST /api/patches, upsertPatch and
// listPatches).
//
// Saving a file a player carried home is one signed write, so the envelope's payload
// cap is the largest file a player can keep. Unit tests prove the schema accepts
// `MAX_SIGNED_PAYLOAD` characters; only this proves nothing between the browser and
// the row caps lower — `vercel dev`'s body parsing, the handler, PostgREST, the
// column — and that the read back hands the whole file over unchanged.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testLargePatch.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { MAX_SIGNED_PAYLOAD } from '../src/core/signedRequest/types.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';

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

type Row = { readonly path: string; readonly content: string | null };
const rowsOf = (body: unknown): readonly Row[] =>
  (body as { patches?: readonly Row[] } | null)?.patches ?? [];

const id = generateIdentity();
const machine = computeWorkstationId('smoke', id.publicKeyHex);

const writeFields = (path: string, content: string) => ({
  machine_id: machine,
  path,
  content,
  owner: 'smoke',
  permissions: { read: ['user', 'root'], write: ['user', 'root'], execute: [] },
  node_type: 'file',
  is_new: true,
});
const save = (path: string, content: string) =>
  post(signRequest(id, 'upsertPatch', writeFields(path, content)));

/** Content that makes the signed payload exactly `length` characters. Every field
 *  but the content has a fixed length (a 13-digit clock, a 32-hex nonce), and an `x`
 *  costs one character of JSON, so the padding is the length minus the rest. */
const contentForPayload = (path: string, length: number): string => {
  const rest = signRequest(id, 'upsertPatch', writeFields(path, '')).payload.length;
  return 'x'.repeat(length - rest);
};

// 1. A file over twice the size of the largest the world generates, with what JSON
// escapes in it: a log of lines, tabs and quotes.
const LOG = '/home/smoke/auth.log.1';
const line = (index: number) =>
  `Oct 18 08:${String(index % 60).padStart(2, '0')}:01 box sshd[${1000 + index}]:\tAccepted password for "guest" from 192.168.1.${index % 250} port 22 ssh2\n`;
const big = Array.from({ length: 520 }, (_, index) => line(index)).join('');
const r1 = await save(LOG, big);
check(
  `a ${big.length}-character log (${JSON.stringify(big).length} escaped) → 200`,
  r1.status === 200,
  `status=${r1.status} body=${JSON.stringify(r1.body)}`,
);

// 2. The read back hands it over whole, through the API the owner's client reads.
const listed = await post(signRequest(id, 'listPatches', { machine_id: machine }));
const back = rowsOf(listed.body).find((row) => row.path === LOG)?.content;
check(
  'listPatches returns it byte for byte',
  listed.status === 200 && back === big,
  `status=${listed.status} length=${back?.length ?? 'missing'} of ${big.length}`,
);

// 3. The cap's edge, live: a payload of exactly the cap lands, one character more
// does not, and the refused write leaves no row.
const EDGE = '/home/smoke/edge.txt';
const atCap = contentForPayload(EDGE, MAX_SIGNED_PAYLOAD);
const r3 = await save(EDGE, atCap);
check(`a payload of exactly ${MAX_SIGNED_PAYLOAD} → 200`, r3.status === 200, `status=${r3.status}`);

const OVER = '/home/smoke/over.txt';
const r4 = await save(OVER, contentForPayload(OVER, MAX_SIGNED_PAYLOAD + 1));
const { data: overRows } = await sr
  .from('patches')
  .select('path')
  .eq('machine_id', machine)
  .eq('path', OVER);
check(
  `a payload of ${MAX_SIGNED_PAYLOAD + 1} → 400 envelope_invalid, nothing written`,
  r4.status === 400 && errorOf(r4.body) === 'envelope_invalid' && overRows?.length === 0,
  `status=${r4.status} error=${errorOf(r4.body)} rows=${overRows?.length}`,
);

// Cleanup.
await sr.from('patches').delete().eq('machine_id', machine);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
