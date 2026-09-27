// Wire-payload smoke for the CROSS-PLAYER path sweep — `gobuster http://<another
// player's public IP>` walks a path list against their box and reports what answered.
// Drives the REAL /api/network endpoint against a running `vercel dev` + supabase,
// seeding two occupants' join state (public IP, leases, occupancy) via service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `resolveHttpSweep` enters through the SAME reachability chain a fetch does, so a
//     sweep can never reach a box a `curl` could not.
//   - THE LIST NEVER CROSSES THE WIRE. The server reads `/usr/share/wordlists/dirlist.txt`
//     off the journal of the machine the caller named, by its real column names
//     (`machine_id` + `path`, every writer's rows). Proven by seeding a list only the
//     server can see and watching those exact words come back — and by the negative
//     half: the same request against a machine holding no list reports one missing
//     rather than sweeping with a default.
//   - `caller_machine_id` is AUTHORIZED against `sessions` before anything is read, so
//     naming a box you neither own nor hold a session on cannot borrow its curated list.
//   - The whole run lands as ONE append in the TARGET OWNER's journal row, under one
//     timestamp — the wall of 404s a defender reads. `writer_key` is a column `tsc`
//     cannot see, so only the database settles which row it landed in.
//   - The line's source IP is VANTAGE-derived: a sweep launched from a box the caller
//     only holds a session on is traced to THAT network's public IP, never their home.
//   - Sizes come back, pages do not.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testGobusterCrossPlayer.ts
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
import { DIRLIST_PATH } from '../src/core/network/defaultDirlist';
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

type SweptResult = { readonly path: string; readonly status: number; readonly size: number };

const resultsOf = (body: unknown): readonly SweptResult[] =>
  (body as { results?: readonly SweptResult[] } | null)?.results ?? [];
const dirlistFoundOf = (body: unknown): boolean | undefined =>
  (body as { dirlistFound?: boolean } | null)?.dirlistFound;
const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

// --- ALICE publishes behind her AP's NAT; BOB sweeps her from another network. CAROL
//     owns the box Bob pivots through, on a third network. ---
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();

const ESSID = 'SYNDICATE-MESH';
const B_ESSID = 'CYBERDYNE-GUEST';
const PIVOT_ESSID = 'TYRELL-LOBBY';
const AP_GATEWAY = computeApGatewayId(ESSID);
const AP_PUBLIC_IP = '203.0.113.94';
const B_PUBLIC_IP = '192.0.2.94';
const PIVOT_PUBLIC_IP = '198.51.100.94';
const UNKNOWN_PUBLIC_IP = '203.0.113.199';

const A_WS_NAME = 'skylab';
const A_WS = computeWorkstationId(A_WS_NAME, alice.publicKeyHex);
const A_OCTET = 24;
const A_LAN = lanAddressFor(ESSID, A_OCTET);

const B_WS_NAME = 'nebuchadnezzar';
const B_WS = computeWorkstationId(B_WS_NAME, bob.publicKeyHex);
/** Carol's box, which Bob has taken a session on — it carries its OWN path list. */
const PIVOT_WS = computeWorkstationId('tyrell-desk', carol.publicKeyHex);

const RULES = '/etc/iptables/rules.v4';
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: ['root'] };
const ROOT_ONLY_CONFIG = { read: ['root'], write: ['root'], execute: [] };
const WORLD_PID = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };
const LIST_PERMS = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };

const A_INDEX = '<html><body><h1>skylab operations</h1></body></html>';
const A_STAGING = '<html><body>migration notes, do not link</body></html>';

/** The words on BOB's own box. Deliberately unlike the shipped default list: if the
 *  server ever swept with a built-in, `staging-notes` could not come back. */
const BOB_WORDS = ['index.html', 'staging-notes', 'nothing-here'];
/** Carol's box holds a DIFFERENT list — what a pivoting attacker inherits. */
const PIVOT_WORDS = ['index.html'];

const FORWARD_RULES = [
  '# /etc/iptables/rules.v4 — NAT port-forward table',
  `forward ${HTTP_DEFAULT_PORT} to ${A_LAN}:${HTTP_DEFAULT_PORT}`,
  `forward 8080 to ${A_LAN}:22`,
  '',
].join('\n');

