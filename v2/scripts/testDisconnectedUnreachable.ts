// Wire-payload smoke for the rule that being on a WiFi is what makes a machine
// reachable. A box joined to an ESSID is running and attackable around the clock —
// nobody has to be at the keyboard — and the ONLY thing that takes it off the network
// is an explicit in-game `nmcli disconnect`. A machine on no network is unreachable by
// every cross-player path.
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
//   - B's read and write of A must now BOTH fail closed. B's session is untouched and
//     still valid; what has gone is A's machine, not B's credential.
//
// Net-new under test (the locally-untypechecked api/ runtime): that the by-machine_id
// resolvers behind resolveCrossPlayerFs and the patch-write L2 answer from occupancy —
// which means "on this WiFi" — and from nothing that outlives a disconnect.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testDisconnectedUnreachable.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { lanAddressFor } from '../src/core/network/lanAddress';
import { formatPidfileContent } from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { md5 } from '../src/core/generation/md5';
import { workstationGuestPassword } from '../src/core/generation/workstationFs';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec';
import type { Directory, FileNode } from '../src/core/filesystem/types';

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

// --- Identities: A (the target, who will disconnect), B (the attacker, who stays). ---
const alice = generateIdentity();
const bob = generateIdentity();

const ESSID = 'DISCONNECT-WIFI';
const A_WS_NAME = 'quarantine';
const B_WS_NAME = 'watchtower';
const A_WS = computeWorkstationId(A_WS_NAME, alice.publicKeyHex);

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
  await sr.from('network_public_ips').delete().eq('essid', ESSID);
  await sr.from('home_network_occupants').delete().eq('essid', ESSID);
  await sr.from('network_lan_leases').delete().eq('essid', ESSID);
  await sr.from('patches').delete().eq('machine_id', A_WS);
  await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);
};

// Clean slate.
await clean();

// B joins FIRST, A SECOND — so the registry row (PK = the shared public_ip) is A's, and
// the ghost this pins belongs to the player who will disconnect.
await post(NETWORK, join(bob, B_WS_NAME));
await post(NETWORK, join(alice, A_WS_NAME));

const A_LAN = await leasedAddress(alice);

// A's own `sshd` opens port 22 — seed its pidfile (a fresh ws is dark until a service runs).
await sr.from('patches').insert([
  {
    machine_id: A_WS,
    path: '/var/run/sshd.pid',
    content: formatPidfileContent(SERVICE_CATALOG.ssh, 22),
    owner: 'root',
    permissions: WORLD_PID,
    node_type: 'file',
    writer_key: alice.publicKeyHex,
    updated_at: new Date().toISOString(),
  },
]);

// === 1. B ssh guest@<A's LAN IP> → a guest session on A's workstation. ===
const s1 = await post(
  SESSIONS,
  signRequest(bob, 'authCreateSessionSameLan', {
    session_id: 'disconnect-b-1',
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

// === 4. A runs `nmcli disconnect` — the one action that takes a machine off a WiFi. ===
await post(NETWORK, signRequest(alice, 'unregisterOccupant', { essid: ESSID }));
const occAfter = await sr
  .from('home_network_occupants')
  .select('owner_key')
  .eq('essid', ESSID)
  .eq('owner_key', alice.publicKeyHex)
  .maybeSingle();
check(
  'nmcli disconnect removes A from occupancy, so A is on no network at all',
  occAfter.data === null,
  `occupant=${occAfter.data !== null}`,
);

// === 5. A's machine has left the network, so B can no longer READ it. ===
const s5 = await readAsBob();
check(
  'a machine on no network is unreachable — the cross-player read fails closed',
  s5.status !== 200,
  `status=${s5.status}`,
);

// === 6. ...nor WRITE it. B's session is still perfectly valid; A's machine is simply
//        not on a network any more, so there is nothing for the write to land on. ===
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

// Cleanup.
await clean();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
