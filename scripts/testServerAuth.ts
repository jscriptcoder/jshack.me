// End-to-end forge smoke for authCreateSession (PRs 2-4 of
// plans/cross-player-base-fs-replication.md) against vercel:dev.
//
// Setup: registers a fresh workstation so the server has a known
// /etc/passwd content with predictable hashes. Then forges signed
// envelopes covering every authCreateSession outcome:
//
//   PR 2 (ssh / scp / su)
//   1.  authCreateSession password ok → 201 with session_id + userType
//   2.  wrong password → 401 invalid_credentials, no session row
//   3.  unknown username → 401 invalid_credentials (no enumeration leak)
//   4.  savedKey fingerprint ok → 201
//   5.  forged savedKey fingerprint → 401 invalid_credentials
//   6.  savedKey wrong targetIp → 401 invalid_credentials
//   7.  derived userType matches /etc/passwd (server-side, not claimed)
//
//   PR 2 step 5 — bypass closure
//   8.  createSession kind=ssh → 403 use_authcreatesession
//   9.  createSession kind=exploit → 200 (non-auth-required kinds still
//       work via createSession)
//
//   PR 3 (ftp)
//   10. authCreateSession kind=ftp + virtual_users.conf overlay match → 201
//   11. wrong FTP password → 401 invalid_credentials
//   12. user not in virtual_users.conf falls back to /etc/passwd → 201
//   13. kind=ftp + savedKey method → 401 invalid_credentials
//   14. createSession kind=ftp → 403 use_authcreatesession
//
//   PR 4 (mysql / redis / snmp)
//   15. mysql password match → 201, userType from data.json
//   16. mysql wrong password → 401
//   17. createSession kind=mysql → 403 use_authcreatesession
//   18. redis requirepass match → 201, userType=root
//   19. redis wrong password → 401
//   20. createSession kind=redis → 403 use_authcreatesession
//   21. snmp rwcommunity match → 201, userType=root
//   22. snmp rocommunity match → 401 (snmpset requires rw)
//   23. createSession kind=snmp → 403 use_authcreatesession
//
// Usage (vercel:dev must be running on http://localhost:3000):
//   npx dotenv -e .env.local -e .env.development.local -- npx tsx scripts/testServerAuth.ts
//
// Self-cleaning: deletes the test workstations + sessions + machine_fs
// rows (including the seeded virtual_users.conf overlay) so the script
// can be re-run idempotently.

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
const machineId = computeWorkstationId(workstationName, identity.publicKeyHex);
const targetIp = '10.0.0.5';

// Cleanup any leftover state from a prior aborted run BEFORE the test.
await sr.from('sessions').delete().eq('player_key', identity.publicKeyHex);
await sr.from('machine_filesystems').delete().eq('machine_id', machineId);
await sr.from('workstations').delete().eq('player_key', identity.publicKeyHex);

