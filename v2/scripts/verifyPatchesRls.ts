// One-shot RLS verification for the `patches` table (v2).
//
// Run against local Supabase to confirm the zero-trust posture: anon and
// authenticated roles are denied; only service_role (used inside the Vercel
// function) can read/write. This is the executable check for the patches
// migration — without it, an RLS regression ships silently.
//
// Usage (env vars from `npx supabase status -o env`):
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
//     npx tsx scripts/verifyPatchesRls.ts
//
// Exits 0 when all checks pass, 1 on any failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

const probe = {
  player_key: 'rls-probe-pubkey',
  machine_id: 'rls-probe-machine',
  path: '/rls/probe.txt',
  content: 'probe',
  owner: 'root',
};

const results: { readonly pass: boolean }[] = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
};

// 1. anon INSERT denied by RLS (42501 / "row-level security").
const a1 = await anon.from('patches').insert(probe);
check(
  'anon INSERT denied by RLS',
  a1.error !== null && (a1.error.code === '42501' || /row-level security/i.test(a1.error.message)),
  `error.code=${a1.error?.code ?? 'null'} message=${a1.error?.message ?? 'no error'}`,
);

// 2. anon SELECT returns zero rows (RLS silently filters).
const a2 = await anon.from('patches').select('*');
check(
  'anon SELECT returns 0 rows',
  a2.error === null && a2.data?.length === 0,
  `error=${a2.error?.message ?? 'null'} rows=${a2.data?.length ?? 'undefined'}`,
);

// 3. service_role INSERT succeeds.
const s1 = await sr.from('patches').insert(probe);
check('service_role INSERT succeeds', s1.error === null, `error=${s1.error?.message ?? 'null'}`);

// 4. service_role SELECT sees the row.
const s2 = await sr.from('patches').select('*').eq('player_key', probe.player_key);
check(
  'service_role SELECT sees the row',
  s2.error === null && s2.data?.length === 1 && s2.data[0]?.path === probe.path,
  `rows=${s2.data?.length ?? 'undefined'}`,
);

// 5. anon SELECT still returns zero after service_role wrote a row.
const a3 = await anon.from('patches').select('*');
check(
  'anon SELECT still 0 rows after service_role write',
  a3.error === null && a3.data?.length === 0,
  `rows=${a3.data?.length ?? 'undefined'}`,
);

// Cleanup.
await sr.from('patches').delete().eq('player_key', probe.player_key);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
