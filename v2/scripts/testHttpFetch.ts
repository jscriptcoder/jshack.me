// Wire-payload smoke for the CREDENTIAL-FREE cross-player web fetch — `curl
// http://<another player's public IP>` returns their page with no session and no
// password. Drives the REAL /api/network endpoint against a running `vercel dev` +
// supabase, seeding two occupants' join state (public IP, leases, occupancy) via
// service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `resolveHttpFetch` resolves public IP → ESSID → gateway → forward → the occupant
//     LEASING that internal address, reading `network_public_ips`, `patches`,
//     `home_network_occupants` and `network_lan_leases` by their real column names.
//   - The page is read AS THE SERVER: a page published by root is root-readable only, so
//     a read at the caller's tier would 404 the owner's own page. Seeded root-only here
//     precisely so a regression to a caller-tier read fails this script.
//   - The document root is enforced SERVER-side on the RAW request path — the wire
//     carries a URL path, never a file path, so a hostile client cannot name
//     `/etc/passwd` and the traversal that reaches it returns 404 with no content.
//   - Every unreachable cause collapses to one `host_unreachable`: no forward, a bricked
//     box, an occupant who left the WiFi, and a forward onto a non-web port.
//   - The hit is recorded on the machine that served it, in the TARGET OWNER's journal
//     row — which only the database can settle, since `writer_key` is a column `tsc`
//     cannot see. A fetcher who held their own row could rewrite the record of their
//     own visit, so the negative half (B holds NO row) is checked too.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testHttpFetch.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { lanAddressFor } from '../src/core/network/lanAddress';
import { formatPidfileContent } from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { HTTP_DEFAULT_PORT } from '../src/core/network/http';
import { ACCESS_LOG_PATH } from '../src/core/logging/accessLog';
import { md5 } from '../src/core/generation/md5';

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

const contentOf = (body: unknown): string | undefined =>
  (body as { content?: string } | null)?.content;

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

// --- Identities: ALICE publishes a page behind her AP's NAT; BOB fetches it from
//     another network, holding nothing at all on her box. ---
const alice = generateIdentity();
const bob = generateIdentity();

const ESSID = 'SYNDICATE-MESH';
const B_ESSID = 'CYBERDYNE-GUEST';
const AP_GATEWAY = computeApGatewayId(ESSID);
const AP_PUBLIC_IP = '203.0.113.91';
const B_PUBLIC_IP = '192.0.2.91';
const UNKNOWN_PUBLIC_IP = '198.51.100.77';

const A_WS_NAME = 'skylab';
const A_WS = computeWorkstationId(A_WS_NAME, alice.publicKeyHex);
const A_OCTET = 21;
const A_LAN = lanAddressFor(ESSID, A_OCTET);

const RULES = '/etc/iptables/rules.v4';
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: ['root'] };
const ROOT_ONLY_CONFIG = { read: ['root'], write: ['root'], execute: [] };
const WORLD_PID = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };

const A_PAGE = '<html><body><h1>skylab operations</h1></body></html>';
const A_STATUS_PAGE = '<html><body>all systems nominal</body></html>';

/** Alice's NAT table: :80 to her web server, plus a second forward onto her SSH port —
 *  the case that must refuse, because reaching a listening daemon is not reaching a web
 *  server. */
const FORWARD_RULES = [
  '# /etc/iptables/rules.v4 — NAT port-forward table',
  `forward ${HTTP_DEFAULT_PORT} to ${A_LAN}:${HTTP_DEFAULT_PORT}`,
  `forward 8080 to ${A_LAN}:22`,
  '',
].join('\n');

const occupantRow = (owner: ReturnType<typeof generateIdentity>, essid: string, wsName: string) => ({
  essid,
  owner_key: owner.publicKeyHex,
  workstation_machine_id: computeWorkstationId(wsName, owner.publicKeyHex),
  workstation_username: 'player',
  workstation_machine_name: wsName,
  workstation_root_hash: md5('root-secret'),
});

