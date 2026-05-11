// getBaseFs cross-player base-FS replication — wire-payload smoke.
//
// Forges signed envelopes against the live /api/patches endpoint and
// verifies the HTTP response actually:
//   - returns full FS for the owner (tier 1)
//   - returns null FS for a cross-player caller without a session (tier 3)
//   - filters out root-only paths for a cross-player guest session (tier 2)
//   - includes /etc/passwd at projected (real) content for a user session
//   - rejects non-workstation patterns with 400
//   - rejects missing workstation rows with 404
//
// Unit tests cover the layers in isolation; this script proves the
// integration (signed envelope → handler → SQL → regen → overlay → walker
// → wire response) does what it says.
//
// Prerequisites:
//   1. Local Supabase up (npm run supabase:start; npm run db:reset)
//   2. Vercel dev server running:
//        npm run vercel:dev
//
// Usage:
//   npx tsx scripts/testGetBaseFs.ts

import './lib/loadEnv';
import { createClient } from '@supabase/supabase-js';
import { generateIdentity, type Identity } from '../src/identity/identity';
import { signRequest } from '../src/signedRequest/sign';
import { computeWorkstationId } from '../src/homeNetworks/homeNetworkHelpers';
import { md5 } from '../src/utils/md5';
import type { FileNode } from '../src/filesystem/types';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const vercelDevUrl = process.env.VERCEL_DEV_URL ?? 'http://localhost:3000';

