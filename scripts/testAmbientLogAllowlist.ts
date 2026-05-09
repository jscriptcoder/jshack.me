// Wire smoke for the L1 ambient-log-path allowlist (handler.ts:
// AMBIENT_LOG_FILES). Forges signed envelopes against a real
// /api/patches via vercel:dev — no session, no DB setup required,
// because the bypass predicate runs BEFORE L1.
//
//   Allowlisted paths     => 200 (bypass fires, write succeeds)
//   Non-allowlisted paths => 403 no_session (bypass skipped, L1 fires)
//
// Self-cleaning: forged identities are tracked, and after the run the
// patches they authored are deleted via service_role. The shared
// machine_filesystems rows on playground (203.0.113.42) for the 8
// canonical log files are gameplay state that any nmap/curl/etc.
// would also write — left in place.
//
// Prerequisites:
//   1. Local Supabase up (npm run supabase:start; npm run db:reset)
//   2. Vercel dev server running:
//        npm run vercel:dev
//
// Usage:
//   npx dotenv -e .env.development.local -- npx tsx scripts/testAmbientLogAllowlist.ts
//
// Optional env vars:
//   VERCEL_DEV_URL                — default http://localhost:3000
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import './lib/loadEnv';
import { createClient } from '@supabase/supabase-js';
import { generateIdentity } from '../src/identity/identity';
import { signRequest } from '../src/signedRequest/sign';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const vercelDevUrl = process.env.VERCEL_DEV_URL ?? 'http://localhost:3000';

if (!url || !serviceKey) {
  console.error(
    'Missing required env vars. Run with:\n  npx dotenv -e .env.development.local -- npx tsx scripts/testAmbientLogAllowlist.ts',
  );
  process.exit(2);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

// Verify vercel dev is reachable.
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

const TARGET_MACHINE_ID = '203.0.113.42'; // playground

type Case = { readonly path: string; readonly expect: 'bypass' | 'gate' };

const cases: ReadonlyArray<Case> = [
  // Allowlisted — every entry is also enumerated in handler.ts AMBIENT_LOG_FILES.
  { path: '/var/log/auth.log', expect: 'bypass' },
  { path: '/var/log/access.log', expect: 'bypass' },
  { path: '/var/log/kern.log', expect: 'bypass' },
  { path: '/var/log/vsftpd.log', expect: 'bypass' },
  { path: '/var/log/mysql.log', expect: 'bypass' },
  { path: '/var/log/redis.log', expect: 'bypass' },
  { path: '/var/log/mail.log', expect: 'bypass' },
  { path: '/var/log/syslog', expect: 'bypass' },
  // Formerly bypassed by the loose /var/log/ prefix — now gated.
  { path: '/var/log/payload.sh', expect: 'gate' },
  { path: '/var/log/messages', expect: 'gate' },
  { path: '/var/log/nginx/access.log', expect: 'gate' },
  { path: '/var/log/auth.log.1', expect: 'gate' },
  { path: '/var/log/.ssh/config', expect: 'gate' },
  { path: '/var/log/subdir/deeper/file.log', expect: 'gate' },
];

let passed = 0;
const playerKeys: string[] = [];

for (const c of cases) {
  const id = generateIdentity();
  playerKeys.push(id.publicKeyHex);
  const envelope = signRequest(id, 'upsertPatch', {
    machine_id: TARGET_MACHINE_ID,
    path: c.path,
    content: '#!/bin/sh\necho pwn\n',
    owner: 'root',
  });
  const res = await fetch(`${vercelDevUrl}/api/patches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };

  const ok =
    c.expect === 'bypass' ? res.status === 200 : res.status === 403 && body.error === 'no_session';

  if (ok) passed++;
  const verdict = ok ? 'PASS' : 'FAIL';
  const expectStr = c.expect === 'bypass' ? '200' : '403 { error: "no_session" }';
  console.log(
    `${verdict}  ${c.expect.padEnd(6)} ${c.path.padEnd(38)}  →  HTTP ${res.status} ${JSON.stringify(body)}  (expected ${expectStr})`,
  );
}

// Cleanup: drop every patch authored by a forged identity. Each run uses
// fresh keypairs so we can DELETE by player_key without risking real data.
await sb.from('patches').delete().in('player_key', playerKeys);

console.log(`\n${passed}/${cases.length} cases passed`);
process.exit(passed === cases.length ? 0 : 1);
