// Wire-payload smoke for the own-box access log — a `curl`, and a `gobuster` sweep, of
// the player's own workstation leave truthful /var/log/access.log lines on it. Drives
// the REAL /api/patches endpoint (recordLanFetch) against a running `vercel dev` +
// supabase, seeding the player's occupancy row, LAN lease, and their workstation's nginx
// pidfile via service_role (as their join + `nginx` would).
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `curl http://<own LAN IP>` → the line lands on the player's OWN workstation,
//     readable straight away — the server resolves "that address is mine" from the
//     lease, never from anything the client claimed.
//   - A report naming a generated LAN host leaves no line: the server serves that box
//     and records the visit as it does (`testLanWebServed.ts`).
//   - A 404 is recorded as readily as a 200, and a traversal is recorded VERBATIM.
//   - A port nothing listens on leaves no line at all.
//   - A client-supplied machine_id / status / size is ignored: the server resolves the
//     machine and reads the page itself.
//   - A SWEEP of many paths lands as ONE append — a line per probe in the order asked,
//     every line stamped with the single moment the request arrived — and a sweep that
//     names no path at all is refused rather than recorded as a visit.
//   - A trace reported from a shell on ANOTHER player's workstation, by loopback or by
//     the box's own LAN address, leaves no line: the server serves that box and records
//     the visit itself (`testOccupantFetch.ts`, `testOccupantSweep.ts`).
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testLanFetchLog.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { lanAddressFor } from '../src/core/network/lanAddress.js';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan.js';
import { buildRemoteHostFs } from '../src/core/generation/remoteHostFs.js';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity.js';
import { readOpenPorts, formatPidfileContent } from '../src/core/services/pidfile.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { md5 } from '../src/core/generation/md5.js';

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

const ACCESS_LOG = '/var/log/access.log';

/** Read a machine's access.log row under one writer: the NETWORK on a generated host,
 *  which every occupant shares, and the fetcher on their own box, which they own. */
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

// --- The player, their LAN, and the two boxes a fetch can land on. ---
const player = generateIdentity();

// Chosen because its generated LAN rolls BOTH serving and non-serving hosts (8 NPC
// machines, 3 of them web) — the pair every check below needs.
const ESSID = 'FETCH-LOG-WIFI';
/** Whose row a generated host's access.log lands in — the network's, never a fetcher's. */
const NETWORK_KEY = apGatewayLogWriterKey(ESSID);
const WS_NAME = 'nebuchadnezzar';
const WS = computeWorkstationId(WS_NAME, player.publicKeyHex);

/** An octet no generated host occupies — the player's lease has to sit somewhere the
 *  LAN generator did not already put a box. */
const lan = generateHomeLan(ESSID);
const takenOctets = new Set(lan.hosts.map((host) => Number(host.ip.split('.')[3])));
const PLAYER_OCTET = Array.from({ length: 253 }, (_unused, index) => index + 2).find(
  (octet) => !takenOctets.has(octet),
);
if (PLAYER_OCTET === undefined) {
  console.error(`No free octet on ${ESSID}'s /24 — pick another ESSID`);
  process.exit(2);
}
const PLAYER_LAN = lanAddressFor(ESSID, PLAYER_OCTET);

const httpPortOf = (host: LanHost): number | null => {
  const open = readOpenPorts(buildRemoteHostFs(ESSID, host)).find(
    (entry) => entry.service === SERVICE_CATALOG.http.service,
  );
  return open === undefined ? null : open.port;
};

const serving = lan.hosts.find((host) => host.kind === 'machine' && httpPortOf(host) !== null);
const silent = lan.hosts.find((host) => host.kind === 'machine' && httpPortOf(host) === null);
if (serving === undefined || silent === undefined) {
  console.error(`${ESSID} generated no serving/non-serving pair — pick another ESSID`);
  process.exit(2);
}
const SERVING_PORT = httpPortOf(serving)!;
const SERVING_ID = resolveLanHostIdentity(serving, ESSID).machineId;
const SILENT_ID = resolveLanHostIdentity(silent, ESSID).machineId;

const WORLD_PID = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };
const FORGED_MACHINE = 'somebody-elses-box';

