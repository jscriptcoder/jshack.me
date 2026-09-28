// Wire-payload smoke for MILLBROOK — a town beyond Ridgemont, reachable over the internet
// alone. Drives the REAL /api/network endpoint against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - The public-IP lookup falls back to the world declaration for an address in a
//     region's block, so a network nobody can join answers at its derived `87.` address.
//   - A fetch of the council's address returns the council's own front page, which names
//     its own town and never Ridgemont.
//   - findit's live index lists the town's institutions, so a search for the town's name
//     finds its council, its police and its library.
//   - A scan of a town network's address reaches its gateway, whose ssh answers.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMillbrook.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { machineIdForLanHost } from '../src/core/generation/lanTopology.js';
import { publisherAt, siteAddress } from '../src/core/generation/publisher.js';
import { siteServer } from '../src/core/generation/siteServer.js';
import { FINDIT_DOMAIN } from '../src/core/generation/findit.js';
import { ACCESS_LOG_PATH } from '../src/core/logging/accessLog.js';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

const results: { readonly pass: boolean }[] = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
};

const post = async (envelope: unknown): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(NETWORK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const contentOf = (body: unknown): string => {
  const content = (body as { content?: unknown } | null)?.content;
  return typeof content === 'string' ? content : '';
};

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

const foundOf = (body: unknown): boolean => (body as { found?: boolean } | null)?.found === true;

type WirePort = { readonly port: number; readonly service: string };
const portsOf = (body: unknown): readonly WirePort[] =>
  (body as { ports?: readonly WirePort[] } | null)?.ports ?? [];

// --- The council publishes; a visitor who has never joined any network reaches it. ---
const visitor = generateIdentity();

const COUNCIL_IP = siteAddress('millbrook.gov');
const FINDIT_IP = siteAddress(FINDIT_DOMAIN);
const COUNCIL = COUNCIL_IP === undefined ? undefined : publisherAt(COUNCIL_IP);
const SERVER = COUNCIL === undefined ? undefined : siteServer(COUNCIL);
if (
  COUNCIL_IP === undefined ||
  FINDIT_IP === undefined ||
  COUNCIL === undefined ||
  SERVER === undefined
) {
  console.error('Millbrook has no council on the internet — the world is unusable.');
  process.exit(2);
}
const COUNCIL_MACHINES = [computeApGatewayId(COUNCIL), machineIdForLanHost(SERVER, COUNCIL)];
// Every fetch appends to the reached box's access log, which is all a run leaves behind on
// the council. findit's own log is shared with every other search and left to accrete.
const cleanup = async () => {
  await sr.from('patches').delete().in('machine_id', COUNCIL_MACHINES).eq('path', ACCESS_LOG_PATH);
};
await cleanup();

// === 1. The council's domain answers at an address in the region's block. ===
check(
  "millbrook.gov resolves to an address in region #0's block",
  /^87\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(COUNCIL_IP),
  `address=${COUNCIL_IP}`,
);

// === 2. The council's front page answers there, and names its own town. ===
const fetched = await post(
  signRequest(visitor, 'resolveHttpFetch', { target: COUNCIL_IP, port: 80, path: '/' }),
);
const homepage = contentOf(fetched.body);
check(
  "curl http://millbrook.gov/ returns the council's own front page",
  fetched.status === 200 &&
    homepage.includes('<title>Millbrook Town Council</title>') &&
    !homepage.includes('Ridgemont'),
  `status=${fetched.status} error=${errorOf(fetched.body)} bytes=${homepage.length}`,
);

// === 3. findit finds the town's institutions by the town's name. ===
const searched = await post(
  signRequest(visitor, 'resolveHttpFetch', { target: FINDIT_IP, port: 80, path: '/?q=millbrook' }),
);
const resultsPage = contentOf(searched.body);
const listed = ['millbrook.gov', 'millbrookpd.gov', 'millbrooklibrary.org'].filter((domain) =>
  resultsPage.includes(domain),
);
check(
  'a findit search for millbrook lists its council, police and library',
  searched.status === 200 && listed.length === 3,
  `status=${searched.status} listed=${listed.join(',')}`,
);

// === 4. A scan of the council's address reaches its gateway, whose ssh answers. ===
const scanned = await post(signRequest(visitor, 'resolvePublicScan', { target: COUNCIL_IP }));
const ports = portsOf(scanned.body).map((openPort) => `${openPort.port}/${openPort.service}`);
check(
  "nmap <the council's address> shows its gateway up with 22/ssh",
  scanned.status === 200 && foundOf(scanned.body) && ports.includes('22/ssh'),
  `status=${scanned.status} ports=${ports.join(',')}`,
);

await cleanup();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
