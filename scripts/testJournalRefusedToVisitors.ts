// Wire-payload smoke for who is handed a machine's raw journal.
//
// The journal rows are raw: nothing prunes them to a tier. So `listPatches` hands them
// to one caller only, the owner of the workstation they belong to, whose own client
// rebuilds that box. Every other box (another player's workstation, the access point's
// gateway, a machine the network generates) is served as a tree pruned to the session's
// tier, and anybody asking for the rows behind one gets a single refusal.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - A `guest` session on another player's workstation gets 403 `permission_denied`
//     from `listPatches`, and the answer carries neither rows nor the text of a
//     root-only file the owner keeps there. That text is what the same request used to
//     return in full.
//   - The refusal is about the rows, not the tier: the same session raised to `root` is
//     refused too, and reads the file through the served tree instead.
//   - The visitor still reads the box: the served tree answers, with the root-only file
//     pruned for `guest` and present for `root`.
//   - The owner's own read is untouched and still carries the row.
//   - The access point's gateway is refused the same way, to a session held on it.
//   - So is a generated machine, to a session opened on the network that generates it.
//     A root-only file somebody wrote there leaves in no answer to a `guest`: not the
//     journal's, and not the served tree's.
//   - A session opened on another network, and no session at all, get the same refusal.
//     There is one answer for everybody who is not the owner.
//
// Drives the REAL migrated schema + glue end to end against a running `vercel dev`
// + local supabase; seeds the occupancy row and the session rows via service_role.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testJournalRefusedToVisitors.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentityIn } from '../src/test/factories/identityIn.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { machineIdForLanHost } from '../src/core/generation/lanHostIdentity.js';
import { ROOT_FILE } from '../src/core/generation/baseFs.js';
import { md5 } from '../src/core/generation/md5.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import type { Directory, FileNode } from '../src/core/filesystem/types.js';
import type { UserType } from '../src/core/types.js';

const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
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

type Row = { readonly path: string; readonly content: string | null };
const patchesOf = (body: unknown): readonly Row[] | undefined =>
  (body as { patches?: readonly Row[] } | null)?.patches;

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
const SECRET_PATH = '/root/secret.txt';
// Unlikely to appear in any generated file, so finding it in an answer means the row left.
const SECRET = 'journal-refusal-canary-7f3a91';
const MARK = '/tmp/visitor-mark';

// --- Identities: A owns the workstation, B visits everything, C holds a session opened
// on another network, D holds nothing. ---
const alice = generateIdentityIn(RIDGEMONT);
const bob = generateIdentityIn(RIDGEMONT);
const carol = generateIdentityIn(RIDGEMONT);
const dave = generateIdentityIn(RIDGEMONT);

const A_MACHINE = computeWorkstationId('skylab', alice.publicKeyHex);
const GATEWAY = computeApGatewayId(ESSID);
const host = generateHomeLan(ESSID)
  .hosts.filter((candidate) => candidate.kind === 'machine')
  .at(-1);
if (host === undefined) {
  console.error(`no machine host generated on ${ESSID}`);
  process.exit(1);
}
const GENERATED = machineIdForLanHost(host, ESSID);

const readJournal = (identity: typeof alice, machineId: string) =>
  post(PATCHES, signRequest(identity, 'listPatches', { machine_id: machineId }));

const readServedTree = async (identity: typeof alice, machineId: string) => {
  const response = await post(
    NETWORK,
    signRequest(identity, 'resolveCrossPlayerFs', { machine_id: machineId }),
  );
  const tree =
    response.status === 200
      ? deserializeTree((response.body as { tree: SerializedDirectory }).tree)
      : null;
  return { status: response.status, tree };
};

const sessionRow = (
  identity: typeof alice,
  machineId: string,
  userType: UserType,
  essid: string,
) => ({
  session_id: `journal-refusal-${identity.publicKeyHex.slice(0, 12)}-${machineId}`,
  player_key: identity.publicKeyHex,
  machine_id: machineId,
  credentials: { username: userType === 'root' ? 'root' : 'guest', userType },
  kind: 'ssh',
  essid,
});

