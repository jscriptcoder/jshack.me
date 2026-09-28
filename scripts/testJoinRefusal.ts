// Wire-payload smoke for the JOIN REFUSAL — the server decides which networks a player may
// join. Drives the REAL /api/network `registerNetwork` action against a running
// `vercel dev` + supabase, then reads the three tables a join writes.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - A signed join to a network in another town is refused with 403 network_not_joinable,
//     and leaves no public IP, no LAN lease and no occupant row behind.
//   - With `JSHACK_ADMIT_LAB_NETWORKS=1` in `.env.development.local`, a join to a network the
//     world does not declare still succeeds and records its occupant, which is what every
//     lab-network wire-check relies on.
//
// Usage (with v2 supabase + vercel dev running on 3100, the flag set):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testJoinRefusal.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { md5 } from '../src/core/generation/md5.js';
import { DECLARED_NETWORKS, RIDGEMONT } from '../src/core/generation/world.js';

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

const post = async (envelope: unknown): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(NETWORK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

const joinEnvelope = (identity: ReturnType<typeof generateIdentity>, essid: string) =>
  signRequest(identity, 'registerNetwork', {
    essid,
    workstation_machine_id: computeWorkstationId('refusal-box', identity.publicKeyHex),
    workstation_username: 'player',
    workstation_machine_name: 'refusal-box',
    workstation_root_hash: md5('root-secret'),
  });

// Every row a join can leave behind for one network, one table at a time.
const rowsFor = async (essid: string) => {
  const count = async (table: string) => {
    const { count: rows } = await sr
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('essid', essid);
    return rows ?? 0;
  };
  return {
    publicIps: await count('network_public_ips'),
    leases: await count('network_lan_leases'),
    occupants: await count('home_network_occupants'),
  };
};

const OUT_OF_TOWN = DECLARED_NETWORKS.find((network) => network.town !== RIDGEMONT);
if (OUT_OF_TOWN === undefined) {
  console.error('The world declares no network outside Ridgemont — nothing to refuse.');
  process.exit(2);
}
// A made-up network of the kind the lab wire-checks join.
const LAB_NETWORK = 'JOIN-REFUSAL-LAB';

const cleanup = async () => {
  for (const essid of [OUT_OF_TOWN.key, LAB_NETWORK]) {
    await sr.from('home_network_occupants').delete().eq('essid', essid);
    await sr.from('network_lan_leases').delete().eq('essid', essid);
    await sr.from('network_public_ips').delete().eq('essid', essid);
  }
};
await cleanup();

const player = generateIdentity();

// === 1. A join to another town's network is refused, and writes nothing. ===
const refused = await post(joinEnvelope(player, OUT_OF_TOWN.key));
const leftBehind = await rowsFor(OUT_OF_TOWN.key);
check(
  `a join to ${OUT_OF_TOWN.key} (${OUT_OF_TOWN.town}) is refused with 403 network_not_joinable`,
  refused.status === 403 && errorOf(refused.body) === 'network_not_joinable',
  `status=${refused.status} error=${errorOf(refused.body)}`,
);
check(
  'the refused join leaves no public IP, LAN lease or occupant row',
  leftBehind.publicIps === 0 && leftBehind.leases === 0 && leftBehind.occupants === 0,
  `public_ips=${leftBehind.publicIps} leases=${leftBehind.leases} occupants=${leftBehind.occupants}`,
);

// === 2. With the local flag set, a lab network still joins and records its occupant. ===
const admitted = await post(joinEnvelope(player, LAB_NETWORK));
const labRows = await rowsFor(LAB_NETWORK);
check(
  `a join to the undeclared ${LAB_NETWORK} succeeds while the local flag is set`,
  admitted.status === 200 && labRows.publicIps === 1 && labRows.leases === 1 && labRows.occupants === 1,
  `status=${admitted.status} error=${errorOf(admitted.body)} public_ips=${labRows.publicIps} leases=${labRows.leases} occupants=${labRows.occupants}`,
);

await cleanup();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
