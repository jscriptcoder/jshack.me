// Wire-payload smoke for a router -> SWITCH deep chain (5b.4d) — a deep gateway seeded as
// a SWITCH is a chain leaf that forwards nothing but is itself reachable + configurable:
//   - WRITE: a root write to the deep SWITCH's /etc/switch/acl.conf passes L2 from the
//     owner's own key (the deep-gateway L2 write path resolves a SWITCH tree, not a router).
//   - REACH: ssh to the inner at a port it forwards to the switch's :22 lands a session ON
//     the switch, authed against ITS admin pw.
//   - SCAN: the inner's upstream scan surfaces that forwarded port (the switch serves :22).
//   - DARK: a forward to any NON-22 port on the switch is dead — the switch runs no NAT, so
//     the chained port drops from the scan AND the reach is refused (a switch forwards
//     nothing beyond its own sshd).
// Drives /api/network (resolveInnerGatewayScan), /api/sessions
// (authCreateSessionInnerGateway), and /api/patches against `vercel dev` + supabase.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testDeepSwitchChain.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no router->switch home.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeDeepGatewayId, computeInnerGatewayId } from '../src/core/identity/router';
import { seedDeepGatewayAdminPw } from '../src/core/generation/routerFs';
import { generateHomeLan } from '../src/core/generation/generateHomeLan';
import { crackableEssidPool } from '../src/core/generation/generateWifi';
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

// --- The network. Pick an ESSID whose inner router's first deep child is a SWITCH (a chain
//     leaf): depth >= 2 so the inner hangs a child, and that child seeds as a switch rather
//     than a router. The chain hangs off a gateway the access point owns, so the shape is a
//     property of the network — the same one for every occupant. ---
const innerSwitchChild = (essid: string) => {
  if (seedNetworkDepth(essid) < 2) return null;
  const innerHost = generateHomeLan(essid).hosts.find(
    (host) => host.kind === 'router' && octetOf(host.ip) !== 1,
  );
  if (innerHost === undefined) return null;
  const innerId = computeInnerGatewayId(essid, octetOf(innerHost.ip));
  const child = generateDeepLayer(
    essid,
    { machineId: innerId, kind: 'router' },
    { hangsChild: true },
  ).childGateway;
  if (child === null || child.kind !== 'switch') return null;
  return { essid, innerIp: innerHost.ip, innerId, switchIp: child.ip };
};

const found = crackableEssidPool.map(innerSwitchChild).find((layout) => layout !== null);
if (found === undefined || found === null) {
  console.error('no network in the crackable pool seeds an inner router -> switch child chain');
  process.exit(2);
}
// The acting player. Any identity does: the chain is the network's, so alice brings a
// session and a signature, not a private world.
const alice = generateIdentity();
const { essid: ESSID, innerIp: INNER_IP, innerId: INNER_GW_ID, switchIp: SWITCH_IP } = found;
const SWITCH_ID = computeDeepGatewayId(INNER_GW_ID, octetOf(SWITCH_IP));
const SWITCH_ROOT_PW = seedDeepGatewayAdminPw(INNER_GW_ID, octetOf(SWITCH_IP));

const RULES = '/etc/iptables/rules.v4';
const ACL = '/etc/switch/acl.conf';
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };
const FWD = 2225;
// The inner forwards FWD to the switch's own sshd:22 — the door onto the switch itself.
const innerToSwitchSsh = `# NAT port-forward table\nforward ${FWD} to ${SWITCH_IP}:22\n`;
// A forward to a NON-22 port on the switch — dead, because a switch runs no NAT.
const innerToSwitchDark = `# NAT port-forward table\nforward ${FWD} to ${SWITCH_IP}:9999\n`;
const aclContent = `# /etc/switch/acl.conf\ndeny 8080\n`;

const writeFile = (machineId: string, path: string, content: string) =>
  post(
    PATCHES,
    signRequest(alice, 'upsertPatch', {
      machine_id: machineId,
      path,
      content,
      owner: 'root',
      permissions: ROOT_ONLY,
      node_type: 'file',
    }),
  );