const occupantRow = (
  owner: ReturnType<typeof generateIdentity>,
  essid: string,
  wsName: string,
) => ({
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
  readonly ownerKey: string;
  readonly nodeType?: string;
}) => ({
  machine_id: fields.machineId,
  path: fields.path,
  content: fields.content,
  owner: 'root',
  permissions: fields.permissions,
  node_type: fields.nodeType ?? 'file',
  writer_key: fields.ownerKey,
  updated_at: new Date().toISOString(),
});

/** A page as a ROOT `nano` write stamps it: readable by root and nothing else, so a
 *  sweep that read as its caller would miss the owner's own pages. */
const pageRow = (path: string, content: string) =>
  patchRow({
    machineId: A_WS,
    path: `/var/www/html${path}`,
    content,
    permissions: ROOT_ONLY,
    ownerKey: alice.publicKeyHex,
  });

/** A directory made with `mkdir`, holding the index that makes it a find. */
const dirRow = (path: string) =>
  patchRow({
    machineId: A_WS,
    path: `/var/www/html${path}`,
    content: null,
    permissions: ROOT_ONLY,
    nodeType: 'directory',
    ownerKey: alice.publicKeyHex,
  });

const dirlistRow = (machineId: string, ownerKey: string, words: readonly string[]) =>
  patchRow({
    machineId,
    path: DIRLIST_PATH,
    content: `${words.join('\n')}\n`,
    permissions: LIST_PERMS,
    ownerKey,
  });

const webServerUpRow = patchRow({
  machineId: A_WS,
  path: `/var/run/${SERVICE_CATALOG.http.pidfile}`,
  content: formatPidfileContent(SERVICE_CATALOG.http, HTTP_DEFAULT_PORT),
  permissions: WORLD_PID,
  ownerKey: alice.publicKeyHex,
});

const sshdUpRow = patchRow({
  machineId: A_WS,
  path: `/var/run/${SERVICE_CATALOG.ssh.pidfile}`,
  content: formatPidfileContent(SERVICE_CATALOG.ssh, 22),
  permissions: WORLD_PID,
  ownerKey: alice.publicKeyHex,
});

const seed = async (table: string, rows: readonly Record<string, unknown>[], label: string) => {
  const { error } = await sr.from(table).insert(rows);
  if (error) {
    console.error(`FATAL: ${table} insert (${label}) failed:`, error.message);
    process.exit(1);
  }
};

const clean = async () => {
  await clearPublicIps(sr, [
    { essid: ESSID, publicIp: AP_PUBLIC_IP },
    { essid: B_ESSID, publicIp: B_PUBLIC_IP },
    { essid: PIVOT_ESSID, publicIp: PIVOT_PUBLIC_IP },
  ]);
  await sr.from('home_network_occupants').delete().in('essid', [ESSID, B_ESSID, PIVOT_ESSID]);
  await sr.from('network_lan_leases').delete().in('essid', [ESSID, B_ESSID, PIVOT_ESSID]);
  await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);
  for (const machineId of [AP_GATEWAY, A_WS, B_WS, PIVOT_WS]) {
    await sr.from('patches').delete().eq('machine_id', machineId);
  }
};

const clearTargetLog = async () => {
  await sr.from('patches').delete().eq('machine_id', A_WS).eq('path', ACCESS_LOG_PATH);
};

/** The lines the TARGET OWNER's row holds, and how many appends built them. `updated_at`
 *  is per-row, so the count of DISTINCT stamps inside the content is what says a run
 *  landed as one write rather than as one per word. */
const targetLog = async (writerKey: string): Promise<readonly string[]> => {
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
  return ((data as { content: string | null } | null)?.content ?? '')
    .split('\n')
    .filter((line) => line.length > 0);
};

const stampsIn = (lines: readonly string[]): ReadonlySet<string> =>
  new Set(lines.map((line) => line.slice(line.indexOf('[') + 1, line.indexOf(']'))));

