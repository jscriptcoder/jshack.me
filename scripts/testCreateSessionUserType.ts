// Smoke test for server-side userType validation in /api/sessions
// (createSession). Forges signed envelopes and verifies the handler
// rejects mismatched userType claims and accepts legitimate ones.
//
// 4 scenarios:
//   A) Mismatch — forge a 'root' claim for a non-root user → 400
//      usertype_mismatch.
//   B) Underivable — forge a claim for a username NOT in /etc/passwd →
//      400 usertype_underivable.
//   C) Match — forge a legitimate claim → 200 + session_id.
//   D) No-op — target a machine with no /etc/passwd projection (mission
//      stand-in via a fabricated machine_id) → 200 + session_id (validation
//      no-ops). This will go away once mission_instances ship.
//
// Self-cleaning: every successful insert is followed by an endSession
// so the test can be re-run idempotently.
//
// Pre-requisites:
//   - vercel:dev running (npm run vercel:dev)
//   - .env.development.local pointing at the dev Supabase project
//   - At least one machine_filesystems row with path='/etc/passwd' AND
//     non-null content (re-run scripts/backfillHomeNetworkBaseFs.ts after
//     20260507100000_machine_fs_selective_content.sql applies)
//
// Env vars used:
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
    'Missing required env vars. Run with:\n  npx dotenv -e .env.development.local -- npx tsx scripts/testCreateSessionUserType.ts',
  );
  process.exit(2);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

// Verify vercel dev is reachable.
try {
  const probe = await fetch(`${vercelDevUrl}/api/sessions`, { method: 'GET' });
  if (probe.status !== 405) {
    console.warn(
      `[warn] /api/sessions probe returned ${probe.status} (expected 405). Endpoint may not be wired.`,
    );
  }
} catch {
  console.error(
    `\nCannot reach Vercel dev server at ${vercelDevUrl}.\nStart it with: npm run vercel:dev\n`,
  );
  process.exit(1);
}

// Find a machine with a non-null /etc/passwd projection. Read its
// content so we can pick a real (username, derived userType) pair to
// build matching/mismatching claims.
const { data: passwdRows } = await sb
  .from('machine_filesystems')
  .select('machine_id, content')
  .eq('path', '/etc/passwd')
  .not('content', 'is', null)
  .limit(20);

if (!passwdRows || passwdRows.length === 0) {
  console.error(
    `\nNo /etc/passwd rows with content found in machine_filesystems.\nRun the backfill scripts after the migration:\n  npx dotenv -e .env.development.local -- npx tsx scripts/backfillHomeNetworkBaseFs.ts\n`,
  );
  process.exit(1);
}

// Pick a row whose /etc/passwd has a parseable non-root user line —
// gives us material for both the mismatch and match scenarios.
type EtcLine = { username: string; uid: number };
const parseEtcPasswd = (content: string): EtcLine[] =>
  content
    .split('\n')
    .map((line) => {
      const parts = line.split(':');
      const username = parts[0];
      const uidField = parts[2];
      const uid = uidField ? Number.parseInt(uidField, 10) : NaN;
      return { username: username ?? '', uid };
    })
    .filter((e) => e.username.length > 0 && Number.isFinite(e.uid));

const target = passwdRows
  .map((row) => ({
    machineId: row.machine_id,
    content: row.content as string,
    entries: parseEtcPasswd(row.content as string),
  }))
  .find((t) => t.entries.some((e) => e.uid !== 0 && e.username !== 'guest'));

if (!target) {
  console.error('\nNo machine has a parseable non-root, non-guest user in /etc/passwd. Aborting.');
  process.exit(1);
}

const nonRootUser = target.entries.find((e) => e.uid !== 0 && e.username !== 'guest')!;
const rootUser = target.entries.find((e) => e.uid === 0);

console.log(`Target machine: ${target.machineId}`);
console.log(`  Non-root user: ${nonRootUser.username} (uid ${nonRootUser.uid})`);
if (rootUser) {
  console.log(`  Root user:     ${rootUser.username} (uid ${rootUser.uid})`);
}
console.log('');

const FIXED_NOW = Date.now();

