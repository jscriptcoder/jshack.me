// Wire-payload smoke for a path sweep of a FELLOW OCCUPANT's box — `gobuster http://<a
// player's LAN address>` from the same WiFi. Drives the REAL /api/network endpoint
// (resolveOccupantSweep) against a running `vercel dev` + supabase, seeding two players'
// occupancy rows and LAN leases, the owner's nginx pidfile and pages, and the visitor's
// path list, via service_role (as their joins, `nginx`, a root `nano` and
// `apt install gobuster` would).
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - A neighbour on the WiFi sweeps the owner's box with no session and no credential,
//     and is told what each word found: sizes, never pages.
//   - THE LIST NEVER CROSSES THE WIRE. The server reads it off the journal of the box the
//     caller named, so words sent in the request are not asked with.
//   - The whole run lands as ONE append in the OWNER's access.log, under the owner's
//     key, from the address the visitor LEASES — the visitor writes no row.
//   - A box with no list is reported as that, and the swept box hears nothing.
//   - A web port the owner closed to the network refuses; a visitor in a shell ON that
//     box sweeps its own address with THAT box's list, logged from that address.
//   - An address nobody leases answers nothing; a caller on no network, or naming a box
//     they hold no shell on, is refused.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testOccupantSweep.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { lanAddressFor } from '../src/core/network/lanAddress.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { formatPidfileContent } from '../src/core/services/pidfile.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { RULES_V4_PATH } from '../src/core/network/iptablesRules.js';
import { DIRLIST_PATH } from '../src/core/network/defaultDirlist.js';
import { ACCESS_LOG_PATH } from '../src/core/logging/accessLog.js';
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

const WEB_PORT = 80;

const readAccessLog = async (machineId: string, writerKey: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', ACCESS_LOG_PATH)
    .eq('writer_key', writerKey)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};

const linesOf = (log: string): readonly string[] => (log.trim() === '' ? [] : log.trim().split('\n'));

// --- Two players on one WiFi: the OWNER publishes, the VISITOR sweeps. ---
const owner = generateIdentity();
const visitor = generateIdentity();
const stranger = generateIdentity();

const ESSID = 'OCCUPANT-SWEEP-WIFI';
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

const OWNER_INDEX = '<h1>welcome to nebuchadnezzar</h1>';
const OWNER_STAGING = 'staging notes nobody linked';
/** The visitor's list: a file, a directory holding an index, and a word naming nothing. */
const VISITOR_WORDS = ['index.html', 'staging-notes', 'admin'];
/** The list on the owner's own box: what a shell there sweeps with. */
const OWNER_WORDS = ['index.html'];

const ROOT_ONLY = { read: ['root'], write: ['root'], execute: ['root'] };
const WORLD_READ = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };

const fileOn = (
  machineId: string,
  writerKey: string,
  path: string,
  content: string | null,
  permissions: object,
  nodeType: 'file' | 'directory' = 'file',
) => ({
  machine_id: machineId,
  path,
  content,
  owner: 'root',
  permissions,
  node_type: nodeType,
  writer_key: writerKey,
  updated_at: new Date().toISOString(),
});

const ownerFile = (path: string, content: string, permissions: object) =>
  fileOn(OWNER_WS, owner.publicKeyHex, path, content, permissions);

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

const VISITOR_SHELL = 'occupant-sweep-visitor-shell';

