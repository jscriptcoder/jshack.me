// Wire-payload smoke for the range sweep's one question — which boxes the access point
// owns can no longer boot. Drives the REAL /api/network (resolveDownHosts) +
// /api/patches endpoints against a running `vercel dev` + supabase, seeding the writer's
// root session on the target via service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime): the batched journal read
// across every box on the LAN, its replay over each seeded base, and the canBoot gate —
// so a sweep stops listing a box a single-host scan already calls down.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testDownHosts.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { standOnNetwork } from './standVantage.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { machineIdForLanHost } from '../src/core/generation/lanHostIdentity.js';

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
const LAN_IDS = LAN.hosts.map((host) => machineIdForLanHost(host, ESSID));

const alice = generateIdentity();
const outsider = generateIdentity();
// The LAN answers only a caller standing on it.
await standOnNetwork(sr, ESSID, alice, 251);
await standOnNetwork(sr, 'SOMEWHERE-ELSE-WIFI', outsider, 251);

const sweep = (who = alice) =>
  post(NETWORK, signRequest(who, 'resolveDownHosts', { essid: ESSID }));

// Clean slate, then seed alice's own ROOT session on the sibling (as her
// `ssh root@<sibling>` would leave it) so her write to its journal passes the gate.
await sr.from('patches').delete().in('machine_id', LAN_IDS);
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

// Cleanup.
await sr.from('patches').delete().in('machine_id', LAN_IDS);
await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
