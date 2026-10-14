// Wire-payload smoke for the rule that a box which leaves its network takes the player's
// own reach with it. Every session a player holds on another machine was opened across
// the network their box was on, so once the box is on no network — or on another one —
// none of those shells has anything left underneath it.
//
// The bug this pins: leaving closed the rows OTHER players held on the leaver's box and
// nothing of the leaver's own. A shell they held on a neighbour's box, or on a box the
// network generates, stayed open on the server, so a request signed outside the game
// still read, wrote and acted on the network from there while their own machine was gone.
//
// Drives the REAL endpoints against a running `vercel dev` + supabase:
//   - A, B and C join the same ESSID via /api/network (registerNetwork).
//   - A `ssh guest@<B's LAN IP>` via /api/sessions (authCreateSessionSameLan); A also holds
//     a hop from B's box onto C's, a shell on a machine the network generates, and a root
//     shell on their own box.
//   - A runs `nmcli disconnect` (unregisterOccupant).
//   - Every one of A's shells on another machine closes, the hop with them; A's root shell
//     on their own box does not. A can no longer read or write B's box, write the
//     generated one, or knock on C from B's box.
//   - A comes back, logs in on B again, and then joins ANOTHER network with no disconnect:
//     the join takes the box off the first one, and the shell on B closes the same way.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testLeaverSessionsClose.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { lanAddressFor } from '../src/core/network/lanAddress.js';
import { formatPidfileContent } from '../src/core/services/pidfile.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { md5 } from '../src/core/generation/md5.js';
import { workstationGuestPassword } from '../src/core/generation/workstationFs.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { machineIdForLanHost } from '../src/core/generation/lanTopology.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import type { Directory, FileNode } from '../src/core/filesystem/types.js';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
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

type Identity = ReturnType<typeof generateIdentity>;

// --- Identities: A (who leaves), B (whose box A stands on) and C (a neighbour A knocks
//     on from B's box). ---
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();

const ESSID = 'LEAVER-WIFI';
const OTHER_ESSID = 'LEAVER-WIFI-2';
const A_WS_NAME = 'wanderer';
const B_WS_NAME = 'harbour';
const C_WS_NAME = 'beacon';
const A_WS = computeWorkstationId(A_WS_NAME, alice.publicKeyHex);
const B_WS = computeWorkstationId(B_WS_NAME, bob.publicKeyHex);
const C_WS = computeWorkstationId(C_WS_NAME, carol.publicKeyHex);

const generatedHost = generateHomeLan(ESSID).hosts.find((host) => host.kind === 'machine');
if (generatedHost === undefined) {
  console.error(`${ESSID} generates no machine`);
  process.exit(1);
}
const GENERATED = machineIdForLanHost(generatedHost, ESSID);

const A_ON_B = 'leaver-a-on-b';
const A_HOP_TO_C = 'leaver-a-hop-to-c';
const A_ON_GENERATED = 'leaver-a-on-generated';
const A_OWN_ROOT = 'leaver-a-own-su';
const A_ON_B_AGAIN = 'leaver-a-on-b-again';

const leasedAddress = async (owner: Identity): Promise<string> => {
  const { data } = await sr
    .from('network_lan_leases')
    .select('octet')
    .eq('essid', ESSID)
    .eq('owner_key', owner.publicKeyHex)
    .maybeSingle();
  const octet = (data as { octet: number } | null)?.octet;
  if (octet === undefined) throw new Error(`no lan lease for ${owner.publicKeyHex.slice(0, 8)}`);
  return lanAddressFor(ESSID, octet);
};

const WORLD_PID = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: ['root'] };
const WORLD_FILE = {
  read: ['root', 'user', 'guest'],
  write: ['root', 'user', 'guest'],
  execute: [],
};

const get = (tree: Directory, ...segments: readonly string[]): FileNode | undefined => {
  let node: FileNode | undefined = tree;
  for (const segment of segments) {
    if (node === undefined || node.kind !== 'directory') return undefined;
    node = node.entries.get(segment);
  }
  return node;
};

const join = (owner: Identity, wsName: string, essid = ESSID) =>
  signRequest(owner, 'registerNetwork', {
    essid,
    workstation_machine_id: computeWorkstationId(wsName, owner.publicKeyHex),
    workstation_username: 'player',
    workstation_machine_name: wsName,
    workstation_root_hash: md5('root-secret'),
  });

const sshAliceOntoBob = (sessionId: string, bobLan: string) =>
  post(
    SESSIONS,
    signRequest(alice, 'authCreateSessionSameLan', {
      session_id: sessionId,
      essid: ESSID,
      target_ip: bobLan,
      username: 'guest',
      password: workstationGuestPassword(bob.publicKeyHex),
    }),
  );

