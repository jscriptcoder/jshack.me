// Wire-payload smoke for the rule that being on a WiFi is what makes a machine
// reachable. A box joined to an ESSID is running and attackable around the clock —
// nobody has to be at the keyboard — and the ONLY thing that takes it off the network
// is an explicit in-game `nmcli disconnect`. A machine on no network is unreachable by
// every cross-player path, and leaving drops every connection another player held to it.
//
// The bug this pins: a resolver that answers from a store which is never emptied keeps
// serving a player who has LEFT the network. `nmcli disconnect` removes the occupancy
// row and nothing else, so occupancy is the only store whose contents mean "reachable".
//
// Join ORDER is kept deliberate — B first, A second — because the original defect
// depended on it: identity used to live in a store keyed by the ESSID-shared public IP,
// where the last joiner won. Joining A second means A is the occupant every such store
// would still be holding, so the fail-closed checks below cannot pass by accident.
//
// Drives the REAL endpoints against a running `vercel dev` + supabase:
//   - B then A join the same ESSID via /api/network (registerNetwork).
//   - B `ssh guest@<A's LAN IP>` via /api/sessions (authCreateSessionSameLan).
//   - B reads and writes A's box while A is ON the network — both succeed.
//   - A runs `nmcli disconnect` (unregisterOccupant).
//   - B's read and write of A must now BOTH fail closed, and B's session on A's box is
//     CLOSED with the session B opened from it. A's own root shell on their own box is
//     not. B can no longer act on the network from A's box: a row that outlived the
//     box's place on the WiFi kept placing B there at no address, and a third occupant's
//     log recorded the visit from `unknown`.
//   - A comes back. B's old session does not: B is a stranger to the box again.
//
// Net-new under test (the locally-untypechecked api/ runtime): that the by-machine_id
// resolvers behind resolveCrossPlayerFs and the patch-write L2 answer from occupancy —
// which means "on this WiFi" — and from nothing that outlives a disconnect; and that
// the disconnect's own delete names the box, whose visitors' rows then close.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testDisconnectedUnreachable.ts
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

// --- Identities: A (the target, who will disconnect), B (the attacker, who stays), and
//     C (a bystander on the same WiFi, whose web server B knocks on from A's box). ---
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();

const ESSID = 'DISCONNECT-WIFI';
const A_WS_NAME = 'quarantine';
const B_WS_NAME = 'watchtower';
const C_WS_NAME = 'lighthouse';
const A_WS = computeWorkstationId(A_WS_NAME, alice.publicKeyHex);
const C_WS = computeWorkstationId(C_WS_NAME, carol.publicKeyHex);

const B_SHELL = 'disconnect-b-1';
const B_HOP_FROM_A = 'disconnect-b-hop-from-a';
const A_OWN_ROOT = 'disconnect-a-own-su';

/** The address the server ISSUED this occupant on join — read back from the lease it
 *  allocated, never re-derived. The lease outlives the disconnect, so it is still
 *  readable afterwards; that is what lets A return to the same address on a rejoin. */
const leasedAddress = async (owner: ReturnType<typeof generateIdentity>): Promise<string> => {
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
const GUEST_PW = workstationGuestPassword(alice.publicKeyHex);

const WORLD_PID = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: ['root'] };
const WORLD_FILE = { read: ['root', 'user', 'guest'], write: ['root', 'user', 'guest'], execute: [] };

const get = (tree: Directory, ...segments: readonly string[]): FileNode | undefined => {
  let node: FileNode | undefined = tree;
  for (const segment of segments) {
    if (node === undefined || node.kind !== 'directory') return undefined;
    node = node.entries.get(segment);
  }
  return node;
};

const join = (owner: ReturnType<typeof generateIdentity>, wsName: string) =>
  signRequest(owner, 'registerNetwork', {
    essid: ESSID,
    workstation_machine_id: computeWorkstationId(wsName, owner.publicKeyHex),
    workstation_username: 'player',
    workstation_machine_name: wsName,
    workstation_root_hash: md5('root-secret'),
  });

const readAsBob = () => post(NETWORK, signRequest(bob, 'resolveCrossPlayerFs', { machine_id: A_WS }));