// Clean slate, then seed the player's occupancy + lease and their workstation's nginx
// pidfile (a fresh ws serves nothing — it is dark on :80 until `nginx` starts).
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('network_lan_leases').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', WS);
await sr.from('patches').delete().eq('machine_id', SERVING_ID);
await sr.from('patches').delete().eq('machine_id', SILENT_ID);
await sr.from('home_network_occupants').insert([
  {
    essid: ESSID,
    owner_key: player.publicKeyHex,
    workstation_machine_id: WS,
    workstation_username: 'player',
    workstation_machine_name: WS_NAME,
    workstation_root_hash: md5('root-secret'),
  },
]);
await sr
  .from('network_lan_leases')
  .insert([{ essid: ESSID, owner_key: player.publicKeyHex, octet: PLAYER_OCTET }]);
await sr.from('patches').insert([
  {
    machine_id: WS,
    path: '/var/run/nginx.pid',
    content: formatPidfileContent(SERVICE_CATALOG.http, 80),
    owner: 'root',
    permissions: WORLD_PID,
    node_type: 'file',
    writer_key: player.publicKeyHex,
    updated_at: new Date().toISOString(),
  },
]);

const fetched = (
  target: string,
  port: number,
  paths: readonly string[],
  over: Record<string, unknown> = {},
) =>
  signRequest(player, 'recordLanFetch', {
    essid: ESSID,
    target,
    port,
    paths,
    source_ip: PLAYER_LAN,
    ...over,
  });

// === 1. A report naming a generated LAN host leaves no line: the server records that
//        visit when it serves the page, so a line here would be a second one. ===
const r1 = await post(PATCHES, await fetched(serving.ip, SERVING_PORT, ['/']));
check(
  'a report naming a generated LAN host is answered and leaves no line on it',
  r1.status === 200 && (await readAccessLog(SERVING_ID, NETWORK_KEY)) === '',
  `status=${r1.status} log=${JSON.stringify(await readAccessLog(SERVING_ID, NETWORK_KEY))}`,
);

/** The player's own box's access.log, which every check below lands on. */
const ownLog = () => readAccessLog(WS, player.publicKeyHex);

// === 2. A self-fetch lands on the player's OWN workstation. ===
const r2 = await post(PATCHES, await fetched(PLAYER_LAN, 80, ['/']));
const own2 = await ownLog();
check(
  'a fetch of the player’s OWN leased address records on their WORKSTATION',
  r2.status === 200 && lineCount(own2) === 1 && own2.includes(`${PLAYER_LAN} - - [`),
  `status=${r2.status} line=${lastLine(own2)}`,
);

// === 3. A 404 is recorded as readily as a 200, and a traversal VERBATIM. ===
await post(PATCHES, await fetched(PLAYER_LAN, 80, ['/wp-admin/setup-config.php']));
await post(PATCHES, await fetched(PLAYER_LAN, 80, ['/../../etc/passwd']));
const own3 = await ownLog();
check(
  'a miss is recorded as "404 0", and the traversal is recorded exactly as it was asked for',
  own3.includes('"GET /wp-admin/setup-config.php HTTP/1.1" 404 0') &&
    own3.includes('"GET /../../etc/passwd HTTP/1.1" 404 0'),
  `lines=${lineCount(own3)}`,
);
check(
  'the lines accrete into ONE row rather than replacing each other',
  lineCount(own3) === 3,
  `expected=3 actual=${lineCount(own3)}`,
);

// === 4. A port nothing listens on leaves no line. ===
const r4 = await post(PATCHES, await fetched(PLAYER_LAN, 81, ['/']));
check(
  'a port the web server is not on leaves no line',
  r4.status === 200 && lineCount(await ownLog()) === 3,
  `lines=${lineCount(await ownLog())}`,
);

// === 5. The client dictates nothing: machine, status and size are the server's. ===
const r5 = await post(
  PATCHES,
  await fetched(PLAYER_LAN, 80, ['/'], {
    machine_id: FORGED_MACHINE,
    status: 500,
    size: 999999,
  }),
);
const own5 = await ownLog();
const forged5 = await readAccessLog(FORGED_MACHINE, player.publicKeyHex);
check(
  'a client-supplied machine_id, status and size are all ignored',
  r5.status === 200 &&
    lineCount(own5) === 4 &&
    forged5 === '' &&
    !lastLine(own5).includes('500') &&
    !lastLine(own5).includes('999999'),
  `line=${lastLine(own5)} forgedRowEmpty=${forged5 === ''}`,
);