/** Whether A is served B's box as a shell there sees it, rather than as a stranger. */
const aliceSeesBobsShell = async (): Promise<boolean> => {
  const response = await post(
    NETWORK,
    signRequest(alice, 'resolveCrossPlayerFs', { machine_id: B_WS }),
  );
  const body = response.body as { tree?: SerializedDirectory };
  if (response.status !== 200 || body.tree === undefined) return false;
  return get(deserializeTree(body.tree), 'bin', 'ls') !== undefined;
};

const writeAsAlice = (machineId: string, path: string) =>
  post(
    PATCHES,
    signRequest(alice, 'upsertPatch', {
      machine_id: machineId,
      path,
      content: 'left by A',
      owner: 'guest',
      permissions: WORLD_FILE,
      is_new: true,
      node_type: 'file',
    }),
  );

const landed = async (machineId: string, path: string): Promise<boolean> => {
  const { data } = await sr
    .from('patches')
    .select('path')
    .eq('machine_id', machineId)
    .eq('path', path)
    .maybeSingle();
  return data !== null;
};

/** A, standing in the shell on B's box, fetches C's front page. */
const fetchCarolFromBobsBox = (carolLan: string) =>
  post(
    NETWORK,
    signRequest(alice, 'resolveOccupantFetch', {
      essid: ESSID,
      target: carolLan,
      port: 80,
      path: '/',
      caller_machine_id: B_WS,
    }),
  );

const carolAccessLog = async (): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', C_WS)
    .eq('path', '/var/log/access.log')
    .eq('writer_key', carol.publicKeyHex)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};
const lineCount = (log: string): number => (log.trim() === '' ? 0 : log.trim().split('\n').length);

/** `open`, the reason a closed row carries, or `missing`. */
const sessionState = async (sessionId: string): Promise<string> => {
  const { data } = await sr
    .from('sessions')
    .select('ended_at, end_reason')
    .eq('session_id', sessionId)
    .maybeSingle();
  const row = data as { ended_at: string | null; end_reason: string | null } | null;
  if (row === null) return 'missing';
  return row.ended_at === null ? 'open' : (row.end_reason ?? 'closed');
};

const clean = async () => {
  await sr.from('home_network_occupants').delete().in('essid', [ESSID, OTHER_ESSID]);
  await sr.from('network_lan_leases').delete().in('essid', [ESSID, OTHER_ESSID]);
  await sr.from('patches').delete().in('machine_id', [A_WS, B_WS, C_WS, GENERATED]);
  await sr
    .from('sessions')
    .delete()
    .in('player_key', [alice.publicKeyHex, bob.publicKeyHex, carol.publicKeyHex]);
};

await clean();

await post(NETWORK, join(bob, B_WS_NAME));
await post(NETWORK, join(carol, C_WS_NAME));
await post(NETWORK, join(alice, A_WS_NAME));

const B_LAN = await leasedAddress(bob);
const C_LAN = await leasedAddress(carol);

const rootFile = (
  machineId: string,
  writer: Identity,
  path: string,
  content: string,
  permissions: object,
) => ({
  machine_id: machineId,
  path,
  content,
  owner: 'root',
  permissions,
  node_type: 'file',
  writer_key: writer.publicKeyHex,
  updated_at: new Date().toISOString(),
});

// B's `sshd` holds port 22 and C serves a page, as their daemons would leave them.
const seeded = await sr
  .from('patches')
  .insert([
    rootFile(
      B_WS,
      bob,
      '/var/run/sshd.pid',
      formatPidfileContent(SERVICE_CATALOG.ssh, 22),
      WORLD_PID,
    ),
    rootFile(
      C_WS,
      carol,
      '/var/run/nginx.pid',
      formatPidfileContent(SERVICE_CATALOG.http, 80),
      WORLD_PID,
    ),
    rootFile(C_WS, carol, '/var/www/html/index.html', '<h1>beacon</h1>', ROOT_ONLY),
  ]);
if (seeded.error) {
  console.error(`FATAL: journal seed failed: ${seeded.error.message}`);
  process.exit(1);
}

// === 1. A logs in on B's box over the LAN. ===
const s1 = await sshAliceOntoBob(A_ON_B, B_LAN);
check(
  'A authenticates same-LAN and lands a guest session on B’s workstation',
  s1.status === 200 && (s1.body as { machine_id?: string }).machine_id === B_WS,
  `status=${s1.status} machine_id=${(s1.body as { machine_id?: string }).machine_id}`,
);

