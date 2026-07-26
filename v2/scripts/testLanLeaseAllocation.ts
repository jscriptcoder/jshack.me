// Wire-payload smoke for the LAN lease allocator. Drives the REAL /api/network
// `registerNetwork` action against a running `vercel dev` + supabase, and exercises
// the `network_lan_leases` claim primitive directly via service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime + the migration):
//   - Joining an ESSID leases a host octet in `network_lan_leases`, and it is the
//     octet the pure derivation issues today — so seeding the lease moves nobody.
//   - Re-joining is idempotent: the leased octet is unchanged.
//   - TWO IDENTITIES WHOSE DERIVATIONS COLLIDE, joining CONCURRENTLY, end up on
//     different octets. This is the defect the slice exists to close, and the race
//     is the part no unit test over a fake store can prove.
//   - The lease OUTLIVES occupancy: `unregisterOccupant` (the real `nmcli
//     disconnect` path) removes the occupancy row but not the lease, so re-joining
//     returns the same address.
//   - The claim primitive: a cross-occupant octet collision raises 23505 (the redraw
//     signal the allocator maps to null), while a same-occupant re-claim is
//     swallowed and leaves the leased octet untouched.
//   - The octet CHECK refuses the AP gateway's `.1`.
//   - The existing per-ESSID public-IP allocation is unbroken by the new step.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testLanLeaseAllocation.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { assignHomeNetwork } from '../src/core/network/homeNetwork';
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

const post = async (envelope: unknown): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(NETWORK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const registerEnvelope = (
  identity: ReturnType<typeof generateIdentity>,
  essid: string,
  wsName: string,
) =>
  signRequest(identity, 'registerNetwork', {
    essid,
    workstation_machine_id: computeWorkstationId(wsName, identity.publicKeyHex),
    workstation_username: 'player',
    workstation_machine_name: wsName,
    workstation_root_hash: md5('root-secret'),
  });

const leasedOctetFor = async (essid: string, ownerKey: string): Promise<number | null> => {
  const { data } = await sr
    .from('network_lan_leases')
    .select('octet')
    .eq('essid', essid)
    .eq('owner_key', ownerKey)
    .maybeSingle();
  return (data as { octet: number } | null)?.octet ?? null;
};

const occupantRowCount = async (essid: string, ownerKey: string): Promise<number> => {
  const { data } = await sr
    .from('home_network_occupants')
    .select('owner_key')
    .eq('essid', essid)
    .eq('owner_key', ownerKey);
  return (data ?? []).length;
};

// The exact upsert the api/ adapter's `claim` issues — replicated here to assert the
// DB-level contract the redraw/adopt logic leans on.
const claimViaSr = async (essid: string, ownerKey: string, octet: number) =>
  sr
    .from('network_lan_leases')
    .upsert(
      { essid, owner_key: ownerKey, octet },
      { onConflict: 'essid,owner_key', ignoreDuplicates: true },
    )
    .select('octet')
    .maybeSingle();

const derivedOctet = (ownerKey: string, essid: string): number =>
  Number(assignHomeNetwork(ownerKey, essid).localIp.split('.')[3]);

const SOLO_ESSID = 'LEASE-TEST-NET';
const RACE_ESSID = 'LEASE-RACE-NET';

const alice = generateIdentity();

// Search for two identities whose PURE DERIVATIONS collide on the race ESSID — the
// exact situation that silently gave two occupants one address before this slice.
// Over 253 octets a birthday collision turns up within a few dozen draws; the cap
// only stops a pathological search.
const findCollidingPair = (essid: string) => {
  const seen = new Map<number, ReturnType<typeof generateIdentity>>();
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const identity = generateIdentity();
    const octet = derivedOctet(identity.publicKeyHex, essid);
    const rival = seen.get(octet);
    if (rival !== undefined) return { first: rival, second: identity, octet };
    seen.set(octet, identity);
  }
  return null;
};

const collision = findCollidingPair(RACE_ESSID);
if (collision === null) {
  console.error('Could not find two identities deriving the same octet — cannot test the race');
  process.exit(1);
}

const raceKeys = [collision.first.publicKeyHex, collision.second.publicKeyHex];
const allKeys = [alice.publicKeyHex, ...raceKeys];

const cleanup = async () => {
  await sr.from('network_lan_leases').delete().in('essid', [SOLO_ESSID, RACE_ESSID]);
  await sr.from('network_public_ips').delete().in('essid', [SOLO_ESSID, RACE_ESSID]);
  await sr.from('network_registry').delete().in('owner_key', allKeys);
  await sr.from('home_network_occupants').delete().in('owner_key', allKeys);
  await sr.from('patches').delete().eq('machine_id', computeApGatewayId(SOLO_ESSID));
  await sr.from('patches').delete().eq('machine_id', computeApGatewayId(RACE_ESSID));
};
await cleanup();

