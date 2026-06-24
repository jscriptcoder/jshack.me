// Wire-payload smoke for Story 5b.1b-ii — `ssh user@<inner>:<fwd port>` through a NAT
// forward on the player's OWN inner gateway, landing a session on the hidden Layer-2
// host. Drives the REAL /api/sessions (authCreateSessionInnerGateway) + /api/patches
// endpoints against a running `vercel dev` + supabase, seeding alice's root session on
// the gateway via service_role so her own-box write to rules.v4 passes the L1/L2 gate.
//
// Net-new under test (the locally-untypechecked api/ runtime): the auth handler
// regenerates the gateway from the verified pubkey + essid, replays its journal
// (canBoot gate), routes the forwarded port via machineServing onto the deep NPC,
// validates the password against ITS /etc/passwd, and inserts a session on the DEEP
// host's machine id — not the gateway's. The deep layer stays private (no registry).
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testInnerGatewayReach.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no inner gateway.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeInnerGatewayId } from '../src/core/identity/router';
import { seedInnerGatewayAdminPw } from '../src/core/generation/routerFs';
import { generateHomeLan } from '../src/core/generation/generateHomeLan';
import { generateDeepLayer, buildDeepHostFs } from '../src/core/generation/generateDeepLayer';
import { hostMachineId } from '../src/core/generation/remoteHostId';
import { accountIn } from '../src/core/sessions/passwdAccount';
import { md5 } from '../src/core/generation/md5';
import { WEAK_PASSWORDS } from '../src/core/generation/remoteHostFs';

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

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;
const machineOf = (body: unknown): string | undefined =>
  (body as { machine_id?: string } | null)?.machine_id;
const userTypeOf = (body: unknown): string | undefined =>
  (body as { userType?: string } | null)?.userType;

// --- The owner (alice). She reaches her OWN deep layer; depth is single-player. ---
const alice = generateIdentity();
const ESSID = 'ABSTERGO-NET';

const innerGateway = generateHomeLan(alice.publicKeyHex, ESSID).hosts.find(
  (host) => host.kind === 'router' && Number(host.ip.split('.')[3]) !== 1,
);
if (innerGateway === undefined) {
  console.error('no inner gateway on the generated LAN');
  process.exit(2);
}
const INNER_IP = innerGateway.ip;
const INNER_OCTET = Number(INNER_IP.split('.')[3]);
const INNER_GW_ID = computeInnerGatewayId(alice.publicKeyHex, INNER_OCTET);
const GATEWAY_ROOT_PW = seedInnerGatewayAdminPw(alice.publicKeyHex, INNER_OCTET);

const deep = generateDeepLayer(alice.publicKeyHex, ESSID, { machineId: INNER_GW_ID, kind: 'router' });
const DEEP_IP = deep.host.ip;
const DEEP_ID = hostMachineId(deep.host, ESSID);
const guestAccount = accountIn(buildDeepHostFs(alice.publicKeyHex, ESSID, deep.host), 'guest');
if (guestAccount === null) {
  console.error('no guest account on the deep host');
  process.exit(2);
}
const DEEP_GUEST_PW = WEAK_PASSWORDS.find((candidate) => md5(candidate) === guestAccount.hash);
if (DEEP_GUEST_PW === undefined) {
  console.error('cannot recover the deep host guest password');
  process.exit(2);
}

const RULES = '/etc/iptables/rules.v4';
const VMLINUZ = '/boot/vmlinuz';
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };
const liveForward = `# NAT port-forward table\nforward 2222 to ${DEEP_IP}:22\n`;

const reach = (over: Record<string, unknown>) =>
  post(
    SESSIONS,
    signRequest(alice, 'authCreateSessionInnerGateway', {
      session_id: `reach-${Math.round(performance.now())}-${Math.random()}`,
      essid: ESSID,
      target: INNER_IP,
      username: 'guest',
      password: DEEP_GUEST_PW,
      port: 2222,
      parent_session_id: null,
      source_ip: null,
      ...over,
    }),
  );

