// Wire-payload smoke for the range sweep's one question — which boxes the shell reaches
// can no longer boot. Drives the REAL /api/network (resolveDownHosts) + /api/patches
// endpoints against a running `vercel dev` + supabase, seeding the writer's root session
// on the target via service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime): the batched journal read
// across every box the shell reaches, its replay over each seeded base, and the canBoot
// gate — so a sweep stops listing a box a single-host scan already calls down. That covers
// the access point's own boxes, a fellow player's box (read through the occupancy and
// lease tables) and a box on a deep layer the shell's box reaches.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testDownHosts.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { leaveNetwork, standOnNetwork } from './standVantage.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import {
  isInnerGateway,
  machineIdForLanHost,
  networkBaseFsForMachineId,
} from '../src/core/generation/lanHostIdentity.js';
import { chainLinks } from '../src/core/generation/lanTopology.js';
import { lanAddressFor } from '../src/core/network/lanAddress.js';
import { resolveDeepScanHosts } from '../src/core/scan/deepScanHosts.js';

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

const downOf = (body: unknown): readonly string[] =>
  (body as { down?: readonly string[] } | null)?.down ?? [];

const ESSID = 'BEAN-THERE-WIFI';
const LAN = generateHomeLan(ESSID);
const SIBLING = LAN.hosts.find((host) => host.kind === 'machine');
if (SIBLING === undefined) {
  console.error(`${ESSID} has no plain machine to brick`);
  process.exit(2);
}
const SIBLING_ID = machineIdForLanHost(SIBLING, ESSID);

// The layer the first inner gateway fronts, and the box on it.
const INNER = LAN.hosts.find(isInnerGateway);
const FRONTING = chainLinks(ESSID).find((link) => link.parentMachineId === null);
const INNER_BASE =
  INNER === undefined ? null : networkBaseFsForMachineId(ESSID, machineIdForLanHost(INNER, ESSID));
const DEEP_BOX =
  FRONTING === undefined || INNER_BASE === null
    ? undefined
    : resolveDeepScanHosts(ESSID, FRONTING, INNER_BASE).hosts.find(
        (entry) => entry.host.kind === 'machine',
      );
if (FRONTING === undefined || DEEP_BOX === undefined) {
  console.error(`${ESSID} fronts no deep layer with a box on it`);
  process.exit(2);
}

const alice = generateIdentity();
const bob = generateIdentity();
const outsider = generateIdentity();
const BOB_OCTET = 252;
const BOB_WS = computeWorkstationId('rig', bob.publicKeyHex);
const MACHINE_IDS = [
  ...LAN.hosts.map((host) => machineIdForLanHost(host, ESSID)),
  BOB_WS,
  DEEP_BOX.machineId,
];

// The LAN answers only a caller standing on it. Nobody else is on it, so the only
// fellow player is bob.
await leaveNetwork(sr, ESSID);
await standOnNetwork(sr, ESSID, alice, 251);
await standOnNetwork(sr, ESSID, bob, BOB_OCTET);
await standOnNetwork(sr, 'SOMEWHERE-ELSE-WIFI', outsider, 251);

const sweep = (who = alice, callerMachineId?: string) =>
  post(
    NETWORK,
    signRequest(who, 'resolveDownHosts', {
      essid: ESSID,
      ...(callerMachineId === undefined ? {} : { caller_machine_id: callerMachineId }),
    }),
  );

/** A root `rm /boot/vmlinuz` on a machine's journal, written straight to the table: the
 *  write door is not what this checks. */
const kernelDeletedOn = (machineId: string) =>
  sr.from('patches').insert({
    machine_id: machineId,
    path: '/boot/vmlinuz',
    content: null,
    owner: 'root',
    permissions: null,
    node_type: 'file',
    writer_key: alice.publicKeyHex,
  });

// Clean slate, then seed alice's own ROOT session on the sibling (as her
// `ssh root@<sibling>` would leave it) so her write to its journal passes the gate.
await sr.from('patches').delete().in('machine_id', MACHINE_IDS);
await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);
await sr.from('sessions').insert({
  session_id: `ssh-alice-sibling-${SIBLING_ID}`,
  player_key: alice.publicKeyHex,
  machine_id: SIBLING_ID,
  credentials: { username: 'root', userType: 'root' },
  kind: 'ssh',
  essid: ESSID,
});

// 1. BASELINE — nobody has touched the LAN, so no box is down.
const s1 = await sweep();
check(
  'baseline: an untouched LAN names no box down',
  s1.status === 200 && downOf(s1.body).length === 0,
  `status=${s1.status} down=[${downOf(s1.body).join(',')}]`,
);

// 2. BRICK — rm /boot/vmlinuz on the sibling: that box, and only that box, is down.
const r2 = await post(
  PATCHES,
  signRequest(alice, 'removePatch', { machine_id: SIBLING_ID, path: '/boot/vmlinuz', owner: 'root' }),
);
const s2 = await sweep();
check(
  `brick: rm /boot/vmlinuz → the sweep names ${SIBLING.ip} down, and nothing else`,
  r2.status === 200 &&
    s2.status === 200 &&
    downOf(s2.body).length === 1 &&
    downOf(s2.body)[0] === SIBLING.ip,
  `brick=${r2.status} sweep=${s2.status} down=[${downOf(s2.body).join(',')}]`,
);

// 3. VANTAGE — a caller standing on another network is refused.
const s3 = await sweep(outsider);
check(
  'vantage: a caller on another network is refused',
  s3.status === 403,
  `status=${s3.status} body=${JSON.stringify(s3.body)}`,
);

// 4. A FELLOW PLAYER — bob's box loses its kernel: the sweep names his address down.
const bobIp = lanAddressFor(ESSID, BOB_OCTET);
const r4 = await kernelDeletedOn(BOB_WS);
const s4 = await sweep();
check(
  `fellow player: bob's box loses its kernel → the sweep names ${bobIp} down`,
  r4.error === null && s4.status === 200 && downOf(s4.body).includes(bobIp),
  `seed=${r4.error?.message ?? 'ok'} sweep=${s4.status} down=[${downOf(s4.body).join(',')}]`,
);

// 5. A DEEP LAYER — the box behind the inner gateway loses its kernel. From a shell on
//    that gateway the sweep names it down; from home, which reaches no deep layer, it
//    does not.
const innerId = FRONTING.machineId;
await sr.from('sessions').insert({
  session_id: `ssh-alice-inner-${innerId}`,
  player_key: alice.publicKeyHex,
  machine_id: innerId,
  credentials: { username: 'root', userType: 'root' },
  kind: 'ssh',
  essid: ESSID,
});
const r5 = await kernelDeletedOn(DEEP_BOX.machineId);
const fromGateway = await sweep(alice, innerId);
const fromHome = await sweep();
check(
  `deep layer: its box loses its kernel → a sweep from the gateway names ${DEEP_BOX.host.ip} down`,
  r5.error === null &&
    fromGateway.status === 200 &&
    downOf(fromGateway.body).includes(DEEP_BOX.host.ip),
  `seed=${r5.error?.message ?? 'ok'} sweep=${fromGateway.status} down=[${downOf(fromGateway.body).join(',')}]`,
);
check(
  'deep layer: a sweep from home, which reaches no deep layer, does not name it',
  fromHome.status === 200 && !downOf(fromHome.body).includes(DEEP_BOX.host.ip),
  `sweep=${fromHome.status} down=[${downOf(fromHome.body).join(',')}]`,
);

// Cleanup.
await sr.from('patches').delete().in('machine_id', MACHINE_IDS);
await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);
await leaveNetwork(sr, ESSID);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
