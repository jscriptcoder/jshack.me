// Wire-payload smoke for web reads on the LAN — a box the network generates answers a
// reader on its own network from its journal, exactly as it answers a reader across the
// internet. Drives the REAL /api/network (resolveOccupantFetch, resolveOccupantSweep,
// resolveHttpFetch) and /api/patches (recordLanFetch) endpoints against a running
// `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - Ridgemont University's site server, reached at its LAN address, serves the page its
//     journal holds: a defaced page is served defaced, a deleted one is a 404, a stopped
//     web server refuses and a bricked box is unreachable. Each answer matches the one a
//     fetch of the university's public address gets.
//   - The LAN visit lands in the site server's access.log under the network's own key,
//     with the size actually served, and a bricked box records nothing.
//   - A sweep of the box from its LAN reads the same journal: the defaced page's size
//     comes back, and a bricked box is unreachable.
//   - A host on a deep layer, fetched from a shell on the inner gateway in front of it,
//     serves its defaced page too, logged from the gateway's address on that layer.
//   - A recordLanFetch naming a generated box leaves no line: the server records that
//     visit when it serves it.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testLanWebServed.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { chainLinks, machineIdForLanHost } from '../src/core/generation/lanTopology.js';
import { chainGatewayBaseFs } from '../src/core/generation/lanHostIdentity.js';
import { publisherIp } from '../src/core/generation/publisher.js';
import { siteServer } from '../src/core/generation/siteServer.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { wifiPoolOf } from '../src/core/generation/generateWifi.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { resolveDeepScanHosts } from '../src/core/scan/deepScanHosts.js';
import { lanAddressFor } from '../src/core/network/lanAddress.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { ACCESS_LOG_PATH } from '../src/core/logging/accessLog.js';
import { DIRLIST_PATH } from '../src/core/network/defaultDirlist.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { md5 } from '../src/core/generation/md5.js';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
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

type Answer = { readonly status: number; readonly body: Record<string, unknown> | null };
const post = async (endpoint: string, envelope: unknown): Promise<Answer> => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: response.status, body };
};

/** An answer as one comparable string: the page, or the refusal. */
const shown = (answer: Answer): string =>
  typeof answer.body?.content === 'string'
    ? `200 ${answer.body.content}`
    : `${answer.status} ${String(answer.body?.error)}`;

// --- Ridgemont University's site server, reached from its LAN and from the internet. ---
const ESSID = 'CAMPUS-GUEST-OPEN';
const SITE_IP = publisherIp(ESSID);
const SERVER = siteServer(ESSID);
if (SITE_IP === undefined || SERVER === undefined) {
  console.error(`FATAL: ${ESSID} publishes no website`);
  process.exit(2);
}
const SERVER_ID = machineIdForLanHost(SERVER, ESSID);
const NETWORK_KEY = apGatewayLogWriterKey(ESSID);
const WEB_PORT = SERVICE_CATALOG.http.defaultPort;
const INDEX = '/var/www/html/index.html';
const DEFACED = '<html><h1>owned by nobody you know</h1></html>';

const bob = generateIdentity();
const BOB_WS = computeWorkstationId('probebox', bob.publicKeyHex);
const taken = new Set(generateHomeLan(ESSID).hosts.map((host) => Number(host.ip.split('.')[3])));
const BOB_OCTET = Array.from({ length: 253 }, (_unused, index) => index + 2).find(
  (octet) => !taken.has(octet),
);
if (BOB_OCTET === undefined) {
  console.error(`No free octet on ${ESSID}'s /24`);
  process.exit(2);
}
const BOB_LAN = lanAddressFor(ESSID, BOB_OCTET);

const PERMS = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };
const rowOn = (machineId: string, path: string, content: string | null, writer = NETWORK_KEY) => ({
  machine_id: machineId,
  path,
  content,
  owner: 'root',
  permissions: PERMS,
  // A row with no content is a deletion; the column still names what was deleted.
  node_type: 'file',
  writer_key: writer,
  updated_at: new Date().toISOString(),
});

const accessLog = async (machineId: string, writerKey: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', ACCESS_LOG_PATH)
    .eq('writer_key', writerKey)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};