const sessionRowsOn = async (machineId: string): Promise<number> => {
  const { data } = await sr
    .from('sessions')
    .select('machine_id')
    .eq('player_key', alice.publicKeyHex)
    .eq('machine_id', machineId);
  return data?.length ?? 0;
};

// Clean slate, then seed alice's own ROOT session on the inner gateway (as her
// `ssh root@<inner>` would leave it) so her own-box write to rules.v4 passes L1/L2.
await sr.from('patches').delete().eq('machine_id', INNER_GW_ID);
await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);
await sr.from('sessions').insert({
  session_id: `ssh-alice-inner-${INNER_GW_ID}`,
  player_key: alice.publicKeyHex,
  machine_id: INNER_GW_ID,
  credentials: { username: 'root', userType: 'root' },
  kind: 'ssh',
  essid: ESSID,
});

// Open the NAT forward `2222 → <deep host>:22` on the gateway journal.
const w0 = await post(
  PATCHES,
  signRequest(alice, 'upsertPatch', {
    machine_id: INNER_GW_ID,
    path: RULES,
    content: liveForward,
    owner: 'root',
    permissions: ROOT_ONLY,
    node_type: 'file',
  }),
);
check('alice opens the NAT forward on the gateway’s rules.v4 → 200', w0.status === 200, `status=${w0.status} error=${errorOf(w0.body) ?? '-'}`);

// 1. REACH — ssh guest@<inner>:2222 with the deep host's own password lands a session
//    ON THE DEEP HOST (its machine id), not the gateway.
const r1 = await reach({});
const landedRows = await sessionRowsOn(DEEP_ID);
check(
  'reach: ssh guest@<inner>:2222 → 200, session lands on the deep host id (not the gateway)',
  r1.status === 200 &&
    machineOf(r1.body) === DEEP_ID &&
    machineOf(r1.body) !== INNER_GW_ID &&
    userTypeOf(r1.body) === 'guest' &&
    landedRows === 1,
  `status=${r1.status} machine=${machineOf(r1.body)} userType=${userTypeOf(r1.body)} deepRows=${landedRows}`,
);

// 2. WRONG PASSWORD — the deep host rejects, no session.
const r2 = await reach({ password: 'definitely-not-the-password' });
check(
  'wrong deep-host password → 401 invalid_credentials',
  r2.status === 401 && errorOf(r2.body) === 'invalid_credentials',
  `status=${r2.status} error=${errorOf(r2.body) ?? '-'}`,
);

// 3. NO FORWARD ON THE PORT — a port the gateway neither serves nor forwards is dark.
const r3 = await reach({ port: 3333 });
check(
  'a port with no matching forward → 404 host_unreachable',
  r3.status === 404 && errorOf(r3.body) === 'host_unreachable',
  `status=${r3.status} error=${errorOf(r3.body) ?? '-'}`,
);

// 4. PORT 22 → THE GATEWAY ITSELF — its own sshd, validated against its admin password,
//    lands on the GATEWAY's id (5b.1a unbroken: `ssh root@<inner>` stays the gateway).
const r4 = await reach({ port: 22, username: 'root', password: GATEWAY_ROOT_PW });
check(
  'port 22 → lands on the gateway id (root, its own sshd), never the deep host',
  r4.status === 200 && machineOf(r4.body) === INNER_GW_ID && userTypeOf(r4.body) === 'root',
  `status=${r4.status} machine=${machineOf(r4.body)} userType=${userTypeOf(r4.body)}`,
);

// 5. BRICK — rm /boot/vmlinuz on the gateway: it stops answering, the deep entrance
//    goes dark even with the forward still configured (the boot gate runs first).
await post(PATCHES, signRequest(alice, 'removePatch', { machine_id: INNER_GW_ID, path: VMLINUZ, owner: 'root' }));
const r5 = await reach({});
check(
  'brick: rm /boot/vmlinuz → reaching the deep host is refused host_unreachable',
  r5.status === 404 && errorOf(r5.body) === 'host_unreachable',
  `status=${r5.status} error=${errorOf(r5.body) ?? '-'}`,
);

// Cleanup.
await sr.from('patches').delete().eq('machine_id', INNER_GW_ID);
await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
