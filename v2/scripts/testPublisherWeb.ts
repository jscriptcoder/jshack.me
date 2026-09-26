// Wire-payload smoke for the PUBLIC WEB — an institution's website answers at its own
// public address from anywhere, before anybody has ever joined its wifi. Drives the REAL
// /api/network endpoint against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - The public-IP lookup falls back to the address an institution's ESSID derives when
//     `network_public_ips` holds no row for it, so `curl` and `nmap` reach a network
//     nobody has registered.
//   - The gateway's seeded forward sends the public web port to a GENERATED box on the
//     LAN — not a player occupant — and the fetch returns that box's page.
//   - The hit is recorded in the site server's own access.log, under the network's own
//     stable writer key, which only the database can settle.
//   - Joining the institution stores exactly the derived address, and the site still
//     answers there afterwards.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testPublisherWeb.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { machineIdForLanHost } from '../src/core/generation/lanTopology';
import { publisherIp } from '../src/core/generation/publisher';
import { siteServer } from '../src/core/generation/siteServer';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter';
import { ACCESS_LOG_PATH } from '../src/core/logging/accessLog';
import { md5 } from '../src/core/generation/md5';
import { clearPublicIps } from './networkFixture';

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

const contentOf = (body: unknown): string | undefined =>
  (body as { content?: string } | null)?.content;

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

const foundOf = (body: unknown): boolean => (body as { found?: boolean } | null)?.found === true;

type WirePort = { readonly port: number; readonly service: string };
const portsOf = (body: unknown): readonly WirePort[] =>
  (body as { ports?: readonly WirePort[] } | null)?.ports ?? [];

// --- The university publishes; BOB browses it from nowhere in particular, and later
//     joins its wifi. ---
const bob = generateIdentity();

const ESSID = 'CAMPUS-GUEST-OPEN';
const SITE_IP = publisherIp(ESSID);
const SERVER = siteServer(ESSID);
if (SITE_IP === undefined || SERVER === undefined) {
  console.error(`FATAL: ${ESSID} publishes no website`);
  process.exit(1);
}
const AP_GATEWAY = computeApGatewayId(ESSID);
const SERVER_MACHINE = machineIdForLanHost(SERVER, ESSID);
const UNPUBLISHED_IP = '193.0.0.1';

const readAccessLog = async (): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', SERVER_MACHINE)
    .eq('path', ACCESS_LOG_PATH)
    .eq('writer_key', apGatewayLogWriterKey(ESSID))
    .maybeSingle();
  return (data as { content: string | null } | null)?.content ?? '';
};

const cleanup = async () => {
  await clearPublicIps(sr, [{ essid: ESSID, publicIp: SITE_IP }]);
  await sr.from('home_network_occupants').delete().eq('owner_key', bob.publicKeyHex);
  await sr.from('network_lan_leases').delete().eq('essid', ESSID);
  await sr.from('patches').delete().in('machine_id', [AP_GATEWAY, SERVER_MACHINE]);
};
await cleanup();

// === 1. Before anybody joins, the site answers at its derived address. ===
const fetched = await post(signRequest(bob, 'resolveHttpFetch', { target: SITE_IP, path: '/' }));
check(
  'curl http://<site ip>/ returns the homepage with the network never registered',
  fetched.status === 200 && (contentOf(fetched.body) ?? '').includes('<html'),
  `status=${fetched.status} error=${errorOf(fetched.body)} bytes=${contentOf(fetched.body)?.length}`,
);

// === 2. The site server records the hit in its own access.log, under the network's key. ===
const log = await readAccessLog();
check(
  "the hit lands in the site server's access.log under the network's own key",
  log.includes('GET / ') && log.includes(' 200 '),
  `log=${JSON.stringify(log.trim().split('\n').at(-1) ?? '')}`,
);

// === 3. A scan of the address shows the gateway's ssh and the forwarded web port. ===
const scanned = await post(signRequest(bob, 'resolvePublicScan', { target: SITE_IP }));
const ports = portsOf(scanned.body).map((openPort) => `${openPort.port}/${openPort.service}`);
check(
  'nmap <site ip> shows 22/ssh and 80/http',
  scanned.status === 200 &&
    foundOf(scanned.body) &&
    ports.includes('22/ssh') &&
    ports.includes('80/http'),
  `status=${scanned.status} ports=${ports.join(',')}`,
);

// === 4. An address in the published range that no institution holds reaches nothing. ===
const nobody = await post(
  signRequest(bob, 'resolveHttpFetch', { target: UNPUBLISHED_IP, path: '/' }),
);
check(
  'an unpublished 193. address is unreachable',
  nobody.status === 404 && errorOf(nobody.body) === 'host_unreachable',
  `status=${nobody.status} error=${errorOf(nobody.body)}`,
);

// === 5. Joining the university stores the address its site already answers at. ===
const WS_NAME = 'dorm-laptop';
const joined = await post(
  signRequest(bob, 'registerNetwork', {
    essid: ESSID,
    workstation_machine_id: computeWorkstationId(WS_NAME, bob.publicKeyHex),
    workstation_username: 'player',
    workstation_machine_name: WS_NAME,
    workstation_root_hash: md5('root-secret'),
  }),
);
const { data: stored } = await sr
  .from('network_public_ips')
  .select('public_ip')
  .eq('essid', ESSID)
  .maybeSingle();
const storedIp = (stored as { public_ip: string } | null)?.public_ip ?? null;
check(
  'joining the institution stores its derived address',
  joined.status === 200 && storedIp === SITE_IP,
  `status=${joined.status} stored=${storedIp} derived=${SITE_IP}`,
);

// === 6. After the join, the site still answers at the same address. ===
const again = await post(signRequest(bob, 'resolveHttpFetch', { target: SITE_IP, path: '/' }));
check(
  'the site still answers after somebody joined',
  again.status === 200 && contentOf(again.body) === contentOf(fetched.body),
  `status=${again.status} sameHomepage=${contentOf(again.body) === contentOf(fetched.body)}`,
);

await cleanup();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
