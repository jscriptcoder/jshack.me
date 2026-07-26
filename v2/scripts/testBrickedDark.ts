// Wire-payload smoke for Story 4 slice 4 + Story 5.1.2: a BRICKED box goes dark to
// other players, and a cross-player ssh routes by destination port.
//
// Story 5.1.2: the public IP is the ROUTER's for BOTH paths now — `nmap` resolves
// the router and `ssh :22` lands ON the router (validated against its seeded admin
// password, session on router_machine_id). The two cross-player server gates must
// materialize A's ROUTER (seeded base + journal replay) and refuse once its /boot
// kernel is gone:
//   - POST /api/network  (resolvePublicScan)        → host-down / no ports
//   - POST /api/sessions (authCreateSessionPublic)   → 404 host_unreachable
// api/ runtime correctness (column names, the narrowed registry select, real signed
// envelopes) isn't covered by typecheck or unit tests, so this drives the REAL
// endpoints against a running `vercel dev`: first a HEALTHY A answers (router :22
// scan + root login; an unforwarded -p 2222 is host_unreachable), then a
// /boot/vmlinuz tombstone proves A drops off scans + refuses logins even with the
// CORRECT admin password. Self-cleaning.
//
// Usage (with v2 supabase + vercel dev running):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/testBrickedDark.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { md5 } from '../src/core/generation/md5';
import { seedApGatewayAdminPw } from '../src/core/generation/routerFs';

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
const foundOf = (body: unknown): boolean | undefined =>
  typeof body === 'object' && body !== null ? (body as { found?: boolean }).found : undefined;
const portsOf = (body: unknown): readonly { port: number; service: string }[] =>
  typeof body === 'object' && body !== null ? ((body as { ports?: never[] }).ports ?? []) : [];
const machineIdOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null
    ? (body as { machine_id?: string }).machine_id
    : undefined;

// --- Identities: A (owner/victim), B (the scanner / would-be guest). ---
const alice = generateIdentity();
const bob = generateIdentity();
const A_MACHINE = computeWorkstationId('skylab', alice.publicKeyHex);
// Story 5.1.1b: the public IP now resolves to A's ROUTER (a distinct machine) for
// scans; ssh still lands on the workstation until 5.1.2. So a bricked-box wire-check
// must darken BOTH boxes — each keyed on its own machine id / journal.
const ESSID = 'BEAN-THERE-WIFI';
const A_ROUTER = computeApGatewayId(ESSID);
const A_PUBLIC_IP = '203.0.113.66';
const ROOT_HASH = md5('alice-root-secret');
// The gateway's admin password — server-recoverable from the ESSID alone, the
// credential B types to log into the gateway over the public IP.
const ROUTER_ADMIN_PW = seedApGatewayAdminPw(ESSID);

const bootPerms = { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] };

const seedRegistry = async () => {
  await sr.from('network_registry').delete().eq('public_ip', A_PUBLIC_IP);
  await sr.from('network_registry').insert({
    public_ip: A_PUBLIC_IP,
    owner_key: alice.publicKeyHex,
    workstation_machine_id: A_MACHINE,
    router_machine_id: A_ROUTER,
    essid: ESSID,
    workstation_username: 'alice',
    workstation_machine_name: 'skylab',
    workstation_root_hash: ROOT_HASH,
  });
};

const cleanup = async () => {
  await sr.from('network_registry').delete().eq('public_ip', A_PUBLIC_IP);
  await sr.from('patches').delete().eq('machine_id', A_MACHINE);
  await sr.from('patches').delete().eq('machine_id', A_ROUTER);
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

// Nothing to seed for a healthy A: the router's own sshd:22 lives in its seeded
// base FS, so BOTH the scan (resolves the router) and the ssh gate (routes :22 to
// the router) report it with an empty journal.

// === CONTROL: a healthy A answers the network ===

const scanHealthy = await post(
  NETWORK,
  signRequest(bob, 'resolvePublicScan', { target: A_PUBLIC_IP }),
);
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
    username: 'root',
    password: ROUTER_ADMIN_PW,
  }),
);
check(
  'healthy A → ssh root :22 lands on the ROUTER (200, session on router_machine_id)',
  sshHealthy.status === 200 && machineIdOf(sshHealthy.body) === A_ROUTER,
  `status=${sshHealthy.status} machine_id=${machineIdOf(sshHealthy.body)} error=${errorOf(sshHealthy.body)}`,
);

// An unforwarded destination port: the opt-in default ships no NAT forward, so the
// router serves nothing on :2222 — host_unreachable, before any password check.
const sshNoForward = await post(
  SESSIONS,
  signRequest(bob, 'authCreateSessionPublic', {
    session_id: `ssh-bob-noforward-${Date.now()}`,
    target: A_PUBLIC_IP,
    username: 'root',
    password: ROUTER_ADMIN_PW,
    port: 2222,
  }),
);
check(
  'healthy A → ssh to an unforwarded port (-p 2222) is host_unreachable (opt-in default)',
  sshNoForward.status === 404 && errorOf(sshNoForward.body) === 'host_unreachable',
  `status=${sshNoForward.status} error=${errorOf(sshNoForward.body)}`,
);

// Drop the control session so the bricked-case "no session inserted" check is clean.
await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);

// === BRICK A: a root rm /boot/vmlinuz tombstone on the ROUTER's journal ===
// Story 5.1.2: the public IP is the router's for BOTH scan and ssh, so bricking the
// ROUTER alone takes the whole public IP dark. content:null is the deletion marker;
// node_type stays 'file' (the table default removePatch relies on) so applyPatches
// treats it as a file deletion.
await insertPatches(
  [
    {
      writer_key: bob.publicKeyHex,
      machine_id: A_ROUTER,
      path: '/boot/vmlinuz',
      content: null,
      owner: 'root',
      permissions: bootPerms,
      node_type: 'file',
    },
  ],
  'router boot tombstone',
);

// === BRICKED: A goes dark to scans + refuses logins ===

const scanBricked = await post(
  NETWORK,
  signRequest(bob, 'resolvePublicScan', { target: A_PUBLIC_IP }),
);
check(
  'bricked A → scan reports host down, no ports (router kernel gone → public IP dark)',
  scanBricked.status === 200 &&
    foundOf(scanBricked.body) === false &&
    portsOf(scanBricked.body).length === 0,
  `status=${scanBricked.status} found=${foundOf(scanBricked.body)} ports=${JSON.stringify(portsOf(scanBricked.body))}`,
);

const sshBrickedRoot = await post(
  SESSIONS,
  signRequest(bob, 'authCreateSessionPublic', {
    session_id: `ssh-bob-bricked-root-${Date.now()}`,
    target: A_PUBLIC_IP,
    username: 'root',
    password: ROUTER_ADMIN_PW,
  }),
);
check(
  'bricked A → even the CORRECT router admin password is refused as host_unreachable',
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
