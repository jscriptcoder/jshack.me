// Read-path privacy filter — wire-payload smoke for listPatchesForMachines.
//
// Forges signed envelopes against the live /api/patches endpoint and
// verifies the HTTP response body actually drops sensitive content. Unit
// tests cover the layers in isolation; this script proves the integration
// (signed envelope → handler → SQL → filter → wire response) does what
// it says under three forged-attacker scenarios:
//
//   Scenario A: no session on A's box — only allowlist paths come back.
//   Scenario B: guest session on A's box — walker drops root-only paths.
//   Scenario C: A forges the request to themselves — owner bypass returns all.
//
// Prerequisites:
//   1. Local Supabase up (npm run supabase:start; npm run db:reset)
//   2. Vercel dev server running:
//        npm run vercel:dev
//
// Usage:
//   npx dotenv -e .env.development.local -- npx tsx scripts/testReadPathPrivacy.ts
//
// Optional env vars:
//   VERCEL_DEV_URL   — default http://localhost:3000
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';
import { generateIdentity, type Identity } from '../src/identity/identity';
import { signRequest } from '../src/signedRequest/sign';
import { computeWorkstationId } from '../src/homeNetworks/homeNetworkHelpers';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const vercelDevUrl = process.env.VERCEL_DEV_URL ?? 'http://localhost:3000';