if (!url || !serviceKey) {
  console.error('Missing required env vars. Run with:\n  npx tsx scripts/testGetBaseFs.ts');
  process.exit(2);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

// 1. Verify vercel dev is reachable.
try {
  const probe = await fetch(`${vercelDevUrl}/api/patches`, { method: 'GET' });
  if (probe.status !== 405) {
    console.warn(`[warn] /api/patches probe returned ${probe.status} (expected 405).`);
  }
} catch {
  console.error(
    `\nCannot reach Vercel dev server at ${vercelDevUrl}.\nStart it with: npm run vercel:dev\n`,
  );
  process.exit(1);
}

// 2. Two identities — A is the workstation owner, B is the cross-player caller.
const identityA = generateIdentity();
const identityB = generateIdentity();
const workstationName = `gbf-${identityA.publicKeyHex.slice(0, 6)}`;
const username = 'alice';
const seed = 'gbf-fixture-seed';
const realRootPassword = 'super-secret-pw';
const realRootHash = md5(realRootPassword);

const machineIdA = computeWorkstationId(workstationName, identityA.publicKeyHex);
const ghostMachineId = `${workstationName}-ffffffff`; // workstation pattern, no row
const ipv4MachineId = '192.168.1.50'; // non-workstation pattern

console.log(`A.player_key  = ${identityA.publicKeyHex.slice(0, 16)}...`);
console.log(`B.player_key  = ${identityB.publicKeyHex.slice(0, 16)}...`);
console.log(`A.machine_id  = ${machineIdA}`);
console.log(`real root hash = ${realRootHash.slice(0, 12)}...`);
console.log();

// 3. Pre-clean any leftovers.
await sb
  .from('sessions')
  .delete()
  .in('player_key', [identityA.publicKeyHex, identityB.publicKeyHex]);
await sb.from('machine_filesystems').delete().eq('machine_id', machineIdA);
await sb.from('patches').delete().eq('machine_id', machineIdA);
await sb.from('workstations').delete().eq('player_key', identityA.publicKeyHex);

// 4. Seed: workstation row + a machine_filesystems projection row for
// /etc/passwd carrying the REAL root hash. Other paths can be absent;
// the regen produces structure for them and the overlay only fills
// projected entries.
const { error: wsErr } = await sb.from('workstations').insert({
  player_key: identityA.publicKeyHex,
  workstation_name: workstationName,
  username,
  seed,
});
if (wsErr) {
  console.error('Failed to seed workstations:', wsErr);
  process.exit(1);
}

// Real /etc/passwd content matching what generateLocalhost would
// produce — but with the REAL hash for root.
const passwdContent =
  `root:${realRootHash}:0:0:root:/root:/bin/bash\n` +
  `${username}::1000:1000:${username}:/home/${username}:/bin/bash\n` +
  `guest:dummyhash:1001:1001:guest:/home/guest:/bin/bash\n`;

const { error: fsErr } = await sb.from('machine_filesystems').insert({
  machine_id: machineIdA,
  path: '/etc/passwd',
  owner: 'root',
  permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
  content: passwdContent,
});
if (fsErr) {
  console.error('Failed to seed machine_filesystems:', fsErr);
  process.exit(1);
}

// 5. Helper: sign + POST a forged getBaseFs.
type GetBaseFsResp = {
  readonly status: number;
  readonly body: { readonly baseFs?: FileNode | null; readonly error?: string };
};

const attemptGetBaseFs = async (identity: Identity, machineId: string): Promise<GetBaseFsResp> => {
  const envelope = signRequest(identity, 'getBaseFs', { machine_id: machineId });
  const res = await fetch(`${vercelDevUrl}/api/patches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = (await res.json().catch(() => ({}))) as {
    readonly baseFs?: FileNode | null;
    readonly error?: string;
  };
  return { status: res.status, body };
};

const insertSession = async (
  identity: Identity,
  userType: 'root' | 'user' | 'guest',
): Promise<void> => {
  const { error } = await sb.from('sessions').insert({
    player_key: identity.publicKeyHex,
    machine_id: machineIdA,
    credentials: { username: 'whoever', userType },
    kind: 'ssh',
  });
  if (error) throw new Error(`session insert failed: ${error.message}`);
};

const endAllSessionsFor = async (identity: Identity): Promise<void> => {
  await sb
    .from('sessions')
    .update({ ended_at: new Date().toISOString(), end_reason: 'smoke-cleanup' })
    .eq('player_key', identity.publicKeyHex)
    .is('ended_at', null);
};

const log = (label: string, pass: boolean, detail: string) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}\n      ${detail}\n`);
};

// Recursive lookup for a path in the FileNode tree.
const findNode = (root: FileNode | null | undefined, path: string): FileNode | null => {
  if (!root) return null;
  if (path === '/') return root;
  const segs = path.split('/').filter(Boolean);
  let cur: FileNode | undefined = root;
  for (const seg of segs) {
    cur = cur?.children?.[seg];
    if (!cur) return null;
  }
  return cur;
};

let passed = 0;
let total = 0;

// --- Scenario 1: A forges to own workstation — tier 1 owner bypass ---
console.log('=== Scenario 1: owner bypass — full FS unfiltered ===');
total++;
{
  const r = await attemptGetBaseFs(identityA, machineIdA);
  const passwd = findNode(r.body.baseFs, '/etc/passwd');
  const rootDir = findNode(r.body.baseFs, '/root');
  const ok =
    r.status === 200 &&
    r.body.baseFs !== null &&
    passwd !== null &&
    passwd.content === passwdContent &&
    rootDir !== null;
  log(
    'owner: /etc/passwd present with real hash, /root visible',
    ok,
    `HTTP ${r.status}, /etc/passwd content matches projection: ${passwd?.content === passwdContent}`,
  );
  if (ok) passed++;
}

// --- Scenario 2: B forges to A's workstation with NO session — tier 3 ---
console.log('=== Scenario 2: cross-player, no session — baseFs:null ===');
total++;
{
  const r = await attemptGetBaseFs(identityB, machineIdA);
  const ok = r.status === 200 && r.body.baseFs === null;
  log(
    'no-session: baseFs is null (defense in depth)',
    ok,
    `HTTP ${r.status}, baseFs ${r.body.baseFs === null ? 'is null' : 'is non-null'}`,
  );
  if (ok) passed++;
}

// --- Scenario 3: B forges with GUEST session — tier 2 walker drops root-only ---
console.log('=== Scenario 3: cross-player, guest session — /etc/passwd dropped ===');
total++;
{
  await insertSession(identityB, 'guest');
  const r = await attemptGetBaseFs(identityB, machineIdA);
  const passwd = findNode(r.body.baseFs, '/etc/passwd');
  const rootDir = findNode(r.body.baseFs, '/root');
  const ok = r.status === 200 && r.body.baseFs !== null && passwd === null && rootDir === null;
  log(
    'guest: walker drops /etc/passwd (read=root,user) and /root (execute=root)',
    ok,
    `HTTP ${r.status}, /etc/passwd present: ${passwd !== null}, /root present: ${rootDir !== null}`,
  );
  if (ok) passed++;
  await endAllSessionsFor(identityB);
}

// --- Scenario 4: B forges with USER session — /etc/passwd visible at real hash ---
console.log('=== Scenario 4: cross-player, user session — /etc/passwd visible (real hash) ===');
total++;
{
  await insertSession(identityB, 'user');
  const r = await attemptGetBaseFs(identityB, machineIdA);
  const passwd = findNode(r.body.baseFs, '/etc/passwd');
  const rootDir = findNode(r.body.baseFs, '/root');
  const ok =
    r.status === 200 &&
    r.body.baseFs !== null &&
    passwd !== null &&
    passwd.content === passwdContent &&
    rootDir === null;
  log(
    'user: /etc/passwd content matches projection, /root excluded',
    ok,
    `HTTP ${r.status}, /etc/passwd content matches: ${passwd?.content === passwdContent}, /root present: ${rootDir !== null}`,
  );
  if (ok) passed++;
  await endAllSessionsFor(identityB);
}

// --- Scenario 5: B forges with ROOT session — full FS visible ---
console.log('=== Scenario 5: cross-player, root session — everything visible ===');
total++;
{
  await insertSession(identityB, 'root');
  const r = await attemptGetBaseFs(identityB, machineIdA);
  const passwd = findNode(r.body.baseFs, '/etc/passwd');
  const rootDir = findNode(r.body.baseFs, '/root');
  const ok =
    r.status === 200 &&
    r.body.baseFs !== null &&
    passwd?.content === passwdContent &&
    rootDir !== null;
  log(
    'root: /etc/passwd at projection, /root visible',
    ok,
    `HTTP ${r.status}, /etc/passwd content matches: ${passwd?.content === passwdContent}, /root: ${rootDir !== null}`,
  );
  if (ok) passed++;
  await endAllSessionsFor(identityB);
}

// --- Scenario 6: non-workstation pattern → 400 ---
console.log('=== Scenario 6: non-workstation pattern (IPv4) → 400 ===');
total++;
{
  const r = await attemptGetBaseFs(identityB, ipv4MachineId);
  const ok = r.status === 400 && r.body.error === 'unsupported_machine_type';
  log('IPv4 → 400 unsupported_machine_type', ok, `HTTP ${r.status}, error=${r.body.error}`);
  if (ok) passed++;
}

// --- Scenario 7: missing workstation row → 404 ---
console.log('=== Scenario 7: missing workstation row → 404 ===');
total++;
{
  const r = await attemptGetBaseFs(identityB, ghostMachineId);
  const ok = r.status === 404 && r.body.error === 'workstation_not_found';
  log(
    'ghost workstation_id → 404 workstation_not_found',
    ok,
    `HTTP ${r.status}, error=${r.body.error}`,
  );
  if (ok) passed++;
}

// 6. Cleanup.
await sb
  .from('sessions')
  .delete()
  .in('player_key', [identityA.publicKeyHex, identityB.publicKeyHex]);
await sb.from('machine_filesystems').delete().eq('machine_id', machineIdA);
await sb.from('patches').delete().eq('machine_id', machineIdA);
await sb.from('workstations').delete().eq('player_key', identityA.publicKeyHex);

console.log(`${passed}/${total} scenarios pass.`);
process.exit(passed === total ? 0 : 1);
