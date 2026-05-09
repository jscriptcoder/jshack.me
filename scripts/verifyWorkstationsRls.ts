// One-shot RLS verification for workstations.
//
// Mirror of verifyMachineFilesystemsRls.ts. Run against local Supabase
// to confirm:
//   - anon INSERT is rejected by RLS (error code 42501).
//   - anon SELECT returns no rows (RLS silently filters).
//   - service_role INSERT succeeds.
//   - service_role SELECT returns the row written by service_role.
//   - anon still sees no rows after service_role wrote one.
//
// Usage (env vars must be set; no hardcoded fallbacks — keys live in
// .env.development.local):
//
//   npx dotenv -e .env.development.local -- npx tsx scripts/verifyWorkstationsRls.ts
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY

import './lib/loadEnv';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error(
    'Missing required env vars. Run with:\n  npx dotenv -e .env.development.local -- npx tsx scripts/verifyWorkstationsRls.ts',
  );
  process.exit(2);
}

const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

const row = {
  player_key: 'rls-probe-pubkey',
  workstation_name: 'rls-probe-box',
  username: 'rls-probe-user',
};

const results: { readonly name: string; readonly pass: boolean; readonly detail: string }[] = [];

const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
};

// 1. anon INSERT must be denied
const a1 = await anon.from('workstations').insert(row);
check(
  'anon INSERT denied by RLS',
  a1.error !== null && (a1.error?.code === '42501' || /row-level security/i.test(a1.error.message)),
  `error.code=${a1.error?.code ?? 'null'} message=${a1.error?.message ?? 'no error'}`,
);

// 2. anon SELECT must return zero rows (RLS silently filters)
const a2 = await anon.from('workstations').select('*');
check(
  'anon SELECT returns 0 rows',
  a2.error === null && a2.data?.length === 0,
  `error=${a2.error ?? 'null'} rows=${a2.data?.length ?? 'undefined'}`,
);

// 3. service_role INSERT must succeed
const s1 = await sr.from('workstations').insert(row);
check('service_role INSERT succeeds', s1.error === null, `error=${s1.error ?? 'null'}`);

// 4. service_role SELECT must see the row
const s2 = await sr.from('workstations').select('*').eq('player_key', 'rls-probe-pubkey');
check(
  'service_role SELECT sees the row',
  s2.error === null && s2.data?.length === 1 && s2.data[0]?.workstation_name === 'rls-probe-box',
  `rows=${s2.data?.length ?? 'undefined'}`,
);

// 5. anon SELECT still returns zero even after service_role wrote a row
const a3 = await anon.from('workstations').select('*');
check(
  'anon SELECT still 0 rows after service_role write',
  a3.error === null && a3.data?.length === 0,
  `rows=${a3.data?.length ?? 'undefined'}`,
);

// Cleanup
await sr.from('workstations').delete().eq('player_key', 'rls-probe-pubkey');

const passed = results.filter((r) => r.pass).length;
const total = results.length;
console.log(`\n${passed}/${total} checks passed`);
process.exit(passed === total ? 0 : 1);
