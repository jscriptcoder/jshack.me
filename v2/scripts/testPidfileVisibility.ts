// Wire-check: does a pidfile a DAEMON wrote survive the trip to a visitor?
//
// A player standing on someone else's box runs `ps` and expects to see what it is
// running. That answer is decided server-side, long before `ps` executes: the
// server replays the box's journal over its regenerated baseline and prunes the
// result to what the caller's tier may read. So the permissions `bringUp` stamps
// on `/var/run/<name>.pid` decide, one hop later, whether the box looks like it
// is serving anything at all.
//
// A unit test cannot see that. It builds a tree directly and never crosses the
// projection, which is exactly how the defect this closes survived a green suite:
// `ps` on an entered box printed a bare header while that box was running the
// sshd the visitor had just logged in through. The cause was `bringUp` passing no
// `permissions` and taking the write's fall-back — the CALLER's tier defaults,
// and a daemon is root-only, so `read: ['root']`.
//
// Path, content and permissions are all derived from the production modules
// (`services/pidfile`, `serviceCatalog`), never hand-written: a literal here
// could agree with itself while disagreeing with what a daemon actually writes.
//
// Check 3 is the one that would have FOUND the bug. It seeds a second pidfile
// wearing the old, root-only shape and asserts the visitor cannot see it — which
// pins the mechanism rather than the symptom. Without it, checks 1 and 2 could
// pass for reasons that have nothing to do with permissions.
//
// Drives the REAL endpoints against a running `vercel dev` + local supabase.
//
// Usage (from v2/, with supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testPidfileVisibility.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { md5 } from '../src/core/generation/md5';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec';
import { defaultFilePermissions } from '../src/core/filesystem/defaultPermissions';
import type { Directory, FileNode } from '../src/core/filesystem/types';
import {
  formatPidfileContent,
  pidfilePath,
  PIDFILE_PERMISSIONS,
} from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { clearPublicIps, seedPublicIps } from './networkFixture';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
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

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

const nodeAt = (tree: Directory, ...segments: readonly string[]): FileNode | undefined => {
  let node: FileNode | undefined = tree;
  for (const segment of segments) {
    if (node === undefined || node.kind !== 'directory') return undefined;
    node = node.entries.get(segment);
  }
  return node;
};

// --- The world under test ------------------------------------------------------

const ESSID = 'PIDFILE-VISIBILITY-WIFI';
const PUBLIC_IP = '203.0.113.77';
const OWNER_HOSTNAME = 'skylab';

const owner = generateIdentity();
const visitor = generateIdentity();
const OWNER_MACHINE = computeWorkstationId(OWNER_HOSTNAME, owner.publicKeyHex);

// What a daemon writes, taken from the modules that decide it.
const SSH_PIDFILE = pidfilePath(SERVICE_CATALOG.ssh);
const SSH_CONTENT = formatPidfileContent(SERVICE_CATALOG.ssh, 22);

// The shape `bringUp` produced BEFORE the fix: a root-only write's tier defaults.
// Seeded on a second service so the two shapes are compared side by side on one box.
const FTP_PIDFILE = pidfilePath(SERVICE_CATALOG.ftp);
const FTP_CONTENT = formatPidfileContent(SERVICE_CATALOG.ftp, 21);
const ROOT_ONLY_PERMISSIONS = defaultFilePermissions('root');

const seedSession = async (userType: 'guest' | 'user') => {
  await sr.from('sessions').delete().eq('player_key', visitor.publicKeyHex);
  await sr.from('sessions').insert({
    session_id: `pidfile-${userType}-${OWNER_MACHINE}`,
    player_key: visitor.publicKeyHex,
    machine_id: OWNER_MACHINE,
    credentials: { username: userType, userType },
    kind: 'ssh',
    essid: ESSID,
  });
};

/** The box as the server hands it to the visitor, or null when it refused. */
const treeAsVisitorSeesIt = async (): Promise<Directory | null> => {
  const response = await post(
    NETWORK,
    signRequest(visitor, 'resolveCrossPlayerFs', { machine_id: OWNER_MACHINE }),
  );
  if (response.status !== 200) return null;
  return deserializeTree((response.body as { tree: SerializedDirectory }).tree);
};

// --- Setup ---------------------------------------------------------------------
// Cleared at SETUP, not only at teardown: a crashed run would otherwise leave rows
// the next run reads as its own.
await clearPublicIps(sr, [{ essid: ESSID, publicIp: PUBLIC_IP }]);
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', OWNER_MACHINE);
await sr.from('sessions').delete().eq('player_key', visitor.publicKeyHex);

