// End-to-end forge smoke for authCreateSession (PR 2 of
// plans/cross-player-base-fs-replication.md) against vercel:dev.
//
// Setup: registers a fresh workstation so the server has a known
// /etc/passwd content with predictable hashes. Then forges signed
// envelopes covering every authCreateSession outcome:
//
//   1.  authCreateSession password ok → 201 with session_id + userType
//   2.  wrong password → 401 invalid_credentials, no session row
//   3.  unknown username → 401 invalid_credentials (no enumeration leak)
//   4.  savedKey fingerprint ok → 201
//   5.  forged savedKey fingerprint → 401 invalid_credentials
//   6.  savedKey wrong targetIp → 401 invalid_credentials
//   7.  derived userType matches /etc/passwd (server-side, not claimed)
//
// Plus the bypass-closure check from PR 2 step 5:
//
//   8.  createSession kind=ssh → 403 use_authcreatesession (auth-required
//       kinds must use authCreateSession)
//   9.  createSession kind=exploit → 200 (non-auth-required kinds still
//       work via createSession)
//
// Usage (vercel:dev must be running on http://localhost:3000):
//   npx dotenv -e .env.local -e .env.development.local -- npx tsx scripts/testServerAuth.ts
//
// Self-cleaning: deletes the test workstations + sessions + machine_fs
// rows so the script can be re-run idempotently.

import { createClient } from '@supabase/supabase-js';
import { generateIdentity } from '../src/identity/identity';
import { signRequest } from '../src/signedRequest/sign';
import { deriveHostnameSuffix } from '../src/homeNetworks/homeNetworkHelpers';
import { md5 } from '../src/utils/md5';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiUrl = process.env.API_URL ?? 'http://localhost:3000';