// --- A host on a deep layer behind an inner ROUTER, and a shell on that router. ---
const deep = (() => {
  for (const essid of wifiPoolOf(RIDGEMONT)) {
    for (const link of chainLinks(essid)) {
      if (link.host.kind !== 'router') continue;
      const web = resolveDeepScanHosts(essid, link, chainGatewayBaseFs(essid, link)).hosts.find(
        (entry) =>
          entry.host.kind === 'machine' &&
          entry.ports.some((open) => open.service === SERVICE_CATALOG.http.service),
      );
      if (web !== undefined) {
        return {
          essid,
          gatewayId: link.machineId,
          host: web.host,
          hostId: web.machineId,
          port: web.ports.find((open) => open.service === SERVICE_CATALOG.http.service)!.port,
        };
      }
    }
  }
  return undefined;
})();
if (deep === undefined) {
  console.error('FATAL: no crackable network with a web host on a router-fronted layer');
  process.exit(2);
}
const DEEP_SHELL = 'lan-web-served-deep-shell';

const cleanup = async () => {
  // The whole fixture network, so a run that died half way cannot hold an address.
  await sr.from('home_network_occupants').delete().eq('essid', ESSID);
  await sr.from('network_lan_leases').delete().eq('essid', ESSID);
  await sr.from('patches').delete().in('machine_id', [SERVER_ID, BOB_WS, deep.hostId]);
  await sr.from('sessions').delete().eq('session_id', DEEP_SHELL);
};
await cleanup();

const seeded = await sr.from('home_network_occupants').insert([
  {
    essid: ESSID,
    owner_key: bob.publicKeyHex,
    workstation_machine_id: BOB_WS,
    workstation_username: 'player',
    workstation_machine_name: 'probebox',
    workstation_root_hash: md5('x'),
  },
]);
const leased = await sr
  .from('network_lan_leases')
  .insert([{ essid: ESSID, owner_key: bob.publicKeyHex, octet: BOB_OCTET }]);
const listed = await sr
  .from('patches')
  .insert([rowOn(BOB_WS, DIRLIST_PATH, 'index.html\ncourses.html\n', bob.publicKeyHex)]);
const shell = await sr.from('sessions').insert({
  session_id: DEEP_SHELL,
  player_key: bob.publicKeyHex,
  machine_id: deep.gatewayId,
  credentials: { username: 'root', userType: 'root' },
  kind: 'ssh',
  essid: deep.essid,
});
for (const step of [seeded, leased, listed, shell]) {
  if (step.error) {
    console.error(`FATAL: seed failed: ${step.error.message}`);
    process.exit(1);
  }
}

const overLan = () =>
  post(
    NETWORK,
    signRequest(bob, 'resolveOccupantFetch', {
      essid: ESSID,
      target: SERVER.ip,
      port: WEB_PORT,
      path: '/',
    }),
  );
const overInternet = () =>
  post(NETWORK, signRequest(bob, 'resolveHttpFetch', { target: SITE_IP, path: '/' }));
const sweptOverLan = () =>
  post(
    NETWORK,
    signRequest(bob, 'resolveOccupantSweep', {
      essid: ESSID,
      target: SERVER.ip,
      port: WEB_PORT,
      caller_machine_id: BOB_WS,
    }),
  );

/** Plant `rows` on the site server (its journal emptied first), then read it both ways. */
const bothWays = async (rows: readonly ReturnType<typeof rowOn>[]) => {
  await sr.from('patches').delete().eq('machine_id', SERVER_ID);
  if (rows.length > 0) {
    const planted = await sr.from('patches').insert(rows);
    if (planted.error) throw new Error(planted.error.message);
  }
  return { lan: await overLan(), internet: await overInternet() };
};

// === 1-5. A LAN read of the site server agrees with an internet read, journal and all. ===
const untouched = await bothWays([]);
check(
  'untouched, the LAN is served the generated page, as the internet is',
  untouched.lan.status === 200 && shown(untouched.lan) === shown(untouched.internet),
  `lan=${shown(untouched.lan).slice(0, 50)} internet=${shown(untouched.internet).slice(0, 50)}`,
);

const defaced = await bothWays([rowOn(SERVER_ID, INDEX, DEFACED)]);
check(
  'defaced, the LAN is served the defaced page, as the internet is',
  shown(defaced.lan) === `200 ${DEFACED}` && shown(defaced.internet) === `200 ${DEFACED}`,
  `lan=${shown(defaced.lan)} internet=${shown(defaced.internet)}`,
);
const defacedLine = (await accessLog(SERVER_ID, NETWORK_KEY)).trim().split('\n');
check(
  "the LAN visit lands in the site server's log under the network key, with the size served",
  defacedLine.some(
    (line) =>
      line.startsWith(`${BOB_LAN} - - [`) &&
      line.endsWith(`"GET / HTTP/1.1" 200 ${DEFACED.length}`),
  ),
  `log=${JSON.stringify(defacedLine)}`,
);