// === 1. Joining leases the octet the derivation issues — seeding moves nobody. ===
const join1 = await post(registerEnvelope(alice, SOLO_ESSID, 'skylab'));
const leased1 = await leasedOctetFor(SOLO_ESSID, alice.publicKeyHex);
const derived1 = derivedOctet(alice.publicKeyHex, SOLO_ESSID);
check(
  'join leases the octet the pure derivation issues (an existing occupant does not move)',
  join1.status === 200 && leased1 === derived1,
  `status=${join1.status} leased=${leased1} derived=${derived1}`,
);

// === 2. Re-joining is idempotent. ===
await post(registerEnvelope(alice, SOLO_ESSID, 'skylab'));
const leased2 = await leasedOctetFor(SOLO_ESSID, alice.publicKeyHex);
check(
  're-joining the same ESSID returns the identical octet (no second allocation)',
  leased2 === leased1,
  `first=${leased1} second=${leased2}`,
);

// === 3. The lease OUTLIVES occupancy: disconnect drops the occupancy row, not the lease. ===
await post(signRequest(alice, 'unregisterOccupant', { essid: SOLO_ESSID }));
const occupantsAfterLeave = await occupantRowCount(SOLO_ESSID, alice.publicKeyHex);
const leaseAfterLeave = await leasedOctetFor(SOLO_ESSID, alice.publicKeyHex);
check(
  'nmcli disconnect removes the occupancy row but NOT the lease',
  occupantsAfterLeave === 0 && leaseAfterLeave === leased1,
  `occupantRows=${occupantsAfterLeave} lease=${leaseAfterLeave}`,
);

// === 4. Reconnecting returns the SAME address. ===
await post(registerEnvelope(alice, SOLO_ESSID, 'skylab'));
const leasedAfterRejoin = await leasedOctetFor(SOLO_ESSID, alice.publicKeyHex);
check(
  'reconnecting after a disconnect returns the address held before',
  leasedAfterRejoin === leased1,
  `before=${leased1} after=${leasedAfterRejoin}`,
);

// === 5. THE RACE: two colliding derivations joining concurrently get distinct octets. ===
const [raceA, raceB] = await Promise.all([
  post(registerEnvelope(collision.first, RACE_ESSID, 'trinity')),
  post(registerEnvelope(collision.second, RACE_ESSID, 'morpheus')),
]);
const octetA = await leasedOctetFor(RACE_ESSID, collision.first.publicKeyHex);
const octetB = await leasedOctetFor(RACE_ESSID, collision.second.publicKeyHex);
check(
  'two identities whose derivations COLLIDE, joining concurrently, get different octets',
  raceA.status === 200 &&
    raceB.status === 200 &&
    octetA !== null &&
    octetB !== null &&
    octetA !== octetB,
  `bothDerived=.${collision.octet} statuses=${raceA.status}/${raceB.status} a=${octetA} b=${octetB}`,
);

// === 6. Exactly one of them keeps the contested octet; the loser redrew into range. ===
const holders = [octetA, octetB].filter((octet) => octet === collision.octet).length;
const loser = octetA === collision.octet ? octetB : octetA;
check(
  'exactly one holds the contested octet and the loser redrew to a usable host address',
  holders === 1 && loser !== null && loser >= 2 && loser <= 254,
  `contested=.${collision.octet} holders=${holders} loser=${loser}`,
);

// === 7. Claim primitive: another occupant's octet raises 23505 (the redraw signal). ===
const rival = await claimViaSr(RACE_ESSID, 'not-a-real-occupant-key', octetA ?? 2);
check(
  'claiming an octet held by another occupant of the ESSID raises 23505 (allocator redraws)',
  (rival.error as { code?: string } | null)?.code === '23505',
  `code=${(rival.error as { code?: string } | null)?.code ?? 'none'}`,
);

// === 8. Claim primitive: a same-occupant re-claim is swallowed, leased octet untouched. ===
const reclaim = await claimViaSr(RACE_ESSID, collision.first.publicKeyHex, 199);
const octetAfterReclaim = await leasedOctetFor(RACE_ESSID, collision.first.publicKeyHex);
check(
  're-claiming an occupant that already holds a lease is a no-op and leaves its octet unchanged',
  reclaim.error === null && octetAfterReclaim === octetA,
  `error=${reclaim.error === null ? 'none' : 'set'} octet=${octetAfterReclaim}`,
);

// === 9. The octet CHECK refuses the AP gateway's .1 (defence in depth). ===
const gatewayClaim = await claimViaSr(RACE_ESSID, 'gateway-impersonator-key', 1);
check(
  'the octet CHECK refuses .1 — no occupant can lease the AP gateway’s address',
  (gatewayClaim.error as { code?: string } | null)?.code === '23514',
  `code=${(gatewayClaim.error as { code?: string } | null)?.code ?? 'none'}`,
);

// === 10. The existing per-ESSID public-IP allocation is unbroken by the new step. ===
const { data: publicIpRow } = await sr
  .from('network_public_ips')
  .select('public_ip')
  .eq('essid', RACE_ESSID)
  .maybeSingle();
check(
  'the join still allocates one shared public IP per ESSID alongside the per-occupant lease',
  (publicIpRow as { public_ip: string } | null)?.public_ip !== undefined,
  `publicIp=${(publicIpRow as { public_ip: string } | null)?.public_ip ?? 'none'}`,
);

await cleanup();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
