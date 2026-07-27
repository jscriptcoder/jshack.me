// Wire-payload smoke for the depth-3 chained reach (5b.4c-ii) — the UNIFIED end-to-end
// loop: a two-forward chain (inner -> L2 child gateway -> L3 gateway) reachable by
// `ssh root@<inner>:<chained port>`, the chained port SURFACING from the upstream scan,
// and BOTH forwards configured through the real write path (deep gateways are now
// L2-writable). Drives /api/network (resolveInnerGatewayScan), /api/sessions
// (authCreateSessionInnerGateway), and /api/patches against `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - WRITE: a forward on the L2 child gateway — a deep box BELOW the home LAN — passes
//     L2 from the owner's own key (the deep-gateway write path).
//   - SCAN: the inner gateway's upstream scan follows the forward chain, so the chained
//     port surfaces only while the WHOLE chain below stays live.
//   - REACH: ssh to the inner at the chained port walks both forwards and lands a session
//     on the L3 gateway, authed against ITS admin pw — not the inner, not the L2 child.
//   - a bricked intermediate takes everything below it dark (scan drops the port, reach 404).
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testDeepChainReach.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no depth-3 home.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeDeepGatewayId, computeInnerGatewayId } from '../src/core/identity/router';
import { seedDeepGatewayAdminPw } from '../src/core/generation/routerFs';
import { generateHomeLan } from '../src/core/generation/generateHomeLan';
import { generateDeepLayer, seedNetworkDepth } from '../src/core/generation/generateDeepLayer';

const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
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
const portsOf = (body: unknown): readonly number[] =>
  ((body as { ports?: readonly { port?: number }[] } | null)?.ports ?? [])
    .map((entry) => entry.port)
    .filter((port): port is number => typeof port === 'number');

const octetOf = (ip: string): number => Number(ip.split('.')[3]);

// --- The owner (alice). She reaches her OWN deep chain; depth is single-player. Pick a
//     depth-3 identity whose chain is ALL ROUTERS — every layer hangs a router child, so
//     the inner router fronts an L2 child that itself fronts an L3 gateway (the two-forward
//     chain). A switch caps the chain short (5b.4d), so a bare depth-3 home no longer
//     guarantees three router hops. ---
const ESSID = 'ABSTERGO-NET';
// The inner gateway belongs to the ACCESS POINT, so it is the same box for every
// candidate — resolved once here rather than re-derived per identity below. What the
// search is still varying is the DEPTH hanging off it, which is per-owner.
const innerHost = generateHomeLan(ESSID).hosts.find(
  (host) => host.kind === 'router' && octetOf(host.ip) !== 1,
);
if (innerHost === undefined) {
  console.error('no inner gateway on the ESSID’s LAN');
  process.exit(2);
}
const innerId = computeInnerGatewayId(ESSID, octetOf(innerHost.ip));

const isAllRouterDepth3 = (candidate: ReturnType<typeof generateIdentity>): boolean => {
  if (seedNetworkDepth(candidate.publicKeyHex, ESSID) !== 3) return false;
  const child = generateDeepLayer(
    candidate.publicKeyHex,
    ESSID,
    { machineId: innerId, kind: 'router' },
    { hangsChild: true },
  ).childGateway;
  if (child === null || child.kind !== 'router') return false;
  const childId = computeDeepGatewayId(candidate.publicKeyHex, innerId, octetOf(child.ip));
  const grandchild = generateDeepLayer(
    candidate.publicKeyHex,
    ESSID,
    { machineId: childId, kind: 'router' },
    { hangsChild: true },
  ).childGateway;
  return grandchild !== null && grandchild.kind === 'router';
};
const alice = Array.from({ length: 400 }, () => generateIdentity()).find(isAllRouterDepth3);
if (alice === undefined) {
  console.error('no identity seeds an all-router depth-3 home');
  process.exit(2);
}

const INNER_IP = innerHost.ip;
const INNER_GW_ID = innerId;

const l2child = generateDeepLayer(
  alice.publicKeyHex,
  ESSID,
  { machineId: INNER_GW_ID, kind: 'router' },
  { hangsChild: true },
).childGateway;
if (l2child === null) {
  console.error('the inner router fronts no L2 child gateway');
  process.exit(2);
}
const L2CHILD_IP = l2child.ip;
const L2CHILD_ID = computeDeepGatewayId(alice.publicKeyHex, INNER_GW_ID, octetOf(L2CHILD_IP));

const l3layer = generateDeepLayer(
  alice.publicKeyHex,
  ESSID,
  { machineId: L2CHILD_ID, kind: 'router' },
  { hangsChild: true },
);
const l3child = l3layer.childGateway;
if (l3child === null) {
  console.error('the L2 child fronts no L3 gateway');
  process.exit(2);
}
const L3CHILD_IP = l3child.ip;
const L3CHILD_ID = computeDeepGatewayId(alice.publicKeyHex, L2CHILD_ID, octetOf(L3CHILD_IP));
const L3CHILD_ROOT_PW = seedDeepGatewayAdminPw(alice.publicKeyHex, L2CHILD_ID, octetOf(L3CHILD_IP));

const RULES = '/etc/iptables/rules.v4';
const VMLINUZ = '/boot/vmlinuz';
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };
const CHAINED = 2224;
// The inner forwards the chained port to the L2 child; the L2 child forwards it on to the
// L3 gateway's own sshd — two hops to reach the chain's end.
const innerForward = `# NAT port-forward table\nforward ${CHAINED} to ${L2CHILD_IP}:${CHAINED}\n`;
const l2Forward = `# NAT port-forward table\nforward ${CHAINED} to ${L3CHILD_IP}:22\n`;

