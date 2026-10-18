// Wire-payload smoke for a log field that cannot fake the columns stamped after it. Drives
// the REAL /api/sessions (authCreateSessionSameLan) and /api/network (resolveOccupantFetch)
// endpoints against a running `vercel dev` + supabase, seeding two players' occupancy rows
// and LAN leases, and the owner's sshd and nginx pidfiles and page, via service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - A neighbour's login with a typed account that carries spaces lands in the OWNER's
//     auth.log with those spaces spelled out, so the source address the server stamped is
//     the only one on the line.
//   - The owner's own chosen machine name heads that line spelled out the same way, so it
//     cannot pass for a second service head.
//   - A fetch of a path that carries a quote and spaces lands in the owner's access.log
//     with them spelled out, so the status and size the server stamped are the only ones.
//   - An ordinary fetch reads exactly as it always has.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testLogFieldEscaping.ts
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
import { md5 } from '../src/core/generation/md5.js';

const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
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

const post = async (endpoint: string, envelope: unknown): Promise<{ status: number }> => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  return { status: response.status };
};

const readLog = async (machineId: string, writerKey: string, path: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', path)
    .eq('writer_key', writerKey)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};

const lastLine = (log: string): string => log.trim().split('\n').slice(-1)[0] ?? '(empty)';

const AUTH_LOG = '/var/log/auth.log';
const ACCESS_LOG = '/var/log/access.log';
const WEB_PORT = 80;

// --- Two players on one WiFi: the OWNER's box is the one whose logs are read. ---
const owner = generateIdentity();
const visitor = generateIdentity();

const ESSID = 'LOG-FIELD-WIFI';
// The owner's machine name is the player's to choose, and it heads every syslog line.
const OWNER_NAME = 'rig sshd[1]: Accepted';
const OWNER_WS = computeWorkstationId(OWNER_NAME, owner.publicKeyHex);
const VISITOR_WS = computeWorkstationId('logos', visitor.publicKeyHex);

const takenOctets = new Set(
  generateHomeLan(ESSID).hosts.map((host) => Number(host.ip.split('.')[3])),
);
const [OWNER_OCTET, VISITOR_OCTET] = Array.from(
  { length: 253 },
  (_unused, index) => index + 2,
).filter((octet) => !takenOctets.has(octet));
if (OWNER_OCTET === undefined || VISITOR_OCTET === undefined) {
  console.error(`Fewer than two free octets on ${ESSID}'s /24 — pick another ESSID`);
  process.exit(2);
}
const OWNER_LAN = lanAddressFor(ESSID, OWNER_OCTET);
const VISITOR_LAN = lanAddressFor(ESSID, VISITOR_OCTET);

const OWNER_PAGE = '<h1>rig</h1>';
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

await sr.from('sessions').delete().eq('player_key', visitor.publicKeyHex);
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('network_lan_leases').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', OWNER_WS);
await sr
  .from('home_network_occupants')
  .insert([occupant(owner, OWNER_WS, OWNER_NAME), occupant(visitor, VISITOR_WS, 'logos')]);
await sr.from('network_lan_leases').insert([
  { essid: ESSID, owner_key: owner.publicKeyHex, octet: OWNER_OCTET },
  { essid: ESSID, owner_key: visitor.publicKeyHex, octet: VISITOR_OCTET },
]);
const seeded = await sr
  .from('patches')
  .insert([
    ownerFile('/var/run/sshd.pid', formatPidfileContent(SERVICE_CATALOG.ssh, 22), WORLD_READ),
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

const fetched = (path: string) =>
  signRequest(visitor, 'resolveOccupantFetch', {
    essid: ESSID,
    target: OWNER_LAN,
    port: WEB_PORT,
    path,
  });

try {
  // === 1. A typed account carrying spaces cannot pass for a second source address. ===
  const login = await post(
    SESSIONS,
    await signRequest(visitor, 'authCreateSessionSameLan', {
      essid: ESSID,
      target_ip: OWNER_LAN,
      session_id: 'log-field-login',
      username: 'guest from 9.9.9.9',
      password: 'not-a-password',
    }),
  );
  const auth = lastLine(await readLog(OWNER_WS, owner.publicKeyHex, AUTH_LOG));
  check(
    'a typed account is spelled out, and the source the server stamped is the only one',
    login.status === 401 &&
      auth.endsWith(String.raw`Failed password for guest\x20from\x209.9.9.9 from ${VISITOR_LAN}`),
    `status=${login.status} line=${auth}`,
  );

  // === 2. The owner's own machine name cannot pass for a second service head. ===
  check(
    'the box’s own chosen name heads the line spelled out',
    auth.includes(String.raw` rig\x20sshd\x5b1\x5d:\x20Accepted sshd[`),
    `line=${auth}`,
  );

  // === 3. A requested path carrying a quote cannot fake the status and size. ===
  const crafted = await post(NETWORK, await fetched('/x HTTP/1.1" 200 0 "'));
  const access = lastLine(await readLog(OWNER_WS, owner.publicKeyHex, ACCESS_LOG));
  check(
    'a requested path is spelled out, and the status and size the server stamped stand alone',
    crafted.status === 404 &&
      access.startsWith(`${VISITOR_LAN} - - [`) &&
      access.endsWith(String.raw`"GET /x\x20HTTP/1.1\x22\x20200\x200\x20\x22 HTTP/1.1" 404 0`),
    `status=${crafted.status} line=${access}`,
  );

  // === 4. An ordinary fetch reads exactly as it always has. ===
  const plain = await post(NETWORK, await fetched('/'));
  const access2 = lastLine(await readLog(OWNER_WS, owner.publicKeyHex, ACCESS_LOG));
  check(
    'an ordinary request is logged unchanged',
    plain.status === 200 && access2.endsWith(`"GET / HTTP/1.1" 200 ${OWNER_PAGE.length}`),
    `status=${plain.status} line=${access2}`,
  );
} finally {
  await sr.from('sessions').delete().eq('player_key', visitor.publicKeyHex);
  await sr.from('home_network_occupants').delete().eq('essid', ESSID);
  await sr.from('network_lan_leases').delete().eq('essid', ESSID);
  await sr.from('patches').delete().eq('machine_id', OWNER_WS);
}

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