const deleted = await bothWays([rowOn(SERVER_ID, INDEX, null)]);
check(
  'with the page deleted, the LAN gets a 404, as the internet does',
  shown(deleted.lan) === '404 not_found' && shown(deleted.internet) === '404 not_found',
  `lan=${shown(deleted.lan)} internet=${shown(deleted.internet)}`,
);

const stopped = await bothWays([
  rowOn(SERVER_ID, `/var/run/${SERVICE_CATALOG.http.pidfile}`, null),
]);
check(
  'with the web server stopped, the LAN is refused, and the internet reaches nothing',
  shown(stopped.lan) === '404 connection_refused' &&
    shown(stopped.internet) === '404 host_unreachable',
  `lan=${shown(stopped.lan)} internet=${shown(stopped.internet)}`,
);

const bricked = await bothWays([rowOn(SERVER_ID, '/boot/vmlinuz', null)]);
const brickedLog = await accessLog(SERVER_ID, NETWORK_KEY);
check(
  'bricked, the box is unreachable from the LAN and the internet, and logs nothing',
  shown(bricked.lan) === '404 host_unreachable' &&
    shown(bricked.internet) === '404 host_unreachable' &&
    brickedLog === '',
  `lan=${shown(bricked.lan)} internet=${shown(bricked.internet)} log=${JSON.stringify(brickedLog)}`,
);

// === 6-7. A sweep from the LAN reads the same journal. ===
type Swept = { readonly path: string; readonly status: number; readonly size: number };
const sweptResults = (answer: Answer): readonly Swept[] =>
  (answer.body?.results as readonly Swept[] | undefined) ?? [];

await sr.from('patches').delete().eq('machine_id', SERVER_ID);
await sr.from('patches').insert([rowOn(SERVER_ID, INDEX, DEFACED)]);
const sweptDefaced = await sweptOverLan();
check(
  "a LAN sweep of the defaced box reports the defaced page's size",
  sweptDefaced.status === 200 &&
    sweptResults(sweptDefaced).some(
      (result) =>
        result.path === '/index.html' && result.status === 200 && result.size === DEFACED.length,
    ),
  `status=${sweptDefaced.status} results=${JSON.stringify(sweptResults(sweptDefaced))}`,
);

await sr.from('patches').delete().eq('machine_id', SERVER_ID);
await sr.from('patches').insert([rowOn(SERVER_ID, '/boot/vmlinuz', null)]);
const sweptBricked = await sweptOverLan();
check(
  'a LAN sweep of the bricked box finds it unreachable',
  sweptBricked.status === 404 && sweptBricked.body?.error === 'host_unreachable',
  `status=${sweptBricked.status} body=${JSON.stringify(sweptBricked.body)}`,
);

// === 8. A host on a deep layer is served from its journal, from a shell in front of it. ===
await sr
  .from('patches')
  .insert([rowOn(deep.hostId, INDEX, DEFACED, apGatewayLogWriterKey(deep.essid))]);
const deepFetched = await post(
  NETWORK,
  signRequest(bob, 'resolveOccupantFetch', {
    essid: deep.essid,
    target: deep.host.ip,
    port: deep.port,
    path: '/',
    caller_machine_id: deep.gatewayId,
  }),
);
const deepSubnet = deep.host.ip.split('.').slice(0, 3).join('.');
const deepLog = await accessLog(deep.hostId, apGatewayLogWriterKey(deep.essid));
check(
  'a deep-layer host is served its defaced page, logged from the gateway in front of it',
  shown(deepFetched) === `200 ${DEFACED}` && deepLog.includes(`${deepSubnet}.1 - - [`),
  `answer=${shown(deepFetched)} log=${JSON.stringify(deepLog.trim())}`,
);

// === 9. The own-box trace no longer files a line for a box the server serves. ===
await sr.from('patches').delete().eq('machine_id', SERVER_ID);
const reported = await post(
  PATCHES,
  signRequest(bob, 'recordLanFetch', {
    essid: ESSID,
    target: SERVER.ip,
    port: WEB_PORT,
    paths: ['/'],
  }),
);
const afterReport = await accessLog(SERVER_ID, NETWORK_KEY);
check(
  'a recordLanFetch naming a generated box is answered and leaves no line',
  reported.status === 200 && afterReport === '',
  `status=${reported.status} log=${JSON.stringify(afterReport)}`,
);

await cleanup();

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
