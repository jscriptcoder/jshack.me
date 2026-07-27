// Wire-payload smoke for the same-LAN cross-player FS read: every occupant of a shared
// AP is reachable, no matter who joined first. This pins the fix for a bug where a
// fellow occupant B who `ssh`'d into A over the shared LAN saw `ls`/`cat`/`su` report
// "command not found" — A's identity was held in a store keyed by the ESSID-shared
// public IP, so a later joiner overwrote it, the cross-player FS read 404'd, and B's
// served root came back empty.
//
// Drives the REAL endpoints against a running `vercel dev` + supabase:
//   - A then B JOIN the same ESSID via /api/network (registerNetwork). Join ORDER is
//     the point: A goes first, so anything that keeps only the latest joiner loses A.
//   - B `ssh guest@<A's LAN IP>` via /api/sessions (authCreateSessionSameLan) → a guest
//     session lands on A's workstation id.
//   - B resolveCrossPlayerFs(A's ws id) via /api/network → 200, and the served tree
//     carries A's world-readable /bin/ls.
//
// Net-new under test (the locally-untypechecked api/ runtime): that
// findOccupantWorkstationByMachineId — keyed (essid, owner_key), so occupants coexist —
// is what the resolveCrossPlayerFs action resolves A's box from.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSameLanCrossPlayerFs.ts
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

// --- Identities: A (the earlier joiner / target), B (the later joiner / attacker). ---
const alice = generateIdentity();
const bob = generateIdentity();

const ESSID = 'CROSSFS-LAN-WIFI';
const A_WS_NAME = 'skylab';
const B_WS_NAME = 'nebuchadnezzar';
const A_WS = computeWorkstationId(A_WS_NAME, alice.publicKeyHex);
/** The address the server ISSUED this occupant on join — read back from the lease it
 *  allocated, never re-derived. The lease is the address of record; deriving one here
 *  would be asserting against a second source of truth. */
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

// Clean slate.
await sr.from('network_public_ips').delete().eq('essid', ESSID);
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('network_lan_leases').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', A_WS);
await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);

// A joins FIRST, then B joins the SAME ESSID. Both go through the real endpoint, so if
// anything on the join path kept only the latest occupant, A would genuinely be gone.
await post(NETWORK, join(alice, A_WS_NAME));
await post(NETWORK, join(bob, B_WS_NAME));

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

// === 1. Both joiners are live occupants — a later joiner displaces nobody. ===
const occ = await sr.from('home_network_occupants').select('owner_key').eq('essid', ESSID);
check(
  'both players are occupants of the shared ESSID (PK (essid, owner_key))',
  (occ.data ?? []).length === 2,
  `occupants=${(occ.data ?? []).length}`,
);

// === 2. B (occupant) ssh guest@<A's LAN IP> → 200, guest session on A's workstation. ===
const s2 = await post(
  SESSIONS,
  signRequest(bob, 'authCreateSessionSameLan', {
    session_id: 'crossfs-b-1',
    essid: ESSID,
    target_ip: A_LAN,
    username: 'guest',
    password: GUEST_PW,
  }),
);
const landed = (s2.body as { machine_id?: string }).machine_id;
check(
  'B authenticates same-LAN and lands a guest session on A’s workstation id',
  s2.status === 200 && landed === A_WS,
  `status=${s2.status} machine_id=${landed}`,
);

// === 3. B's cross-player FS read of A resolves from A's occupancy row, and the served
//        tree carries A's world-readable /bin/ls (so ls/cat/su run). ===
const s3 = await post(NETWORK, signRequest(bob, 'resolveCrossPlayerFs', { machine_id: A_WS }));
const body3 = s3.body as { ok?: boolean; tree?: SerializedDirectory };
const tree = s3.status === 200 && body3.tree ? deserializeTree(body3.tree) : null;
const ls = tree ? get(tree, 'bin', 'ls') : undefined;
check(
  'B’s cross-player read of A resolves from A’s occupancy row and serves A’s /bin/ls',
  s3.status === 200 && body3.ok === true && ls?.kind === 'file',
  `status=${s3.status} ok=${body3.ok} bin/ls=${ls?.kind ?? 'absent'}`,
);

// Cleanup.
await sr.from('network_public_ips').delete().eq('essid', ESSID);
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('network_lan_leases').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', A_WS);
await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