const post = async (
  path: string,
  envelope: unknown,
): Promise<{ status: number; body: unknown }> => {
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

// ---- FTP server-authoritative auth (PR 3) ----------------------------
//
// Set up a /etc/vsftpd/virtual_users.conf overlay row for the registered
// workstation. virtual_users.conf format is `username:md5hash` per line
// — the overlay takes precedence over /etc/passwd, but only for users
// listed in it. Users NOT in virtual_users.conf fall through to
// /etc/passwd. userType always derives from /etc/passwd.

const FTP_OVERLAY_PASSWORD = 'alice-ftp-overlay-pw';
const ftpOverlayContent = `${username}:${md5(FTP_OVERLAY_PASSWORD)}`;

await sr.from('machine_filesystems').upsert(
  {
    machine_id: machineId,
    path: '/etc/vsftpd/virtual_users.conf',
    content: ftpOverlayContent,
    permissions: { read: ['root'], write: ['root'], execute: [] },
    owner: 'root',
  },
  { onConflict: 'machine_id,path' },
);

// ---- 10. FTP overlay match: alice's FTP password validates -----------

const env10 = signRequest(identity, 'authCreateSession', {
  machine_id: machineId,
  kind: 'ftp',
  username,
  auth: { method: 'password', password: FTP_OVERLAY_PASSWORD },
});
const r10 = await post('/api/sessions', env10);
const r10Body = r10.body as { session_id?: string; userType?: string };
check(
  '10. FTP overlay password match returns 201 with userType from /etc/passwd',
  r10.status === 201 && typeof r10Body?.session_id === 'string' && r10Body?.userType === 'user',
  `status=${r10.status} body=${JSON.stringify(r10.body)}`,
);

// ---- 11. FTP wrong password (overlay) -------------------------------

const env11 = signRequest(identity, 'authCreateSession', {
  machine_id: machineId,
  kind: 'ftp',
  username,
  auth: { method: 'password', password: 'wrong-ftp-password' },
});
const r11 = await post('/api/sessions', env11);
check(
  '11. FTP wrong password returns 401 invalid_credentials',
  r11.status === 401 && (r11.body as { error?: string })?.error === 'invalid_credentials',
  `status=${r11.status} body=${JSON.stringify(r11.body)}`,
);

// ---- 12. FTP fallback: root not in overlay, validates against /etc/passwd

const env12 = signRequest(identity, 'authCreateSession', {
  machine_id: machineId,
  kind: 'ftp',
  username: 'root',
  auth: { method: 'password', password: rootPassword },
});
const r12 = await post('/api/sessions', env12);
const r12Body = r12.body as { session_id?: string; userType?: string };
check(
  '12. FTP fallback to /etc/passwd when user absent from virtual_users.conf',
  r12.status === 201 && typeof r12Body?.session_id === 'string' && r12Body?.userType === 'root',
  `status=${r12.status} body=${JSON.stringify(r12.body)}`,
);

// ---- 13. FTP savedKey rejected --------------------------------------

const env13 = signRequest(identity, 'authCreateSession', {
  machine_id: machineId,
  kind: 'ftp',
  username,
  // Even a "valid" fingerprint (formula matches SSH derivation) MUST be
  // rejected for FTP — there's no .ssh_keys for ftp.
  auth: {
    method: 'savedKey',
    fingerprint: md5(`${username}:${targetIp}:${md5(FTP_OVERLAY_PASSWORD)}`),
    targetIp,
  },
});
const r13 = await post('/api/sessions', env13);
check(
  '13. FTP savedKey method returns 401 invalid_credentials (no .ssh_keys for ftp)',
  r13.status === 401 && (r13.body as { error?: string })?.error === 'invalid_credentials',
  `status=${r13.status} body=${JSON.stringify(r13.body)}`,
);

// ---- 14. createSession with kind=ftp is rejected (PR 3 closes bypass)

const env14 = signRequest(identity, 'createSession', {
  machine_id: machineId,
  credentials: { username, userType: 'user' },
  kind: 'ftp',
});
const r14 = await post('/api/sessions', env14);
check(
  '14. createSession kind=ftp returns 403 use_authcreatesession',
  r14.status === 403 && (r14.body as { error?: string })?.error === 'use_authcreatesession',
  `status=${r14.status} body=${JSON.stringify(r14.body)}`,
);

// ---- MySQL / Redis / SNMP server-auth (PR 4) -------------------------

const MYSQL_PASSWORD = 'mysql-admin-pw';
const MYSQL_CONTENT = JSON.stringify({
  name: 'app',
  tables: {},
  credentials: [{ username: 'mysqladmin', passwordHash: md5(MYSQL_PASSWORD), userType: 'root' }],
});

const REDIS_PASSWORD = 'redis-secret-pw';
const REDIS_CONTENT = `port 6379\nrequirepass ${REDIS_PASSWORD}`;

const RW_COMMUNITY = 'private-rw';
const RO_COMMUNITY = 'public-ro';
const SNMP_CONTENT = `rocommunity ${RO_COMMUNITY}\nrwcommunity ${RW_COMMUNITY}`;

await sr.from('machine_filesystems').upsert(
  [
    {
      machine_id: machineId,
      path: '/var/lib/mysql/data.json',
      content: MYSQL_CONTENT,
      permissions: { read: ['root'], write: ['root'], execute: [] },
      owner: 'root',
    },
    {
      machine_id: machineId,
      path: '/etc/redis/redis.conf',
      content: REDIS_CONTENT,
      permissions: { read: ['root'], write: ['root'], execute: [] },
      owner: 'root',
    },
    {
      machine_id: machineId,
      path: '/etc/snmp/snmpd.conf',
      content: SNMP_CONTENT,
      permissions: { read: ['root'], write: ['root'], execute: [] },
      owner: 'root',
    },
  ],
  { onConflict: 'machine_id,path' },
);

// ---- 15. mysql success ---------------------------------------------

const env15 = signRequest(identity, 'authCreateSession', {
  machine_id: machineId,
  kind: 'mysql',
  username: 'mysqladmin',
  auth: { method: 'password', password: MYSQL_PASSWORD },
});
const r15 = await post('/api/sessions', env15);
const r15Body = r15.body as { session_id?: string; userType?: string };
check(
  '15. mysql password match returns 201 with userType from data.json',
  r15.status === 201 && typeof r15Body?.session_id === 'string' && r15Body?.userType === 'root',
  `status=${r15.status} body=${JSON.stringify(r15.body)}`,
);

// ---- 16. mysql wrong password --------------------------------------

const env16 = signRequest(identity, 'authCreateSession', {
  machine_id: machineId,
  kind: 'mysql',
  username: 'mysqladmin',
  auth: { method: 'password', password: 'wrong-pw' },
});
const r16 = await post('/api/sessions', env16);
check(
  '16. mysql wrong password returns 401 invalid_credentials',
  r16.status === 401 && (r16.body as { error?: string })?.error === 'invalid_credentials',
  `status=${r16.status} body=${JSON.stringify(r16.body)}`,
);

// ---- 17. createSession kind=mysql is rejected ----------------------

const env17 = signRequest(identity, 'createSession', {
  machine_id: machineId,
  credentials: { username: 'mysqladmin', userType: 'root' },
  kind: 'mysql',
});
const r17 = await post('/api/sessions', env17);
check(
  '17. createSession kind=mysql returns 403 use_authcreatesession',
  r17.status === 403 && (r17.body as { error?: string })?.error === 'use_authcreatesession',
  `status=${r17.status} body=${JSON.stringify(r17.body)}`,
);

// ---- 18. redis success ---------------------------------------------

const env18 = signRequest(identity, 'authCreateSession', {
  machine_id: machineId,
  kind: 'redis',
  username: 'redis',
  auth: { method: 'password', password: REDIS_PASSWORD },
});
const r18 = await post('/api/sessions', env18);
const r18Body = r18.body as { session_id?: string; userType?: string };
check(
  '18. redis requirepass match returns 201 with userType=root',
  r18.status === 201 && typeof r18Body?.session_id === 'string' && r18Body?.userType === 'root',
  `status=${r18.status} body=${JSON.stringify(r18.body)}`,
);

// ---- 19. redis wrong password --------------------------------------

const env19 = signRequest(identity, 'authCreateSession', {
  machine_id: machineId,
  kind: 'redis',
  username: 'redis',
  auth: { method: 'password', password: 'wrong-pw' },
});
const r19 = await post('/api/sessions', env19);
check(
  '19. redis wrong password returns 401 invalid_credentials',
  r19.status === 401 && (r19.body as { error?: string })?.error === 'invalid_credentials',
  `status=${r19.status} body=${JSON.stringify(r19.body)}`,
);

// ---- 20. createSession kind=redis is rejected ----------------------

const env20 = signRequest(identity, 'createSession', {
  machine_id: machineId,
  credentials: { username: 'redis', userType: 'root' },
  kind: 'redis',
});
const r20 = await post('/api/sessions', env20);
check(
  '20. createSession kind=redis returns 403 use_authcreatesession',
  r20.status === 403 && (r20.body as { error?: string })?.error === 'use_authcreatesession',
  `status=${r20.status} body=${JSON.stringify(r20.body)}`,
);

// ---- 21. snmp success on rwcommunity -------------------------------

const env21 = signRequest(identity, 'authCreateSession', {
  machine_id: machineId,
  kind: 'snmp',
  username: 'snmp',
  auth: { method: 'password', password: RW_COMMUNITY },
});
const r21 = await post('/api/sessions', env21);
const r21Body = r21.body as { session_id?: string; userType?: string };
check(
  '21. snmp rwcommunity match returns 201 with userType=root',
  r21.status === 201 && typeof r21Body?.session_id === 'string' && r21Body?.userType === 'root',
  `status=${r21.status} body=${JSON.stringify(r21.body)}`,
);

// ---- 22. snmp rocommunity rejected (snmpset needs rwcommunity) -----

const env22 = signRequest(identity, 'authCreateSession', {
  machine_id: machineId,
  kind: 'snmp',
  username: 'snmp',
  auth: { method: 'password', password: RO_COMMUNITY },
});
const r22 = await post('/api/sessions', env22);
check(
  '22. snmp rocommunity match returns 401 (snmpset requires rwcommunity)',
  r22.status === 401 && (r22.body as { error?: string })?.error === 'invalid_credentials',
  `status=${r22.status} body=${JSON.stringify(r22.body)}`,
);

// ---- 23. createSession kind=snmp is rejected -----------------------

const env23 = signRequest(identity, 'createSession', {
  machine_id: machineId,
  credentials: { username: 'snmp', userType: 'root' },
  kind: 'snmp',
});
const r23 = await post('/api/sessions', env23);
check(
  '23. createSession kind=snmp returns 403 use_authcreatesession',
  r23.status === 403 && (r23.body as { error?: string })?.error === 'use_authcreatesession',
  `status=${r23.status} body=${JSON.stringify(r23.body)}`,
);

// ---- Cleanup ---------------------------------------------------------

await sr.from('sessions').delete().eq('player_key', identity.publicKeyHex);
await sr.from('machine_filesystems').delete().eq('machine_id', machineId);
await sr.from('workstations').delete().eq('player_key', identity.publicKeyHex);

const passed = results.filter((r) => r.pass).length;
const total = results.length;
console.log(`\n${passed}/${total} checks passed`);
process.exit(passed === total ? 0 : 1);
