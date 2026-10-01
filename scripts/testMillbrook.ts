// Wire-payload smoke for MILLBROOK — a town beyond Ridgemont, reachable over the internet
// alone. Drives the REAL /api/network endpoint against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - The public-IP lookup falls back to the world declaration for an address in a
//     region's block, so a network nobody can join answers at its derived `87.` address.
//   - A fetch of the council's address returns the council's own front page, which names
//     its own town and never Ridgemont.
//   - findit's live index lists the town's institutions, so a search for the town's name
//     finds every one its directory lists, save those the town keeps off search.
//   - A scan of a town network's address reaches its gateway, whose ssh answers.
//   - The council's front page links the town directory, which links every institution in
//     the town, and following its link to the police reaches the police's own front page.
//   - A network's gateway forwards ssh to a box behind it: a scan of its address shows
//     every forward, and ssh through the forwarded port reaches the box behind it, whose
//     own auth.log records the attempt. The network is one that stands no inner router,
//     so the box the server finds there is the one its smaller LAN holds.
//   - The town's unlisted site answers a fetch by its domain, and findit's live index
//     never lists it, whether searched by its name, its domain or its town.
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
import { siteAddress } from '../src/core/generation/publisher.js';
import {
  DECLARED_NETWORKS,
  declaredNetwork,
  networkAt,
  publicAddress,
} from '../src/core/generation/world.js';
import { seededForwards } from '../src/core/generation/seededForwards.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { hostServices, npcUsername } from '../src/core/generation/remoteHostFs.js';
import { siteServer } from '../src/core/generation/siteServer.js';
import { FINDIT_DOMAIN } from '../src/core/generation/findit.js';
import { ACCESS_LOG_PATH } from '../src/core/logging/accessLog.js';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog.js';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
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