// A hops on from B's box to C's, holds a shell on a box the network generates, and is
// root on their own machine: the last is the one row leaving must not touch.
const stacked = await sr.from('sessions').insert([
  {
    session_id: A_HOP_TO_C,
    player_key: alice.publicKeyHex,
    machine_id: C_WS,
    credentials: { username: 'guest', userType: 'guest' },
    kind: 'ssh',
    essid: ESSID,
    parent_session_id: A_ON_B,
  },
  {
    session_id: A_ON_GENERATED,
    player_key: alice.publicKeyHex,
    machine_id: GENERATED,
    credentials: { username: 'guest', userType: 'guest' },
    kind: 'ssh',
    essid: ESSID,
    parent_session_id: 'seed-session',
  },
  {
    session_id: A_OWN_ROOT,
    player_key: alice.publicKeyHex,
    machine_id: A_WS,
    credentials: { username: 'root', userType: 'root' },
    kind: 'su',
    essid: ESSID,
  },
]);
if (stacked.error) {
  console.error(`FATAL: session seed failed: ${stacked.error.message}`);
  process.exit(1);
}

// === 2. While A's box is on the WiFi, every one of those shells works. ===
const s2w = await writeAsAlice(GENERATED, '/tmp/before-leaving');
check(
  'while A is on the WiFi, A reads B’s box as a shell there and writes the generated one',
  (await aliceSeesBobsShell()) && s2w.status === 200,
  `generated write=${s2w.status}`,
);

// === 3. A runs `nmcli disconnect`. ===
const s3 = await post(NETWORK, signRequest(alice, 'unregisterOccupant', { essid: ESSID }));
check('nmcli disconnect succeeds', s3.status === 200, `status=${s3.status}`);

// === 4. Every shell A held on another machine closed; A's own root shell did not. ===
check(
  'A’s shell on B’s box is closed, recorded as A’s box leaving its network',
  (await sessionState(A_ON_B)) === 'network_left',
  `session=${await sessionState(A_ON_B)}`,
);
check(
  'the hop A made from B’s box onto C’s is closed the same way',
  (await sessionState(A_HOP_TO_C)) === 'network_left',
  `session=${await sessionState(A_HOP_TO_C)}`,
);
check(
  'A’s shell on the generated box is closed too',
  (await sessionState(A_ON_GENERATED)) === 'network_left',
  `session=${await sessionState(A_ON_GENERATED)}`,
);
check(
  'A’s own root shell on their own box is still open',
  (await sessionState(A_OWN_ROOT)) === 'open',
  `session=${await sessionState(A_OWN_ROOT)}`,
);

// === 5. ...so a request signed outside the game finds nothing to act through. ===
check(
  'A is served B’s box as a stranger is, not as a shell there',
  !(await aliceSeesBobsShell()),
  'no /bin/ls',
);
const s5b = await writeAsAlice(B_WS, '/tmp/after-leaving');
check(
  'A cannot write B’s box',
  s5b.status === 403 && !(await landed(B_WS, '/tmp/after-leaving')),
  `status=${s5b.status}`,
);
const s5g = await writeAsAlice(GENERATED, '/tmp/after-leaving');
check(
  'A cannot write the generated box',
  s5g.status === 403 && !(await landed(GENERATED, '/tmp/after-leaving')),
  `status=${s5g.status}`,
);
const s5f = await fetchCarolFromBobsBox(C_LAN);
check(
  'A cannot knock on C from B’s box, and C’s log gains no line',
  s5f.status === 403 && lineCount(await carolAccessLog()) === 0,
  `status=${s5f.status} lines=${lineCount(await carolAccessLog())}`,
);

// === 6. A comes back, logs in on B again, then joins another network without leaving
//        this one: the join takes the box off it, and the shell on B goes the same way. ===
await post(NETWORK, join(alice, A_WS_NAME));
const s6 = await sshAliceOntoBob(A_ON_B_AGAIN, B_LAN);
const s6j = await post(NETWORK, join(alice, A_WS_NAME, OTHER_ESSID));
check(
  'a join that moves A’s box to another network closes A’s shell on B’s box',
  s6.status === 200 && s6j.status === 200 && (await sessionState(A_ON_B_AGAIN)) === 'network_left',
  `login=${s6.status} join=${s6j.status} session=${await sessionState(A_ON_B_AGAIN)}`,
);
check(
  'and leaves A’s own root shell open',
  (await sessionState(A_OWN_ROOT)) === 'open',
  `session=${await sessionState(A_OWN_ROOT)}`,
);

await clean();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