const patchRow = (fields: {
  readonly machineId: string;
  readonly path: string;
  readonly content: string | null;
  readonly permissions: unknown;
  readonly nodeType: string;
  readonly ownerKey: string;
}) => ({
  machine_id: fields.machineId,
  path: fields.path,
  content: fields.content,
  owner: 'root',
  permissions: fields.permissions,
  node_type: fields.nodeType,
  writer_key: fields.ownerKey,
  updated_at: new Date().toISOString(),
});

/** A page as a ROOT `nano` write stamps it: readable by root and nothing else. */
const pageRow = (path: string, content: string) =>
  patchRow({
    machineId: A_WS,
    path,
    content,
    permissions: ROOT_ONLY,
    nodeType: 'file',
    ownerKey: alice.publicKeyHex,
  });

const webServerUpRow = patchRow({
  machineId: A_WS,
  path: `/var/run/${SERVICE_CATALOG.http.pidfile}`,
  content: formatPidfileContent(SERVICE_CATALOG.http, HTTP_DEFAULT_PORT),
  permissions: WORLD_PID,
  nodeType: 'file',
  ownerKey: alice.publicKeyHex,
});

const sshdUpRow = patchRow({
  machineId: A_WS,
  path: `/var/run/${SERVICE_CATALOG.ssh.pidfile}`,
  content: formatPidfileContent(SERVICE_CATALOG.ssh, 22),
  permissions: WORLD_PID,
  nodeType: 'file',
  ownerKey: alice.publicKeyHex,
});

/** A root `rm /boot/vmlinuz` tombstone. `content: null` is the deletion marker, but
 *  `node_type` stays `'file'` — the column is NOT NULL, so an explicit null is a rejected
 *  row, i.e. a brick that never happened and a check that passes for the wrong reason. */
const bootTombstoneRow = (machineId: string) =>
  patchRow({
    machineId,
    path: '/boot/vmlinuz',
    content: null,
    permissions: null,
    nodeType: 'file',
    ownerKey: alice.publicKeyHex,
  });

/** Seed rows, failing LOUDLY. A silently-rejected seed is worse than a failing check:
 *  the scenario under test simply never existed. */
const seed = async (table: string, rows: readonly Record<string, unknown>[], label: string) => {
  const { error } = await sr.from(table).insert(rows);
  if (error) {
    console.error(`FATAL: ${table} insert (${label}) failed:`, error.message);
    process.exit(1);
  }
};

const clean = async () => {
  await sr.from('network_public_ips').delete().in('public_ip', [AP_PUBLIC_IP, B_PUBLIC_IP]);
  await sr.from('home_network_occupants').delete().in('essid', [ESSID, B_ESSID]);
  // Leases are permanent by design, so a re-run would otherwise find the octet held.
  await sr.from('network_lan_leases').delete().in('essid', [ESSID, B_ESSID]);
  for (const machineId of [AP_GATEWAY, A_WS]) {
    await sr.from('patches').delete().eq('machine_id', machineId);
  }
};

await clean();
await seed(
  'network_public_ips',
  [
    { essid: ESSID, public_ip: AP_PUBLIC_IP },
    { essid: B_ESSID, public_ip: B_PUBLIC_IP },
  ],
  'public ips',
);
await seed(
  'network_lan_leases',
  [
    { essid: ESSID, owner_key: alice.publicKeyHex, octet: A_OCTET },
    { essid: B_ESSID, owner_key: bob.publicKeyHex, octet: 42 },
  ],
  'leases',
);
await seed(
  'home_network_occupants',
  [occupantRow(alice, ESSID, A_WS_NAME), occupantRow(bob, B_ESSID, 'nebuchadnezzar')],
  'occupancy',
);
await seed(
  'patches',
  [
    patchRow({
      machineId: AP_GATEWAY,
      path: RULES,
      content: FORWARD_RULES,
      permissions: ROOT_ONLY_CONFIG,
      nodeType: 'file',
      ownerKey: alice.publicKeyHex,
    }),
    webServerUpRow,
    sshdUpRow,
    pageRow('/var/www/html/index.html', A_PAGE),
    pageRow('/var/www/html/status.html', A_STATUS_PAGE),
  ],
  'gateway forwards + A pages',
);

