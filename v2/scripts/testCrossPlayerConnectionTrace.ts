// Wire-payload smoke for Story 6.2 — a cross-player ssh login leaves a truthful
// auth.log trace on the TARGET's shared record. Drives the REAL /api/sessions
// endpoint (authCreateSessionPublic) against a running `vercel dev` + supabase,
// seeding the registry rows + the NAT forward via service_role (as A's join/config
// would).
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - B `ssh root@<A.publicIp>` (correct admin pw) → ONE `Accepted password for root
//     from <B's home public IP>` line lands on A's ROUTER auth.log, keyed by A's
//     OWNER writer_key (decision 1), naming A's seeded router hostname.
//   - A wrong password → `Failed password …` line still lands (sshd logs both); 401.
//   - The source IP is SERVER-DERIVED from B's verified key (B's registry public IP),
//     NOT the client `source_ip` — a forged `source_ip` in the payload is ignored.
//   - Keystone: a SECOND attacker (C) accretes its own line into the SAME owner-keyed
//     row instead of collapsing it under the last-write-wins fold.
//   - A NAT-forwarded `ssh guest@<A.publicIp> -p 2222` → the line lands on the
//     WORKSTATION record, naming the workstation's machine name.
//   - host_unreachable (unregistered public IP) writes nothing.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testCrossPlayerConnectionTrace.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { assignHomeNetwork } from '../src/core/network/homeNetwork';
import { formatPidfileContent } from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { md5 } from '../src/core/generation/md5';
import { seedApGatewayHostname, seedApGatewayAdminPw } from '../src/core/generation/routerFs';
import { workstationGuestPassword } from '../src/core/generation/workstationFs';

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

const AUTH_LOG = '/var/log/auth.log';

/** Read a machine's auth.log row keyed by the OWNER's writer_key — the single
 *  canonical row the system writes its login lines to (decision 1). */
const readAuthLog = async (machineId: string, ownerKey: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', AUTH_LOG)
    .eq('writer_key', ownerKey)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};

const lastLine = (log: string): string => log.trim().split('\n').slice(-1)[0] ?? '(empty)';

// --- Identities: A (the target/owner), B + C (two attackers with their own home nets). ---
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();

const A_ESSID = 'ABSTERGO-NET';
const B_ESSID = 'BLUE-SUN-CAFE';
const C_ESSID = 'CYBERDYNE-GUEST';
const A_WS_NAME = 'skylab';
const A_WS = computeWorkstationId(A_WS_NAME, alice.publicKeyHex);
const A_ROUTER = computeApGatewayId(A_ESSID);
const A_PUBLIC_IP = '203.0.113.93';
const A_LAN = assignHomeNetwork(alice.publicKeyHex, A_ESSID).localIp; // A's ws LAN ip
// B's + C's truthful source IPs: the public IPs in their seeded registry rows, which the
// server recovers from each verified key via the registry — never a client claim. Explicit
// constants, since this script seeds those rows directly (self-consistent with the asserts).
const B_PUBLIC_IP = '198.51.100.93';
const C_PUBLIC_IP = '192.0.2.93';
const A_ROUTER_HOST = seedApGatewayHostname(A_ESSID);
const ADMIN_PW = seedApGatewayAdminPw(A_ESSID); // A's router root (admin) pw
const GUEST_PW = workstationGuestPassword(alice.publicKeyHex); // A's ws guest pw

const RULES = '/etc/iptables/rules.v4';
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };
const WORLD_PID = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };
// A's opt-in forward: expose the workstation sshd on the public :2222.
const FORWARD_RULES = `# /etc/iptables/rules.v4 — NAT port-forward table\nforward 2222 to ${A_LAN}:22\n`;

const registryRow = (
  publicIp: string,
  owner: ReturnType<typeof generateIdentity>,
  essid: string,
  wsName: string,
) => ({
  public_ip: publicIp,
  owner_key: owner.publicKeyHex,
  workstation_machine_id: computeWorkstationId(wsName, owner.publicKeyHex),
  router_machine_id: computeApGatewayId(essid),
  essid,
  workstation_username: 'player',
  workstation_machine_name: wsName,
  workstation_root_hash: md5('root-secret'),
});

// Clean slate, then seed the three registry rows (as each player's join would), A's
// NAT forward + her workstation sshd pidfile (as A's own config writes would).
await sr.from('network_registry').delete().in('public_ip', [A_PUBLIC_IP, B_PUBLIC_IP, C_PUBLIC_IP]);
await sr.from('patches').delete().eq('machine_id', A_ROUTER);
await sr.from('patches').delete().eq('machine_id', A_WS);
for (const id of [bob, carol]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}
await sr
  .from('network_registry')
  .insert([
    registryRow(A_PUBLIC_IP, alice, A_ESSID, A_WS_NAME),
    registryRow(B_PUBLIC_IP, bob, B_ESSID, 'nebuchadnezzar'),
    registryRow(C_PUBLIC_IP, carol, C_ESSID, 'serenity'),
  ]);
