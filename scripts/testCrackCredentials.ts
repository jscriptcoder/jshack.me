// crackCredentials — wire-payload smoke for cross-player batched hydra.
//
// Forges signed envelopes against the live /api/patches endpoint and
// verifies the HTTP response actually:
//   - returns matching {username, matched_hash} pairs for ssh /etc/passwd
//   - returns empty hits when no candidate matches
//   - user_filter scopes the hash lookup
//   - FTP virtual_users.conf overlay wins over /etc/passwd
//   - FTP falls back to /etc/passwd when virtual_users.conf misses the user
//   - rejects non-workstation machine_id with 400
//   - rejects missing workstation row with 404
//   - rejects oversized batch (> 200) with 400
//   - rejects empty candidate_hashes with 400
//   - rejects non-hex hash with 400
//
// Unit tests cover the layers in isolation; this script proves the
// integration (signed envelope → handler → SQL → wire response) actually
// matches the contract a real client (hydra) depends on.
//
// Prerequisites:
//   1. Local Supabase up (npm run supabase:start; npm run db:reset)
//   2. Vercel dev server running:
//        npm run vercel:dev
//
// Usage:
//   npx tsx scripts/testCrackCredentials.ts

import './lib/loadEnv';
import { createClient } from '@supabase/supabase-js';
import { generateIdentity, type Identity } from '../src/identity/identity';
import { signRequest } from '../src/signedRequest/sign';
import { computeWorkstationId } from '../src/homeNetworks/homeNetworkHelpers';
import { md5 } from '../src/utils/md5';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const vercelDevUrl = process.env.VERCEL_DEV_URL ?? 'http://localhost:3000';

