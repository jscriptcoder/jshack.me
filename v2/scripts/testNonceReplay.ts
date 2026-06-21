// Wire-payload smoke for REPLAY PROTECTION on POST /api/patches.
//
// Forges a signed envelope, POSTs it once (succeeds), then POSTs the BYTE-
// IDENTICAL envelope again — same nonce — and asserts the server rejects the
// replay (401 `replay`) WITHOUT re-writing the row. A fresh nonce still
// succeeds. This is the integration seam unit tests can't cover (envelope →
// verify → nonce store → Supabase). Self-cleaning (deletes its patches + nonces).
//
// RED for Slice 7.2.0a: FAILS today because api/patches.ts uses a noop nonce
// store that always reports { fresh: true } → the replay returns 200 and the
// row is re-written. GREEN = the Supabase-backed nonce store.
//
// Usage (with v2 supabase + vercel dev running):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/testNonceReplay.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import type { SignedEnvelope } from '../src/core/signedRequest/types';

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

const nonceOf = (envelope: SignedEnvelope): string =>
  (JSON.parse(envelope.payload) as { nonce: string }).nonce;

const id = generateIdentity();
const machine = computeWorkstationId('replay', id.publicKeyHex);
const path = '/home/replay/probe.txt';

const readRow = () =>
  sr
    .from('patches')
    .select('content, updated_at')
    .eq('writer_key', id.publicKeyHex)
    .eq('machine_id', machine)
    .eq('path', path)
    .maybeSingle();

// 1. First signed write succeeds.
const envelope = signRequest(id, 'upsertPatch', {
  machine_id: machine,
  path,
  content: 'first',
  owner: 'replay',
});
const r1 = await post(envelope);
check(
  'first signed upsert → 200',
  r1.status === 200,
  `status=${r1.status} body=${JSON.stringify(r1.body)}`,
);

const afterFirst = await readRow();
const firstUpdatedAt = (afterFirst.data as { updated_at?: string } | null)?.updated_at;
check(
  'row persisted with content',
  (afterFirst.data as { content?: string } | null)?.content === 'first',
  `content=${(afterFirst.data as { content?: string } | null)?.content} updated_at=${firstUpdatedAt}`,
);

// 2. Replaying the BYTE-IDENTICAL envelope (same nonce) is rejected.
const r2 = await post(envelope);
check(
  'replay (same nonce) → 401 replay',
  r2.status === 401 && errorOf(r2.body) === 'replay',
  `status=${r2.status} error=${errorOf(r2.body)}`,
);

// 3. The replay wrote NOTHING — updated_at is unchanged (the upsert never ran).
const afterReplay = await readRow();
check(
  'replay did not re-write the row (updated_at unchanged)',
  (afterReplay.data as { updated_at?: string } | null)?.updated_at === firstUpdatedAt,
  `before=${firstUpdatedAt} after=${(afterReplay.data as { updated_at?: string } | null)?.updated_at}`,
);

// 4. A FRESH nonce still succeeds (no false-positive dedup).
const fresh = signRequest(id, 'upsertPatch', {
  machine_id: machine,
  path,
  content: 'second',
  owner: 'replay',
});
const r4 = await post(fresh);
check('fresh nonce → 200', r4.status === 200, `status=${r4.status} body=${JSON.stringify(r4.body)}`);

// Cleanup: this test's patches + the nonces it burned (nonces table may not yet
// exist in RED — the delete simply no-ops there).
await sr.from('patches').delete().eq('writer_key', id.publicKeyHex);
await sr.from('nonces').delete().in('nonce', [nonceOf(envelope), nonceOf(fresh)]);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