const scanInner = () =>
  post(NETWORK, signRequest(alice, 'resolveInnerGatewayScan', { essid: ESSID, target: INNER_IP }));

const reachSwitch = () =>
  post(
    SESSIONS,
    signRequest(alice, 'authCreateSessionInnerGateway', {
      session_id: `switch-${Math.round(performance.now())}-${Math.random()}`,
      essid: ESSID,
      target: INNER_IP,
      username: 'root',
      password: SWITCH_ROOT_PW,
      port: FWD,
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

// Clean slate, then seed alice's root session on the inner gateway (as her `ssh
// root@<inner>` hop would leave it) so her write to the inner's rules.v4 passes L1/L2. The
// session on the SWITCH is established by the reach below — the natural flow is to root the
// switch first, THEN nano its acl.conf.
await sr.from('patches').delete().eq('machine_id', INNER_GW_ID);
await sr.from('patches').delete().eq('machine_id', SWITCH_ID);
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
]);

// 1. WRITE the inner gateway's forward to the switch's :22 (own home-LAN gateway).
const w1 = await writeFile(INNER_GW_ID, RULES, innerToSwitchSsh);
check(
  'alice forwards a port on the inner gateway to the switch :22 → 200',
  w1.status === 200,
  `status=${w1.status} error=${errorOf(w1.body) ?? '-'}`,
);

// 2. SCAN the inner gateway: the forwarded port surfaces (the switch serves :22).
const s2 = await scanInner();
const ports2 = portsOf(s2.body);
check(
  'scan: nmap <inner> surfaces the port forwarded to the switch :22',
  s2.status === 200 && ports2.includes(FWD),
  `status=${s2.status} ports=[${ports2.join(',')}]`,
);

// 3. REACH the switch: ssh root@<inner>:<fwd> lands a session ON the switch (not the inner),
//    authed against the switch's own admin pw — and that session is what authorizes the
//    acl.conf write below.
const r3 = await reachSwitch();
const switchRows = await sessionRowsOn(SWITCH_ID);
check(
  'reach: ssh root@<inner>:<fwd> → 200, lands ON the deep switch (auth its admin pw)',
  r3.status === 200 &&
    machineOf(r3.body) === SWITCH_ID &&
    machineOf(r3.body) !== INNER_GW_ID &&
    userTypeOf(r3.body) === 'root' &&
    switchRows === 1,
  `status=${r3.status} machine=${machineOf(r3.body)} userType=${userTypeOf(r3.body)} switchRows=${switchRows}`,
);

// 4. WRITE the rooted SWITCH's acl.conf — a deep box below the LAN whose tree is a SWITCH
//    (acl.conf), not a router (rules.v4). A 403 here would mean the L2 write path failed to
//    resolve the deep switch's tree from alice's own key.
const w4 = await writeFile(SWITCH_ID, ACL, aclContent);
check(
  'alice writes the rooted deep SWITCH acl.conf (deep-switch L2 write) → 200',
  w4.status === 200,
  `status=${w4.status} error=${errorOf(w4.body) ?? '-'}`,
);

// 5. DARK: re-point the inner's forward at a NON-22 port on the switch. A switch runs no
//    NAT, so it serves nothing there — the forwarded port drops from the scan AND the reach
//    is refused (the switch forwards nothing beyond its own sshd).
await writeFile(INNER_GW_ID, RULES, innerToSwitchDark);
const s5 = await scanInner();
const ports5 = portsOf(s5.body);
const r5 = await reachSwitch();
check(
  'switch forwards nothing: a forward to a non-22 port drops from the scan AND the reach 404s',
  s5.status === 200 &&
    !ports5.includes(FWD) &&
    r5.status === 404 &&
    errorOf(r5.body) === 'host_unreachable',
  `scanPorts=[${ports5.join(',')}] reach=${r5.status}/${errorOf(r5.body) ?? '-'}`,
);

// Cleanup.
await sr.from('patches').delete().eq('machine_id', INNER_GW_ID);
await sr.from('patches').delete().eq('machine_id', SWITCH_ID);
await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