const post = async (
  envelope: unknown,
  endpoint: string = NETWORK,
): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(endpoint, {
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
const COUNCIL = COUNCIL_IP === undefined ? undefined : networkAt(COUNCIL_IP);
const SERVER = COUNCIL === undefined ? undefined : siteServer(COUNCIL);
const POLICE_IP = siteAddress('millbrookpd.gov');
const POLICE = POLICE_IP === undefined ? undefined : networkAt(POLICE_IP);
const POLICE_SERVER = POLICE === undefined ? undefined : siteServer(POLICE);
if (
  COUNCIL_IP === undefined ||
  FINDIT_IP === undefined ||
  COUNCIL === undefined ||
  SERVER === undefined ||
  POLICE_IP === undefined ||
  POLICE === undefined ||
  POLICE_SERVER === undefined
) {
  console.error('Millbrook has no council or police on the internet — the world is unusable.');
  process.exit(2);
}
// The institutions the town's directory lists, read from the declaration, and which of
// them the town keeps off every search.
const TOWN_SITES = declaredNetwork(COUNCIL)?.directory ?? [];
const isUnlisted = (domain: string): boolean =>
  DECLARED_NETWORKS.some((network) => network.site?.domain === domain && network.unlisted === true);
const TOWN_MACHINES = [
  computeApGatewayId(COUNCIL),
  machineIdForLanHost(SERVER, COUNCIL),
  computeApGatewayId(POLICE),
  machineIdForLanHost(POLICE_SERVER, POLICE),
];
// Every fetch appends to the reached box's access log, which is all a run leaves behind on
// the town. findit's own log is shared with every other search and left to accrete.
const cleanup = async () => {
  await sr.from('patches').delete().in('machine_id', TOWN_MACHINES).eq('path', ACCESS_LOG_PATH);
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
const listed = TOWN_SITES.map((site) => site.domain).filter((domain) =>
  resultsPage.includes(domain),
);
const expected = TOWN_SITES.map((site) => site.domain).filter((domain) => !isUnlisted(domain));
check(
  'a findit search for millbrook lists every institution of the town not kept off search',
  searched.status === 200 && expected.length > 0 && listed.join(' ') === expected.join(' '),
  `status=${searched.status} listed=${listed.join(',')} expected=${expected.join(',')}`,
);

// === 4. A scan of the council's address reaches its gateway, whose ssh answers. ===
const scanned = await post(signRequest(visitor, 'resolvePublicScan', { target: COUNCIL_IP }));
const ports = portsOf(scanned.body).map((openPort) => `${openPort.port}/${openPort.service}`);
check(
  "nmap <the council's address> shows its gateway up with 22/ssh",
  scanned.status === 200 && foundOf(scanned.body) && ports.includes('22/ssh'),
  `status=${scanned.status} ports=${ports.join(',')}`,
);

// === 5. The council's directory links every institution, and its links lead there. ===
const directoryFetch = await post(
  signRequest(visitor, 'resolveHttpFetch', {
    target: COUNCIL_IP,
    port: 80,
    path: '/directory.html',
  }),
);
const directory = contentOf(directoryFetch.body);
const linked = [...directory.matchAll(/<a href="(http:\/\/[^"]+)">/g)].map(([, href]) => href);
check(
  'the council front page links its town directory, which links every institution in the town',
  homepage.includes('<a href="/directory.html">Town directory</a>') &&
    directoryFetch.status === 200 &&
    TOWN_SITES.length > 0 &&
    linked.join(' ') === TOWN_SITES.map((site) => `http://${site.domain}/`).join(' '),
  `status=${directoryFetch.status} error=${errorOf(directoryFetch.body)} links=${linked.join(',')}`,
);
const followed = await post(
  signRequest(visitor, 'resolveHttpFetch', { target: POLICE_IP, port: 80, path: '/' }),
);
check(
  "following the directory's link to millbrookpd.gov reaches the police's own front page",
  linked.includes('http://millbrookpd.gov/') &&
    followed.status === 200 &&
    contentOf(followed.body).includes('<title>Millbrook Police Department</title>'),
  `status=${followed.status} error=${errorOf(followed.body)}`,
);

// === 6. A gateway forwards ssh to a box behind it, and a scan shows every forward. ===
/** The forward of `key`'s gateway that lands on a box serving ssh, if any does. */
const sshForwardOf = (key: string) =>
  seededForwards(key).find((forward) =>
    generateHomeLan(key).hosts.some(
      (host) =>
        host.ip === forward.internalIp &&
        hostServices(key, host).some(
          ({ spec, port }) => spec.service === 'ssh' && port === forward.internalPort,
        ),
    ),
  );
// A town network that is not `deep`, whose gateway forwards ssh to a box behind it.
const FORWARDER = DECLARED_NETWORKS.find(
  (network) =>
    network.profile !== undefined &&
    network.profile !== 'deep' &&
    sshForwardOf(network.key) !== undefined,
);
const FORWARDER_IP = FORWARDER === undefined ? undefined : publicAddress(FORWARDER.key);
const SSH_FORWARD = FORWARDER === undefined ? undefined : sshForwardOf(FORWARDER.key);
const DESK = generateHomeLan(FORWARDER?.key ?? '').hosts.find(
  (host) => host.ip === SSH_FORWARD?.internalIp,
);
if (
  FORWARDER === undefined ||
  FORWARDER_IP === undefined ||
  SSH_FORWARD === undefined ||
  DESK === undefined
) {
  console.error('No lone or flat network in Millbrook forwards ssh — the world is unusable.');
  process.exit(2);
}
const DESK_ID = machineIdForLanHost(DESK, FORWARDER.key);
const clearDeskLog = async () => {
  await sr.from('patches').delete().eq('machine_id', DESK_ID).eq('path', AUTH_LOG_PATH);
};
await clearDeskLog();

const forwarderScan = await post(
  signRequest(visitor, 'resolvePublicScan', { target: FORWARDER_IP }),
);
const forwarderPorts = portsOf(forwarderScan.body).map(
  (openPort) => `${openPort.port}/${openPort.service}`,
);
const forwardedPorts = seededForwards(FORWARDER.key).map((forward) => forward.publicPort);
check(
  `nmap <${FORWARDER.essid}'s address> (${FORWARDER.profile}) shows every service its gateway forwards`,
  forwarderScan.status === 200 &&
    [
      '22/ssh',
      `${SSH_FORWARD.publicPort}/ssh`,
      ...(FORWARDER.site === undefined ? [] : ['80/http']),
    ].every((port) => forwarderPorts.includes(port)) &&
    forwardedPorts.every((port) => forwarderPorts.some((open) => open.startsWith(`${port}/`))),
  `status=${forwarderScan.status} ports=${forwarderPorts.join(',')}`,
);

// === 7. Connecting through the forward reaches the box behind it, not the gateway. ===
const login = await post(
  signRequest(visitor, 'authCreateSessionPublic', {
    session_id: `millbrook-forward-${Date.now()}`,
    target: FORWARDER_IP,
    username: npcUsername(FORWARDER.key, DESK),
    password: 'not-the-password',
    port: SSH_FORWARD.publicPort,
  }),
  SESSIONS,
);
const { data: deskLog } = await sr
  .from('patches')
  .select('content')
  .eq('machine_id', DESK_ID)
  .eq('path', AUTH_LOG_PATH)
  .maybeSingle();
check(
  `ssh -p ${SSH_FORWARD.publicPort} reaches ${DESK.hostname} behind ${FORWARDER.essid}'s gateway`,
  login.status === 401 &&
    typeof deskLog?.content === 'string' &&
    deskLog.content.includes('Failed password'),
  `status=${login.status} error=${errorOf(login.body)} logged=${deskLog !== null}`,
);
await clearDeskLog();

// === 7. An unlisted site answers by its domain, and no findit search lists it. ===
const UNLISTED = DECLARED_NETWORKS.find((network) => network.unlisted === true);
const UNLISTED_SITE = UNLISTED?.site;
const UNLISTED_IP = UNLISTED_SITE === undefined ? undefined : siteAddress(UNLISTED_SITE.domain);
const UNLISTED_SERVER = UNLISTED === undefined ? undefined : siteServer(UNLISTED.key);
if (
  UNLISTED === undefined ||
  UNLISTED_SITE === undefined ||
  UNLISTED_IP === undefined ||
  UNLISTED_SERVER === undefined ||
  UNLISTED.town === undefined
) {
  console.error('Millbrook unlists no site on the internet — the world is unusable.');
  process.exit(2);
}
const clearUnlistedLog = async () => {
  await sr
    .from('patches')
    .delete()
    .eq('machine_id', machineIdForLanHost(UNLISTED_SERVER, UNLISTED.key))
    .eq('path', ACCESS_LOG_PATH);
};
await clearUnlistedLog();

const unlistedFetch = await post(
  signRequest(visitor, 'resolveHttpFetch', { target: UNLISTED_IP, port: 80, path: '/' }),
);
check(
  `curl http://${UNLISTED_SITE.domain}/ returns its own front page`,
  unlistedFetch.status === 200 &&
    contentOf(unlistedFetch.body).includes(`<title>${UNLISTED_SITE.name}</title>`),
  `status=${unlistedFetch.status} error=${errorOf(unlistedFetch.body)}`,
);

const searchesFor = [UNLISTED_SITE.name, UNLISTED_SITE.domain, UNLISTED.town];
const unlistedSearches = await Promise.all(
  searchesFor.map((words) =>
    post(
      signRequest(visitor, 'resolveHttpFetch', {
        target: FINDIT_IP,
        port: 80,
        path: `/?q=${encodeURIComponent(words)}`,
      }),
    ),
  ),
);
// A result is a link to the site; the page also echoes the query, which may be the domain.
const leaking = searchesFor.filter(
  (_, index) =>
    unlistedSearches[index]?.status !== 200 ||
    contentOf(unlistedSearches[index]?.body).includes(`<a href="http://${UNLISTED_SITE.domain}/">`),
);
const listedLink = contentOf(searched.body).includes('<a href="http://millbrook.gov/">');
check(
  `no findit search for its name, its domain or its town lists ${UNLISTED_SITE.domain}`,
  // A listed site's result must match the same link, or finding none would prove nothing.
  listedLink && leaking.length === 0,
  `searched=${searchesFor.join(' | ')} leaking=${leaking.join(' | ')} listedLink=${listedLink}`,
);
await clearUnlistedLog();

await cleanup();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
