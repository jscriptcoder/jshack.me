// Wire-payload smoke for the own-LAN access log — an own-LAN `curl`, and a `gobuster`
// sweep, leave truthful /var/log/access.log lines on the box that SERVED them, whether
// that box is a generated sibling or the player's own workstation. Drives the REAL
// /api/patches endpoint (recordLanFetch) against a running `vercel dev` + supabase,
// seeding the player's occupancy row, LAN lease, and their workstation's nginx pidfile
// via service_role (as their join + `nginx` would).
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `curl http://<a generated LAN host>` → ONE Apache-combined line on THAT host's
//     access.log, keyed by the NETWORK's own key (a generated host has no owner, and every
//     occupant of the WiFi fetches from the identical box).
//   - `curl http://<own LAN IP>` → the line lands on the player's OWN workstation,
//     readable straight away — the server resolves "that address is mine" from the
//     lease, never from anything the client claimed.
//   - A 404 is recorded as readily as a 200, and a traversal is recorded VERBATIM.
//   - A target that is not serving leaves no line at all.
//   - A client-supplied machine_id / status / size is ignored: the server resolves the
//     machine and reads the page itself.
//   - A SWEEP of many paths lands as ONE append — a line per probe in the order asked,
//     every line stamped with the single moment the request arrived — and a sweep that
//     names no path at all is refused rather than recorded as a visit.
//   - `curl localhost` in a shell on a box on a DEEP layer lands on that box, as a local
//     visit, and a switch in front of the layer denying the web port does not stop it:
//     the request never leaves the box to cross the switch.
//   - `curl localhost`, or the box's own LAN address, in a shell on ANOTHER player's
//     workstation lands on that workstation, in its owner's log — the visitor writes no
//     row of their own there.
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
import { crackableEssidPool } from '../src/core/generation/generateWifi.js';
import { generateDeepLayer } from '../src/core/generation/generateDeepLayer.js';
import { buildDeepHostFs } from '../src/core/generation/deepHostFs.js';
import { chainLinks } from '../src/core/generation/lanTopology.js';
import { hostMachineId } from '../src/core/generation/remoteHostId.js';

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

// === 1. A fetch of a generated LAN host lands on THAT host, keyed by its network. ===
const r1 = await post(PATCHES, await fetched(serving.ip, SERVING_PORT, ['/']));
const host1 = await readAccessLog(SERVING_ID, NETWORK_KEY);
check('a fetch of a serving LAN host is accepted', r1.status === 200, `status=${r1.status}`);
check(
  'the SERVING host records one Apache-combined line from the fetcher’s LAN IP',
  lineCount(host1) === 1 && host1.includes(`${PLAYER_LAN} - - [`) && host1.includes('" 200 '),
  `line=${lastLine(host1)}`,
);

// === 2. A self-fetch lands on the player's OWN workstation, not on a generated host. ===
const r2 = await post(PATCHES, await fetched(PLAYER_LAN, 80, ['/']));
const own2 = await readAccessLog(WS, player.publicKeyHex);
check(
  'a fetch of the player’s OWN leased address records on their WORKSTATION',
  r2.status === 200 && lineCount(own2) === 1 && own2.includes(`${PLAYER_LAN} - - [`),
  `status=${r2.status} line=${lastLine(own2)}`,
);
check(
  'the self-fetch did NOT also land on the generated host that fetch 1 touched',
  lineCount(await readAccessLog(SERVING_ID, NETWORK_KEY)) === 1,
  `servingHostLines=${lineCount(await readAccessLog(SERVING_ID, NETWORK_KEY))}`,
);

