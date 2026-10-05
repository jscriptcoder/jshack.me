// Wire-check — `nmap` from a hop sweeps the hop's network and is traced to the hop.
//
// B sits at home and holds a shell on an ordinary box on network N. Every scan request
// names that box (`caller_machine_id`), and the server works out from B's session row
// where B stands — never from anything the request claims. So:
//   - a sweep of N's LAN lands a kern.log line on N's boxes naming the HOP's LAN address,
//     and on a fellow player's box on N too, though B is not on N's WiFi;
//   - a fellow player's open ports, an ordinary box and an inner gateway on N each answer
//     to B on the hop, and refuse B asking the same thing from home;
//   - a public scan run from the hop is logged on the target's gateway under N's public
//     address, and the same scan from home under B's own;
//   - a sweep naming a network the hop is not on, or a box B holds no shell on, is refused.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testHopNmap.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env/fixture.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { isInnerGateway, machineIdForLanHost } from '../src/core/generation/lanTopology.js';
import { lanAddressFor } from '../src/core/network/lanAddress.js';
import { publicAddressOf } from './publicAddressOf.js';
import { leaveNetwork, standOnNetwork } from './standVantage.js';

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
): Promise<{ status: number; body: Record<string, unknown> | null }> => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: response.status, body };
};

const KERN_LOG = '/var/log/kern.log';

const readKernLog = async (machineId: string, writerKey: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', KERN_LOG)
    .eq('writer_key', writerKey)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};

const lastLine = (log: string): string => log.trim().split('\n').at(-1) ?? '';

// --- The world: B's home, the hop's network N, and a public target T. ---
const HOME = 'SMART-FRIDGE-NET';
const N = 'NAKATOMI-PLAZA';
const T = 'OSCORP-GUEST';
const HOME_PUBLIC = publicAddressOf(HOME);
const N_PUBLIC = publicAddressOf(N);
const T_PUBLIC = publicAddressOf(T);
const T_GATEWAY = computeApGatewayId(T);

const nLan = generateHomeLan(N);
const machines = nLan.hosts.filter((host) => host.kind === 'machine');
const hop = machines[0];
const sibling = machines[1];
if (hop === undefined || sibling === undefined) {
  console.error(`${N} needs two ordinary generated boxes — pick another network.`);
  process.exit(2);
}
const inner = nLan.hosts.find(isInnerGateway);
const HOP_BOX = machineIdForLanHost(hop, N);
const SIBLING_BOX = machineIdForLanHost(sibling, N);

const bob = generateIdentity();
const alice = generateIdentity();
const ALICE_OCTET = 233;
const ALICE_IP = lanAddressFor(N, ALICE_OCTET);
const ALICE_WS = computeWorkstationId('rig', alice.publicKeyHex);
if (nLan.hosts.some((host) => host.ip === ALICE_IP)) {
  console.error(`${ALICE_IP} is a generated box on ${N} — pick another octet.`);
  process.exit(2);
}

// The boxes are seeded from the network, so their ids are the same on every run: clean
// them at setup, or a previous run's lines answer this run's assertions.
const touched = [HOP_BOX, SIBLING_BOX, ALICE_WS, T_GATEWAY];
for (const machineId of touched) {
  await sr.from('patches').delete().eq('machine_id', machineId);
}
await leaveNetwork(sr, N);
await standOnNetwork(sr, HOME, bob, 34);
await standOnNetwork(sr, N, alice, ALICE_OCTET);

// B's shell on the hop, as `ssh` would have left it: a live session row stamped with N.
const seeded = await sr.from('sessions').insert({
  session_id: 'ssh-root-hop-nmap',
  player_key: bob.publicKeyHex,
  machine_id: HOP_BOX,
  credentials: { username: 'root', userType: 'root' },
  kind: 'ssh',
  essid: N,
});
if (seeded.error) {
  console.error(`FATAL: session seed failed: ${seeded.error.message}`);
  process.exit(1);
}

const fromHop = { caller_machine_id: HOP_BOX };

