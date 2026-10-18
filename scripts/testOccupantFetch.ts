// Wire-payload smoke for a web fetch of a FELLOW OCCUPANT's box — `curl http://<a
// player's LAN address>` from the same WiFi. Drives the REAL /api/network endpoint
// (resolveOccupantFetch) against a running `vercel dev` + supabase, seeding two players'
// occupancy rows and LAN leases, and the owner's nginx pidfile and page, via
// service_role (as their joins, `nginx` and a root `nano` would).
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - A neighbour on the WiFi is served the page the owner's box publishes, with no
//     session and no credential, and the program that served it is named.
//   - The visit lands as ONE Apache-combined line in the OWNER's access.log, under the
//     owner's key, from the address the visitor LEASES — the visitor writes no row.
//   - A 404 is answered as one and recorded as readily as a 200.
//   - A web port the owner closed to the network refuses, and leaves no line; a visitor
//     in a shell ON that box is still served its own address, logged from that address.
//   - That shell is served the same page over loopback, logged as a local visit; loopback
//     from a caller at home names nobody's box.
//   - An address nobody leases, and one whose holder has left the WiFi, answer nothing.
//   - A caller on no network, or naming one they do not stand on, is refused.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testOccupantFetch.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { escapeLogField } from '../src/core/logging/escapeLogField.js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { lanAddressFor } from '../src/core/network/lanAddress.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { formatPidfileContent } from '../src/core/services/pidfile.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { RULES_V4_PATH } from '../src/core/network/iptablesRules.js';
import { LOOPBACK_IPV4 } from '../src/core/network/interfaces.js';
import { md5 } from '../src/core/generation/md5.js';

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

const ACCESS_LOG = '/var/log/access.log';
const WEB_PORT = 80;

const readAccessLog = async (machineId: string, writerKey: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', ACCESS_LOG)
    .eq('writer_key', writerKey)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};

const lineCount = (log: string): number => (log.trim() === '' ? 0 : log.trim().split('\n').length);
const lastLine = (log: string): string => log.trim().split('\n').slice(-1)[0] ?? '(empty)';

// --- Two players on one WiFi: the OWNER publishes a page, the VISITOR fetches it. ---
const owner = generateIdentity();
const visitor = generateIdentity();
const stranger = generateIdentity();

const ESSID = 'OCCUPANT-FETCH-WIFI';
const OWNER_WS = computeWorkstationId('nebuchadnezzar', owner.publicKeyHex);
const VISITOR_WS = computeWorkstationId('logos', visitor.publicKeyHex);

/** Octets no generated host occupies, as a lease is only ever issued on one. */
const takenOctets = new Set(
  generateHomeLan(ESSID).hosts.map((host) => Number(host.ip.split('.')[3])),
);
const [OWNER_OCTET, VISITOR_OCTET, VACANT_OCTET] = Array.from(
  { length: 253 },
  (_unused, index) => index + 2,
).filter((octet) => !takenOctets.has(octet));
if (OWNER_OCTET === undefined || VISITOR_OCTET === undefined || VACANT_OCTET === undefined) {
  console.error(`Fewer than three free octets on ${ESSID}'s /24 — pick another ESSID`);
  process.exit(2);
}
const OWNER_LAN = lanAddressFor(ESSID, OWNER_OCTET);
const VISITOR_LAN = lanAddressFor(ESSID, VISITOR_OCTET);

const OWNER_PAGE = '<h1>welcome to nebuchadnezzar</h1>';
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: ['root'] };
const WORLD_READ = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };

const ownerFile = (path: string, content: string, permissions: object) => ({
  machine_id: OWNER_WS,
  path,
  content,
  owner: 'root',
  permissions,
  node_type: 'file',
  writer_key: owner.publicKeyHex,
  updated_at: new Date().toISOString(),
});

const occupant = (
  identity: ReturnType<typeof generateIdentity>,
  machineId: string,
  machineName: string,
) => ({
  essid: ESSID,
  owner_key: identity.publicKeyHex,
  workstation_machine_id: machineId,
  workstation_username: 'player',
  workstation_machine_name: machineName,
  workstation_root_hash: md5('root-secret'),
});

const VISITOR_SHELL = 'occupant-fetch-visitor-shell';

// Clean slate, then seat both players and bring the owner's web server up: a fresh
// workstation serves nothing until `nginx` starts.
await sr.from('sessions').delete().eq('session_id', VISITOR_SHELL);
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('network_lan_leases').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', OWNER_WS);
await sr
  .from('home_network_occupants')
  .insert([
    occupant(owner, OWNER_WS, 'nebuchadnezzar'),
    occupant(visitor, VISITOR_WS, 'logos'),
  ]);