await sr.from('patches').insert([
  {
    machine_id: A_ROUTER,
    path: RULES,
    content: FORWARD_RULES,
    owner: 'root',
    permissions: ROOT_ONLY,
    node_type: 'file',
    writer_key: alice.publicKeyHex,
    updated_at: new Date().toISOString(),
  },
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

const sshLogin = (
  attacker: ReturnType<typeof generateIdentity>,
  fields: Record<string, unknown>,
) =>
  signRequest(attacker, 'authCreateSessionPublic', {
    target: A_PUBLIC_IP,
    ...fields,
  });

// === 1. B ssh root@:22 (correct admin pw) → 200 + Accepted line on A's ROUTER auth.log. ===
const s1 = await post(
  SESSIONS,
  sshLogin(bob, { session_id: 'ssh-b-r-1', username: 'root', password: ADMIN_PW }),
);
const log1 = await readAuthLog(A_ROUTER, alice.publicKeyHex);
check(
  'B ssh root@<A.publicIp> authenticates on the router (:22)',
  s1.status === 200,
  `status=${s1.status}`,
);
check(
  'A’s ROUTER auth.log records "Accepted password for root from <B’s home IP>", naming the seeded router',
  log1.includes(`Accepted password for root from ${B_PUBLIC_IP}`) &&
    log1.includes(`${A_ROUTER_HOST} sshd[`),
  `line=${lastLine(log1)}`,
);

// === 2. Wrong admin pw → 401, but the rejected attempt still lands a Failed line. ===
const s2 = await post(
  SESSIONS,
  sshLogin(bob, { session_id: 'ssh-b-r-2', username: 'root', password: 'not-the-admin-pw' }),
);
const log2 = await readAuthLog(A_ROUTER, alice.publicKeyHex);
check(
  'a wrong password is 401 yet records "Failed password for root from <B’s home IP>"',
  s2.status === 401 && log2.includes(`Failed password for root from ${B_PUBLIC_IP}`),
  `status=${s2.status} line=${lastLine(log2)}`,
);

// === 3. A forged client source_ip is IGNORED (server derives B's registry IP). ===
const s3 = await post(
  SESSIONS,
  sshLogin(bob, {
    session_id: 'ssh-b-r-3',
    username: 'root',
    password: ADMIN_PW,
    source_ip: '10.6.6.6',
  }),
);
const log3 = await readAuthLog(A_ROUTER, alice.publicKeyHex);
check(
  'a client-supplied source_ip is ignored — lines carry B’s registry IP, not the forged one',
  s3.status === 200 && log3.includes(`from ${B_PUBLIC_IP}`) && !log3.includes('10.6.6.6'),
  `status=${s3.status} forgedPresent=${log3.includes('10.6.6.6')}`,
);

// === 4. Keystone: a SECOND attacker (C) accretes into the SAME owner-keyed row. ===
const s4 = await post(
  SESSIONS,
  sshLogin(carol, { session_id: 'ssh-c-r-1', username: 'root', password: ADMIN_PW }),
);
const log4 = await readAuthLog(A_ROUTER, alice.publicKeyHex);
check(
  'both B’s and C’s logins coexist in the one owner-keyed router row (no last-write-wins collapse)',
  s4.status === 200 &&
    log4.includes(`from ${B_PUBLIC_IP}`) &&
    log4.includes(`from ${C_PUBLIC_IP}`),
  `lines=${log4.trim().split('\n').length}`,
);

// === 5. NAT-forwarded ssh guest@:2222 → 200 + line on the WORKSTATION record. ===
const s5 = await post(
  SESSIONS,
  sshLogin(bob, { session_id: 'ssh-b-w-1', username: 'guest', password: GUEST_PW, port: 2222 }),
);
const log5 = await readAuthLog(A_WS, alice.publicKeyHex);
check(
  'a forwarded :2222 guest login lands "Accepted password for guest from <B’s home IP>" on the WORKSTATION, naming its machine name',
  s5.status === 200 &&
    log5.includes(`Accepted password for guest from ${B_PUBLIC_IP}`) &&
    log5.includes(`${A_WS_NAME} sshd[`),
  `status=${s5.status} line=${lastLine(log5)}`,
);

// === 6. host_unreachable (unregistered public IP) writes nothing. ===
const before = await readAuthLog(A_ROUTER, alice.publicKeyHex);
const s6 = await post(
  SESSIONS,
  signRequest(bob, 'authCreateSessionPublic', {
    session_id: 'ssh-b-x-1',
    target: '203.0.113.250',
    username: 'root',
    password: ADMIN_PW,
  }),
);
const after = await readAuthLog(A_ROUTER, alice.publicKeyHex);
check(
  'logging in to an unregistered IP is 404 host_unreachable and writes no trace',
  s6.status === 404 && before === after,
  `status=${s6.status} logUnchanged=${before === after}`,
);

// Cleanup.
await sr.from('network_registry').delete().in('public_ip', [A_PUBLIC_IP, B_PUBLIC_IP, C_PUBLIC_IP]);
await sr.from('patches').delete().eq('machine_id', A_ROUTER);
await sr.from('patches').delete().eq('machine_id', A_WS);
for (const id of [bob, carol]) {
  await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
}

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