try {
  // === 1. A sweep of N from the hop is logged on N's boxes from the hop's address. ===
  const sweep = await post(
    PATCHES,
    signRequest(bob, 'nmapScan', { essid: N, target: `${nLan.subnet}.1-254`, ...fromHop }),
  );
  const siblingLog = await readKernLog(SIBLING_BOX, apGatewayLogWriterKey(N));
  check(
    "a sweep from the hop names the hop's LAN address on N's boxes",
    sweep.status === 200 && lastLine(siblingLog).includes(`Port scan from ${hop.ip} —`),
    `status=${sweep.status} line="${lastLine(siblingLog)}"`,
  );

  // === 2. ... and on a fellow player's box on N, though B is not on N's WiFi. ===
  const aliceLog = await readKernLog(ALICE_WS, alice.publicKeyHex);
  check(
    "the sweep traces a fellow player on N from the hop's address",
    lastLine(aliceLog).includes(`Port scan from ${hop.ip} —`),
    `line="${lastLine(aliceLog)}"`,
  );

  // === 3. A sweep naming a network the hop is not on is refused, writing nothing. ===
  const crafted = await post(
    PATCHES,
    signRequest(bob, 'nmapScan', { essid: HOME, target: `${nLan.subnet}.1-254`, ...fromHop }),
  );
  check(
    'a sweep naming a network the hop is not on is refused',
    crafted.status === 403 && crafted.body?.error === 'wrong_network',
    `status=${crafted.status} body=${JSON.stringify(crafted.body)}`,
  );

  // === 4. A sweep from a box B holds no shell on is refused. ===
  const borrowed = await post(
    PATCHES,
    signRequest(bob, 'nmapScan', {
      essid: N,
      target: `${nLan.subnet}.1-254`,
      caller_machine_id: SIBLING_BOX,
    }),
  );
  check(
    'a sweep from a box held by no shell is refused',
    borrowed.status === 403 && borrowed.body?.error === 'no_session',
    `status=${borrowed.status} body=${JSON.stringify(borrowed.body)}`,
  );

  // === 5. A fellow player's ports answer B on the hop, and not B at home. ===
  const occupantArgs = { essid: N, target: ALICE_IP };
  const occupantFromHop = await post(
    NETWORK,
    signRequest(bob, 'resolveOccupantScan', { ...occupantArgs, ...fromHop }),
  );
  const occupantFromHome = await post(
    NETWORK,
    signRequest(bob, 'resolveOccupantScan', occupantArgs),
  );
  check(
    "a fellow player's box on N answers the hop and refuses home",
    occupantFromHop.status === 200 &&
      occupantFromHop.body?.found === true &&
      occupantFromHome.status === 403 &&
      occupantFromHome.body?.error === 'wrong_network',
    `hop=${occupantFromHop.status}/${JSON.stringify(occupantFromHop.body)} ` +
      `home=${occupantFromHome.status}/${JSON.stringify(occupantFromHome.body)}`,
  );

  // === 6. An ordinary box on N answers B on the hop, and not B at home. ===
  const siblingArgs = { essid: N, target: sibling.ip };
  const siblingFromHop = await post(
    NETWORK,
    signRequest(bob, 'resolveSameLanScan', { ...siblingArgs, ...fromHop }),
  );
  const siblingFromHome = await post(NETWORK, signRequest(bob, 'resolveSameLanScan', siblingArgs));
  check(
    'an ordinary box on N answers the hop and refuses home',
    siblingFromHop.status === 200 &&
      siblingFromHop.body?.found === true &&
      siblingFromHome.status === 403 &&
      siblingFromHome.body?.error === 'wrong_network',
    `hop=${siblingFromHop.status} home=${siblingFromHome.status}`,
  );

  // === 7. An inner gateway on N answers B on the hop, and not B at home. ===
  if (inner === undefined) {
    console.log(`SKIP  ${N} has no inner gateway to scan`);
  } else {
    const innerArgs = { essid: N, target: inner.ip };
    const innerFromHop = await post(
      NETWORK,
      signRequest(bob, 'resolveInnerGatewayScan', { ...innerArgs, ...fromHop }),
    );
    const innerFromHome = await post(
      NETWORK,
      signRequest(bob, 'resolveInnerGatewayScan', innerArgs),
    );
    check(
      'an inner gateway on N answers the hop and refuses home',
      innerFromHop.status === 200 &&
        innerFromHop.body?.found === true &&
        innerFromHome.status === 403 &&
        innerFromHome.body?.error === 'wrong_network',
      `hop=${innerFromHop.status} home=${innerFromHome.status}`,
    );
  }

  // === 8. A public scan from the hop is logged under N's public address. ===
  const publicFromHop = await post(
    NETWORK,
    signRequest(bob, 'resolvePublicScan', { target: T_PUBLIC, ...fromHop }),
  );
  const afterHop = await readKernLog(T_GATEWAY, apGatewayLogWriterKey(T));
  check(
    "a public scan from the hop is logged under the hop network's public address",
    publicFromHop.status === 200 && lastLine(afterHop).includes(`Port scan from ${N_PUBLIC} —`),
    `status=${publicFromHop.status} line="${lastLine(afterHop)}"`,
  );

  // === 9. The same scan from home is logged under B's own public address. ===
  const publicFromHome = await post(
    NETWORK,
    signRequest(bob, 'resolvePublicScan', { target: T_PUBLIC }),
  );
  const afterHome = await readKernLog(T_GATEWAY, apGatewayLogWriterKey(T));
  check(
    "the same public scan from home is logged under B's home address",
    publicFromHome.status === 200 &&
      lastLine(afterHome).includes(`Port scan from ${HOME_PUBLIC} —`),
    `status=${publicFromHome.status} line="${lastLine(afterHome)}"`,
  );

  // === 10. A public scan from a box B holds no shell on is refused. ===
  const publicBorrowed = await post(
    NETWORK,
    signRequest(bob, 'resolvePublicScan', { target: T_PUBLIC, caller_machine_id: SIBLING_BOX }),
  );
  check(
    'a public scan from a box held by no shell is refused',
    publicBorrowed.status === 403 && publicBorrowed.body?.error === 'no_session',
    `status=${publicBorrowed.status} body=${JSON.stringify(publicBorrowed.body)}`,
  );
} finally {
  for (const machineId of touched) {
    await sr.from('patches').delete().eq('machine_id', machineId);
  }
  await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);
  await leaveNetwork(sr, N);
  await sr.from('home_network_occupants').delete().eq('owner_key', bob.publicKeyHex);
  await sr.from('network_lan_leases').delete().eq('owner_key', bob.publicKeyHex);
}

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