await sr.from('network_lan_leases').insert([
  { essid: ESSID, owner_key: owner.publicKeyHex, octet: OWNER_OCTET },
  { essid: ESSID, owner_key: visitor.publicKeyHex, octet: VISITOR_OCTET },
]);
const seeded = await sr
  .from('patches')
  .insert([
    ownerFile(
      '/var/run/nginx.pid',
      formatPidfileContent(SERVICE_CATALOG.http, WEB_PORT),
      WORLD_READ,
    ),
    ownerFile('/var/www/html/index.html', OWNER_PAGE, ROOT_ONLY),
  ]);
if (seeded.error) {
  console.error(`FATAL: journal seed failed: ${seeded.error.message}`);
  process.exit(1);
}

const fetched = (
  identity: ReturnType<typeof generateIdentity>,
  asked: Record<string, unknown> = {},
) =>
  signRequest(identity, 'resolveOccupantFetch', {
    essid: ESSID,
    target: OWNER_LAN,
    port: WEB_PORT,
    path: '/',
    ...asked,
  });

const errorOf = (body: unknown): string | undefined =>
  (body as { error?: string } | null)?.error;

try {
  // === 1. A neighbour is served the owner's page, and the owner's log records it. ===
  const r1 = await post(await fetched(visitor));
  const page1 = r1.body as { ok?: boolean; content?: string; server?: string } | null;
  check(
    'a neighbour on the WiFi is served the page the owner’s box publishes',
    r1.status === 200 && page1?.content === OWNER_PAGE && page1?.server === 'nginx',
    `status=${r1.status} body=${JSON.stringify(r1.body)}`,
  );
  const log1 = await readAccessLog(OWNER_WS, owner.publicKeyHex);
  check(
    'the OWNER’s access.log records one line from the address the visitor leases',
    lineCount(log1) === 1 &&
      log1.startsWith(`${VISITOR_LAN} - - [`) &&
      log1.includes(`"GET / HTTP/1.1" 200 ${OWNER_PAGE.length}`),
    `line=${lastLine(log1)}`,
  );

  // === 2. A 404 is answered as one, and recorded as readily as the hit. ===
  const r2 = await post(await fetched(visitor, { path: '/admin.php' }));
  const log2 = await readAccessLog(OWNER_WS, owner.publicKeyHex);
  check(
    'a path the box does not publish is a 404, recorded as "404 0" beneath the hit',
    r2.status === 404 &&
      errorOf(r2.body) === 'not_found' &&
      lineCount(log2) === 2 &&
      lastLine(log2).includes('"GET /admin.php HTTP/1.1" 404 0'),
    `status=${r2.status} error=${errorOf(r2.body)} lines=${lineCount(log2)}`,
  );
  check(
    'the visitor wrote no row of their own on the owner’s box',
    (await readAccessLog(OWNER_WS, visitor.publicKeyHex)) === '',
    `visitorRow=${JSON.stringify(await readAccessLog(OWNER_WS, visitor.publicKeyHex))}`,
  );

  // === 3. A port nothing serves the web on refuses, and leaves no line. ===
  const r3 = await post(await fetched(visitor, { port: WEB_PORT + 1 }));
  check(
    'a port the box serves no web on refuses the connection',
    r3.status === 404 &&
      errorOf(r3.body) === 'connection_refused' &&
      lineCount(await readAccessLog(OWNER_WS, owner.publicKeyHex)) === 2,
    `status=${r3.status} error=${errorOf(r3.body)}`,
  );

  // === 4. The owner closes the web port to the network: the neighbour is refused. ===
  const filter = await sr
    .from('patches')
    .insert([ownerFile(RULES_V4_PATH, `deny ${WEB_PORT}`, ROOT_ONLY)]);
  if (filter.error) {
    console.error(`FATAL: filter seed failed: ${filter.error.message}`);
    process.exit(1);
  }
  const r4 = await post(await fetched(visitor));
  check(
    'a web port the owner filtered refuses a neighbour, and leaves no line',
    r4.status === 404 &&
      errorOf(r4.body) === 'connection_refused' &&
      lineCount(await readAccessLog(OWNER_WS, owner.publicKeyHex)) === 2,
    `status=${r4.status} error=${errorOf(r4.body)}`,
  );

  // === 5. A shell ON that box still reaches its own address, logged from that address. ===
  const shell = await sr.from('sessions').insert({
    session_id: VISITOR_SHELL,
    player_key: visitor.publicKeyHex,
    machine_id: OWNER_WS,
    credentials: { username: 'guest', userType: 'guest' },
    kind: 'ssh',
    essid: ESSID,
  });
  if (shell.error) {
    console.error(`FATAL: session seed failed: ${shell.error.message}`);
    process.exit(1);
  }
  const r5 = await post(await fetched(visitor, { caller_machine_id: OWNER_WS }));
  const log5 = await readAccessLog(OWNER_WS, owner.publicKeyHex);
  check(
    'a shell on the box is served its own address past its own filter, logged from that address',
    r5.status === 200 &&
      (r5.body as { content?: string } | null)?.content === OWNER_PAGE &&
      lineCount(log5) === 3 &&
      lastLine(log5).startsWith(`${OWNER_LAN} - - [`),
    `status=${r5.status} lines=${lineCount(log5)} line=${lastLine(log5)}`,
  );

  // === 5b. The same shell over loopback: the same page, recorded as a local visit. ===
  const r5b = await post(
    await fetched(visitor, { target: LOOPBACK_IPV4, caller_machine_id: OWNER_WS }),
  );
  const log5b = await readAccessLog(OWNER_WS, owner.publicKeyHex);
  check(
    'a shell on the box is served the page the box publishes over loopback, logged as local',
    r5b.status === 200 &&
      (r5b.body as { content?: string } | null)?.content === OWNER_PAGE &&
      lineCount(log5b) === 4 &&
      lastLine(log5b).startsWith(`${LOOPBACK_IPV4} - - [`) &&
      (await readAccessLog(OWNER_WS, visitor.publicKeyHex)) === '',
    `status=${r5b.status} lines=${lineCount(log5b)} line=${lastLine(log5b)}`,
  );

  // === 5c. Loopback from a caller at home names nobody's box. ===
  const r5c = await post(await fetched(visitor, { target: LOOPBACK_IPV4 }));
  check(
    'loopback from a caller at home reaches no neighbour, and leaves no line',
    r5c.status === 404 &&
      errorOf(r5c.body) === 'host_unreachable' &&
      lineCount(await readAccessLog(OWNER_WS, owner.publicKeyHex)) === 4,
    `status=${r5c.status} error=${errorOf(r5c.body)}`,
  );
  await sr.from('sessions').delete().eq('session_id', VISITOR_SHELL);
  await sr.from('patches').delete().eq('machine_id', OWNER_WS).eq('path', RULES_V4_PATH);

  // === 6. A box the caller names but holds no shell on is refused. ===
  const r6 = await post(await fetched(visitor, { caller_machine_id: OWNER_WS }));
  check(
    'naming a box the caller holds no shell on is refused',
    r6.status === 403 && errorOf(r6.body) === 'no_session',
    `status=${r6.status} error=${errorOf(r6.body)}`,
  );

  // === 7. The LAN boundary: off the network, or on another, nothing is served. ===
  const r7a = await post(await fetched(stranger));
  const r7b = await post(await fetched(visitor, { essid: 'SOMEWHERE-ELSE-WIFI' }));
  check(
    'a caller on no network, and one naming a network they do not stand on, are refused',
    r7a.status === 403 &&
      errorOf(r7a.body) === 'caller_not_on_network' &&
      r7b.status === 403 &&
      errorOf(r7b.body) === 'wrong_network',
    `stranger=${r7a.status}/${errorOf(r7a.body)} elsewhere=${r7b.status}/${errorOf(r7b.body)}`,
  );

  // === 8. An address nobody leases answers nothing. ===
  const r8 = await post(
    await fetched(visitor, { target: lanAddressFor(ESSID, VACANT_OCTET) }),
  );
  check(
    'an address nobody leases is unreachable',
    r8.status === 404 && errorOf(r8.body) === 'host_unreachable',
    `status=${r8.status} error=${errorOf(r8.body)}`,
  );

  // === 8b. The path is the visitor's own words, written into the owner's evidence, and
  //     asking needs no session at all. A line break in it must not end the line and
  //     start another the visitor wrote whole. ===
  const FORGED = '10.0.0.5 - - [14/Aug/2026:13:50:00 +0000] "GET /admin.php HTTP/1.1" 200 512';
  const before8b = lineCount(await readAccessLog(OWNER_WS, owner.publicKeyHex));
  const r8b = await post(await fetched(visitor, { path: `/missing\n${FORGED}` }));
  const log8b = await readAccessLog(OWNER_WS, owner.publicKeyHex);
  check(
    'a path carrying a line break stays on its one line, adding none of its own',
    r8b.status === 404 &&
      lineCount(log8b) === before8b + 1 &&
      lastLine(log8b).includes(`"GET ${escapeLogField(`/missing\n${FORGED}`)} HTTP/1.1" 404 0`),
    `status=${r8b.status} added=${lineCount(log8b) - before8b} line=${lastLine(log8b)}`,
  );

  // === 9. The owner leaves the WiFi: the lease stands, the box is gone. ===
  await sr
    .from('home_network_occupants')
    .delete()
    .eq('essid', ESSID)
    .eq('owner_key', owner.publicKeyHex);
  const before9 = lineCount(await readAccessLog(OWNER_WS, owner.publicKeyHex));
  const r9 = await post(await fetched(visitor));
  check(
    'an address whose holder has left the WiFi is unreachable, and leaves no line',
    r9.status === 404 &&
      errorOf(r9.body) === 'host_unreachable' &&
      lineCount(await readAccessLog(OWNER_WS, owner.publicKeyHex)) === before9,
    `status=${r9.status} error=${errorOf(r9.body)}`,
  );
} finally {
  await sr.from('sessions').delete().eq('session_id', VISITOR_SHELL);
}

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
