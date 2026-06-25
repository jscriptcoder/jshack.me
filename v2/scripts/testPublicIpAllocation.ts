// Wire-payload smoke for the unique public-IP allocation service (epic item #4).
// Drives the REAL /api/network `registerNetwork` action against a running
// `vercel dev` + supabase, and exercises the `network_public_ips` claim primitive
// directly via service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime + the migration):
//   - Joining an ESSID allocates + stores a public IP in `network_public_ips` and
//     stamps the SAME address into `network_registry.public_ip` (no longer the old
//     deterministic derive).
//   - Re-joining the same ESSID is idempotent — the stored IP is unchanged.
//   - Two different ESSIDs get two DISTINCT IPs.
//   - The claim primitive (`INSERT … ON CONFLICT (essid) DO NOTHING`): a cross-ESSID
//     IP collision raises 23505 (the redraw signal the allocator maps to null), while
//     a same-ESSID re-claim is swallowed and leaves the stored IP untouched.
//   - The existing cross-player loop is unbroken: `resolvePublicScan` of an allocated
//     IP still resolves the router + :22.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testPublicIpAllocation.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeRouterId } from '../src/core/identity/router';
import { isPublicIp } from '../src/core/generation/ip';
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

const foundOf = (body: unknown): boolean => (body as { found?: boolean } | null)?.found === true;

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

const storedIpFor = async (essid: string): Promise<string | null> => {
  const { data } = await sr
    .from('network_public_ips')
    .select('public_ip')
    .eq('essid', essid)
    .maybeSingle();
  return (data as { public_ip: string } | null)?.public_ip ?? null;
};

const registryIpFor = async (ownerKey: string): Promise<string | null> => {
  const { data } = await sr
    .from('network_registry')
    .select('public_ip')
    .eq('owner_key', ownerKey)
    .maybeSingle();
  return (data as { public_ip: string } | null)?.public_ip ?? null;
};

// The exact upsert the api/ adapter's `claim` issues — replicated here to assert the
// DB-level contract the redraw/adopt logic leans on.
const claimViaSr = async (essid: string, ip: string) =>
  sr
    .from('network_public_ips')
    .upsert({ essid, public_ip: ip }, { onConflict: 'essid', ignoreDuplicates: true })
    .select('public_ip')
    .maybeSingle();

const alice = generateIdentity();
const bob = generateIdentity();
const A_ESSID = 'ABSTERGO-NET';
const B_ESSID = 'BLUE-SUN-CAFE';
const C_ESSID = 'CYBERDYNE-GUEST';
const A_ROUTER = computeRouterId(alice.publicKeyHex);
const FRESH_IP = '198.51.100.222';

// Clean slate.
const cleanup = async () => {
  await sr.from('network_public_ips').delete().in('essid', [A_ESSID, B_ESSID, C_ESSID]);
  await sr.from('network_registry').delete().in('owner_key', [alice.publicKeyHex, bob.publicKeyHex]);
  await sr
    .from('home_network_occupants')
    .delete()
    .in('owner_key', [alice.publicKeyHex, bob.publicKeyHex]);
  await sr.from('patches').delete().eq('machine_id', A_ROUTER);
};
await cleanup();

// === 1. Joining ESSID A allocates + persists a public IP, stamped into the registry. ===
const r1 = await post(registerEnvelope(alice, A_ESSID, 'skylab'));
const aStored = await storedIpFor(A_ESSID);
const aRegistry = await registryIpFor(alice.publicKeyHex);
check(
  'join allocates a routable public IP and stamps the SAME address into the registry',
  r1.status === 200 &&
    aStored !== null &&
    isPublicIp(aStored) &&
    aStored === aRegistry,
  `status=${r1.status} allocated=${aStored} registry=${aRegistry}`,
);

// === 2. Re-joining ESSID A is idempotent — the stored IP is unchanged. ===
await post(registerEnvelope(alice, A_ESSID, 'skylab'));
const aStored2 = await storedIpFor(A_ESSID);
check(
  're-joining the same ESSID returns the identical IP (no second allocation)',
  aStored2 === aStored,
  `first=${aStored} second=${aStored2}`,
);

// === 3. A different ESSID gets a DISTINCT public IP. ===
await post(registerEnvelope(bob, B_ESSID, 'nebuchadnezzar'));
const bStored = await storedIpFor(B_ESSID);
check(
  'two different ESSIDs receive two distinct public IPs',
  bStored !== null && isPublicIp(bStored) && bStored !== aStored,
  `A=${aStored} B=${bStored}`,
);

// === 4a. Claim primitive: a cross-ESSID IP collision raises 23505 (the redraw signal). ===
const collide = await claimViaSr(C_ESSID, aStored ?? '');
check(
  'claiming an IP already owned by another ESSID raises 23505 (allocator redraws)',
  (collide.error as { code?: string } | null)?.code === '23505',
  `code=${(collide.error as { code?: string } | null)?.code ?? 'none'}`,
);

// === 4b. Claim primitive: a same-ESSID re-claim is swallowed, stored IP untouched. ===
const reclaim = await claimViaSr(A_ESSID, FRESH_IP);
const aStored3 = await storedIpFor(A_ESSID);
check(
  're-claiming an allocated ESSID is a no-op (DO NOTHING) and leaves its IP unchanged',
  reclaim.error === null && aStored3 === aStored,
  `error=${reclaim.error === null ? 'none' : 'set'} ip=${aStored3}`,
);

// === 5. The existing cross-player loop is unbroken: scan the allocated IP. ===
const scan = await post(signRequest(bob, 'resolvePublicScan', { target: aStored ?? '' }));
check(
  'resolvePublicScan of the allocated IP still resolves the router host-up with :22',
  scan.status === 200 &&
    foundOf(scan.body) &&
    (scan.body as { ports?: { port: number }[] }).ports?.some((openPort) => openPort.port === 22) ===
      true,
  `status=${scan.status} found=${foundOf(scan.body)}`,
);

await cleanup();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