/** A signed fetch. `path` defaults because a URL always has one — `curl http://host`
 *  asks for `/` — so a check that varies only the port still sends a complete request. */
const fetchAs = (
  fetcher: ReturnType<typeof generateIdentity>,
  fields: Record<string, unknown>,
) => signRequest(fetcher, 'resolveHttpFetch', { target: AP_PUBLIC_IP, path: '/', ...fields });

// === 1. The whole point: B reads A's page holding NOTHING on her box. ===
const page = await post(NETWORK, fetchAs(bob, { port: HTTP_DEFAULT_PORT, path: '/' }));
check(
  'curl http://<A public IP> returns A’s root-only page with no session and no credential',
  page.status === 200 && contentOf(page.body) === A_PAGE,
  `status=${page.status} content=${JSON.stringify(contentOf(page.body) ?? null)}`,
);

// === 2. A named path under the document root. ===
const named = await post(NETWORK, fetchAs(bob, { path: '/status.html' }));
check(
  'a named path under the document root is served',
  named.status === 200 && contentOf(named.body) === A_STATUS_PAGE,
  `status=${named.status} content=${JSON.stringify(contentOf(named.body) ?? null)}`,
);

// === 3. The document root holds server-side, against a path the CLIENT chose. ===
const traversal = await post(NETWORK, fetchAs(bob, { path: '/../../../etc/passwd' }));
check(
  'a traversal to /etc/passwd is 404 not_found and carries no file content',
  traversal.status === 404 &&
    errorOf(traversal.body) === 'not_found' &&
    !JSON.stringify(traversal.body ?? {}).includes('root:'),
  `status=${traversal.status} error=${errorOf(traversal.body) ?? '-'} body=${JSON.stringify(traversal.body)}`,
);

const missing = await post(NETWORK, fetchAs(bob, { path: '/nothing-here.html' }));
check(
  'a file the document root does not publish is 404 not_found',
  missing.status === 404 && errorOf(missing.body) === 'not_found',
  `status=${missing.status} error=${errorOf(missing.body) ?? '-'}`,
);

// === 4. Reaching a listening daemon is not reaching a web server. ===
const ontoSsh = await post(NETWORK, fetchAs(bob, { port: 8080 }));
check(
  'a forward onto A’s SSH port is host_unreachable — something listens, but not for the web',
  ontoSsh.status === 404 && errorOf(ontoSsh.body) === 'host_unreachable',
  `status=${ontoSsh.status} error=${errorOf(ontoSsh.body) ?? '-'}`,
);

const unforwarded = await post(NETWORK, fetchAs(bob, { port: 9999 }));
check(
  'a port nothing forwards is host_unreachable',
  unforwarded.status === 404 && errorOf(unforwarded.body) === 'host_unreachable',
  `status=${unforwarded.status} error=${errorOf(unforwarded.body) ?? '-'}`,
);

const unknown = await post(
  NETWORK,
  signRequest(bob, 'resolveHttpFetch', { target: UNKNOWN_PUBLIC_IP, path: '/' }),
);
check(
  'a public IP no access point bears is host_unreachable',
  unknown.status === 404 && errorOf(unknown.body) === 'host_unreachable',
  `status=${unknown.status} error=${errorOf(unknown.body) ?? '-'}`,
);

// === 5. Occupancy is the reachability test: A leaves the WiFi, keeping her lease. ===
await sr
  .from('home_network_occupants')
  .delete()
  .eq('essid', ESSID)
  .eq('owner_key', alice.publicKeyHex);

const departed = await post(NETWORK, fetchAs(bob, { path: '/' }));
check(
  'after A disconnects, her page is host_unreachable though her lease still names the address',
  departed.status === 404 && errorOf(departed.body) === 'host_unreachable',
  `status=${departed.status} error=${errorOf(departed.body) ?? '-'}`,
);

await seed('home_network_occupants', [occupantRow(alice, ESSID, A_WS_NAME)], 'A rejoins');
const rejoined = await post(NETWORK, fetchAs(bob, { path: '/' }));
check(
  'rejoining the WiFi restores the page — occupancy is the gate, not a stored flag',
  rejoined.status === 200 && contentOf(rejoined.body) === A_PAGE,
  `status=${rejoined.status} content=${JSON.stringify(contentOf(rejoined.body) ?? null)}`,
);