/** B, standing in the shell on A's box, fetches C's front page. */
const fetchCarolFromAlicesBox = (carolLan: string) =>
  post(
    NETWORK,
    signRequest(bob, 'resolveOccupantFetch', {
      essid: ESSID,
      target: carolLan,
      port: 80,
      path: '/',
      caller_machine_id: A_WS,
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
const errorOf = (body: unknown): string | undefined => (body as { error?: string } | null)?.error;

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

const writeAsBob = (path: string) =>
  post(
    PATCHES,
    signRequest(bob, 'upsertPatch', {
      machine_id: A_WS,
      path,
      content: 'left by B',
      owner: 'guest',
      permissions: WORLD_FILE,
      is_new: true,
      node_type: 'file',
    }),
  );

const clean = async () => {
  await sr.from('home_network_occupants').delete().eq('essid', ESSID);
  await sr.from('network_lan_leases').delete().eq('essid', ESSID);
  await sr.from('patches').delete().in('machine_id', [A_WS, C_WS]);
  await sr.from('sessions').delete().in('player_key', [bob.publicKeyHex, alice.publicKeyHex]);
};

// Clean slate.
await clean();

// B joins FIRST, A SECOND — see the join-order note above: A is the later joiner, so a
// store that kept only the latest occupant would still be holding exactly the player
// this check then disconnects.
await post(NETWORK, join(bob, B_WS_NAME));
await post(NETWORK, join(carol, C_WS_NAME));
await post(NETWORK, join(alice, A_WS_NAME));

const A_LAN = await leasedAddress(alice);
const C_LAN = await leasedAddress(carol);

const rootFile = (
  machineId: string,
  writer: ReturnType<typeof generateIdentity>,
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

// A's own `sshd` opens port 22 — seed its pidfile (a fresh ws is dark until a service
// runs) — and C serves a page, as her `nginx` and a root `nano` would leave it.
const SSHD_PID = formatPidfileContent(SERVICE_CATALOG.ssh, 22);
const NGINX_PID = formatPidfileContent(SERVICE_CATALOG.http, 80);
const seeded = await sr.from('patches').insert([
  rootFile(A_WS, alice, '/var/run/sshd.pid', SSHD_PID, WORLD_PID),
  rootFile(C_WS, carol, '/var/run/nginx.pid', NGINX_PID, WORLD_PID),
  rootFile(C_WS, carol, '/var/www/html/index.html', '<h1>lighthouse</h1>', ROOT_ONLY),
]);
if (seeded.error) {
  console.error(`FATAL: journal seed failed: ${seeded.error.message}`);
  process.exit(1);
}

// === 1. B ssh guest@<A's LAN IP> → a guest session on A's workstation. ===
const s1 = await post(
  SESSIONS,
  signRequest(bob, 'authCreateSessionSameLan', {
    session_id: B_SHELL,
    essid: ESSID,
    target_ip: A_LAN,
    username: 'guest',
    password: GUEST_PW,
  }),
);
check(
  'B authenticates same-LAN and lands a guest session on A’s workstation',
  s1.status === 200 && (s1.body as { machine_id?: string }).machine_id === A_WS,
  `status=${s1.status} machine_id=${(s1.body as { machine_id?: string }).machine_id}`,
);

// === 2. While A is ON the WiFi, B can read A's box — nobody need be at A's keyboard. ===
const s2 = await readAsBob();
const body2 = s2.body as { ok?: boolean; tree?: SerializedDirectory };
const tree2 = s2.status === 200 && body2.tree ? deserializeTree(body2.tree) : null;
check(
  'a box joined to the WiFi is readable across players, playing or not',
  s2.status === 200 && body2.ok === true && get(tree2 ?? ({} as Directory), 'bin', 'ls')?.kind === 'file',
  `status=${s2.status} ok=${body2.ok}`,
);

// === 3. ...and writable at the session's tier. ===
const s3 = await writeAsBob('/tmp/before-disconnect');
check(
  'a box joined to the WiFi is writable across players at the session tier',
  s3.status === 200,
  `status=${s3.status}`,
);

// === 3b. From the shell on A's box, B reaches the network as A's box does. ===
const s3b = await fetchCarolFromAlicesBox(C_LAN);
const log3b = await carolAccessLog();
check(
  'a shell on a box joined to the WiFi reaches a neighbour, logged from that box’s address',
  s3b.status === 200 && lineCount(log3b) === 1 && log3b.startsWith(`${A_LAN} - - [`),
  `status=${s3b.status} line=${log3b.trim()}`,
);

// B hops on from A's box, and A is root on their own machine: the two rows the
// disconnect must tell apart from B's shell — one standing on it, one that is A's own.
const stacked = await sr.from('sessions').insert([
  {
    session_id: B_HOP_FROM_A,
    player_key: bob.publicKeyHex,
    machine_id: C_WS,
    credentials: { username: 'guest', userType: 'guest' },
    kind: 'ssh',
    essid: ESSID,
    parent_session_id: B_SHELL,
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

// === 4. A runs `nmcli disconnect` — the one action that takes a machine off a WiFi. ===
const s4 = await post(NETWORK, signRequest(alice, 'unregisterOccupant', { essid: ESSID }));
const occAfter = await sr
  .from('home_network_occupants')
  .select('owner_key')
  .eq('essid', ESSID)
  .eq('owner_key', alice.publicKeyHex)
  .maybeSingle();
check(
  'nmcli disconnect removes A from occupancy, so A is on no network at all',
  s4.status === 200 && occAfter.data === null,
  `status=${s4.status} occupant=${occAfter.data !== null}`,
);

// === 4b. The box left, so every connection another player held to it dropped. ===
check(
  'B’s session on A’s box is closed, recorded as the box leaving its network',
  (await sessionState(B_SHELL)) === 'network_left',
  `session=${await sessionState(B_SHELL)}`,
);
check(
  'the session B opened from A’s box went down with it',
  (await sessionState(B_HOP_FROM_A)) === 'upstream_lost',
  `session=${await sessionState(B_HOP_FROM_A)}`,
);
check(
  'A’s own root shell on their own box is still open',
  (await sessionState(A_OWN_ROOT)) === 'open',
  `session=${await sessionState(A_OWN_ROOT)}`,
);

// === 4c. A repeat disconnect finds nobody to take off the network, and is no error. ===
const s4c = await post(NETWORK, signRequest(alice, 'unregisterOccupant', { essid: ESSID }));
check(
  'a repeat disconnect succeeds and closes nothing more',
  s4c.status === 200 && (await sessionState(A_OWN_ROOT)) === 'open',
  `status=${s4c.status} ownShell=${await sessionState(A_OWN_ROOT)}`,
);

// === 5. A's machine has left the network, so B can no longer READ it. ===
const s5 = await readAsBob();
check(
  'a machine on no network is unreachable — the cross-player read fails closed',
  s5.status !== 200,
  `status=${s5.status}`,
);

// === 6. ...nor WRITE it: B holds no session there any more. ===
const s6 = await writeAsBob('/tmp/after-disconnect');
const landed = await sr
  .from('patches')
  .select('path')
  .eq('machine_id', A_WS)
  .eq('path', '/tmp/after-disconnect')
  .maybeSingle();
check(
  'a machine on no network is unwritable — the write is refused and nothing lands',
  s6.status === 403 && landed.data === null,
  `status=${s6.status} row-written=${landed.data !== null}`,
);

// === 7. ...nor act on the network FROM it. While the row stayed open this fetch
//        answered 200, and C's log recorded it from `unknown`. ===
const s7 = await fetchCarolFromAlicesBox(C_LAN);
const log7 = await carolAccessLog();
check(
  'a box that left the network is nowhere to knock from — refused, and C’s log gains no line',
  s7.status === 403 && errorOf(s7.body) === 'no_session' && lineCount(log7) === 1,
  `status=${s7.status} error=${errorOf(s7.body)} lines=${lineCount(log7)}`,
);

// === 8. A comes back to the same WiFi. B's old session does not come back with the
//        box: B sees what any stranger sees, and must log in again to see more. ===
await post(NETWORK, join(alice, A_WS_NAME));
const s8 = await readAsBob();
const body8 = s8.body as { ok?: boolean; tree?: SerializedDirectory };
const tree8 = s8.status === 200 && body8.tree ? deserializeTree(body8.tree) : null;
const seesBinaries = get(tree8 ?? ({} as Directory), 'bin', 'ls') !== undefined;
const s8w = await writeAsBob('/tmp/after-return');
check(
  'when the box returns, B’s old session does not — no shell’s view of it, and no write',
  s8.status === 200 &&
    !seesBinaries &&
    s8w.status === 403 &&
    (await sessionState(B_SHELL)) === 'network_left',
  `read=${s8.status} sees /bin/ls=${seesBinaries} write=${s8w.status}`,
);

// Cleanup.
await clean();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