await clean();
await seed(
  'network_public_ips',
  [
    { essid: ESSID, public_ip: AP_PUBLIC_IP },
    { essid: B_ESSID, public_ip: B_PUBLIC_IP },
    { essid: PIVOT_ESSID, public_ip: PIVOT_PUBLIC_IP },
  ],
  'public ips',
);
await seed(
  'network_lan_leases',
  [
    { essid: ESSID, owner_key: alice.publicKeyHex, octet: A_OCTET },
    { essid: B_ESSID, owner_key: bob.publicKeyHex, octet: 42 },
    { essid: PIVOT_ESSID, owner_key: carol.publicKeyHex, octet: 51 },
  ],
  'leases',
);
await seed(
  'home_network_occupants',
  [
    occupantRow(alice, ESSID, A_WS_NAME),
    occupantRow(bob, B_ESSID, B_WS_NAME),
    occupantRow(carol, PIVOT_ESSID, 'tyrell-desk'),
  ],
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
      ownerKey: alice.publicKeyHex,
    }),
    webServerUpRow,
    sshdUpRow,
    pageRow('/index.html', A_INDEX),
    dirRow('/staging-notes'),
    pageRow('/staging-notes/index.html', A_STAGING),
    dirlistRow(B_WS, bob.publicKeyHex, BOB_WORDS),
    dirlistRow(PIVOT_WS, carol.publicKeyHex, PIVOT_WORDS),
  ],
  'forwards, A pages, and the two path lists',
);

const sweepAs = (
  sweeper: ReturnType<typeof generateIdentity>,
  fields: Record<string, unknown> = {},
) =>
  signRequest(sweeper, 'resolveHttpSweep', {
    target: AP_PUBLIC_IP,
    port: HTTP_DEFAULT_PORT,
    caller_machine_id: B_WS,
    ...fields,
  });

// === 1. The whole point: B sweeps A's box with B's OWN list, which never left B's box. ===
await clearTargetLog();
const swept = await post(sweepAs(bob));
const found = resultsOf(swept.body);
check(
  'gobuster http://<A public IP> reports every word B holds, in list order',
  swept.status === 200 &&
    dirlistFoundOf(swept.body) === true &&
    found.length === BOB_WORDS.length,
  `status=${swept.status} dirlistFound=${dirlistFoundOf(swept.body)} results=${JSON.stringify(found)}`,
);

check(
  'the words came from B’s journal, not from a default the server carries',
  found[1]?.path === '/staging-notes/' && found[1]?.status === 200,
  `second result=${JSON.stringify(found[1] ?? null)}`,
);

check(
  'a served file is a hit with its real size, and an unserved word is a 404 with none',
  found[0]?.status === 200 &&
    found[0]?.size === A_INDEX.length &&
    found[2]?.status === 404 &&
    found[2]?.size === 0,
  `first=${JSON.stringify(found[0] ?? null)} third=${JSON.stringify(found[2] ?? null)}`,
);

check(
  'a directory holding an index is reported as the trailing-slash form, sized by its index',
  found[1]?.path === '/staging-notes/' && found[1]?.size === A_STAGING.length,
  `second=${JSON.stringify(found[1] ?? null)}`,
);

check(
  'the sweep hands back sizes, never pages',
  !JSON.stringify(swept.body ?? {}).includes('migration notes'),
  `body=${JSON.stringify(swept.body).slice(0, 160)}`,
);

// === 2. The defender's record: one append, one stamp, every path asked about. ===
const ownerLines = await targetLog(alice.publicKeyHex);
const sweeperLines = await targetLog(bob.publicKeyHex);

check(
  'the run accretes under the OWNER’s key — B, who made every probe, holds no row at all',
  ownerLines.length > 0 && sweeperLines.length === 0,
  `owner lines=${ownerLines.length} sweeper lines=${sweeperLines.length}`,
);

check(
  'all four requests the three words cost are recorded — the directory retry included',
  ownerLines.length === 4,
  `lines=${JSON.stringify(ownerLines)}`,
);

check(
  'the whole sweep lands under ONE timestamp, so a defender reads it as one act',
  stampsIn(ownerLines).size === 1,
  `stamps=${JSON.stringify([...stampsIn(ownerLines)])}`,
);

check(
  'the wall shows the misses as plainly as the hits, with each path as ASKED',
  ownerLines.some((line) => line.includes('"GET /index.html HTTP/1.1" 200 ')) &&
    ownerLines.some((line) => line.includes('"GET /staging-notes HTTP/1.1" 404 0')) &&
    ownerLines.some((line) => line.includes('"GET /staging-notes/ HTTP/1.1" 200 ')) &&
    ownerLines.some((line) => line.includes('"GET /nothing-here HTTP/1.1" 404 0')),
  `lines=${JSON.stringify(ownerLines)}`,
);