if (!url || !serviceKey) {
  console.error(
    'Missing required env vars. Run with:\n  npx dotenv -e .env.local -e .env.development.local -- npx tsx scripts/testServerAuth.ts',
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
const workstationName = 'auth-smoke-box';
const username = 'alice';
const seed = '0123456789abcdef';
const rootPassword = 'auth-smoke-rootpw';
const machineId = `${workstationName}-${deriveHostnameSuffix(identity.publicKeyHex)}`;
const targetIp = '10.0.0.5';

// Cleanup any leftover state from a prior aborted run BEFORE the test.
await sr.from('sessions').delete().eq('player_key', identity.publicKeyHex);
await sr.from('machine_filesystems').delete().eq('machine_id', machineId);
await sr.from('workstations').delete().eq('player_key', identity.publicKeyHex);

const post = async (path: string, envelope: unknown): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

// ---- Setup: register the workstation -------------------------------

const regEnv = signRequest(identity, 'registerWorkstation', {
  workstation_name: workstationName,
  username,
  seed,
  rootPassword,
});
const regResp = await post('/api/register-workstation', regEnv);
check(
  '0. registered workstation (setup)',
  regResp.status === 201 && (regResp.body as { inserted?: boolean })?.inserted === true,
  `status=${regResp.status} body=${JSON.stringify(regResp.body)}`,
);

if (regResp.status !== 201) {
  console.error('Setup failed; aborting.');
  process.exit(1);
}

// ---- 1. authCreateSession password ok -------------------------------

const env1 = signRequest(identity, 'authCreateSession', {
  machine_id: machineId,
  kind: 'ssh',
  username: 'root',
  auth: { method: 'password', password: rootPassword },
});
const r1 = await post('/api/sessions', env1);
const r1Body = r1.body as { session_id?: string; userType?: string };
check(
  '1. valid password returns 201 with session_id + userType',
  r1.status === 201 && typeof r1Body?.session_id === 'string' && r1Body?.userType === 'root',
  `status=${r1.status} body=${JSON.stringify(r1.body)}`,
);

// ---- 2. wrong password -----------------------------------------------

const env2 = signRequest(identity, 'authCreateSession', {
  machine_id: machineId,
  kind: 'ssh',
  username: 'root',
  auth: { method: 'password', password: 'wrong-password' },
});
const r2 = await post('/api/sessions', env2);
check(
  '2. wrong password returns 401 invalid_credentials',
  r2.status === 401 && (r2.body as { error?: string })?.error === 'invalid_credentials',
  `status=${r2.status} body=${JSON.stringify(r2.body)}`,
);

// ---- 3. unknown username (no enumeration leak) -----------------------

const env3 = signRequest(identity, 'authCreateSession', {
  machine_id: machineId,
  kind: 'ssh',
  username: 'nonexistent-user',
  auth: { method: 'password', password: rootPassword },
});
const r3 = await post('/api/sessions', env3);
check(
  '3. unknown username returns 401 invalid_credentials (same body as wrong password)',
  r3.status === 401 && (r3.body as { error?: string })?.error === 'invalid_credentials',
  `status=${r3.status} body=${JSON.stringify(r3.body)}`,
);

// ---- 4. savedKey fingerprint ok --------------------------------------

const rootHash = md5(rootPassword);
const validFingerprint = md5(`root:${targetIp}:${rootHash}`);

const env4 = signRequest(identity, 'authCreateSession', {
  machine_id: machineId,
  kind: 'ssh',
  username: 'root',
  auth: { method: 'savedKey', fingerprint: validFingerprint, targetIp },
});
const r4 = await post('/api/sessions', env4);
const r4Body = r4.body as { session_id?: string; userType?: string };
check(
  '4. valid savedKey fingerprint returns 201',
  r4.status === 201 && typeof r4Body?.session_id === 'string' && r4Body?.userType === 'root',
  `status=${r4.status} body=${JSON.stringify(r4.body)}`,
);

// ---- 5. forged savedKey fingerprint ----------------------------------

const env5 = signRequest(identity, 'authCreateSession', {
  machine_id: machineId,
  kind: 'ssh',
  username: 'root',
  auth: { method: 'savedKey', fingerprint: 'a'.repeat(32), targetIp },
});
const r5 = await post('/api/sessions', env5);
check(
  '5. forged savedKey fingerprint returns 401 invalid_credentials',
  r5.status === 401 && (r5.body as { error?: string })?.error === 'invalid_credentials',
  `status=${r5.status} body=${JSON.stringify(r5.body)}`,
);

// ---- 6. savedKey wrong targetIp --------------------------------------

const env6 = signRequest(identity, 'authCreateSession', {
  machine_id: machineId,
  kind: 'ssh',
  username: 'root',
  auth: { method: 'savedKey', fingerprint: validFingerprint, targetIp: '10.99.99.99' },
});
const r6 = await post('/api/sessions', env6);
check(
  '6. savedKey with wrong targetIp returns 401 (fingerprint binds to typed IP)',
  r6.status === 401 && (r6.body as { error?: string })?.error === 'invalid_credentials',
  `status=${r6.status} body=${JSON.stringify(r6.body)}`,
);

// ---- 7. userType is server-derived (not from envelope claim) ---------

// Verify by inspecting the row from #1: server stamped userType='root'
// purely because /etc/passwd says uid=0, NOT because the envelope claimed
// it (the envelope has no userType field at all).
const { data: sessionRow } = await sr
  .from('sessions')
  .select('credentials')
  .eq('session_id', r1Body.session_id)
  .maybeSingle();
const credUserType = (sessionRow?.credentials as { userType?: string } | undefined)?.userType;
check(
  '7. server stamps userType from /etc/passwd, not client claim',
  credUserType === 'root',
  `session.credentials.userType=${credUserType}`,
);

// ---- 8. createSession with kind=ssh is rejected ----------------------

const env8 = signRequest(identity, 'createSession', {
  machine_id: machineId,
  credentials: { username: 'root', userType: 'root' },
  kind: 'ssh',
});
const r8 = await post('/api/sessions', env8);
check(
  '8. createSession kind=ssh returns 403 use_authcreatesession',
  r8.status === 403 && (r8.body as { error?: string })?.error === 'use_authcreatesession',
  `status=${r8.status} body=${JSON.stringify(r8.body)}`,
);

// ---- 9. createSession with kind=exploit is allowed -------------------

const env9 = signRequest(identity, 'createSession', {
  machine_id: machineId,
  credentials: { username: 'root', userType: 'root' },
  kind: 'exploit',
});
const r9 = await post('/api/sessions', env9);
check(
  '9. createSession kind=exploit returns 200 (non-auth-required kinds still work)',
  r9.status === 200 && typeof (r9.body as { session_id?: string })?.session_id === 'string',
  `status=${r9.status} body=${JSON.stringify(r9.body)}`,
);

// ---- Cleanup ---------------------------------------------------------

await sr.from('sessions').delete().eq('player_key', identity.publicKeyHex);
await sr.from('machine_filesystems').delete().eq('machine_id', machineId);
await sr.from('workstations').delete().eq('player_key', identity.publicKeyHex);

const passed = results.filter((r) => r.pass).length;
const total = results.length;
console.log(`\n${passed}/${total} checks passed`);
process.exit(passed === total ? 0 : 1);
