// Wire-payload smoke for Story 5b.1b-i — the player's OWN-LAN nmap of an inner
// gateway, resolved server-side at the external vantage. Drives the REAL
// /api/network (resolveInnerGatewayScan) + /api/patches endpoints against a running
// `vercel dev` + supabase, seeding the owner's root session on the gateway via
// service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime): a single-IP scan of an
// inner gateway regenerates it from the verified pubkey + essid, replays its journal
// (canBoot gate), and reports its own sshd:22 PLUS any LIVE NAT forward to the hidden
// Layer-2 host — the forward lives on the gateway's journal, not the client's static
// world, and is surfaced only while the deep host behind it is actually serving.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testInnerGatewayScan.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no inner gateway.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeInnerGatewayId } from '../src/core/identity/router';
import { generateHomeLan } from '../src/core/generation/generateHomeLan';
import { generateDeepLayer } from '../src/core/generation/generateDeepLayer';

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

const portsOf = (body: unknown): readonly number[] =>
  ((body as { ports?: readonly { port?: number }[] } | null)?.ports ?? [])
    .map((entry) => entry.port)
    .filter((port): port is number => typeof port === 'number');

const foundOf = (body: unknown): boolean => (body as { found?: boolean } | null)?.found === true;

// --- The acting player scans the network's inner gateway. Both the gateway and the layer
//     behind it belong to the access point, so alice brings only a signature. ---
const alice = generateIdentity();
const ESSID = 'ABSTERGO-NET';

const innerGateway = generateHomeLan(ESSID).hosts.find(
  (host) => host.kind === 'router' && Number(host.ip.split('.')[3]) !== 1,
);
if (innerGateway === undefined) {
  console.error('no inner gateway on the generated LAN');
  process.exit(2);
}
const INNER_IP = innerGateway.ip;
const INNER_OCTET = Number(INNER_IP.split('.')[3]);
const INNER_GW_ID = computeInnerGatewayId(ESSID, INNER_OCTET);
const DEEP_IP = generateDeepLayer(ESSID, {
  machineId: INNER_GW_ID,
  kind: 'router',
}).host.ip;

const RULES = '/etc/iptables/rules.v4';
const VMLINUZ = '/boot/vmlinuz';
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };
const liveForward = `# NAT port-forward table\nforward 2222 to ${DEEP_IP}:22\n`;
const deadForward = `# NAT port-forward table\nforward 2222 to 10.9.9.9:22\n`;

const scan = () => post(NETWORK, signRequest(alice, 'resolveInnerGatewayScan', {
  essid: ESSID,
  target: INNER_IP,
}));

const writeRules = (content: string) =>
  post(
    PATCHES,
    signRequest(alice, 'upsertPatch', {
      machine_id: INNER_GW_ID,
      path: RULES,
      content,
      owner: 'root',
      permissions: ROOT_ONLY,
      node_type: 'file',
    }),
  );

// Clean slate, then seed alice's own ROOT session on the inner gateway (as her
// `ssh root@<inner>` would leave it) so her own-box writes to rules.v4 pass the L1/L2
// gate (only the own WORKSTATION bypasses L1; the own gateway needs a session).
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

// 1. BASELINE — no forward: the gateway shows only its own sshd:22; the deep layer is dark.
const s1 = await scan();
const ports1 = portsOf(s1.body);
check(
  'baseline: nmap <inner gateway> shows only its own :22 (deep layer dark)',
  s1.status === 200 && foundOf(s1.body) && ports1.includes(22) && !ports1.includes(2222),
  `status=${s1.status} found=${foundOf(s1.body)} ports=[${ports1.join(',')}]`,
);

// 2. LIVE FORWARD — alice opens `forward 2222 to <deep host>:22` on the gateway journal.
const w2 = await writeRules(liveForward);
check(
  'alice writes the NAT forward on the gateway’s rules.v4 → 200',
  w2.status === 200,
  `status=${w2.status} error=${errorOf(w2.body) ?? '-'}`,
);

// 3. SCAN after the live forward: :2222 surfaces alongside the gateway’s own :22.
const s3 = await scan();
const ports3 = portsOf(s3.body);
check(
  'live forward: nmap <inner gateway> shows :22 + :2222 (deep host serving)',
  s3.status === 200 && ports3.includes(22) && ports3.includes(2222),
  `status=${s3.status} ports=[${ports3.join(',')}]`,
);

// 4. DEAD FORWARD — repoint the forward at an address with no deep host: :2222 drops
//    (the liveness gate: a forward only shows while its target is actually serving).
await writeRules(deadForward);
const s4 = await scan();
const ports4 = portsOf(s4.body);
check(
  'dead forward: nmap <inner gateway> drops :2222, keeps :22 (liveness gate)',
  s4.status === 200 && ports4.includes(22) && !ports4.includes(2222),
  `status=${s4.status} ports=[${ports4.join(',')}]`,
);

// 5. BRICK — rm /boot/vmlinuz on the gateway journal: it stops answering, the deep
//    entrance goes dark (host-down, no ports).
const b5 = await post(
  PATCHES,
  signRequest(alice, 'removePatch', { machine_id: INNER_GW_ID, path: VMLINUZ, owner: 'root' }),
);
const s5 = await scan();
check(
  'brick: rm /boot/vmlinuz → nmap <inner gateway> host-down, no ports',
  b5.status === 200 && s5.status === 200 && !foundOf(s5.body) && portsOf(s5.body).length === 0,
  `brick=${b5.status} scan=${s5.status} found=${foundOf(s5.body)} ports=[${portsOf(s5.body).join(',')}]`,
);

// Cleanup.
await sr.from('patches').delete().eq('machine_id', INNER_GW_ID);
await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