// Clean slate, then seat both players, bring the owner's web server up with two pages,
// and put a path list on each box.
await sr.from('sessions').delete().eq('session_id', VISITOR_SHELL);
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('network_lan_leases').delete().eq('essid', ESSID);
await sr.from('patches').delete().in('machine_id', [OWNER_WS, VISITOR_WS]);
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
const seeded = await sr.from('patches').insert([
  ownerFile('/var/run/nginx.pid', formatPidfileContent(SERVICE_CATALOG.http, WEB_PORT), WORLD_READ),
  ownerFile('/var/www/html/index.html', OWNER_INDEX, ROOT_ONLY),
  fileOn(OWNER_WS, owner.publicKeyHex, '/var/www/html/staging-notes', null, ROOT_ONLY, 'directory'),
  ownerFile('/var/www/html/staging-notes/index.html', OWNER_STAGING, ROOT_ONLY),
  ownerFile(DIRLIST_PATH, `${OWNER_WORDS.join('\n')}\n`, WORLD_READ),
  fileOn(
    VISITOR_WS,
    visitor.publicKeyHex,
    DIRLIST_PATH,
    `${VISITOR_WORDS.join('\n')}\n`,
    WORLD_READ,
  ),
]);
if (seeded.error) {
  console.error(`FATAL: journal seed failed: ${seeded.error.message}`);
  process.exit(1);
}

const sweep = (identity: ReturnType<typeof generateIdentity>, asked: Record<string, unknown> = {}) =>
  signRequest(identity, 'resolveOccupantSweep', {
    essid: ESSID,
    target: OWNER_LAN,
    port: WEB_PORT,
    caller_machine_id: VISITOR_WS,
    ...asked,
  });

type Swept = { readonly path: string; readonly status: number; readonly size: number };
const resultsOf = (body: unknown): readonly Swept[] =>
  (body as { results?: readonly Swept[] } | null)?.results ?? [];
const dirlistFoundOf = (body: unknown): boolean | undefined =>
  (body as { dirlistFound?: boolean } | null)?.dirlistFound;
const errorOf = (body: unknown): string | undefined =>
  (body as { error?: string } | null)?.error;