const cleanUp = async () => {
  await sr.from('home_network_occupants').delete().eq('essid', ESSID);
  await sr.from('patches').delete().in('machine_id', [A_MACHINE, GATEWAY, GENERATED]);
  await sr
    .from('sessions')
    .delete()
    .in('player_key', [bob.publicKeyHex, carol.publicKeyHex, dave.publicKeyHex]);
};

// Clean slate, then the join state a real `registerNetwork` writes (occupancy is what
// makes a box reachable) and the rows the logins would leave.
await cleanUp();
await sr.from('home_network_occupants').insert({
  essid: ESSID,
  owner_key: alice.publicKeyHex,
  workstation_machine_id: A_MACHINE,
  workstation_username: 'alice',
  workstation_machine_name: 'skylab',
  workstation_root_hash: md5('alice-root-secret'),
});
const seeded = await sr.from('sessions').insert([
  sessionRow(bob, A_MACHINE, 'guest', ESSID),
  sessionRow(bob, GATEWAY, 'root', ESSID),
  sessionRow(bob, GENERATED, 'guest', ESSID),
  sessionRow(carol, GENERATED, 'guest', OTHER_ESSID),
]);
if (seeded.error) {
  console.error('could not seed sessions:', seeded.error);
  process.exit(1);
}

// 1. The owner keeps a root-only file on their own box.
const w1 = await post(
  PATCHES,
  signRequest(alice, 'upsertPatch', {
    machine_id: A_MACHINE,
    path: SECRET_PATH,
    content: SECRET,
    owner: 'root',
    permissions: ROOT_FILE,
    is_new: true,
    node_type: 'file',
  }),
);
check(
  'the owner writes a root-only file on their own box → 200',
  w1.status === 200,
  `status=${w1.status} error=${errorOf(w1.body) ?? '-'}`,
);

// 2. A guest session on that box is refused the journal, and nothing of the file leaves.
const l2 = await readJournal(bob, A_MACHINE);
check(
  'a guest on another player’s box is refused its journal → 403 permission_denied',
  l2.status === 403 && errorOf(l2.body) === 'permission_denied',
  `status=${l2.status} error=${errorOf(l2.body) ?? '-'}`,
);
check(
  'the refusal carries no rows and none of the root-only file',
  patchesOf(l2.body) === undefined && !l2.raw.includes(SECRET),
  `rows=${patchesOf(l2.body)?.length ?? 'none'} canary=${l2.raw.includes(SECRET) ? 'LEAKED' : 'absent'}`,
);

// 3. The visitor still reads the box through the served tree, pruned to guest.
const t3 = await readServedTree(bob, A_MACHINE);
check(
  'the guest still reads the box as a served tree, without the root-only file',
  t3.status === 200 &&
    t3.tree !== null &&
    get(t3.tree, 'tmp')?.kind === 'directory' &&
    get(t3.tree, 'root', 'secret.txt') === undefined,
  `status=${t3.status} tmp=${t3.tree ? (get(t3.tree, 'tmp')?.kind ?? 'absent') : '-'} secret=${
    t3.tree && get(t3.tree, 'root', 'secret.txt') ? 'PRESENT' : 'absent'
  }`,
);

// 4. The owner's own read is untouched.
const l4 = await readJournal(alice, A_MACHINE);
const ownerRow = patchesOf(l4.body)?.find((row) => row.path === SECRET_PATH);
check(
  'the owner’s own journal read still carries the row',
  l4.status === 200 && ownerRow?.content === SECRET,
  `status=${l4.status} content=${ownerRow?.content === SECRET ? 'matches' : 'missing'}`,
);

// 5. The refusal is about raw rows, not the tier: root on that box is refused too, and
//    reads the file where every visitor reads the box.
await sr
  .from('sessions')
  .update({ credentials: { username: 'root', userType: 'root' } })
  .eq('player_key', bob.publicKeyHex)
  .eq('machine_id', A_MACHINE);
