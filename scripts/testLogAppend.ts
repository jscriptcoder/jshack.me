// Wire-check — do log lines that land at the same moment all land?
//
// Every system log line is appended to the log a reader sees. Two appends to one log at
// once must not build on the same copy of it, or the later write drops the earlier line:
// a defender then misses a visitor who came at the same time as another. This drives the
// real /api/network endpoint against a running `vercel dev` + supabase:
//
//   1. A visitor fetches findit.io RACERS times at once, each a different search, so each
//      look leaves a line only it could have written.
//   2. findit's access.log, as a reader materializes it, holds every one of those lines.
//
// A root's wipe sticking, and a line building on another writer's newer row, are
// `testLogWipeSticks`'s checks.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testLogAppend.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentityIn } from '../src/test/factories/identityIn.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { wifiPoolOf } from '../src/core/generation/generateWifi.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { FINDIT_DOMAIN, FINDIT_NETWORK } from '../src/core/generation/fixedSites.js';
import { ACCESS_LOG_PATH } from '../src/core/logging/accessLog.js';
import { orderPatchesForReplay } from '../src/core/patches/orderPatchesForReplay.js';
import { md5 } from '../src/core/generation/md5.js';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

/** Enough looks at once that a read-then-write append loses lines on every run, not
 *  only on an unlucky one. */
const RACERS = 20;

const SITE_IP = siteAddress(FINDIT_DOMAIN);
if (SITE_IP === undefined) {
  console.error('findit.io answers nowhere — the world is unusable.');
  process.exit(2);
}
const machineId = computeApGatewayId(FINDIT_NETWORK);

const results: { readonly pass: boolean }[] = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
};

const post = async (
  endpoint: string,
  envelope: unknown,
): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

type LogRow = {
  readonly content: string | null;
  readonly updated_at: string;
  readonly writer_key: string;
};

/** findit's access.log as a reader materializes it: the latest of every writer's rows. */
const accessLog = async (): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content, updated_at, writer_key')
    .eq('machine_id', machineId)
    .eq('path', ACCESS_LOG_PATH);
  return orderPatchesForReplay((data ?? []) as readonly LogRow[]).at(-1)?.content ?? '';
};

const visitor = generateIdentityIn(RIDGEMONT);
const [visitorEssid] = wifiPoolOf(RIDGEMONT);

const cleanup = async () => {
  await sr.from('sessions').delete().eq('player_key', visitor.publicKeyHex);
  await sr.from('home_network_occupants').delete().eq('owner_key', visitor.publicKeyHex);
  await sr.from('patches').delete().eq('machine_id', machineId).eq('path', ACCESS_LOG_PATH);
};

const main = async () => {
  await cleanup();
  const joined = await post(
    NETWORK,
    signRequest(visitor, 'registerNetwork', {
      essid: visitorEssid,
      workstation_machine_id: computeWorkstationId('newbie', visitor.publicKeyHex),
      workstation_username: 'newbie',
      workstation_machine_name: 'newbie',
      workstation_root_hash: md5('newbie-root-secret'),
    }),
  );
  if (joined.status !== 200) {
    console.error(`Could not put the visitor on a network: status ${joined.status}`);
    process.exit(2);
  }

  // 1. RACERS looks at once, each its own search.
  const searches = Array.from({ length: RACERS }, (_unused, index) => `race${index}x`);
  const looks = await Promise.all(
    searches.map((search) =>
      post(
        NETWORK,
        signRequest(visitor, 'resolveHttpFetch', {
          target: SITE_IP,
          port: 80,
          path: `/?q=${search}`,
        }),
      ),
    ),
  );
  const answered = looks.filter((look) => look.status === 200).length;
  check(`all ${RACERS} looks are answered`, answered === RACERS, `${answered} answered`);

  // 2. Every look left its line.
  const log = await accessLog();
  const missing = searches.filter((search) => !log.includes(`q=${search} `));
  check(
    `access.log holds all ${RACERS} looks`,
    missing.length === 0,
    `${RACERS - missing.length} of ${RACERS} landed${missing.length > 0 ? `; missing ${missing.join(', ')}` : ''}`,
  );

  await cleanup();
  const passed = results.filter((result) => result.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
};

await main();
