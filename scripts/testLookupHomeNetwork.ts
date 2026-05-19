// Smoke test for /api/lookup-home-network. Forges signed envelopes against
// vercel:dev and verifies the four end-to-end behaviors:
//
//   A) Existing row → 200 + projected row matches the DB.
//   B) Non-existent public IP → 404 + 'not_found'.
//   C) Tampered signature → 401 + 'signature_invalid'.
//   D) Replay (same nonce twice) → 200 then 401 + 'replay' (only when
//      Upstash is configured; with noopNonceStore both succeed and we
//      log a warning instead of failing).
//
// Read-only endpoint, so no cleanup needed.
//
// Pre-requisites:
//   - vercel:dev running (npm run vercel:dev)
//   - .env.development.local pointing at the dev Supabase project
//   - At least one home_networks row exists (any row will do — most dev
//     environments have one after the join-home-network smoke or normal
//     gameplay)
//
// Env vars used:
//   VERCEL_DEV_URL   — default http://localhost:3000
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
    '\nMissing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\nRun: npx tsx scripts/testLookupHomeNetwork.ts\n(env auto-loaded from .env.development.local via scripts/lib/loadEnv)\n',
  );
  process.exit(2);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

// Verify vercel dev is reachable.
try {
  const probe = await fetch(`${vercelDevUrl}/api/lookup-home-network`, { method: 'GET' });
  if (probe.status !== 405) {
    console.warn(
      `[warn] /api/lookup-home-network probe returned ${probe.status} (expected 405). Endpoint may not be wired.`,
    );
  }
} catch {
  console.error(
    `\nCannot reach Vercel dev server at ${vercelDevUrl}.\nStart it with: npm run vercel:dev\n`,
  );
  process.exit(1);
}

// Pick any existing row — the smoke is "endpoint returns this same row".
const { data: networks, error } = await sb
  .from('home_networks')
  .select('public_ip, essid_template, density_tier, max_slots, seed')
  .limit(1);

if (error || !networks || networks.length === 0) {
  console.error(
    '\nNo home_networks rows found. Run the join-home-network smoke first or play through a WiFi crack to create one.\n',
  );
  process.exit(1);
}
const existingRow = networks[0]!;
console.log(`[info] Using existing row: public_ip=${existingRow.public_ip as string}`);

const postEnvelope = async (envelope: object) => {
  const response = await fetch(`${vercelDevUrl}/api/lookup-home-network`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
};

let failures = 0;
const expect = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    failures++;
  } else {
    console.log(`  ✓ ${msg}`);
  }
};

const identity = generateIdentity();

// ----- A) Found row -----
console.log('\n[A] Existing row → 200 + projection');
{
  const envelope = signRequest(identity, 'lookupHomeNetwork', {
    public_ip: existingRow.public_ip as string,
  });
  const { status, body } = await postEnvelope(envelope);
  const b = body as Record<string, unknown> | null;
  expect(status === 200, `status === 200 (got ${status})`);
  expect(
    b?.public_ip === existingRow.public_ip,
    `body.public_ip === ${existingRow.public_ip as string}`,
  );
  expect(
    b?.essid_template === existingRow.essid_template,
    `body.essid_template === ${existingRow.essid_template as string}`,
  );
  expect(
    b?.density_tier === existingRow.density_tier,
    `body.density_tier === ${existingRow.density_tier as string}`,
  );
  expect(
    b?.max_slots === existingRow.max_slots,
    `body.max_slots === ${existingRow.max_slots as number}`,
  );
  expect(b?.seed === existingRow.seed, `body.seed === ${existingRow.seed as string}`);
}

// ----- B) Not found -----
console.log('\n[B] Non-existent public IP → 404 + not_found');
{
  // 192.0.2.0/24 is RFC 5737 documentation space — guaranteed not to be
  // in any normal allocator's output.
  const envelope = signRequest(identity, 'lookupHomeNetwork', {
    public_ip: '192.0.2.111',
  });
  const { status, body } = await postEnvelope(envelope);
  const b = body as Record<string, unknown> | null;
  expect(status === 404, `status === 404 (got ${status})`);
  expect(b?.error === 'not_found', `body.error === 'not_found' (got ${String(b?.error)})`);
}

// ----- C) Tampered signature -----
console.log('\n[C] Tampered publicKey → 401 + signature_invalid');
{
  const stranger = generateIdentity();
  const envelope = signRequest(identity, 'lookupHomeNetwork', {
    public_ip: existingRow.public_ip as string,
  });
  const tampered = { ...envelope, publicKey: stranger.publicKeyHex };
  const { status, body } = await postEnvelope(tampered);
  const b = body as Record<string, unknown> | null;
  expect(status === 401, `status === 401 (got ${status})`);
  expect(
    b?.error === 'signature_invalid',
    `body.error === 'signature_invalid' (got ${String(b?.error)})`,
  );
}

// ----- D) Replay -----
console.log('\n[D] Replay (same nonce twice)');
{
  const envelope = signRequest(identity, 'lookupHomeNetwork', {
    public_ip: existingRow.public_ip as string,
  });
  const first = await postEnvelope(envelope);
  const second = await postEnvelope(envelope);
  expect(first.status === 200, `first status === 200 (got ${first.status})`);
  const firstSecondOk = first.status === 200 && second.status === 200;
  const replayDetected = first.status === 200 && second.status === 401;
  if (replayDetected) {
    expect(true, 'second status === 401 (replay) — Upstash configured');
  } else if (firstSecondOk) {
    console.warn(
      '  ⚠ second status === 200 — Upstash NOT configured, replay protection disabled (noopNonceStore). This is expected for local dev without Upstash env vars.',
    );
  } else {
    expect(
      false,
      `expected 200/401 (replay) or 200/200 (noop), got ${first.status}/${second.status}`,
    );
  }
}

console.log('\n----------------------------------------');
if (failures > 0) {
  console.error(`✗ ${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log('✓ all assertions passed');
}