await seedPublicIps(sr, [{ essid: ESSID, publicIp: PUBLIC_IP }]);
await sr.from('home_network_occupants').insert({
  essid: ESSID,
  owner_key: owner.publicKeyHex,
  workstation_machine_id: OWNER_MACHINE,
  workstation_username: 'owner',
  workstation_machine_name: OWNER_HOSTNAME,
  workstation_root_hash: md5('owner-root-secret'),
});

await sr.from('patches').insert([
  {
    writer_key: owner.publicKeyHex,
    machine_id: OWNER_MACHINE,
    path: SSH_PIDFILE,
    content: SSH_CONTENT,
    owner: 'root',
    permissions: PIDFILE_PERMISSIONS,
    node_type: 'file',
  },
  {
    writer_key: owner.publicKeyHex,
    machine_id: OWNER_MACHINE,
    path: FTP_PIDFILE,
    content: FTP_CONTENT,
    owner: 'root',
    permissions: ROOT_ONLY_PERMISSIONS,
    node_type: 'file',
  },
]);

console.log(`owner box   ${OWNER_MACHINE}`);
console.log(`daemon pidfile   ${SSH_PIDFILE}  ${JSON.stringify(PIDFILE_PERMISSIONS.read)}`);
console.log(`root-only pidfile ${FTP_PIDFILE}  ${JSON.stringify(ROOT_ONLY_PERMISSIONS.read)}`);
console.log('');

// === 1. A guest-tier visitor is handed the pidfile a daemon wrote ==============
await seedSession('guest');
const guestTree = await treeAsVisitorSeesIt();
const guestSsh = guestTree === null ? undefined : nodeAt(guestTree, 'var', 'run', 'sshd.pid');
check(
  'a guest-session visitor is handed the daemon pidfile, content intact',
  guestSsh?.kind === 'file' && guestSsh.content === SSH_CONTENT,
  guestSsh?.kind === 'file' ? `present, "${guestSsh.content}"` : 'absent',
);

// === 2. Same for a user-tier visitor ==========================================
// Both tiers below root are pruned by the same walker, so a fix that reached only
// one of them would be a rule with a hole in it.
await seedSession('user');
const userTree = await treeAsVisitorSeesIt();
const userSsh = userTree === null ? undefined : nodeAt(userTree, 'var', 'run', 'sshd.pid');
check(
  'a user-session visitor is handed it too',
  userSsh?.kind === 'file' && userSsh.content === SSH_CONTENT,
  userSsh?.kind === 'file' ? `present, "${userSsh.content}"` : 'absent',
);

// === 3. The old root-only shape is still pruned — the check that finds the bug ==
// The server prunes on the file's OWN permissions. If this pidfile were visible,
// checks 1 and 2 would be passing for some reason other than the one claimed, and
// the fix would not be load-bearing.
const userFtp = userTree === null ? undefined : nodeAt(userTree, 'var', 'run', 'vsftpd.pid');
check(
  'a pidfile wearing the OLD root-only shape is still pruned away',
  userFtp === undefined,
  userFtp === undefined ? 'absent, as a root-only file must be' : 'VISIBLE — pruning is not happening',
);

// === 4. The read tier widened; the write tier did not =========================
// Seeing what a box runs is recon. Being able to edit what it claims to run would
// let any visitor close a door, or fake one open, without ever elevating.
const forgery = await post(
  PATCHES,
  signRequest(visitor, 'upsertPatch', {
    machine_id: OWNER_MACHINE,
    path: SSH_PIDFILE,
    content: formatPidfileContent(SERVICE_CATALOG.ssh, 9999),
    owner: 'root',
    permissions: PIDFILE_PERMISSIONS,
    node_type: 'file',
  }),
);
const { data: rewritten } = await sr
  .from('patches')
  .select('writer_key')
  .eq('machine_id', OWNER_MACHINE)
  .eq('path', SSH_PIDFILE)
  .eq('writer_key', visitor.publicKeyHex);
check(
  'a user-tier visitor still cannot rewrite that pidfile',
  forgery.status === 403 && errorOf(forgery.body) === 'permission_denied' && rewritten?.length === 0,
  `status ${forgery.status} ${errorOf(forgery.body) ?? '-'}, visitor rows ${rewritten?.length ?? 0}`,
);

// --- Teardown ------------------------------------------------------------------
await sr.from('patches').delete().eq('machine_id', OWNER_MACHINE);
await sr.from('sessions').delete().eq('player_key', visitor.publicKeyHex);
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await clearPublicIps(sr, [{ essid: ESSID, publicIp: PUBLIC_IP }]);

const failed = results.filter((result) => !result.pass).length;
console.log('');
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