if (!url || !serviceKey) {
  console.error('Missing required env vars. Run with:\n  npx tsx scripts/testCrackCredentials.ts');
  process.exit(2);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

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

const identityA = generateIdentity();
const identityB = generateIdentity();
const workstationName = `hyc-${identityA.publicKeyHex.slice(0, 6)}`;
const username = 'alice';
const seed = 'hyc-fixture-seed';

// Plaintext-and-hash pairs the smoke uses. ALICE is in the wordlist
// (server should return as a hit). ROOT is also in /etc/passwd but
// not in the candidate batches for misses-test. FTP_VIRTUAL is the
// vsftpd overlay password that should win over alice's system hash.
const alicePlain = 'admin';
const aliceHash = md5(alicePlain);
const rootPlain = 'sup3r-r00t';
const rootHash = md5(rootPlain);
const ftpVirtualPlain = 'ftpsecret';
const ftpVirtualHash = md5(ftpVirtualPlain);

const machineIdA = computeWorkstationId(workstationName, identityA.publicKeyHex);
const ghostMachineId = `${workstationName}-ffffffff`;
const ipv4MachineId = '192.168.1.50';

console.log(`A.player_key  = ${identityA.publicKeyHex.slice(0, 16)}...`);
console.log(`B.player_key  = ${identityB.publicKeyHex.slice(0, 16)}...`);
console.log(`A.machine_id  = ${machineIdA}`);
console.log();

await sb
  .from('sessions')
  .delete()
  .in('player_key', [identityA.publicKeyHex, identityB.publicKeyHex]);
await sb.from('machine_filesystems').delete().eq('machine_id', machineIdA);
await sb.from('patches').delete().eq('machine_id', machineIdA);
await sb.from('workstations').delete().eq('player_key', identityA.publicKeyHex);

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

const passwdContent =
  `root:${rootHash}:0:0:root:/root:/bin/bash\n` +
  `alice:${aliceHash}:1000:1000:alice:/home/alice:/bin/bash\n` +
  `guest:dummyhashforguest:1001:1001:guest:/home/guest:/bin/bash\n`;

const { error: fsErr } = await sb.from('machine_filesystems').insert({
  machine_id: machineIdA,
  path: '/etc/passwd',
  owner: 'root',
  permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
  content: passwdContent,
});
if (fsErr) {
  console.error('Failed to seed /etc/passwd row:', fsErr);
  process.exit(1);
}

const virtualContent = `alice:${ftpVirtualHash}`;
const { error: vuErr } = await sb.from('machine_filesystems').insert({
  machine_id: machineIdA,
  path: '/etc/vsftpd/virtual_users.conf',
  owner: 'root',
  permissions: { read: ['root'], write: ['root'], execute: ['root'] },
  content: virtualContent,
});
if (vuErr) {
  console.error('Failed to seed virtual_users.conf row:', vuErr);
  process.exit(1);
}

type CrackResp = {
  readonly status: number;
  readonly body: {
    readonly hits?: ReadonlyArray<{ readonly username: string; readonly matched_hash: string }>;
    readonly attempts?: number;
    readonly error?: string;
  };
};

const attempt = async (
  identity: Identity,
  machineId: string,
  service: 'ssh' | 'ftp',
  candidateHashes: readonly string[],
  userFilter?: string,
): Promise<CrackResp> => {
  const envelope = signRequest(identity, 'crackCredentials', {
    machine_id: machineId,
    service,
    candidate_hashes: candidateHashes,
    ...(userFilter !== undefined && { user_filter: userFilter }),
  });
  const res = await fetch(`${vercelDevUrl}/api/patches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = (await res.json().catch(() => ({}))) as CrackResp['body'];
  return { status: res.status, body };
};

// Raw POST bypassing the signed-envelope helper — for testing zod
// rejection of malformed payloads (oversized batches, bad shape, etc).
// The signer would reject these payloads before they hit the wire,
// so we have to forge the request manually.
const rawAttempt = async (rawPayload: unknown): Promise<CrackResp> => {
  // We still need a valid signed envelope shape — sign the payload as-is
  // and let the server reject it via zod (the schema runs INSIDE the
  // verified path, after signature check). signRequest accepts any
  // payload object.
  const envelope = signRequest(
    identityB,
    (rawPayload as { action?: string }).action ?? 'crackCredentials',
    rawPayload as Record<string, unknown>,
  );
  const res = await fetch(`${vercelDevUrl}/api/patches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = (await res.json().catch(() => ({}))) as CrackResp['body'];
  return { status: res.status, body };
};

const log = (label: string, pass: boolean, detail: string) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}\n      ${detail}\n`);
};

let passed = 0;
let total = 0;

// --- Scenario 1: ssh hit — alice's hash in batch → returns matched hit ---
console.log('=== Scenario 1: ssh — candidate matches alice → hit ===');
total++;
{
  const r = await attempt(identityB, machineIdA, 'ssh', [
    aliceHash,
    md5('not-a-password-1'),
    md5('not-a-password-2'),
  ]);
  const hit = r.body.hits?.find((h) => h.username === 'alice');
  const ok = r.status === 200 && hit !== undefined && hit.matched_hash === aliceHash;
  log(
    'ssh hit: alice + matched_hash',
    ok,
    `HTTP ${r.status}, hits=${JSON.stringify(r.body.hits)}, attempts=${r.body.attempts}`,
  );
  if (ok) passed++;
}

// --- Scenario 2: ssh miss — no candidate matches → empty hits ---
console.log('=== Scenario 2: ssh — no candidate matches → empty hits ===');
total++;
{
  const r = await attempt(identityB, machineIdA, 'ssh', [
    md5('not-a-password-1'),
    md5('not-a-password-2'),
  ]);
  const ok =
    r.status === 200 &&
    Array.isArray(r.body.hits) &&
    r.body.hits.length === 0 &&
    r.body.attempts === 3 * 2;
  log(
    'ssh miss: hits=[], attempts=users x candidates',
    ok,
    `HTTP ${r.status}, hits=${JSON.stringify(r.body.hits)}, attempts=${r.body.attempts}`,
  );
  if (ok) passed++;
}

// --- Scenario 3: ssh user_filter — only alice considered ---
console.log('=== Scenario 3: ssh user_filter=alice — only alice in scope ===');
total++;
{
  // rootHash IS in batch but user_filter restricts to alice → no hit
  // for root, only alice's hash should be checked.
  const r = await attempt(identityB, machineIdA, 'ssh', [rootHash, aliceHash], 'alice');
  const ok =
    r.status === 200 &&
    Array.isArray(r.body.hits) &&
    r.body.hits.length === 1 &&
    r.body.hits[0]?.username === 'alice' &&
    r.body.attempts === 1 * 2; // 1 user (alice) x 2 candidates
  log(
    'user_filter scopes to alice',
    ok,
    `HTTP ${r.status}, hits=${JSON.stringify(r.body.hits)}, attempts=${r.body.attempts}`,
  );
  if (ok) passed++;
}

// --- Scenario 4: ftp virtual_users overlay wins ---
console.log('=== Scenario 4: ftp — virtual_users.conf hash wins over /etc/passwd for alice ===');
total++;
{
  // ftpVirtualHash should hit (vsftpd overlay); aliceHash (system) is in
  // the batch too but should NOT hit because the overlay replaces it.
  const r = await attempt(identityB, machineIdA, 'ftp', [aliceHash, ftpVirtualHash], 'alice');
  const hit = r.body.hits?.find((h) => h.username === 'alice');
  const ok = r.status === 200 && hit !== undefined && hit.matched_hash === ftpVirtualHash;
  log(
    'ftp overlay precedence: virtual hash hits, system hash does not',
    ok,
    `HTTP ${r.status}, hits=${JSON.stringify(r.body.hits)}`,
  );
  if (ok) passed++;
}

// --- Scenario 5: ftp fallback when virtual_users.conf misses user ---
console.log(
  '=== Scenario 5: ftp — virtual_users.conf missing root → falls back to /etc/passwd ===',
);
total++;
{
  // root is NOT in virtual_users.conf — only alice is. So ftp hydra
  // against root should fall through to /etc/passwd hash → rootHash hits.
  const r = await attempt(identityB, machineIdA, 'ftp', [rootHash], 'root');
  const hit = r.body.hits?.find((h) => h.username === 'root');
  const ok = r.status === 200 && hit !== undefined && hit.matched_hash === rootHash;
  log(
    'ftp fallback: /etc/passwd hash hits when virtual entry absent',
    ok,
    `HTTP ${r.status}, hits=${JSON.stringify(r.body.hits)}`,
  );
  if (ok) passed++;
}

// --- Scenario 6: non-workstation pattern (IPv4) → 400 ---
console.log('=== Scenario 6: IPv4 machine_id → 400 unsupported_machine_type ===');
total++;
{
  const r = await attempt(identityB, ipv4MachineId, 'ssh', [aliceHash]);
  const ok = r.status === 400 && r.body.error === 'unsupported_machine_type';
  log('IPv4 → 400 unsupported_machine_type', ok, `HTTP ${r.status}, error=${r.body.error}`);
  if (ok) passed++;
}

// --- Scenario 7: missing workstation row → 404 ---
console.log('=== Scenario 7: ghost workstation_id → 404 workstation_not_found ===');
total++;
{
  const r = await attempt(identityB, ghostMachineId, 'ssh', [aliceHash]);
  const ok = r.status === 404 && r.body.error === 'workstation_not_found';
  log(
    'ghost workstation_id → 404 workstation_not_found',
    ok,
    `HTTP ${r.status}, error=${r.body.error}`,
  );
  if (ok) passed++;
}

// --- Scenario 8: oversized batch (> 200) → 400 ---
console.log('=== Scenario 8: 201-entry batch → 400 (zod max rejects) ===');
total++;
{
  const big = Array.from({ length: 201 }, (_, i) => md5(`pw-${i}`).padEnd(32, '0').slice(0, 32));
  const r = await rawAttempt({
    action: 'crackCredentials',
    machine_id: machineIdA,
    service: 'ssh',
    candidate_hashes: big,
  });
  const ok = r.status === 400;
  log('oversized batch → 400', ok, `HTTP ${r.status}, error=${r.body.error}`);
  if (ok) passed++;
}

// --- Scenario 9: empty candidate_hashes → 400 ---
console.log('=== Scenario 9: empty candidate_hashes → 400 (zod min rejects) ===');
total++;
{
  const r = await rawAttempt({
    action: 'crackCredentials',
    machine_id: machineIdA,
    service: 'ssh',
    candidate_hashes: [],
  });
  const ok = r.status === 400;
  log('empty batch → 400', ok, `HTTP ${r.status}, error=${r.body.error}`);
  if (ok) passed++;
}

// --- Scenario 10: non-hex hash → 400 ---
console.log('=== Scenario 10: non-hex hash → 400 (regex rejects) ===');
total++;
{
  const r = await rawAttempt({
    action: 'crackCredentials',
    machine_id: machineIdA,
    service: 'ssh',
    candidate_hashes: ['ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'],
  });
  const ok = r.status === 400;
  log('non-hex hash → 400', ok, `HTTP ${r.status}, error=${r.body.error}`);
  if (ok) passed++;
}

// --- Scenario 11: unsupported service (mysql) → 400 ---
console.log('=== Scenario 11: service=mysql → 400 (enum rejects) ===');
total++;
{
  const r = await rawAttempt({
    action: 'crackCredentials',
    machine_id: machineIdA,
    service: 'mysql',
    candidate_hashes: [aliceHash],
  });
  const ok = r.status === 400;
  log('service=mysql → 400', ok, `HTTP ${r.status}, error=${r.body.error}`);
  if (ok) passed++;
}

// --- Scenario 12: no session required — pre-auth tool by design ---
console.log('=== Scenario 12: no session — pre-auth tool, hit still works ===');
total++;
{
  // Ensure no session row exists for B (insertSession is never called
  // in this script except for scenarios that don't apply here).
  await sb.from('sessions').delete().eq('player_key', identityB.publicKeyHex);
  const r = await attempt(identityB, machineIdA, 'ssh', [aliceHash]);
  const ok = r.status === 200 && (r.body.hits?.some((h) => h.username === 'alice') ?? false);
  log(
    'pre-auth hit succeeds (no session needed)',
    ok,
    `HTTP ${r.status}, hits=${JSON.stringify(r.body.hits)}`,
  );
  if (ok) passed++;
}

await sb
  .from('sessions')
  .delete()
  .in('player_key', [identityA.publicKeyHex, identityB.publicKeyHex]);
await sb.from('machine_filesystems').delete().eq('machine_id', machineIdA);
await sb.from('patches').delete().eq('machine_id', machineIdA);
await sb.from('workstations').delete().eq('player_key', identityA.publicKeyHex);

console.log(`${passed}/${total} scenarios pass.`);
process.exit(passed === total ? 0 : 1);