const post = async (envelope: unknown): Promise<{ status: number; body: unknown }> => {
  const res = await fetch(`${vercelDevUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await res.json();
  return { status: res.status, body };
};

const sign = (identity: Identity, fields: Record<string, unknown>): unknown => {
  const realNow = Date.now;
  Date.now = () => FIXED_NOW;
  try {
    return signRequest(identity, 'createSession', fields);
  } finally {
    Date.now = realNow;
  }
};

let passed = 0;
let total = 0;

// Scenario A: Mismatch
total++;
{
  console.log(
    '=== Scenario A: forge userType=root for a non-root user → expect 400 usertype_mismatch ===',
  );
  const identity = generateIdentity();
  const envelope = sign(identity, {
    machine_id: target.machineId,
    credentials: { username: nonRootUser.username, userType: 'root' },
  });
  const { status, body } = await post(envelope);
  const ok = status === 400 && (body as { error?: string }).error === 'usertype_mismatch';
  console.log(`  status: ${status}, body: ${JSON.stringify(body)}`);
  console.log(ok ? '  ✓ PASS' : '  ✗ FAIL');
  if (ok) passed++;
  console.log('');
}

// Scenario B: Underivable
total++;
{
  console.log(
    '=== Scenario B: forge claim for username not in /etc/passwd → expect 400 usertype_underivable ===',
  );
  const identity = generateIdentity();
  const envelope = sign(identity, {
    machine_id: target.machineId,
    credentials: { username: 'nobody-not-in-passwd', userType: 'user' },
  });
  const { status, body } = await post(envelope);
  const ok = status === 400 && (body as { error?: string }).error === 'usertype_underivable';
  console.log(`  status: ${status}, body: ${JSON.stringify(body)}`);
  console.log(ok ? '  ✓ PASS' : '  ✗ FAIL');
  if (ok) passed++;
  console.log('');
}

// Scenario C: Match
total++;
{
  console.log('=== Scenario C: legitimate userType claim for non-root user → expect 200 ===');
  const identity = generateIdentity();
  const envelope = sign(identity, {
    machine_id: target.machineId,
    credentials: { username: nonRootUser.username, userType: 'user' },
  });
  const { status, body } = await post(envelope);
  const ok = status === 200 && typeof (body as { session_id?: string }).session_id === 'string';
  console.log(`  status: ${status}, body: ${JSON.stringify(body)}`);
  console.log(ok ? '  ✓ PASS' : '  ✗ FAIL');
  if (ok) passed++;
  // Self-clean: end the session
  const sessionId = (body as { session_id?: string }).session_id;
  if (sessionId) {
    const endEnvelope = (() => {
      const realNow = Date.now;
      Date.now = () => FIXED_NOW;
      try {
        return signRequest(identity, 'endSession', { session_id: sessionId, reason: 'logout' });
      } finally {
        Date.now = realNow;
      }
    })();
    await post(endEnvelope);
  }
  console.log('');
}

// Scenario D: No-op (mission machine stand-in — fabricated machine_id
// with no /etc/passwd projection)
total++;
{
  console.log(
    '=== Scenario D: machine with no /etc/passwd projection → expect 200 (validation no-ops) ===',
  );
  const identity = generateIdentity();
  const envelope = sign(identity, {
    machine_id: 'mission-stand-in-no-projection-' + Math.random().toString(36).slice(2, 10),
    credentials: { username: 'alice', userType: 'root' },
  });
  const { status, body } = await post(envelope);
  const ok = status === 200 && typeof (body as { session_id?: string }).session_id === 'string';
  console.log(`  status: ${status}, body: ${JSON.stringify(body)}`);
  console.log(ok ? '  ✓ PASS' : '  ✗ FAIL');
  if (ok) passed++;
  // Self-clean
  const sessionId = (body as { session_id?: string }).session_id;
  if (sessionId) {
    const endEnvelope = (() => {
      const realNow = Date.now;
      Date.now = () => FIXED_NOW;
      try {
        return signRequest(identity, 'endSession', { session_id: sessionId, reason: 'logout' });
      } finally {
        Date.now = realNow;
      }
    })();
    await post(endEnvelope);
  }
  console.log('');
}

console.log(`=== ${passed} / ${total} passed ===`);
process.exit(passed === total ? 0 : 1);
