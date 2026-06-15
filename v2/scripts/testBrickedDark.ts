// Wire-payload smoke for Story 4 slice 4: a BRICKED box goes dark to other players.
//
// The two cross-player server gates must materialize A's box (regenerated base +
// journal replay) and refuse to answer once A's /boot kernel is gone:
//   - POST /api/network  (resolvePublicScan)        → host-down / no ports
//   - POST /api/sessions (authCreateSessionPublic)   → 404 host_unreachable
// api/* is not typechecked locally, so this drives the REAL endpoints against a
// running `vercel dev`, first proving a HEALTHY A answers (control), then planting
// a /boot/vmlinuz tombstone and proving A drops off scans + refuses logins even
// with a CORRECT password. Self-cleaning.
//
// Usage (with v2 supabase + vercel dev running):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/testBrickedDark.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { md5 } from '../src/core/generation/md5';
import { workstationGuestPassword } from '../src/core/generation/workstationFs';

const NETWORK = process.env.ENDPOINT ?? 'http://localhost:3100/api/network';
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

const post = async (endpoint: string, envelope: unknown): Promise<{ status: number; body: unknown }> => {
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
const foundOf = (body: unknown): boolean | undefined =>
  typeof body === 'object' && body !== null ? (body as { found?: boolean }).found : undefined;
const portsOf = (body: unknown): readonly { port: number; service: string }[] =>
  typeof body === 'object' && body !== null ? ((body as { ports?: never[] }).ports ?? []) : [];

// --- Identities: A (owner/victim), B (the scanner / would-be guest). ---
const alice = generateIdentity();
const bob = generateIdentity();
const A_MACHINE = computeWorkstationId('skylab', alice.publicKeyHex);
const A_PUBLIC_IP = '203.0.113.66';
const ESSID = 'BEAN-THERE-WIFI';
const ROOT_HASH = md5('alice-root-secret');
const GUEST_PW = workstationGuestPassword(alice.publicKeyHex);

const worldReadable = { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] };
const bootPerms = { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] };

const seedRegistry = async () => {
  await sr.from('network_registry').delete().eq('public_ip', A_PUBLIC_IP);
  await sr.from('network_registry').insert({
    public_ip: A_PUBLIC_IP,
    owner_key: alice.publicKeyHex,
    workstation_machine_id: A_MACHINE,
    router_machine_id: A_MACHINE,
    forward_table: [{ publicPort: '*', targetMachineId: A_MACHINE }],
    essid: ESSID,
    workstation_username: 'alice',
    workstation_machine_name: 'skylab',
    workstation_root_hash: ROOT_HASH,
  });
};

const cleanup = async () => {
  await sr.from('network_registry').delete().eq('public_ip', A_PUBLIC_IP);
  await sr.from('patches').delete().eq('machine_id', A_MACHINE);
  await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);
};

await cleanup();
await seedRegistry();

const insertPatches = async (rows: readonly Record<string, unknown>[], label: string) => {
  const { error } = await sr.from('patches').insert(rows);
  if (error) {
    console.error(`FATAL: patch insert (${label}) failed:`, error.message);
    await cleanup();
    process.exit(1);
  }
};

// A is healthy + running sshd. The base FS carries /boot, so nothing to seed for
// "bootable"; just the pidfile so a healthy scan has a port to report.
await insertPatches(
  [
    { writer_key: alice.publicKeyHex, machine_id: A_MACHINE, path: '/var/run/sshd.pid', content: 'sshd:port=22', owner: 'root', permissions: worldReadable, node_type: 'file' },
  ],
  'sshd pidfile',
);

// === CONTROL: a healthy A answers the network ===

const scanHealthy = await post(NETWORK, signRequest(bob, 'resolvePublicScan', { target: A_PUBLIC_IP }));
check(
  'healthy A → scan reports host up with the sshd port',
  scanHealthy.status === 200 &&
    foundOf(scanHealthy.body) === true &&
    portsOf(scanHealthy.body).some((entry) => entry.port === 22 && entry.service === 'ssh'),
  `status=${scanHealthy.status} found=${foundOf(scanHealthy.body)} ports=${JSON.stringify(portsOf(scanHealthy.body))}`,
);

const sshHealthy = await post(
  SESSIONS,
  signRequest(bob, 'authCreateSessionPublic', {
    session_id: `ssh-bob-healthy-${Date.now()}`,
    target: A_PUBLIC_IP,
    username: 'guest',
    password: GUEST_PW,
  }),
);
check(
  'healthy A → ssh guest login succeeds (200)',
  sshHealthy.status === 200 && errorOf(sshHealthy.body) === undefined,
  `status=${sshHealthy.status} error=${errorOf(sshHealthy.body)}`,
);

// Drop the control session so the bricked-case "no session inserted" check is clean.
await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);

// === BRICK A: a root rm /boot/vmlinuz tombstone on the shared journal ===
// content:null is the deletion marker; node_type stays 'file' (the table default
// removePatch relies on) so applyPatches treats it as a file deletion.
await insertPatches(
  [
    { writer_key: bob.publicKeyHex, machine_id: A_MACHINE, path: '/boot/vmlinuz', content: null, owner: 'root', permissions: bootPerms, node_type: 'file' },
  ],
  'boot tombstone',
);

// === BRICKED: A goes dark to scans + refuses logins ===

const scanBricked = await post(NETWORK, signRequest(bob, 'resolvePublicScan', { target: A_PUBLIC_IP }));
check(
  'bricked A → scan reports host down, no ports (despite the lingering sshd pidfile)',
  scanBricked.status === 200 && foundOf(scanBricked.body) === false && portsOf(scanBricked.body).length === 0,
  `status=${scanBricked.status} found=${foundOf(scanBricked.body)} ports=${JSON.stringify(portsOf(scanBricked.body))}`,
);

const sshBrickedGuest = await post(
  SESSIONS,
  signRequest(bob, 'authCreateSessionPublic', {
    session_id: `ssh-bob-bricked-${Date.now()}`,
    target: A_PUBLIC_IP,
    username: 'guest',
    password: GUEST_PW,
  }),
);
check(
  'bricked A → ssh guest login refused as host_unreachable (correct password)',
  sshBrickedGuest.status === 404 && errorOf(sshBrickedGuest.body) === 'host_unreachable',
  `status=${sshBrickedGuest.status} error=${errorOf(sshBrickedGuest.body)}`,
);

const sshBrickedRoot = await post(
  SESSIONS,
  signRequest(bob, 'authCreateSessionPublic', {
    session_id: `ssh-bob-bricked-root-${Date.now()}`,
    target: A_PUBLIC_IP,
    username: 'root',
    password: 'alice-root-secret',
  }),
);
check(
  'bricked A → even a CORRECT root password is refused as host_unreachable',
  sshBrickedRoot.status === 404 && errorOf(sshBrickedRoot.body) === 'host_unreachable',
  `status=${sshBrickedRoot.status} error=${errorOf(sshBrickedRoot.body)}`,
);

// No session may have been created against the dead box.
const { data: bobSessions } = await sr
  .from('sessions')
  .select('session_id')
  .eq('player_key', bob.publicKeyHex)
  .is('ended_at', null);
check(
  'bricked A → no session row was inserted for B',
  (bobSessions?.length ?? 0) === 0,
  `bob sessions on file=${bobSessions?.length ?? 0}`,
);

await cleanup();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
