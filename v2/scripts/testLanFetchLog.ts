// Wire-payload smoke for the own-LAN access log — an own-LAN `curl` leaves a truthful
// /var/log/access.log line on the box that SERVED it, whether that box is a generated
// sibling or the player's own workstation. Drives the REAL /api/patches endpoint
// (recordLanFetch) against a running `vercel dev` + supabase, seeding the player's
// occupancy row, LAN lease, and their workstation's nginx pidfile via service_role (as
// their join + `nginx` would).
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `curl http://<a generated LAN host>` → ONE Apache-combined line on THAT host's
//     access.log, keyed by the CALLER's writer_key (a generated host has no owner, so
//     its log is per-viewer).
//   - `curl http://<own LAN IP>` → the line lands on the player's OWN workstation,
//     readable straight away — the server resolves "that address is mine" from the
//     lease, never from anything the client claimed.
//   - A 404 is recorded as readily as a 200, and a traversal is recorded VERBATIM.
//   - A target that is not serving leaves no line at all.
//   - A client-supplied machine_id / status / size is ignored: the server resolves the
//     machine and reads the page itself.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testLanFetchLog.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { lanAddressFor } from '../src/core/network/lanAddress';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan';
import { buildRemoteHostFs } from '../src/core/generation/remoteHostFs';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity';
import { readOpenPorts, formatPidfileContent } from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { md5 } from '../src/core/generation/md5';

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

/** Read a machine's access.log row keyed by the CALLER — on this path the writer is
 *  always the fetcher, both on a generated host and on their own box. */
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
  path: string,
  over: Record<string, unknown> = {},
) => signRequest(player, 'recordLanFetch', { essid: ESSID, target, port, path, source_ip: PLAYER_LAN, ...over });

// === 1. A fetch of a generated LAN host lands on THAT host, keyed by the fetcher. ===
const r1 = await post(PATCHES, await fetched(serving.ip, SERVING_PORT, '/'));
const host1 = await readAccessLog(SERVING_ID, player.publicKeyHex);
check('a fetch of a serving LAN host is accepted', r1.status === 200, `status=${r1.status}`);
check(
  'the SERVING host records one Apache-combined line from the fetcher’s LAN IP',
  lineCount(host1) === 1 && host1.includes(`${PLAYER_LAN} - - [`) && host1.includes('" 200 '),
  `line=${lastLine(host1)}`,
);

// === 2. A self-fetch lands on the player's OWN workstation, not on a generated host. ===
const r2 = await post(PATCHES, await fetched(PLAYER_LAN, 80, '/'));
const own2 = await readAccessLog(WS, player.publicKeyHex);
check(
  'a fetch of the player’s OWN leased address records on their WORKSTATION',
  r2.status === 200 && lineCount(own2) === 1 && own2.includes(`${PLAYER_LAN} - - [`),
  `status=${r2.status} line=${lastLine(own2)}`,
);
check(
  'the self-fetch did NOT also land on the generated host that fetch 1 touched',
  lineCount(await readAccessLog(SERVING_ID, player.publicKeyHex)) === 1,
  `servingHostLines=${lineCount(await readAccessLog(SERVING_ID, player.publicKeyHex))}`,
);

// === 3. A 404 is recorded as readily as a 200, and a traversal VERBATIM. ===
await post(PATCHES, await fetched(serving.ip, SERVING_PORT, '/wp-admin/setup-config.php'));
await post(PATCHES, await fetched(serving.ip, SERVING_PORT, '/../../etc/passwd'));
const host3 = await readAccessLog(SERVING_ID, player.publicKeyHex);
check(
  'a miss is recorded as "404 0", and the traversal is recorded exactly as it was asked for',
  host3.includes('"GET /wp-admin/setup-config.php HTTP/1.1" 404 0') &&
    host3.includes('"GET /../../etc/passwd HTTP/1.1" 404 0'),
  `lines=${lineCount(host3)}`,
);
check(
  'the lines accrete into ONE row rather than replacing each other',
  lineCount(host3) === 3,
  `expected=3 actual=${lineCount(host3)}`,
);

// === 4. A target that answered nothing leaves no line. ===
const r4a = await post(PATCHES, await fetched(silent.ip, 80, '/'));
const r4b = await post(PATCHES, await fetched(serving.ip, SERVING_PORT + 1, '/'));
check(
  'a non-serving host and a port nothing listens on both leave no line',
  r4a.status === 200 &&
    r4b.status === 200 &&
    (await readAccessLog(SILENT_ID, player.publicKeyHex)) === '' &&
    lineCount(await readAccessLog(SERVING_ID, player.publicKeyHex)) === 3,
  `silentLog=${JSON.stringify(await readAccessLog(SILENT_ID, player.publicKeyHex))}`,
);

// === 5. The client dictates nothing: machine, status and size are the server's. ===
const before5 = lineCount(await readAccessLog(SERVING_ID, player.publicKeyHex));
const r5 = await post(
  PATCHES,
  await fetched(serving.ip, SERVING_PORT, '/', {
    machine_id: FORGED_MACHINE,
    status: 500,
    size: 999999,
  }),
);
const host5 = await readAccessLog(SERVING_ID, player.publicKeyHex);
const forged5 = await readAccessLog(FORGED_MACHINE, player.publicKeyHex);
check(
  'a client-supplied machine_id, status and size are all ignored',
  r5.status === 200 &&
    lineCount(host5) === before5 + 1 &&
    forged5 === '' &&
    !lastLine(host5).includes('500') &&
    !lastLine(host5).includes('999999'),
  `line=${lastLine(host5)} forgedRowEmpty=${forged5 === ''}`,
);

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