// === 6. A bricked box behind the forward answers nothing, page and pidfile intact. ===
await seed('patches', [bootTombstoneRow(A_WS)], 'A workstation bricked');

const bricked = await post(NETWORK, fetchAs(bob, { path: '/' }));
check(
  'a bricked box behind the forward is host_unreachable, page and running pidfile notwithstanding',
  bricked.status === 404 && errorOf(bricked.body) === 'host_unreachable',
  `status=${bricked.status} error=${errorOf(bricked.body) ?? '-'}`,
);

// === 7. Bricking the GATEWAY takes the whole public IP dark. ===
await sr.from('patches').delete().eq('machine_id', A_WS).eq('path', '/boot/vmlinuz');
await seed('patches', [bootTombstoneRow(AP_GATEWAY)], 'AP gateway bricked');

const gatewayDark = await post(NETWORK, fetchAs(bob, { path: '/' }));
check(
  'a bricked gateway takes the whole public IP dark, even with a live box behind it',
  gatewayDark.status === 404 && errorOf(gatewayDark.body) === 'host_unreachable',
  `status=${gatewayDark.status} error=${errorOf(gatewayDark.body) ?? '-'}`,
);

// === 8. The wire is the threat surface: an envelope that does not verify never resolves. ===
const signed = fetchAs(bob, { path: '/' });
const tampered = { ...signed, payload: `${signed.payload} ` };
const rejected = await post(NETWORK, tampered);
check(
  'a tampered envelope is refused before anything is resolved',
  rejected.status === 401 && errorOf(rejected.body) === 'signature_invalid',
  `status=${rejected.status} error=${errorOf(rejected.body) ?? '-'}`,
);

// === 9. The defender's record. Every check above that REACHED A's box left a line;
// every unreachable one left nothing. Only the database can settle which ROW they
// landed in, which is the whole keystone — `tsc` cannot see a writer_key. ===
const accessLogRow = async (writerKey: string) => {
  const { data, error } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', A_WS)
    .eq('path', ACCESS_LOG_PATH)
    .eq('writer_key', writerKey)
    .maybeSingle();
  if (error) {
    console.error('FATAL: access.log read failed:', error.message);
    process.exit(1);
  }
  return (data as { content: string | null } | null)?.content ?? null;
};

const ownerLog = await accessLogRow(alice.publicKeyHex);
const fetcherLog = await accessLogRow(bob.publicKeyHex);
const logLines = (ownerLog ?? '').split('\n').filter((line) => line.length > 0);

check(
  'the hits accrete under the OWNER’s key — and B, who made every one of them, holds no row at all',
  ownerLog !== null && fetcherLog === null,
  `owner row=${ownerLog === null ? 'missing' : 'present'} fetcher row=${fetcherLog === null ? 'absent' : 'PRESENT'}`,
);

check(
  'exactly the five fetches that reached A’s box are recorded — the unreachable ones left nothing',
  logLines.length === 5,
  `lines=${logLines.length}`,
);

check(
  'every line carries B’s server-derived public IP, never a LAN address or a client claim',
  logLines.length > 0 && logLines.every((line) => line.startsWith(`${B_PUBLIC_IP} - - [`)),
  `lines=${JSON.stringify(logLines.slice(0, 2))}`,
);

check(
  'a served page and a 404 are both recorded, with the path as REQUESTED',
  logLines.some((line) => line.includes('"GET / HTTP/1.1" 200 ')) &&
    logLines.some((line) => line.includes('"GET /nothing-here.html HTTP/1.1" 404 0')),
  `lines=${JSON.stringify(logLines)}`,
);

check(
  'a traversal attempt is recorded verbatim — the raw path is exactly what a defender needs to see',
  logLines.some((line) => line.includes('"GET /../../../etc/passwd HTTP/1.1" 404 0')),
  `lines=${JSON.stringify(logLines)}`,
);

await clean();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