check(
  'every line carries B’s server-derived home public IP, never a client claim',
  ownerLines.every((line) => line.startsWith(`${B_PUBLIC_IP} - - [`)),
  `lines=${JSON.stringify(ownerLines.slice(0, 2))}`,
);

// === 3. The list is the machine's, and the machine must be yours. ===
const borrowed = await post(sweepAs(bob, { caller_machine_id: PIVOT_WS }));
check(
  'naming a box B holds no session on is refused — no borrowing somebody else’s curated list',
  borrowed.status === 403 && errorOf(borrowed.body) === 'no_session',
  `status=${borrowed.status} error=${errorOf(borrowed.body) ?? '-'}`,
);

await sr.from('patches').delete().eq('machine_id', B_WS).eq('path', DIRLIST_PATH);
await clearTargetLog();
const listless = await post(sweepAs(bob));
check(
  'with no list on the box B stands on, the sweep reports one missing rather than inventing one',
  listless.status === 200 &&
    dirlistFoundOf(listless.body) === false &&
    resultsOf(listless.body).length === 0,
  `status=${listless.status} dirlistFound=${dirlistFoundOf(listless.body)} results=${JSON.stringify(resultsOf(listless.body))}`,
);

check(
  'a sweep with nothing to ask tells the target nothing',
  (await targetLog(alice.publicKeyHex)).length === 0,
  `lines=${(await targetLog(alice.publicKeyHex)).length}`,
);

await seed('patches', [dirlistRow(B_WS, bob.publicKeyHex, BOB_WORDS)], 'B reinstalls the list');

// === 4. The pivot: a sweep from a box B only holds a session on. ===
const { error: sessionError } = await sr.from('sessions').insert({
  session_id: crypto.randomUUID(),
  player_key: bob.publicKeyHex,
  machine_id: PIVOT_WS,
  credentials: { username: 'root', userType: 'root' },
  parent_session_id: null,
  source_ip: lanAddressFor(PIVOT_ESSID, 51),
  kind: 'ssh',
  essid: PIVOT_ESSID,
});
if (sessionError) {
  console.error('FATAL: session seed failed:', sessionError.message);
  process.exit(1);
}

await clearTargetLog();
const pivoted = await post(sweepAs(bob, { caller_machine_id: PIVOT_WS }));
const pivotLines = await targetLog(alice.publicKeyHex);

check(
  'a sweep from a box B has taken uses THAT box’s list, not the one at home',
  pivoted.status === 200 && resultsOf(pivoted.body).length === PIVOT_WORDS.length,
  `status=${pivoted.status} results=${JSON.stringify(resultsOf(pivoted.body))}`,
);

check(
  'and the target’s log names THAT network — the box actually used, not the attacker’s home',
  pivotLines.length === 1 && pivotLines[0]?.startsWith(`${PIVOT_PUBLIC_IP} - - [`) === true,
  `lines=${JSON.stringify(pivotLines)}`,
);

// === 5. The same reachability chain a fetch enters, refusing the same way. ===
await clearTargetLog();
const unreachable: readonly (readonly [string, Record<string, unknown>])[] = [
  ['a forward onto A’s SSH port — something listens, but not for the web', { port: 8080 }],
  ['a port nothing forwards', { port: 9999 }],
  ['a public IP no access point bears', { target: UNKNOWN_PUBLIC_IP }],
];
for (const [name, fields] of unreachable) {
  const refused = await post(sweepAs(bob, fields));
  check(
    `${name} is host_unreachable`,
    refused.status === 404 && errorOf(refused.body) === 'host_unreachable',
    `status=${refused.status} error=${errorOf(refused.body) ?? '-'}`,
  );
}

check(
  'nothing unreachable left a line — an unreached box has nothing to write one with',
  (await targetLog(alice.publicKeyHex)).length === 0,
  `lines=${(await targetLog(alice.publicKeyHex)).length}`,
);

// === 6. The wire is the threat surface. ===
const signed = sweepAs(bob);
const rejected = await post({ ...signed, payload: `${signed.payload} ` });
check(
  'a tampered envelope is refused before anything is read or asked',
  rejected.status === 401 && errorOf(rejected.body) === 'signature_invalid',
  `status=${rejected.status} error=${errorOf(rejected.body) ?? '-'}`,
);

await clean();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
