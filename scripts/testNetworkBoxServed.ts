// Wire-payload smoke for the served tree of a box the network makes.
//
// Nobody owns the access point's gateway or a machine the network generates, so the
// server finds one from the network on the caller's own session row, builds it, replays
// its journal and sends the tree pruned to what the caller may read. The journal's raw
// rows are the alternative, and they carry every file on the box at any permission.
//
// Net-new under test (the locally-untypechecked api/ runtime), on the gateway and on each
// kind of machine a network generates (a LAN machine, an inner router, a switch, a
// gateway down the chain, the machine behind a gateway):
//   - A `guest` session is served the box: a file anyone may read is there, and a
//     root-only file somebody wrote is nowhere in the answer.
//   - A `root` session is served that file.
//   - A session opened on another network, and a caller with no row at all, get 404
//     `host_unreachable`: the network is read off the row and never taken from the caller.
//   - After a real reboot ends the `guest` row, the same caller is served the
//     externally-observable list alone. It carries the boot marker the reboot wrote, which
//     is how a shell left standing there learns the box went down, and none of what the
//     session could read.
//
// Drives the REAL migrated schema + glue end to end against a running `vercel dev`
// + local supabase; seeds the session rows and the two files via service_role.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testNetworkBoxServed.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan.js';
import { generateDeepLayer } from '../src/core/generation/generateDeepLayer.js';
import { hostMachineId } from '../src/core/generation/remoteHostId.js';
import {
  chainLinks,
  isInnerGateway,
  machineIdForLanHost,
} from '../src/core/generation/lanTopology.js';
import { ROOT_FILE } from '../src/core/generation/baseFs.js';
import { BOOT_ID_PATH, readBootId } from '../src/core/boot/bootId.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import type { Directory, FileNode } from '../src/core/filesystem/types.js';
import type { UserType } from '../src/core/types.js';

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
  endpoint: string,
  envelope: unknown,
): Promise<{ status: number; body: unknown; raw: string }> => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const raw = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  return { status: response.status, body, raw };
};

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

const get = (tree: Directory, ...segments: readonly string[]): FileNode | undefined => {
  let node: FileNode | undefined = tree;
  for (const segment of segments) {
    if (node === undefined || node.kind !== 'directory') return undefined;
    node = node.entries.get(segment);
  }
  return node;
};

const ESSID = 'BEAN-THERE-WIFI';
const OTHER_ESSID = 'SOME-OTHER-WIFI';
const LOOT = 'left-in-the-open-93be10';
// Unlikely to appear in any generated file, so finding it in an answer means it left.
const SECRET = 'network-box-canary-5d20c8';

const generated = <Value>(value: Value | undefined, what: string): Value => {
  if (value === undefined) {
    console.error(`${ESSID} generates no ${what}`);
    process.exit(1);
  }
  return value;
};

const lanHosts = generateHomeLan(ESSID).hosts;
const lanBox = (what: string, pick: (host: LanHost) => boolean): string =>
  machineIdForLanHost(generated(lanHosts.findLast(pick), what), ESSID);

const INNER_ROUTER = lanBox(
  'inner router',
  (host) => host.kind === 'router' && isInnerGateway(host),
);
const BOXES: readonly (readonly [string, string])[] = [
  ['the access point’s gateway', computeApGatewayId(ESSID)],
  ['a LAN machine', lanBox('machine', (host) => host.kind === 'machine')],
  ['an inner router', INNER_ROUTER],
  ['a switch', lanBox('switch', (host) => host.kind === 'switch')],
  [
    'a gateway down the chain',
    generated(
      chainLinks(ESSID).find((link) => link.parentMachineId !== null),
      'gateway down the chain',
    ).machineId,
  ],
  [
    'a machine behind a gateway',
    hostMachineId(
      generateDeepLayer(ESSID, { machineId: INNER_ROUTER, kind: 'router' }).host,
      ESSID,
    ),
  ],
];
const BOX_IDS = BOXES.map(([, machineId]) => machineId);

// --- Identities: G holds a guest row on each box, R a root one, E a row opened on
// another network, and N holds nothing. ---
const guest = generateIdentity();
const root = generateIdentity();
const elsewhere = generateIdentity();
const nobody = generateIdentity();
const KEYS = [guest, root, elsewhere, nobody].map((identity) => identity.publicKeyHex);

const servedTree = async (identity: typeof guest, machineId: string) => {
  const response = await post(
    NETWORK,
    signRequest(identity, 'resolveCrossPlayerFs', { machine_id: machineId }),
  );
  const tree =
    response.status === 200
      ? deserializeTree((response.body as { tree: SerializedDirectory }).tree)
      : null;
  return { ...response, tree };
};

