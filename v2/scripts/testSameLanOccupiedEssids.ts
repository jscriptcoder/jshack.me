// Wire-payload smoke for the organic-discovery read — `resolveOccupiedEssids`. Drives
// the REAL /api/network endpoint against a running `vercel dev` + supabase, seeding
// occupancy rows via service_role (as players' WiFi joins would), then asserting the
// net-new (locally-untypechecked api/) runtime:
//   - Discovery is UNGATED: a player who occupies NOTHING still gets the list — that is
//     what lets a stranger learn a network exists before joining it.
//   - It surfaces every currently-occupied ESSID NAME, and is NAME-ONLY: no owner key,
//     machine id, or LAN IP crosses the wire.
//   - A network occupied by several players appears ONCE (the handler de-duplicates).
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSameLanOccupiedEssids.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { md5 } from '../src/core/generation/md5';

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

// Identities: alice + bob both occupy SHARED (dedup case); carol occupies SOLO; dave
// occupies NOTHING (the discoverer — proves the read is ungated).
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();
const dave = generateIdentity();

const SHARED = 'OCCUPIED-SHARED-WIFI';
const SOLO = 'OCCUPIED-SOLO-WIFI';

const occupancyRow = (owner: ReturnType<typeof generateIdentity>, essid: string, wsName: string) => ({
  essid,
  owner_key: owner.publicKeyHex,
  workstation_machine_id: computeWorkstationId(wsName, owner.publicKeyHex),
  workstation_username: 'player',
  workstation_machine_name: wsName,
  workstation_root_hash: md5('root-secret'),
});

// Clean slate, then seed: alice + bob on SHARED, carol on SOLO.
await sr.from('home_network_occupants').delete().in('essid', [SHARED, SOLO]);
await sr
  .from('home_network_occupants')
  .insert([
    occupancyRow(alice, SHARED, 'skylab'),
    occupancyRow(bob, SHARED, 'nebuchadnezzar'),
    occupancyRow(carol, SOLO, 'matrix'),
  ]);

const ask = (caller: ReturnType<typeof generateIdentity>) =>
  signRequest(caller, 'resolveOccupiedEssids', {});

// === 1. Dave (occupies nothing) discovers the occupied ESSIDs — ungated. ===
const r1 = await post(NETWORK, ask(dave));
const essids = ((r1.body as { essids?: readonly string[] }).essids ?? []).filter(
  (essid) => essid === SHARED || essid === SOLO,
);
check('a non-occupant discovery is accepted (ungated read)', r1.status === 200, `status=${r1.status}`);
check(
  'discovery surfaces every currently-occupied ESSID name',
  essids.includes(SHARED) && essids.includes(SOLO),
  `essids=${JSON.stringify(essids)}`,
);

// === 2. Name-only — bare strings, and no occupant identity anywhere in the body. ===
const joined = JSON.stringify(r1.body);
check(
  'the result is name-only — every entry is a bare string',
  essids.every((essid) => typeof essid === 'string'),
  `types=${[...new Set(essids.map((essid) => typeof essid))].join(',')}`,
);
check(
  'no occupant identity leaks (no owner key / machine id in the body)',
  ![alice, bob, carol].some((id) => joined.includes(id.publicKeyHex)) &&
    !joined.includes(computeWorkstationId('skylab', alice.publicKeyHex)),
  `ownerKeysAbsent=${![alice, bob, carol].some((id) => joined.includes(id.publicKeyHex))}`,
);

// === 3. Dedup — SHARED is occupied by two players but appears exactly once. ===
check(
  'an ESSID occupied by several players appears once (dedup)',
  essids.filter((essid) => essid === SHARED).length === 1,
  `sharedCount=${essids.filter((essid) => essid === SHARED).length}`,
);

// Cleanup.
await sr.from('home_network_occupants').delete().in('essid', [SHARED, SOLO]);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
