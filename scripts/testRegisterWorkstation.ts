// End-to-end smoke for /api/register-workstation against vercel:dev.
//
// Verifies:
//   1. Fresh registration → 201 inserted:true; row in workstations;
//      machine_filesystems populated for the workstation_id.
//   1d. workstations.seed persists the seed sent in the envelope.
//   1e. /etc/passwd projected content carries md5(rootPassword) — the
//      load-bearing fix for cross-player password validation.
//   2. Idempotent repeat → 200 inserted:false; no duplicate rows.
//   3. Conflicting repeat (different workstation_name) → 409
//      already_registered.
//   4. Tampered signature → 401 signature_invalid.
//   5. Missing-seed envelope → 400 payload_invalid.
//
// Usage (vercel:dev must be running on http://localhost:3000):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testRegisterWorkstation.ts
//
// Cleans up after itself (deletes the test workstations + machine_fs
// rows) so it can be re-run idempotently.

import './lib/loadEnv';
import { createClient } from '@supabase/supabase-js';
import { generateIdentity } from '../src/identity/identity';
import { signRequest } from '../src/signedRequest/sign';
import { computeWorkstationId } from '../src/homeNetworks/homeNetworkHelpers';
import { md5 } from '../src/utils/md5';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiUrl = process.env.API_URL ?? 'http://localhost:3000';

if (!url || !serviceKey) {
  console.error(
    'Missing required env vars. Run with:\n  npx dotenv -e .env.development.local -- npx tsx scripts/testRegisterWorkstation.ts',
  );
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

const results: { readonly name: string; readonly pass: boolean; readonly detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
};

const identity = generateIdentity();
const workstationName = 'rls-probe-box';
const username = 'probeuser';
const seed = '0123456789abcdef';
const rootPassword = 'probe-root-pw';
const machineId = computeWorkstationId(workstationName, identity.publicKeyHex);

// Cleanup any leftover state from a prior aborted run BEFORE the test.
await sr.from('machine_filesystems').delete().eq('machine_id', machineId);
await sr.from('workstations').delete().eq('player_key', identity.publicKeyHex);

const post = async (envelope: unknown): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(`${apiUrl}/api/register-workstation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

// ---- 1. Fresh registration -----------------------------------------

const env1 = signRequest(identity, 'registerWorkstation', {
  workstation_name: workstationName,
  username,
  seed,
  rootPassword,
});
const r1 = await post(env1);
check(
  '1. fresh registration returns 201 with inserted:true',
  r1.status === 201 && (r1.body as { inserted?: boolean })?.inserted === true,
  `status=${r1.status} body=${JSON.stringify(r1.body)}`,
);

const { data: ws } = await sr
  .from('workstations')
  .select('*')
  .eq('player_key', identity.publicKeyHex)
  .maybeSingle();
check(
  '1a. workstations row exists with expected fields',
  ws?.workstation_name === workstationName && ws?.username === username,
  `row=${JSON.stringify(ws)}`,
);

const { data: fsRows, count: fsCount } = await sr
  .from('machine_filesystems')
  .select('path', { count: 'exact' })
  .eq('machine_id', machineId);
check(
  '1b. machine_filesystems populated for the workstation_id',
  (fsCount ?? 0) > 10,
  `machineId=${machineId} fs_rows=${fsCount}`,
);
const hasPasswd = fsRows?.some((r) => r.path === '/etc/passwd');
check(
  '1c. machine_filesystems contains /etc/passwd (a representative L2 target)',
  hasPasswd === true,
  `hasPasswd=${hasPasswd}`,
);

// 1d. seed persists in workstations row.
check(
  '1d. workstations.seed persists the seed from the envelope',
  ws?.seed === seed,
  `expected=${seed} got=${ws?.seed}`,
);

// 1e. Projected /etc/passwd content carries md5(rootPassword) — the
// load-bearing fix that lets cross-player password validation compare
// submitted passwords against this hash.
const { data: passwdRow } = await sr
  .from('machine_filesystems')
  .select('content')
  .eq('machine_id', machineId)
  .eq('path', '/etc/passwd')
  .maybeSingle();
const expectedHash = md5(rootPassword);
const passwdContent = passwdRow?.content as string | undefined;
check(
  '1e. /etc/passwd projected content includes md5(rootPassword)',
  passwdContent?.includes(expectedHash) === true,
  `expectedHash=${expectedHash} present=${passwdContent?.includes(expectedHash)}`,
);

// ---- 2. Idempotent repeat ------------------------------------------

const env2 = signRequest(identity, 'registerWorkstation', {
  workstation_name: workstationName,
  username,
  seed,
  rootPassword,
});
const r2 = await post(env2);
check(
  '2. idempotent repeat returns 200 with inserted:false',
  r2.status === 200 && (r2.body as { inserted?: boolean })?.inserted === false,
  `status=${r2.status} body=${JSON.stringify(r2.body)}`,
);

const { count: wsCount2 } = await sr
  .from('workstations')
  .select('*', { count: 'exact', head: true })
  .eq('player_key', identity.publicKeyHex);
check('2a. no duplicate workstations row after repeat', wsCount2 === 1, `count=${wsCount2}`);

// ---- 3. Conflicting repeat -----------------------------------------

const env3 = signRequest(identity, 'registerWorkstation', {
  workstation_name: 'DIFFERENT-BOX',
  username,
  seed,
  rootPassword,
});
const r3 = await post(env3);
check(
  '3. conflicting repeat returns 409 already_registered',
  r3.status === 409 && (r3.body as { error?: string })?.error === 'already_registered',
  `status=${r3.status} body=${JSON.stringify(r3.body)}`,
);

// ---- 4. Tampered signature -----------------------------------------

const env4 = signRequest(identity, 'registerWorkstation', {
  workstation_name: workstationName,
  username,
  seed,
  rootPassword,
});
const tampered = { ...env4, signature: '00'.repeat(64) };
const r4 = await post(tampered);
check(
  '4. tampered signature returns 401 signature_invalid',
  r4.status === 401 && (r4.body as { error?: string })?.error === 'signature_invalid',
  `status=${r4.status} body=${JSON.stringify(r4.body)}`,
);

// ---- 5. Missing-seed envelope --------------------------------------
//
// New schema requires `seed` and `rootPassword`. An envelope missing
// either should fail Zod validation server-side and return 400.
// Use a fresh identity so it doesn't conflict with the other rows.

const otherIdentity = generateIdentity();
const env5 = signRequest(otherIdentity, 'registerWorkstation', {
  workstation_name: workstationName,
  username,
  // intentional: omit seed and rootPassword
});
const r5 = await post(env5);
check(
  '5. envelope missing seed/rootPassword returns 400 payload_invalid',
  r5.status === 400 && (r5.body as { error?: string })?.error === 'payload_invalid',
  `status=${r5.status} body=${JSON.stringify(r5.body)}`,
);

// ---- Cleanup -------------------------------------------------------

await sr.from('machine_filesystems').delete().eq('machine_id', machineId);
await sr.from('workstations').delete().eq('player_key', identity.publicKeyHex);

const passed = results.filter((r) => r.pass).length;
const total = results.length;
console.log(`\n${passed}/${total} checks passed`);
process.exit(passed === total ? 0 : 1);
