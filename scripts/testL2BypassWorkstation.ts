// L2 bypass verifier scoped to the player's own workstation. Closes the
// loop on chunk #1b: prove that an intruder with a cracked guest session
// on Player A's workstation cannot overwrite root-owned files via forged
// envelope. Mirrors scripts/testL2Bypass.ts for the 3-scenario shape but
// (a) registers a workstation up-front (so machine_filesystems has rows
// for its workstation_id) and (b) targets that workstation specifically.
//
// Without this, testL2Bypass.ts's leaf-pick logic only finds rows on
// home/world networks; workstation rows show up only AFTER a
// registration. This script ensures the full flow runs end-to-end.
//
// Prerequisites:
//   1. Local Supabase up
//   2. machine_filesystems backfilled for at least one network (sanity)
//   3. vercel:dev running on http://localhost:3000
//
// Usage:
//   npx dotenv -e .env.development.local -- npx tsx scripts/testL2BypassWorkstation.ts
//
// Optional env vars:
//   VERCEL_DEV_URL (default http://localhost:3000)

import { createClient } from '@supabase/supabase-js';
import { generateIdentity, type Identity } from '../src/identity/identity';
import { signRequest } from '../src/signedRequest/sign';
import { computeWorkstationId } from '../src/homeNetworks/homeNetworkHelpers';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const vercelDevUrl = process.env.VERCEL_DEV_URL ?? 'http://localhost:3000';

if (!url || !serviceKey) {
  console.error(
    'Missing required env vars. Run with:\n  npx dotenv -e .env.development.local -- npx tsx scripts/testL2BypassWorkstation.ts',
  );
  process.exit(2);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

// 1. Probe vercel:dev.
try {
  const probe = await fetch(`${vercelDevUrl}/api/patches`, { method: 'GET' });
  if (probe.status !== 405) {
    console.warn(`[warn] /api/patches probe returned ${probe.status} (expected 405).`);
  }
} catch {
  console.error(`Cannot reach Vercel dev at ${vercelDevUrl}. Start it with: npm run vercel:dev`);
  process.exit(1);
}

// 2. Register Player A's workstation through the real endpoint.
const owner = generateIdentity();
const workstationName = 'l2-probe-box';
const username = 'probealice';
const workstationId = computeWorkstationId(workstationName, owner.publicKeyHex);

// Cleanup any leftover state from a prior aborted run.
await sb.from('sessions').delete().eq('machine_id', workstationId);
await sb.from('patches').delete().eq('machine_id', workstationId);
await sb.from('machine_filesystems').delete().eq('machine_id', workstationId);
await sb.from('workstations').delete().eq('player_key', owner.publicKeyHex);

const regEnv = signRequest(owner, 'registerWorkstation', {
  workstation_name: workstationName,
  username,
});
const regRes = await fetch(`${vercelDevUrl}/api/register-workstation`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(regEnv),
});
if (regRes.status !== 201) {
  console.error(`Registration failed: ${regRes.status} ${await regRes.text()}`);
  process.exit(1);
}
console.log(`Registered ${workstationId}`);

// 3. Pick a target file: /etc/passwd is a stable, restrictive choice
// for the localhost FS (write: ['root']).
const targetPath = '/etc/passwd';
const { data: fsRow } = await sb
  .from('machine_filesystems')
  .select('owner, permissions')
  .eq('machine_id', workstationId)
  .eq('path', targetPath)
  .maybeSingle();
if (!fsRow) {
  console.error(`No ${targetPath} row found on ${workstationId}. Populate may have failed.`);
  process.exit(1);
}
console.log(`Target ${targetPath}: ${JSON.stringify(fsRow)}\n`);

// 4. Run the 3 bypass scenarios against the workstation.
const attemptForgedPatch = async (
  identity: Identity,
): Promise<{ status: number; body: unknown }> => {
  const envelope = signRequest(identity, 'upsertPatch', {
    machine_id: workstationId,
    path: targetPath,
    content: 'pwn',
    owner: 'root',
    permissions: {
      read: ['root', 'user', 'guest'],
      write: ['root', 'user', 'guest'],
      execute: ['root', 'user', 'guest'],
    },
  });
  const res = await fetch(`${vercelDevUrl}/api/patches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
};

const insertFakeSession = async (identity: Identity, userType: 'root' | 'guest'): Promise<void> => {
  const u = userType === 'root' ? 'root' : 'guest';
  const { error } = await sb.from('sessions').insert({
    player_key: identity.publicKeyHex,
    machine_id: workstationId,
    credentials: { username: u, userType },
    kind: 'ssh',
  });
  if (error) throw new Error(`fake session insert failed: ${error.message}`);
};

const log = (label: string, status: number, body: unknown, expected: string, pass: boolean) => {
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${label}\n      HTTP ${status}: ${JSON.stringify(body)}\n      expected: ${expected}\n`,
  );
};

let passed = 0;
let total = 0;
const intruderKeys: string[] = [];

// --- A: no session ---
console.log('=== Scenario A: forged write with NO session — L1 should fire ===');
total++;
{
  const intruder = generateIdentity();
  intruderKeys.push(intruder.publicKeyHex);
  const r = await attemptForgedPatch(intruder);
  const ok = r.status === 403 && (r.body as { error?: string })?.error === 'no_session';
  log('A — L1 (no_session)', r.status, r.body, '403 { error: "no_session" }', ok);
  if (ok) passed++;
}

// --- B: guest session ---
console.log('=== Scenario B: forged write WITH guest session — L2 should fire ===');
total++;
{
  const intruder = generateIdentity();
  intruderKeys.push(intruder.publicKeyHex);
  await insertFakeSession(intruder, 'guest');
  const r = await attemptForgedPatch(intruder);
  const ok = r.status === 403 && (r.body as { error?: string })?.error === 'permission_denied';
  log('B — L2 (permission_denied)', r.status, r.body, '403 { error: "permission_denied" }', ok);
  if (ok) passed++;
}

// --- C: root session (sanity) ---
console.log('=== Scenario C: forged write WITH root session — should succeed ===');
total++;
{
  const intruder = generateIdentity();
  intruderKeys.push(intruder.publicKeyHex);
  await insertFakeSession(intruder, 'root');
  const r = await attemptForgedPatch(intruder);
  const ok = r.status === 200;
  log('C — root write succeeds', r.status, r.body, '200', ok);
  if (ok) passed++;
}

// 5. Cleanup.
await sb.from('sessions').delete().in('player_key', intruderKeys);
await sb.from('patches').delete().eq('machine_id', workstationId);
await sb.from('machine_filesystems').delete().eq('machine_id', workstationId);
await sb.from('workstations').delete().eq('player_key', owner.publicKeyHex);

console.log(`${passed}/${total} scenarios pass.`);
process.exit(passed === total ? 0 : 1);
