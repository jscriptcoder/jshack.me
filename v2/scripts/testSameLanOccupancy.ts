// Wire-payload smoke for Story 7 slice 7.2a — same-WiFi occupancy persisted on join
// + readable by a fellow occupant. Drives the REAL /api/network endpoint against a
// running `vercel dev` + supabase (the locally-untypechecked api/ runtime).
//
// Net-new under test:
//   - A signed `registerNetwork` join writes an occupancy row keyed (essid, owner_key)
//     in addition to the WAN registry — every occupant of a shared ESSID coexists.
//   - B (a live occupant of X) `resolveOccupants X` gets A's workstation_machine_id +
//     A's RE-DERIVED LAN IP, with B itself excluded.
//   - A non-occupant (C) is refused (403 not_an_occupant) — the LAN boundary (D11).
//   - A payload that smuggles a client-supplied owner_key is rejected (schema refine).
//
// Usage (with v2 supabase + vercel dev running; point at 3101 if 3100 is a stale dev):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSameLanOccupancy.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
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

// --- Identities: A + B occupy X; C is elsewhere (never joins X). ---
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();

const X_ESSID = 'ABSTERGO-NET';
const A_WS = computeWorkstationId('skylab', alice.publicKeyHex);
const B_WS = computeWorkstationId('nebuchadnezzar', bob.publicKeyHex);
const A_LOCAL_IP = assignHomeNetwork(alice.publicKeyHex, X_ESSID).localIp;
const B_LOCAL_IP = assignHomeNetwork(bob.publicKeyHex, X_ESSID).localIp;
// A + B share the AP's public IP (essid-derived) — clean both registry rows up after.
const X_PUBLIC_IP = assignHomeNetwork(alice.publicKeyHex, X_ESSID).publicIp;

const joinPayload = (wsName: string, machineId: string) => ({
  essid: X_ESSID,
  workstation_machine_id: machineId,
  workstation_username: 'player',
  workstation_machine_name: wsName,
  workstation_root_hash: md5('root-secret'),
});

const readOccupant = async (ownerKey: string) => {
  const { data } = await sr
    .from('home_network_occupants')
    .select('owner_key, workstation_machine_id')
    .eq('essid', X_ESSID)
    .eq('owner_key', ownerKey)
    .maybeSingle();
  return data as { owner_key: string; workstation_machine_id: string } | null;
};

type WireOccupant = {
  workstation_machine_id: string;
  localIp: string;
  machineName: string;
};

const occupantsOf = (body: unknown): readonly WireOccupant[] =>
  (body as { occupants?: readonly WireOccupant[] } | null)?.occupants ?? [];

// Clean slate.
await sr.from('home_network_occupants').delete().eq('essid', X_ESSID);
await sr.from('network_registry').delete().eq('public_ip', X_PUBLIC_IP);

// === 1. A's signed join writes an occupancy row keyed (essid, owner_key). ===
const j1 = await post(signRequest(alice, 'registerNetwork', joinPayload('skylab', A_WS)));
const aRow = await readOccupant(alice.publicKeyHex);
check(
  "A's join persists an occupancy row for (X, ownerA) with A's workstation id",
  j1.status === 200 && aRow !== null && aRow.workstation_machine_id === A_WS,
  `status=${j1.status} row=${JSON.stringify(aRow)}`,
);

// === 2. B's signed join coexists (no last-writer collapse — separate PK). ===
const j2 = await post(signRequest(bob, 'registerNetwork', joinPayload('nebuchadnezzar', B_WS)));
const bRow = await readOccupant(bob.publicKeyHex);
check(
  "B's join coexists — both (X, ownerA) and (X, ownerB) rows exist",
  j2.status === 200 && bRow !== null && (await readOccupant(alice.publicKeyHex)) !== null,
  `status=${j2.status} bRow=${JSON.stringify(bRow)}`,
);

// === 3. B (a live occupant) reads the occupant list → sees A, excludes itself. ===
const r3 = await post(signRequest(bob, 'resolveOccupants', { essid: X_ESSID }));
const seen = occupantsOf(r3.body);
check(
  "B resolveOccupants X sees A's workstation (id + LAN IP + machine name), excluding B",
  r3.status === 200 &&
    seen.length === 1 &&
    seen[0]!.workstation_machine_id === A_WS &&
    seen[0]!.localIp === A_LOCAL_IP &&
    seen[0]!.machineName === 'skylab' &&
    !seen.some((occupant) => occupant.localIp === B_LOCAL_IP),
  `status=${r3.status} occupants=${JSON.stringify(seen)}`,
);

// === 4. C (never joined X) is refused — the LAN boundary. ===
const r4 = await post(signRequest(carol, 'resolveOccupants', { essid: X_ESSID }));
check(
  'a non-occupant (C) is refused with 403 not_an_occupant',
  r4.status === 403 && (r4.body as { error?: string } | null)?.error === 'not_an_occupant',
  `status=${r4.status} body=${JSON.stringify(r4.body)}`,
);

// === 5. A payload smuggling a client-supplied owner_key is rejected (schema refine). ===
const r5 = await post(
  signRequest(bob, 'resolveOccupants', { essid: X_ESSID, owner_key: alice.publicKeyHex }),
);
check(
  'a client-supplied owner_key in the payload is rejected (400)',
  r5.status === 400,
  `status=${r5.status} body=${JSON.stringify(r5.body)}`,
);

// === 6. A disconnects → only A's row is removed; B (still connected) remains. ===
const d6 = await post(signRequest(alice, 'unregisterOccupant', { essid: X_ESSID }));
const aAfter = await readOccupant(alice.publicKeyHex);
const bAfter = await readOccupant(bob.publicKeyHex);
check(
  "A's disconnect removes only A's occupancy row — B's row is untouched",
  d6.status === 200 && aAfter === null && bAfter !== null,
  `status=${d6.status} aRow=${JSON.stringify(aAfter)} bRow=${JSON.stringify(bAfter)}`,
);

// === 7. A repeat disconnect (no row left) is a harmless idempotent no-op. ===
const d7 = await post(signRequest(alice, 'unregisterOccupant', { essid: X_ESSID }));
check(
  'a repeat disconnect with no row left still succeeds (idempotent)',
  d7.status === 200 && (await readOccupant(alice.publicKeyHex)) === null,
  `status=${d7.status}`,
);

// Cleanup.
await sr.from('home_network_occupants').delete().eq('essid', X_ESSID);
await sr.from('network_registry').delete().eq('public_ip', X_PUBLIC_IP);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