// === 6. A path SWEEP lands as one append: a line per probe, in the order asked. ===
const before6 = lineCount(await ownLog());
const r6 = await post(PATCHES, await fetched(PLAYER_LAN, 80, ['/admin', '/', '/backup']));
const swept = (await ownLog()).trim().split('\n').slice(before6);
check(
  'a sweep records every probe, hits and misses alike, in the order it asked',
  r6.status === 200 &&
    swept.length === 3 &&
    swept[0]!.includes('"GET /admin HTTP/1.1" 404 0') &&
    swept[1]!.includes('"GET / HTTP/1.1" 200 ') &&
    swept[2]!.includes('"GET /backup HTTP/1.1" 404 0'),
  `status=${r6.status} added=${swept.length} lines=${JSON.stringify(swept)}`,
);
check(
  'the whole sweep shares one arrival time — the server read its clock once',
  new Set(swept.map((line) => line.slice(line.indexOf('['), line.indexOf(']') + 1))).size === 1,
  `stamps=${JSON.stringify(swept.map((line) => line.slice(line.indexOf('['), line.indexOf(']') + 1)))}`,
);

// === 7. A sweep that names no path at all is refused, and writes nothing. ===
const before7 = lineCount(await ownLog());
const r7 = await post(PATCHES, await fetched(PLAYER_LAN, 80, []));
check(
  'an empty path list is refused rather than recorded as a visit',
  r7.status === 400 && lineCount(await ownLog()) === before7,
  `status=${r7.status} body=${JSON.stringify(r7.body)}`,
);

// === 10. A trace from a shell on ANOTHER player's workstation leaves no line there. ===
// The server serves that box to the shell and records the visit as it does, so this
// action is never the one asked. The visitor lives nowhere; what puts them on the network
// is the shell they hold on the player's workstation, seeded as their `ssh` login would
// leave it.
const visitor = generateIdentity();
const VISITOR_SHELL = 'fetch-log-visitor-shell';
await sr.from('sessions').delete().eq('session_id', VISITOR_SHELL);
const visitorShell = await sr.from('sessions').insert({
  session_id: VISITOR_SHELL,
  player_key: visitor.publicKeyHex,
  machine_id: WS,
  credentials: { username: 'guest', userType: 'guest' },
  kind: 'ssh',
  essid: ESSID,
});
if (visitorShell.error) {
  console.error(`FATAL: session seed failed: ${visitorShell.error.message}`);
  process.exit(1);
}
const fetchedByVisitor = (target: string) =>
  signRequest(visitor, 'recordLanFetch', {
    essid: ESSID,
    target,
    port: 80,
    paths: ['/'],
    caller_machine_id: WS,
  });

try {
  const before10 = lineCount(await readAccessLog(WS, player.publicKeyHex));
  const r10 = await post(PATCHES, await fetchedByVisitor('127.0.0.1'));
  const own10 = await readAccessLog(WS, player.publicKeyHex);
  check(
    'a loopback trace from a shell on another player’s workstation leaves no line in the owner’s log',
    r10.status === 200 && lineCount(own10) === before10,
    `status=${r10.status} before=${before10} after=${lineCount(own10)} line=${lastLine(own10)}`,
  );

  // === 11. The same box by the address it holds on the LAN, from the same shell. ===
  const r11 = await post(PATCHES, await fetchedByVisitor(PLAYER_LAN));
  const own11 = await readAccessLog(WS, player.publicKeyHex);
  check(
    'a trace of that workstation by its own LAN address from the shell on it leaves no line either',
    r11.status === 200 && lineCount(own11) === before10,
    `status=${r11.status} after=${lineCount(own11)} line=${lastLine(own11)}`,
  );
  check(
    'the visitor’s requests wrote no row of their own on that box',
    (await readAccessLog(WS, visitor.publicKeyHex)) === '',
    `visitorRow=${JSON.stringify(await readAccessLog(WS, visitor.publicKeyHex))}`,
  );
} finally {
  await sr.from('sessions').delete().eq('session_id', VISITOR_SHELL);
}

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
