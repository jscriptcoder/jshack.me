// L2 bypass-attempt verifier — proves the server-side gate fires under
// the actual threat model (Burp / curl / hex-edited client).
//
// The in-game flow validates client-side, so legitimate UIs never send
// a malicious request. To verify L2, we need to forge a signed envelope
// directly — exactly what an attacker would do. This script generates
// fresh Ed25519 identities, fabricates session rows for them via
// service_role (so the L1 gate has something to find), then signs +
// POSTs an upsertPatch attempting to overwrite a root-only file on a
// real home-network machine. The response code tells you what happened:
//
//   Scenario A: forged write with NO session
//     → expect 403 no_session              (L1 fires)
//
//   Scenario B: forged write WITH guest session
//     → expect 403 permission_denied       (L2 fires — THE TEST)
//
//   Scenario C: forged write WITH root session
//     → expect 200                         (sanity: walker doesn't false-positive)
//
// Prerequisites:
//   1. Local Supabase up (npm run supabase:start; npm run db:reset)
//   2. At least one home_networks row + base-FS backfill done:
//        npx dotenv -e .env.development.local -- npx tsx scripts/backfillHomeNetworkBaseFs.ts
//   3. Vercel dev server running (the /api/patches endpoint is a Vercel
//      function; npm run dev alone won't expose it):
//        npm run vercel:dev
//
// Usage:
//   npx dotenv -e .env.development.local -- npx tsx scripts/testL2Bypass.ts
//
// Optional env vars:
//   VERCEL_DEV_URL   — default http://localhost:3000
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';
import { generateIdentity, type Identity } from '../src/identity/identity';
import { signRequest } from '../src/signedRequest/sign';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const vercelDevUrl = process.env.VERCEL_DEV_URL ?? 'http://localhost:3000';

if (!url || !serviceKey) {
  console.error(
    'Missing required env vars. Run with:\n  npx dotenv -e .env.development.local -- npx tsx scripts/testL2Bypass.ts',
  );
  process.exit(2);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

// 1. Verify vercel dev is reachable.
try {
  const probe = await fetch(`${vercelDevUrl}/api/patches`, { method: 'GET' });
  if (probe.status !== 405) {
    console.warn(
      `[warn] /api/patches probe returned ${probe.status} (expected 405 method_not_allowed). Endpoint may not be wired.`,
    );
  }
} catch {
  console.error(
    `\nCannot reach Vercel dev server at ${vercelDevUrl}.\nStart it with: npm run vercel:dev\n`,
  );
  process.exit(1);
}

// 2. Find a root-only target file from a real home-network machine.
// node_type and content were dropped from machine_filesystems
// (20260503210309) — L2 only enforces on permissions, so any restrictive
// path works as a target. We still bias toward file-shaped paths by
// excluding the bare '/' node, which would force the forged write to
// rewrite the root directory and produce a less interesting test.
const { data: candidates } = await sb
  .from('machine_filesystems')
  .select('machine_id, path, owner, permissions')
  .neq('path', '/')
  .limit(200);

type Row = NonNullable<typeof candidates>[number];
const isRootOnlyWrite = (r: Row): boolean => {
  const perms = r.permissions as { write?: readonly string[] } | null;
  return perms?.write?.length === 1 && perms.write[0] === 'root';
};

const target = (candidates ?? []).find(isRootOnlyWrite);
if (!target) {
  console.error(
    '\nNo root-only file found in machine_filesystems. Have you run the backfill?\n  npx dotenv -e .env.development.local -- npx tsx scripts/backfillHomeNetworkBaseFs.ts\n',
  );
  process.exit(1);
}

console.log('Target found:');
console.log(`  machine_id:  ${target.machine_id}`);
console.log(`  path:        ${target.path}`);
console.log(`  owner:       ${target.owner}`);
console.log(`  permissions: ${JSON.stringify(target.permissions)}`);
console.log();

// 3. Helper: sign + POST a forged upsertPatch.
const attemptForgedPatch = async (
  identity: Identity,
  machineId: string,
  path: string,
): Promise<{ readonly status: number; readonly body: unknown }> => {
  const envelope = signRequest(identity, 'upsertPatch', {
    machine_id: machineId,
    path,
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

const insertFakeSession = async (
  identity: Identity,
  machineId: string,
  userType: 'root' | 'user' | 'guest',
): Promise<string> => {
  const username = userType === 'root' ? 'root' : userType === 'guest' ? 'guest' : 'alice';
  const { data, error } = await sb
    .from('sessions')
    .insert({
      player_key: identity.publicKeyHex,
      machine_id: machineId,
      credentials: { username, userType },
      kind: 'ssh',
    })
    .select('session_id')
    .single();
  if (error || !data) {
    throw new Error(`fake session insert failed: ${error?.message}`);
  }
  return data.session_id as string;
};

const log = (label: string, status: number, body: unknown, expected: string, pass: boolean) => {
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${label}\n      HTTP ${status}: ${JSON.stringify(body)}\n      expected: ${expected}\n`,
  );
};

let passed = 0;
let total = 0;
const playerKeys: string[] = [];

// --- Scenario A: NO session ---
console.log('=== Scenario A: forged write with NO session — L1 should fire ===');
total++;
{
  const id = generateIdentity();
  playerKeys.push(id.publicKeyHex);
  const r = await attemptForgedPatch(id, target.machine_id, target.path);
  const ok =
    r.status === 403 &&
    typeof r.body === 'object' &&
    r.body !== null &&
    (r.body as { error?: string }).error === 'no_session';
  log('A — L1 (no_session)', r.status, r.body, '403 { error: "no_session" }', ok);
  if (ok) passed++;
}

// --- Scenario B: GUEST session ---
console.log('=== Scenario B: forged write WITH guest session — L2 should fire ===');
total++;
{
  const id = generateIdentity();
  playerKeys.push(id.publicKeyHex);
  await insertFakeSession(id, target.machine_id, 'guest');
  const r = await attemptForgedPatch(id, target.machine_id, target.path);
  const ok =
    r.status === 403 &&
    typeof r.body === 'object' &&
    r.body !== null &&
    (r.body as { error?: string }).error === 'permission_denied';
  log('B — L2 (permission_denied)', r.status, r.body, '403 { error: "permission_denied" }', ok);
  if (ok) passed++;
}

// --- Scenario C: ROOT session (sanity) ---
console.log('=== Scenario C: forged write WITH root session — should succeed ===');
total++;
{
  const id = generateIdentity();
  playerKeys.push(id.publicKeyHex);
  await insertFakeSession(id, target.machine_id, 'root');
  const r = await attemptForgedPatch(id, target.machine_id, target.path);
  const ok = r.status === 200;
  log('C — root write succeeds', r.status, r.body, '200', ok);
  if (ok) passed++;
}

// Cleanup: drop the fake sessions, drop any rows the tests created, restore
// the target's machine_filesystems row to its pre-test base-FS shape.
await sb.from('sessions').delete().in('player_key', playerKeys);
await sb.from('patches').delete().in('player_key', playerKeys);
await sb
  .from('machine_filesystems')
  .update({
    owner: target.owner,
    permissions: target.permissions,
  })
  .eq('machine_id', target.machine_id)
  .eq('path', target.path);

console.log(`${passed}/${total} scenarios pass.`);
process.exit(passed === total ? 0 : 1);
