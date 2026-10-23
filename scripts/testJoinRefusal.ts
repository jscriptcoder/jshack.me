// Wire-payload smoke for the JOIN REFUSAL — the server decides which networks a player may
// join. Drives the REAL /api/network `registerNetwork` action against a running
// `vercel dev` + supabase, then reads the two tables a join writes.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - A player may join only the networks of the town their key starts them in.
//   - A signed join by a player who starts in Ridgemont, to a network Ridgemont draws beyond
//     its landmarks, is admitted, under the key it is known by, with a LAN lease and an
//     occupant row.
//   - Their join to a network in another town is refused with 403 network_not_joinable,
//     and leaves no LAN lease and no occupant row behind.
//   - So is a join to a corporation the world draws, which stands in no town at all.
//   - A player who starts in that other town joins its network, and is refused Ridgemont's.
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
import { generateIdentityIn } from '../src/test/factories/identityIn.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { md5 } from '../src/core/generation/md5.js';
import { DECLARED_NETWORKS, isLandmark, RIDGEMONT } from '../src/core/generation/world.js';

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

// Every row a join can leave behind for one network, one table at a time, or only the
// rows of the player under `ownerKey` when it is given.
const rowsFor = async (essid: string, ownerKey?: string) => {
  const count = async (table: string) => {
    const query = sr.from(table).select('*', { count: 'exact', head: true }).eq('essid', essid);
    const { count: rows } = await (ownerKey === undefined
      ? query
      : query.eq('owner_key', ownerKey));
    return rows ?? 0;
  };
  return {
    leases: await count('network_lan_leases'),
    occupants: await count('home_network_occupants'),
  };
};

const OUT_OF_TOWN = DECLARED_NETWORKS.find(
  (network) => network.town !== undefined && network.town !== RIDGEMONT,
);
// A corporation the world draws stands in no town at all.
const PLACELESS = DECLARED_NETWORKS.find((network) => network.town === undefined);
// A network Ridgemont draws, which a player who starts in Ridgemont may join.
const RIDGEMONT_DRAWN = DECLARED_NETWORKS.find(
  (network) => network.town === RIDGEMONT && !isLandmark(network.key),
);
if (OUT_OF_TOWN?.town === undefined || PLACELESS === undefined || RIDGEMONT_DRAWN === undefined) {
  console.error('The world declares no network to refuse, or none Ridgemont draws to admit.');
  process.exit(2);
}
// A made-up network of the kind the lab wire-checks join.
const LAB_NETWORK = 'JOIN-REFUSAL-LAB';

const cleanup = async () => {
  for (const essid of [RIDGEMONT_DRAWN.key, OUT_OF_TOWN.key, PLACELESS.key, LAB_NETWORK]) {
    await sr.from('home_network_occupants').delete().eq('essid', essid);
    await sr.from('network_lan_leases').delete().eq('essid', essid);
  }
};
await cleanup();

const player = generateIdentityIn(RIDGEMONT);
// A player who starts in the other town.
const outsider = generateIdentityIn(OUT_OF_TOWN.town);

// === 0. A join to a network Ridgemont draws is admitted under its key. ===
const joinedDrawn = await post(joinEnvelope(player, RIDGEMONT_DRAWN.key));
const drawnRows = await rowsFor(RIDGEMONT_DRAWN.key);
const localIp =
  typeof joinedDrawn.body === 'object' && joinedDrawn.body !== null
    ? (joinedDrawn.body as { local_ip?: string }).local_ip
    : undefined;
check(
  `a join to ${RIDGEMONT_DRAWN.key} (${RIDGEMONT_DRAWN.essid}) is admitted with a LAN address`,
  joinedDrawn.status === 200 && typeof localIp === 'string',
  `status=${joinedDrawn.status} local_ip=${localIp} error=${errorOf(joinedDrawn.body)}`,
);
check(
  'the admitted join holds one LAN lease and one occupant row under the key',
  drawnRows.leases === 1 && drawnRows.occupants === 1,
  `leases=${drawnRows.leases} occupants=${drawnRows.occupants}`,
);

// === 1. A join to another town's network is refused, and writes nothing. ===
const refused = await post(joinEnvelope(player, OUT_OF_TOWN.key));
const leftBehind = await rowsFor(OUT_OF_TOWN.key);
check(
  `a join to ${OUT_OF_TOWN.key} (${OUT_OF_TOWN.town}) is refused with 403 network_not_joinable`,
  refused.status === 403 && errorOf(refused.body) === 'network_not_joinable',
  `status=${refused.status} error=${errorOf(refused.body)}`,
);
check(
  'the refused join leaves no LAN lease or occupant row',
  leftBehind.leases === 0 && leftBehind.occupants === 0,
  `leases=${leftBehind.leases} occupants=${leftBehind.occupants}`,
);

// === 2. A join to a corporation, which stands in no town, is refused the same way. ===
const refusedPlaceless = await post(joinEnvelope(player, PLACELESS.key));
const placelessLeft = await rowsFor(PLACELESS.key);
check(
  `a join to ${PLACELESS.key} (${PLACELESS.place}, in no town) is refused with 403 network_not_joinable`,
  refusedPlaceless.status === 403 && errorOf(refusedPlaceless.body) === 'network_not_joinable',
  `status=${refusedPlaceless.status} error=${errorOf(refusedPlaceless.body)}`,
);
check(
  'the refused join leaves no LAN lease or occupant row',
  placelessLeft.leases === 0 && placelessLeft.occupants === 0,
  `leases=${placelessLeft.leases} occupants=${placelessLeft.occupants}`,
);

// === 3. A player who starts in the other town joins there, and is refused Ridgemont. ===
const joinedHome = await post(joinEnvelope(outsider, OUT_OF_TOWN.key));
const homeRows = await rowsFor(OUT_OF_TOWN.key, outsider.publicKeyHex);
check(
  `a player who starts in ${OUT_OF_TOWN.town} joins ${OUT_OF_TOWN.key} there`,
  joinedHome.status === 200 && homeRows.leases === 1 && homeRows.occupants === 1,
  `status=${joinedHome.status} error=${errorOf(joinedHome.body)} leases=${homeRows.leases} occupants=${homeRows.occupants}`,
);
const refusedRidgemont = await post(joinEnvelope(outsider, RIDGEMONT_DRAWN.key));
const ridgemontRows = await rowsFor(RIDGEMONT_DRAWN.key, outsider.publicKeyHex);
check(
  `the same player's join to ${RIDGEMONT_DRAWN.key} (${RIDGEMONT}) is refused with 403 network_not_joinable`,
  refusedRidgemont.status === 403 && errorOf(refusedRidgemont.body) === 'network_not_joinable',
  `status=${refusedRidgemont.status} error=${errorOf(refusedRidgemont.body)}`,
);
check(
  'the refused join leaves them no LAN lease or occupant row in Ridgemont',
  ridgemontRows.leases === 0 && ridgemontRows.occupants === 0,
  `leases=${ridgemontRows.leases} occupants=${ridgemontRows.occupants}`,
);

// === 4. With the local flag set, a lab network still joins and records its occupant. ===
const admitted = await post(joinEnvelope(player, LAB_NETWORK));
const labRows = await rowsFor(LAB_NETWORK);
check(
  `a join to the undeclared ${LAB_NETWORK} succeeds while the local flag is set`,
  admitted.status === 200 && labRows.leases === 1 && labRows.occupants === 1,
  `status=${admitted.status} error=${errorOf(admitted.body)} leases=${labRows.leases} occupants=${labRows.occupants}`,
);

await cleanup();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