try {
  // === 1. A neighbour sweeps the owner's box with the list on their own. ===
  // Words sent along with the request are not asked with: `secret` names nothing on the
  // visitor's list, so it must not come back.
  const r1 = await post(await sweep(visitor, { words: ['secret'] }));
  const found1 = resultsOf(r1.body);
  check(
    'a neighbour on the WiFi is told what each word on THEIR list found, in list order',
    r1.status === 200 &&
      dirlistFoundOf(r1.body) === true &&
      JSON.stringify(found1) ===
        JSON.stringify([
          { path: '/index.html', status: 200, size: OWNER_INDEX.length },
          { path: '/staging-notes/', status: 200, size: OWNER_STAGING.length },
          { path: '/admin', status: 404, size: 0 },
        ]),
    `status=${r1.status} results=${JSON.stringify(found1)}`,
  );
  check(
    'the answer carries sizes and never a page',
    !JSON.stringify(r1.body).includes(OWNER_STAGING),
    `body=${JSON.stringify(r1.body)}`,
  );

  // === 2. The owner's log holds the whole run as one append from the visitor's lease. ===
  const log1 = linesOf(await readAccessLog(OWNER_WS, owner.publicKeyHex));
  const stamps = new Set(log1.map((line) => line.slice(line.indexOf('['), line.indexOf(']') + 1)));
  check(
    'the OWNER’s access.log records every request the run cost, under one stamp',
    log1.length === 4 &&
      stamps.size === 1 &&
      log1[0]?.includes(`"GET /index.html HTTP/1.1" 200 ${OWNER_INDEX.length}`) === true &&
      log1[1]?.includes('"GET /staging-notes HTTP/1.1" 404 0') === true &&
      log1[2]?.includes(`"GET /staging-notes/ HTTP/1.1" 200 ${OWNER_STAGING.length}`) === true &&
      log1[3]?.includes('"GET /admin HTTP/1.1" 404 0') === true,
    `lines=${JSON.stringify(log1)}`,
  );
  check(
    'every line is from the address the visitor leases, and the visitor wrote no row',
    log1.every((line) => line.startsWith(`${VISITOR_LAN} - - [`)) &&
      (await readAccessLog(OWNER_WS, visitor.publicKeyHex)) === '',
    `first=${log1[0] ?? '(empty)'}`,
  );

  // === 3. A port nothing serves the web on refuses, and the box hears nothing. ===
  const r3 = await post(await sweep(visitor, { port: WEB_PORT + 1 }));
  check(
    'a port the box serves no web on refuses the sweep',
    r3.status === 404 &&
      errorOf(r3.body) === 'connection_refused' &&
      linesOf(await readAccessLog(OWNER_WS, owner.publicKeyHex)).length === 4,
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
  const r4 = await post(await sweep(visitor));
  check(
    'a web port the owner filtered refuses a neighbour, and the box hears nothing',
    r4.status === 404 &&
      errorOf(r4.body) === 'connection_refused' &&
      linesOf(await readAccessLog(OWNER_WS, owner.publicKeyHex)).length === 4,
    `status=${r4.status} error=${errorOf(r4.body)}`,
  );

  // === 5. A shell ON that box sweeps its own address, with THAT box's list. ===
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
  const r5 = await post(await sweep(visitor, { caller_machine_id: OWNER_WS }));
  const log5 = linesOf(await readAccessLog(OWNER_WS, owner.publicKeyHex));
  check(
    'a shell on the box sweeps past its own filter with the list on THAT box, logged from its address',
    r5.status === 200 &&
      JSON.stringify(resultsOf(r5.body)) ===
        JSON.stringify([{ path: '/index.html', status: 200, size: OWNER_INDEX.length }]) &&
      log5.length === 5 &&
      log5[4]?.startsWith(`${OWNER_LAN} - - [`) === true,
    `status=${r5.status} results=${JSON.stringify(resultsOf(r5.body))} last=${log5[4] ?? '(none)'}`,
  );
  await sr.from('sessions').delete().eq('session_id', VISITOR_SHELL);
  await sr.from('patches').delete().eq('machine_id', OWNER_WS).eq('path', RULES_V4_PATH);

  // === 6. A box the caller names but holds no shell on is refused: no borrowed list. ===
  const r6 = await post(await sweep(visitor, { caller_machine_id: OWNER_WS }));
  check(
    'naming a box the caller holds no shell on is refused',
    r6.status === 403 && errorOf(r6.body) === 'no_session',
    `status=${r6.status} error=${errorOf(r6.body)}`,
  );

  // === 7. The LAN boundary: off the network, or on another, nothing is swept. ===
  const STRANGER_WS = computeWorkstationId('osiris', stranger.publicKeyHex);
  const r7a = await post(await sweep(stranger, { caller_machine_id: STRANGER_WS }));
  const r7b = await post(await sweep(visitor, { essid: 'SOMEWHERE-ELSE-WIFI' }));
  check(
    'a caller on no network, and one naming a network they do not stand on, are refused',
    r7a.status === 403 &&
      errorOf(r7a.body) === 'caller_not_on_network' &&
      r7b.status === 403 &&
      errorOf(r7b.body) === 'wrong_network',
    `stranger=${r7a.status}/${errorOf(r7a.body)} elsewhere=${r7b.status}/${errorOf(r7b.body)}`,
  );

  // === 8. An address nobody leases answers nothing. ===
  const r8 = await post(await sweep(visitor, { target: lanAddressFor(ESSID, VACANT_OCTET) }));
  check(
    'an address nobody leases is unreachable',
    r8.status === 404 && errorOf(r8.body) === 'host_unreachable',
    `status=${r8.status} error=${errorOf(r8.body)}`,
  );

  // === 9. A box with no list is told so, and the swept box hears nothing. ===
  await sr.from('patches').delete().eq('machine_id', VISITOR_WS).eq('path', DIRLIST_PATH);
  const before9 = linesOf(await readAccessLog(OWNER_WS, owner.publicKeyHex)).length;
  const r9 = await post(await sweep(visitor));
  check(
    'a caller whose box holds no list is told so, and the swept box hears nothing',
    r9.status === 200 &&
      dirlistFoundOf(r9.body) === false &&
      resultsOf(r9.body).length === 0 &&
      linesOf(await readAccessLog(OWNER_WS, owner.publicKeyHex)).length === before9,
    `status=${r9.status} dirlistFound=${dirlistFoundOf(r9.body)}`,
  );
} finally {
  await sr.from('sessions').delete().eq('session_id', VISITOR_SHELL);
}

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