// === 3. A 404 is recorded as readily as a 200, and a traversal VERBATIM. ===
await post(PATCHES, await fetched(serving.ip, SERVING_PORT, ['/wp-admin/setup-config.php']));
await post(PATCHES, await fetched(serving.ip, SERVING_PORT, ['/../../etc/passwd']));
const host3 = await readAccessLog(SERVING_ID, NETWORK_KEY);
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
const r4a = await post(PATCHES, await fetched(silent.ip, 80, ['/']));
const r4b = await post(PATCHES, await fetched(serving.ip, SERVING_PORT + 1, ['/']));
check(
  'a non-serving host and a port nothing listens on both leave no line',
  r4a.status === 200 &&
    r4b.status === 200 &&
    (await readAccessLog(SILENT_ID, NETWORK_KEY)) === '' &&
    lineCount(await readAccessLog(SERVING_ID, NETWORK_KEY)) === 3,
  `silentLog=${JSON.stringify(await readAccessLog(SILENT_ID, NETWORK_KEY))}`,
);

// === 5. The client dictates nothing: machine, status and size are the server's. ===
const before5 = lineCount(await readAccessLog(SERVING_ID, NETWORK_KEY));
const r5 = await post(
  PATCHES,
  await fetched(serving.ip, SERVING_PORT, ['/'], {
    machine_id: FORGED_MACHINE,
    status: 500,
    size: 999999,
  }),
);
const host5 = await readAccessLog(SERVING_ID, NETWORK_KEY);
const forged5 = await readAccessLog(FORGED_MACHINE, NETWORK_KEY);
check(
  'a client-supplied machine_id, status and size are all ignored',
  r5.status === 200 &&
    lineCount(host5) === before5 + 1 &&
    forged5 === '' &&
    !lastLine(host5).includes('500') &&
    !lastLine(host5).includes('999999'),
  `line=${lastLine(host5)} forgedRowEmpty=${forged5 === ''}`,
);

// === 6. A path SWEEP lands as one append: a line per probe, in the order asked. ===
const before6 = lineCount(await readAccessLog(SERVING_ID, NETWORK_KEY));
const r6 = await post(PATCHES, await fetched(serving.ip, SERVING_PORT, ['/admin', '/', '/backup']));
const host6 = await readAccessLog(SERVING_ID, NETWORK_KEY);
const swept = host6.trim().split('\n').slice(before6);
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
const before7 = lineCount(await readAccessLog(SERVING_ID, NETWORK_KEY));
const r7 = await post(PATCHES, await fetched(serving.ip, SERVING_PORT, []));
check(
  'an empty path list is refused rather than recorded as a visit',
  r7.status === 400 &&
    lineCount(await readAccessLog(SERVING_ID, NETWORK_KEY)) === before7,
  `status=${r7.status} body=${JSON.stringify(r7.body)}`,
);

// === 8. `curl localhost` on a box on a deep layer lands on THAT box, as a local visit. ===
// A switch-fronted layer, so the same box also carries the case where the switch denies
// the web port. The player holds a shell there, seeded as their `ssh` login would leave it.
const deepWeb = crackableEssidPool
  .flatMap((essid) =>
    chainLinks(essid)
      .filter((link) => link.host.kind === 'switch')
      .map((link) => {
        const { host } = generateDeepLayer(
          essid,
          { machineId: link.machineId, kind: link.host.kind },
          { hangsChild: link.hangsChild },
        );
        const web = readOpenPorts(buildDeepHostFs(essid, host)).find(
          (entry) => entry.service === SERVICE_CATALOG.http.service,
        );
        return { essid, switchId: link.machineId, host, port: web?.port ?? null };
      }),
  )
  .find((candidate) => candidate.port !== null);
if (deepWeb === undefined || deepWeb.port === null) {
  console.error('no network in the crackable pool has a web box behind a switch');
  process.exit(2);
}
const DEEP_ESSID = deepWeb.essid;
const DEEP_PORT = deepWeb.port;
const DEEP_ID = hostMachineId(deepWeb.host, DEEP_ESSID);
const DEEP_KEY = apGatewayLogWriterKey(DEEP_ESSID);
const ACL_PATH = '/etc/switch/acl.conf';
const DEEP_SHELL = 'fetch-log-deep-shell';