if (!url || !serviceKey) {
  console.error(
    'Missing required env vars. Run with:\n  npx dotenv -e .env.development.local -- npx tsx scripts/testReadPathPrivacy.ts',
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

// 2. Build A and B identities + A's workstation_id (suffix-derived).
const identityA = generateIdentity();
const identityB = generateIdentity();
const workstationName = 'smoketest';
const machineId = computeWorkstationId(workstationName, identityA.publicKeyHex);

const SECRET_PATH = '/root/.notes';
const ALLOWLIST_PATH = '/var/run/sshd.pid';
const SECRET_CONTENT = 'WALLET_SEED_DO_NOT_LEAK';
const ALLOWLIST_CONTENT = 'sshd-pid-1234';

console.log(`A.player_key = ${identityA.publicKeyHex.slice(0, 16)}...`);
console.log(`B.player_key = ${identityB.publicKeyHex.slice(0, 16)}...`);
console.log(`A's machine_id = ${machineId}`);
console.log();

// 3. Pre-clean any leftovers from prior runs (idempotent).
await sb.from('patches').delete().eq('machine_id', machineId);
await sb.from('machine_filesystems').delete().eq('machine_id', machineId);
await sb
  .from('sessions')
  .delete()
  .in('player_key', [identityA.publicKeyHex, identityB.publicKeyHex]);

// 4. Seed the test fixtures via service_role.
//
// machine_filesystems carries the perms the walker consults for tier 2.
// We pin /root with root-only execute (so guest can't even traverse to
// /root/.notes) and the leaf with root-only read (so root-userType
// walker still permits via the root bypass).
const restrictivePerms = {
  read: ['root'],
  write: ['root'],
  execute: ['root'],
};
const allowlistPerms = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root', 'user', 'guest'],
};

const fsRows = [
  { machine_id: machineId, path: '/root', owner: 'root', permissions: restrictivePerms },
  { machine_id: machineId, path: SECRET_PATH, owner: 'root', permissions: restrictivePerms },
  {
    machine_id: machineId,
    path: ALLOWLIST_PATH,
    owner: 'root',
    permissions: allowlistPerms,
  },
];
const { error: fsError } = await sb.from('machine_filesystems').insert(fsRows);
if (fsError) {
  console.error('Failed to seed machine_filesystems:', fsError);
  process.exit(1);
}

// patches table — what listPatchesForMachines actually returns. Two
// rows: one secret (filtered out under tiers 2/3, returned under tier
// 1) and one allowlist (returned under all three tiers).
const patchRows = [
  {
    player_key: identityA.publicKeyHex,
    machine_id: machineId,
    path: SECRET_PATH,
    content: SECRET_CONTENT,
    owner: 'root',
    permissions: restrictivePerms,
    is_new: true,
    node_type: 'file',
  },
  {
    player_key: identityA.publicKeyHex,
    machine_id: machineId,
    path: ALLOWLIST_PATH,
    content: ALLOWLIST_CONTENT,
    owner: 'root',
    permissions: allowlistPerms,
    is_new: true,
    node_type: 'file',
  },
];
const { error: pError } = await sb.from('patches').insert(patchRows);
if (pError) {
  console.error('Failed to seed patches:', pError);
  process.exit(1);
}

// 5. Helper: sign + POST a forged listPatchesForMachines.
type Patch = {
  readonly machine_id: string;
  readonly path: string;
  readonly content: string | null;
};

const attemptForgedList = async (
  identity: Identity,
): Promise<{ readonly status: number; readonly patches: ReadonlyArray<Patch> }> => {
  const envelope = signRequest(identity, 'listPatchesForMachines', {
    machine_ids: [machineId],
  });
  const res = await fetch(`${vercelDevUrl}/api/patches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = (await res.json().catch(() => ({}))) as { patches?: ReadonlyArray<Patch> };
  return { status: res.status, patches: body.patches ?? [] };
};

const insertGuestSession = async (identity: Identity): Promise<void> => {
  const { error } = await sb.from('sessions').insert({
    player_key: identity.publicKeyHex,
    machine_id: machineId,
    credentials: { username: 'guest', userType: 'guest' },
    kind: 'ssh',
  });
  if (error) {
    throw new Error(`fake session insert failed: ${error.message}`);
  }
};

const log = (label: string, pass: boolean, detail: string) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}\n      ${detail}\n`);
};

const containsPath = (patches: ReadonlyArray<Patch>, path: string): boolean =>
  patches.some((p) => p.path === path);

const containsContent = (patches: ReadonlyArray<Patch>, content: string): boolean =>
  patches.some((p) => p.content === content);

let passed = 0;
let total = 0;

// --- Scenario A: B forges with NO session on A's box ---
console.log('=== Scenario A: B forges with NO session — tier 3 default-deny ===');
total++;
{
  const r = await attemptForgedList(identityB);
  const ok =
    r.status === 200 &&
    !containsPath(r.patches, SECRET_PATH) &&
    !containsContent(r.patches, SECRET_CONTENT) &&
    containsPath(r.patches, ALLOWLIST_PATH);
  log(
    'A — no-session: secret dropped, allowlist kept',
    ok,
    `HTTP ${r.status}, paths: ${JSON.stringify(r.patches.map((p) => p.path))}`,
  );
  if (ok) passed++;
}

// --- Scenario B: B forges WITH guest session on A's box ---
console.log('=== Scenario B: B forges with guest session — tier 2 walker drops root-only ===');
total++;
{
  await insertGuestSession(identityB);
  const r = await attemptForgedList(identityB);
  const ok =
    r.status === 200 &&
    !containsPath(r.patches, SECRET_PATH) &&
    !containsContent(r.patches, SECRET_CONTENT) &&
    containsPath(r.patches, ALLOWLIST_PATH);
  log(
    'B — guest-session: walker denies root-only, allowlist kept',
    ok,
    `HTTP ${r.status}, paths: ${JSON.stringify(r.patches.map((p) => p.path))}`,
  );
  if (ok) passed++;
}

// --- Scenario C: A forges to their own box (owner bypass) ---
console.log('=== Scenario C: A forges to own workstation — tier 1 owner bypass ===');
total++;
{
  const r = await attemptForgedList(identityA);
  const ok =
    r.status === 200 &&
    containsPath(r.patches, SECRET_PATH) &&
    containsContent(r.patches, SECRET_CONTENT) &&
    containsPath(r.patches, ALLOWLIST_PATH);
  log(
    'C — owner: all rows returned',
    ok,
    `HTTP ${r.status}, paths: ${JSON.stringify(r.patches.map((p) => p.path))}`,
  );
  if (ok) passed++;
}

// 6. Cleanup.
await sb.from('patches').delete().eq('machine_id', machineId);
await sb.from('machine_filesystems').delete().eq('machine_id', machineId);
await sb
  .from('sessions')
  .delete()
  .in('player_key', [identityA.publicKeyHex, identityB.publicKeyHex]);

console.log(`${passed}/${total} scenarios pass.`);
process.exit(passed === total ? 0 : 1);