const writeRules = (machineId: string, content: string) =>
  post(
    PATCHES,
    signRequest(alice, 'upsertPatch', {
      machine_id: machineId,
      path: RULES,
      content,
      owner: 'root',
      permissions: ROOT_ONLY,
      node_type: 'file',
    }),
  );

const scanInner = () =>
  post(NETWORK, signRequest(alice, 'resolveInnerGatewayScan', { essid: ESSID, target: INNER_IP }));

const reach = () =>
  post(
    SESSIONS,
    signRequest(alice, 'authCreateSessionInnerGateway', {
      session_id: `chain-${Math.round(performance.now())}-${Math.random()}`,
      essid: ESSID,
      target: INNER_IP,
      username: 'root',
      password: L3CHILD_ROOT_PW,
      port: CHAINED,
      parent_session_id: null,
      source_ip: null,
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

const readAuthLog = async (machineId: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('writer_key', alice.publicKeyHex)
    .eq('machine_id', machineId)
    .eq('path', '/var/log/auth.log')
    .maybeSingle();
  return (data as { content?: string | null } | null)?.content ?? '';
};

// Clean slate, then seed alice's root sessions on the inner gateway AND the L2 child (as
// her `ssh root@<inner>` then `ssh root@<inner>:<fwd>` hops would leave them) so her
// writes to each gateway's rules.v4 pass L1/L2.
await sr.from('patches').delete().eq('machine_id', INNER_GW_ID);
await sr.from('patches').delete().eq('machine_id', L2CHILD_ID);
await sr.from('patches').delete().eq('machine_id', L3CHILD_ID);
await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);
await sr.from('sessions').insert([
  {
    session_id: `ssh-alice-inner-${INNER_GW_ID}`,
    player_key: alice.publicKeyHex,
    machine_id: INNER_GW_ID,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid: ESSID,
  },
  {
    session_id: `ssh-alice-l2-${L2CHILD_ID}`,
    player_key: alice.publicKeyHex,
    machine_id: L2CHILD_ID,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid: ESSID,
  },
]);

// 1. WRITE the inner gateway's forward (own home-LAN gateway — L1/L2 already supported).
const w1 = await writeRules(INNER_GW_ID, innerForward);
check(
  'alice opens the chained forward on the inner gateway → 200',
  w1.status === 200,
  `status=${w1.status} error=${errorOf(w1.body) ?? '-'}`,
);

// 2. WRITE the L2 child gateway's forward — a DEEP box below the LAN. A 403 here would
//    mean a player can't configure the chain (the deep-gateway L2 write path).
const w2 = await writeRules(L2CHILD_ID, l2Forward);
check(
  'alice opens the chained forward on the L2 child gateway (deep-gateway L2 write) → 200',
  w2.status === 200,
  `status=${w2.status} error=${errorOf(w2.body) ?? '-'}`,
);

// 3. SCAN the inner gateway: the chained port surfaces (the chain is live end-to-end).
const s3 = await scanInner();
const ports3 = portsOf(s3.body);
check(
  'chained scan: nmap <inner> surfaces the chained port (whole chain live)',
  s3.status === 200 && ports3.includes(CHAINED),
  `status=${s3.status} ports=[${ports3.join(',')}]`,
);

// 4. REACH the chain end: ssh root@<inner>:<chained> walks both forwards and lands a
//    session on the L3 gateway — not the inner, not the L2 child.
const r4 = await reach();
const l3Rows = await sessionRowsOn(L3CHILD_ID);
check(
  'chained reach: ssh root@<inner>:<chained> → 200, lands on the L3 gateway (two forwards deep)',
  r4.status === 200 &&
    machineOf(r4.body) === L3CHILD_ID &&
    machineOf(r4.body) !== INNER_GW_ID &&
    machineOf(r4.body) !== L2CHILD_ID &&
    userTypeOf(r4.body) === 'root' &&
    l3Rows === 1,
  `status=${r4.status} machine=${machineOf(r4.body)} userType=${userTypeOf(r4.body)} l3Rows=${l3Rows}`,
);

// 4b. TRACE: the successful reach left an sshd auth.log line on the L3 gateway — the
//     deep-reach trace, sourced from the fronting gateway's `.1` (its own deep subnet),
//     readable once the player is in. Read it back from the L3 gateway's shared journal.
const l3AuthLog = await readAuthLog(L3CHILD_ID);
check(
  'deep-reach trace: the L3 gateway auth.log records the accepted login from the gateway .1',
  l3AuthLog.includes(`Accepted password for root from ${l3layer.subnet}.1`),
  `auth.log=${JSON.stringify(l3AuthLog)}`,
);

// 5. BRICK the intermediate L2 child: everything below it goes dark — the scan drops the
//    chained port AND the reach is refused (the per-hop canBoot gate).
await post(
  PATCHES,
  signRequest(alice, 'removePatch', { machine_id: L2CHILD_ID, path: VMLINUZ, owner: 'root' }),
);
const s5 = await scanInner();
const ports5 = portsOf(s5.body);
const r5 = await reach();
check(
  'bricked intermediate: the chained port drops from the scan AND the reach is refused',
  s5.status === 200 &&
    !ports5.includes(CHAINED) &&
    r5.status === 404 &&
    errorOf(r5.body) === 'host_unreachable',
  `scanPorts=[${ports5.join(',')}] reach=${r5.status}/${errorOf(r5.body) ?? '-'}`,
);

// Cleanup.
await sr.from('patches').delete().eq('machine_id', INNER_GW_ID);
await sr.from('patches').delete().eq('machine_id', L2CHILD_ID);
await sr.from('patches').delete().eq('machine_id', L3CHILD_ID);
await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