const contentOf = (node: FileNode | undefined): string | null =>
  node?.kind === 'file' ? node.content : null;

const sessionRow = (
  identity: typeof guest,
  machineId: string,
  userType: UserType,
  essid: string,
) => ({
  session_id: `network-box-${identity.publicKeyHex.slice(0, 12)}-${machineId}`,
  player_key: identity.publicKeyHex,
  machine_id: machineId,
  credentials: { username: userType === 'root' ? 'root' : 'guest', userType },
  kind: 'ssh',
  essid,
});

const fileRow = (
  machineId: string,
  path: string,
  content: string,
  permissions: typeof ROOT_FILE,
) => ({
  machine_id: machineId,
  path,
  content,
  owner: 'root',
  permissions,
  node_type: 'file',
  writer_key: root.publicKeyHex,
});

const cleanUp = async () => {
  await sr.from('sessions').delete().in('player_key', KEYS);
  await sr.from('patches').delete().in('machine_id', BOX_IDS);
};

// Clean slate, then the rows the logins would leave and the two files somebody wrote.
await cleanUp();
const seededSessions = await sr
  .from('sessions')
  .insert(
    BOX_IDS.flatMap((machineId) => [
      sessionRow(guest, machineId, 'guest', ESSID),
      sessionRow(root, machineId, 'root', ESSID),
      sessionRow(elsewhere, machineId, 'root', OTHER_ESSID),
    ]),
  );
const seededFiles = await sr.from('patches').insert(
  BOX_IDS.flatMap((machineId) => [
    fileRow(machineId, '/srv/loot.txt', LOOT, {
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: [],
    }),
    fileRow(machineId, '/srv/secret.txt', SECRET, ROOT_FILE),
  ]),
);
if (seededSessions.error || seededFiles.error) {
  console.error('could not seed the fixture:', seededSessions.error ?? seededFiles.error);
  process.exit(1);
}

for (const [name, machineId] of BOXES) {
  // 1. A guest reads the box, and nothing of the root-only file leaves.
  const asGuest = await servedTree(guest, machineId);
  check(
    `a guest session on ${name} is served the box without the root-only file`,
    asGuest.tree !== null &&
      contentOf(get(asGuest.tree, 'srv', 'loot.txt')) === LOOT &&
      get(asGuest.tree, 'srv', 'secret.txt') === undefined &&
      !asGuest.raw.includes(SECRET),
    `status=${asGuest.status} error=${errorOf(asGuest.body) ?? '-'} canary=${
      asGuest.raw.includes(SECRET) ? 'LEAKED' : 'absent'
    }`,
  );

  // 2. Root on the same box reads it.
  const asRoot = await servedTree(root, machineId);
  check(
    `a root session on ${name} is served the root-only file`,
    asRoot.tree !== null && contentOf(get(asRoot.tree, 'srv', 'secret.txt')) === SECRET,
    `status=${asRoot.status} error=${errorOf(asRoot.body) ?? '-'}`,
  );

  // 3. The network is the one on the row: a row opened elsewhere finds no box, at any
  //    tier, and neither does holding no row.
  const fromElsewhere = await servedTree(elsewhere, machineId);
  const fromNobody = await servedTree(nobody, machineId);
  check(
    `${name} is unreachable to a row opened on another network, and to no row at all`,
    fromElsewhere.status === 404 &&
      errorOf(fromElsewhere.body) === 'host_unreachable' &&
      fromNobody.status === 404 &&
      errorOf(fromNobody.body) === 'host_unreachable',
    `elsewhere=${fromElsewhere.status} nobody=${fromNobody.status}`,
  );

  // 4. A reboot ends the guest's row. What is left to them is what anybody outside can
  //    observe of the box, which includes the marker that reboot wrote.
  const reboot = await post(
    SESSIONS,
    signRequest(root, 'rebootMachine', { machine_id: machineId }),
  );
  const marker = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', BOOT_ID_PATH)
    .maybeSingle();
  const written = (marker.data as { content: string } | null)?.content.trim() ?? null;
  const evicted = await servedTree(guest, machineId);
  check(
    `a guest whose row a reboot ended on ${name} is served the boot marker and no file`,
    reboot.status === 200 &&
      written !== null &&
      evicted.tree !== null &&
      readBootId(evicted.tree) === written &&
      get(evicted.tree, 'srv') === undefined &&
      get(evicted.tree, 'bin') === undefined &&
      !evicted.raw.includes(LOOT),
    `reboot=${reboot.status} status=${evicted.status} error=${errorOf(evicted.body) ?? '-'} marker=${
      evicted.tree !== null && readBootId(evicted.tree) === written ? 'matches' : 'missing'
    }`,
  );
}

await cleanUp();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
