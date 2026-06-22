// Wire-payload smoke for the same-LAN cross-player FS read fallback. Reproduces the
// Story-7 capstone bug: a fellow occupant B who `ssh`'d into A over the shared LAN saw
// `ls`/`cat`/`su` report "command not found", because the WAN registry (PK = the
// ESSID-shared public_ip, last-writer-wins) had A's row OVERWRITTEN by a later joiner,
// so the cross-player FS read 404'd and B's served root was empty.
//
// Drives the REAL endpoints against a running `vercel dev` + supabase:
//   - A then B JOIN the same ESSID via /api/network (registerNetwork). Because the
//     public_ip is essid-derived, B's join EVICTS A from network_registry — the precise
//     production condition (confirmed by check 1).
//   - B `ssh guest@<A's LAN IP>` via /api/sessions (authCreateSessionSameLan) → a guest
//     session lands on A's workstation id.
//   - B resolveCrossPlayerFs(A's ws id) via /api/network → 200, and the served tree
//     carries A's world-readable /bin/ls. BEFORE the fix this was 404/empty (the bug);
//     AFTER it, the occupancy table (never overwritten) resolves A's box.
//
// Net-new under test (the locally-untypechecked api/ runtime): the
// findOccupantWorkstationByMachineId fallback wired into the resolveCrossPlayerFs action.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSameLanCrossPlayerFs.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { assignHomeNetwork } from '../src/core/network/homeNetwork';
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
const B_WS = computeWorkstationId(B_WS_NAME, bob.publicKeyHex);
const A_LAN = assignHomeNetwork(alice.publicKeyHex, ESSID).localIp;
const PUBLIC_IP = assignHomeNetwork(alice.publicKeyHex, ESSID).publicIp; // shared by both
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
await sr.from('network_registry').delete().eq('public_ip', PUBLIC_IP);
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', A_WS);
await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);

// A joins FIRST, then B joins the SAME ESSID — B's registry upsert overwrites A's row
// (shared public_ip PK). Both join via the real endpoint, so the eviction is genuine.
await post(NETWORK, join(alice, A_WS_NAME));
await post(NETWORK, join(bob, B_WS_NAME));

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

// === 1. The bug precondition: A is EVICTED from network_registry by B's later join. ===
const regForA = await sr
  .from('network_registry')
  .select('workstation_machine_id')
  .eq('workstation_machine_id', A_WS)
  .maybeSingle();
const regForB = await sr
  .from('network_registry')
  .select('workstation_machine_id')
  .eq('workstation_machine_id', B_WS)
  .maybeSingle();
check(
  'a later same-ESSID joiner evicts the earlier occupant from network_registry (shared public_ip)',
  regForA.data === null && (regForB.data as { workstation_machine_id?: string } | null) !== null,
  `registry-has-A=${regForA.data !== null} registry-has-B=${regForB.data !== null}`,
);

// === 2. ...but both remain live occupants (the never-overwritten table). ===
const occ = await sr.from('home_network_occupants').select('owner_key').eq('essid', ESSID);
check(
  'both players remain in home_network_occupants (PK (essid, owner_key))',
  (occ.data ?? []).length === 2,
  `occupants=${(occ.data ?? []).length}`,
);

// === 3. B (occupant) ssh guest@<A's LAN IP> → 200, guest session on A's workstation. ===
const s3 = await post(
  SESSIONS,
  signRequest(bob, 'authCreateSessionSameLan', {
    session_id: 'crossfs-b-1',
    essid: ESSID,
    target_ip: A_LAN,
    username: 'guest',
    password: GUEST_PW,
  }),
);
const landed = (s3.body as { machine_id?: string }).machine_id;
check(
  'B authenticates same-LAN and lands a guest session on A’s workstation id',
  s3.status === 200 && landed === A_WS,
  `status=${s3.status} machine_id=${landed}`,
);

// === 4. THE FIX: B's cross-player FS read of A resolves via the occupancy fallback,
//        and the served tree carries A's world-readable /bin/ls (so ls/cat/su run). ===
const s4 = await post(NETWORK, signRequest(bob, 'resolveCrossPlayerFs', { machine_id: A_WS }));
const body4 = s4.body as { ok?: boolean; tree?: SerializedDirectory };
const tree = s4.status === 200 && body4.tree ? deserializeTree(body4.tree) : null;
const ls = tree ? get(tree, 'bin', 'ls') : undefined;
check(
  'B’s cross-player read of A resolves via the occupancy fallback and serves A’s /bin/ls',
  s4.status === 200 && body4.ok === true && ls?.kind === 'file',
  `status=${s4.status} ok=${body4.ok} bin/ls=${ls?.kind ?? 'absent'}`,
);

// Cleanup.
await sr.from('network_registry').delete().eq('public_ip', PUBLIC_IP);
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', A_WS);
await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