const cleanDeep = async () => {
  await sr.from('patches').delete().eq('machine_id', DEEP_ID).eq('path', ACCESS_LOG);
  await sr.from('patches').delete().eq('machine_id', deepWeb.switchId).eq('path', ACL_PATH);
  await sr.from('sessions').delete().eq('session_id', DEEP_SHELL);
};
await cleanDeep();
const deepShell = await sr.from('sessions').insert({
  session_id: DEEP_SHELL,
  player_key: player.publicKeyHex,
  machine_id: DEEP_ID,
  credentials: { username: 'root', userType: 'root' },
  kind: 'ssh',
  essid: DEEP_ESSID,
});
if (deepShell.error) {
  console.error(`FATAL: session seed failed: ${deepShell.error.message}`);
  process.exit(1);
}
const fetchedOnDeepBox = () =>
  signRequest(player, 'recordLanFetch', {
    essid: DEEP_ESSID,
    target: '127.0.0.1',
    port: DEEP_PORT,
    paths: ['/'],
    caller_machine_id: DEEP_ID,
  });

try {
  const r8 = await post(PATCHES, await fetchedOnDeepBox());
  const deep8 = await readAccessLog(DEEP_ID, DEEP_KEY);
  check(
    '`curl localhost` on a deep box records one local visit on that box',
    r8.status === 200 && lineCount(deep8) === 1 && deep8.startsWith('127.0.0.1 - - ['),
    `box=${deepWeb.host.hostname}@${DEEP_ESSID} status=${r8.status} lines=${lineCount(deep8)} line=${lastLine(deep8)}`,
  );

  // === 9. The switch in front denying the web port does not stand in loopback's way. ===
  await sr.from('patches').insert([
    {
      machine_id: deepWeb.switchId,
      path: ACL_PATH,
      content: `deny ${DEEP_PORT}`,
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: [] },
      node_type: 'file',
      writer_key: player.publicKeyHex,
      updated_at: new Date().toISOString(),
    },
  ]);
  const before9 = lineCount(await readAccessLog(DEEP_ID, DEEP_KEY));
  const r9 = await post(PATCHES, await fetchedOnDeepBox());
  const deep9 = await readAccessLog(DEEP_ID, DEEP_KEY);
  check(
    'a switch denying the web port in front of the layer does not stop the local visit',
    r9.status === 200 && lineCount(deep9) === before9 + 1 && lastLine(deep9).startsWith('127.0.0.1 '),
    `status=${r9.status} before=${before9} after=${lineCount(deep9)}`,
  );
} finally {
  await cleanDeep();
}

// === 10. `curl localhost` in a shell on ANOTHER player's workstation lands on that box. ===
// The visitor lives nowhere; what puts them on the network is the shell they hold on the
// player's workstation, seeded as their `ssh` login would leave it.
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
    '`curl localhost` in a shell on another player’s workstation records a local visit there, in the owner’s log',
    r10.status === 200 &&
      lineCount(own10) === before10 + 1 &&
      lastLine(own10).startsWith('127.0.0.1 - - ['),
    `status=${r10.status} before=${before10} after=${lineCount(own10)} line=${lastLine(own10)}`,
  );

  // === 11. The same box by the address it holds on the LAN, from the same shell. ===
  const r11 = await post(PATCHES, await fetchedByVisitor(PLAYER_LAN));
  const own11 = await readAccessLog(WS, player.publicKeyHex);
  check(
    'fetching that workstation by its own LAN address from the shell on it records there too',
    r11.status === 200 &&
      lineCount(own11) === before10 + 2 &&
      lastLine(own11).startsWith(`${PLAYER_LAN} - - [`),
    `status=${r11.status} after=${lineCount(own11)} line=${lastLine(own11)}`,
  );
  check(
    'the visitor’s fetches wrote no row of their own on that box',
    (await readAccessLog(WS, visitor.publicKeyHex)) === '',
    `visitorRow=${JSON.stringify(await readAccessLog(WS, visitor.publicKeyHex))}`,
  );
} finally {
  await sr.from('sessions').delete().eq('session_id', VISITOR_SHELL);
}

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