const l5 = await readJournal(bob, A_MACHINE);
const t5 = await readServedTree(bob, A_MACHINE);
const servedSecret = t5.tree ? get(t5.tree, 'root', 'secret.txt') : undefined;
check(
  'root on another player’s box is refused the journal as well',
  l5.status === 403 && errorOf(l5.body) === 'permission_denied' && !l5.raw.includes(SECRET),
  `status=${l5.status} error=${errorOf(l5.body) ?? '-'}`,
);
check(
  'root reads the file through the served tree',
  t5.status === 200 && servedSecret?.kind === 'file' && servedSecret.content === SECRET,
  `status=${t5.status} content=${servedSecret?.kind === 'file' ? 'matches' : 'absent'}`,
);

// 6. The access point's gateway belongs to no player and is served the same way.
const l6 = await readJournal(bob, GATEWAY);
check(
  'a session on the access point’s gateway is refused its journal → 403 permission_denied',
  l6.status === 403 && errorOf(l6.body) === 'permission_denied' && patchesOf(l6.body) === undefined,
  `status=${l6.status} error=${errorOf(l6.body) ?? '-'}`,
);

// 7. A generated machine is nobody's, so its journal answers nobody. The visitor can
//    still write where their tier allows, and reads the box as the served tree.
const w7 = await post(
  PATCHES,
  signRequest(bob, 'upsertPatch', {
    machine_id: GENERATED,
    path: MARK,
    content: 'left by a visitor',
    owner: 'guest',
    permissions: { read: ['root', 'user', 'guest'], write: ['root', 'user', 'guest'], execute: [] },
    is_new: true,
    node_type: 'file',
  }),
);
const planted = await sr.from('patches').insert({
  machine_id: GENERATED,
  path: SECRET_PATH,
  content: SECRET,
  owner: 'root',
  permissions: ROOT_FILE,
  node_type: 'file',
  writer_key: alice.publicKeyHex,
});
const l7 = await readJournal(bob, GENERATED);
check(
  'a visitor on a machine their network generates is refused its journal',
  w7.status === 200 &&
    planted.error === null &&
    l7.status === 403 &&
    errorOf(l7.body) === 'permission_denied' &&
    patchesOf(l7.body) === undefined &&
    !l7.raw.includes(SECRET),
  `write=${w7.status} read=${l7.status} error=${errorOf(l7.body) ?? '-'} canary=${
    l7.raw.includes(SECRET) ? 'LEAKED' : 'absent'
  }`,
);
const t7 = await readServedTree(bob, GENERATED);
const mark7 = t7.tree ? get(t7.tree, 'tmp', 'visitor-mark') : undefined;
check(
  'and reads that machine as a served tree, with their own file and without the root-only one',
  t7.status === 200 &&
    mark7?.kind === 'file' &&
    t7.tree !== null &&
    get(t7.tree, 'root', 'secret.txt') === undefined,
  `status=${t7.status} mark=${mark7?.kind ?? 'absent'} secret=${
    t7.tree && get(t7.tree, 'root', 'secret.txt') ? 'PRESENT' : 'absent'
  }`,
);

// 8. A session opened on another network changes nothing.
const l8 = await readJournal(carol, GENERATED);
check(
  'a session opened on another network is refused that machine’s journal',
  l8.status === 403 && errorOf(l8.body) === 'permission_denied' && patchesOf(l8.body) === undefined,
  `status=${l8.status} error=${errorOf(l8.body) ?? '-'}`,
);

// 9. Neither does holding no session: one answer for everybody who is not the owner.
const l9 = await readJournal(dave, A_MACHINE);
check(
  'no session at all gets the same refusal',
  l9.status === 403 && errorOf(l9.body) === 'permission_denied',
  `status=${l9.status} error=${errorOf(l9.body) ?? '-'}`,
);

await cleanUp();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
