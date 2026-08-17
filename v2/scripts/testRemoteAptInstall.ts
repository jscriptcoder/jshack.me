// Wire-check: can a player `apt install` a package onto a box they have ROOTED
// but do not own?
//
// D5 (`nc` connect + `nc -l` backdoor) locked a decision that depends on this:
// generated hosts ship no `nc`, so planting a backdoor is "root the box, install
// netcat there, then `nc -l`". Installing netcat is exactly ONE patch write —
// `/usr/bin/nc` with `is_new: true` and world-executable perms — because `nc` has
// no entry in `libraryDeps`, so the library loop writes nothing.
//
// Nothing proved that write was allowed. `tsc` cannot see it: the answer lives in
// the server's L2 walker, which regenerates the target's tree and asks `canWrite`
// at the session's tier. The two arms of that resolver differ, and only one of
// them had ever been exercised with a `/usr/bin` create:
//
//   1. an NPC host on the caller's own LAN (`lanBaseFsForMachineId`) — the path
//      the backdoor demo actually walks, and the untested one;
//   2. a foreign player's workstation (occupancy → owner's identity) — proven for
//      `/etc/implant` by `testCrossPlayerSuElevate.ts`, but `/usr/bin` is a
//      different container with different permissions, so it is asserted here too.
//
// The negative case is the one that matters most. `apt`'s root gate is CLIENT-side
// (`handleInstall` checks `env.session.userType`), and §7 records that a client
// holding a valid keypair can mint its own session — so the server's L2 is the
// only real gate. A guest-tier session must be refused `/usr/bin/nc`, or `apt
// install` is a privilege escalation on any box you can open a guest shell on.
//
// Drives the REAL endpoints against a running `vercel dev` + local supabase.
//
// Usage (from v2/, with supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testRemoteAptInstall.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { generateHomeLan } from '../src/core/generation/generateHomeLan';
import {
  isInnerGateway,
  lanBaseFsForMachineId,
  machineIdForLanHost,
} from '../src/core/generation/lanHostIdentity';
import { md5 } from '../src/core/generation/md5';
import { clearPublicIps, seedPublicIps } from './networkFixture';

const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
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
  const response = await fetch(PATCHES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

// --- The world under test ------------------------------------------------------

const ESSID = 'APT-REMOTE-WIFI';
const PUBLIC_IP = '203.0.113.91';

// What `apt install netcat` really sends, byte for byte.
const NC_PATH = '/usr/bin/nc';
const BINARY_STUB = '\x7fELF\x02\x01\x01\x03\x3e\x01';
const INSTALLED_BINARY_PERMS = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root', 'user', 'guest'],
};

const attacker = generateIdentity();
const victim = generateIdentity();

// The resolver's arm 1. An ORDINARY sibling (`kind: 'machine'`) is the tree the
// backdoor demo actually walks — a `buildRemoteHostFs` box with a real /usr/bin.
// Routers and switches are a different tree entirely, so selecting on "not .1"
// would silently test the wrong thing: the first such host this ESSID generates is
// an inner gateway.
const lanHosts = generateHomeLan(ESSID).hosts;
const resolvable = (host: (typeof lanHosts)[number]): boolean =>
  lanBaseFsForMachineId(ESSID, machineIdForLanHost(host, ESSID)) !== null;

const npcHost = lanHosts.find((host) => host.kind === 'machine' && resolvable(host));
const gatewayHost = lanHosts.find((host) => isInnerGateway(host) && resolvable(host));
if (npcHost === undefined) {
  console.error(`No ordinary NPC host (kind 'machine') generated for ESSID ${ESSID}`);
  process.exit(2);
}
const NPC_MACHINE = machineIdForLanHost(npcHost, ESSID);
const VICTIM_HOSTNAME = 'victimbox';
const VICTIM_MACHINE = computeWorkstationId(VICTIM_HOSTNAME, victim.publicKeyHex);

const installNetcat = (machineId: string) =>
  post(
    signRequest(attacker, 'upsertPatch', {
      machine_id: machineId,
      path: NC_PATH,
      content: BINARY_STUB,
      owner: 'root',
      permissions: INSTALLED_BINARY_PERMS,
      is_new: true,
      node_type: 'file',
    }),
  );

const ncRows = async (machineId: string): Promise<number> => {
  const { data } = await sr
    .from('patches')
    .select('writer_key')
    .eq('machine_id', machineId)
    .eq('path', NC_PATH);
  return data?.length ?? 0;
};

/** Replace the attacker's session on a machine with one at the given tier — the row
 *  an ssh hop (guest) or a subsequent `su` (root) would have inserted. Sessions are
 *  deleted rather than ended so L1's findActiveSession cannot return a stale top. */
const seedSession = async (machineId: string, userType: 'guest' | 'root') => {
  await sr.from('sessions').delete().eq('player_key', attacker.publicKeyHex);
  await sr.from('sessions').insert({
    session_id: `apt-${userType}-${machineId}`,
    player_key: attacker.publicKeyHex,
    machine_id: machineId,
    credentials: { username: userType === 'root' ? 'root' : 'guest', userType },
    kind: userType === 'root' ? 'su' : 'ssh',
    essid: ESSID,
  });
};

// --- Setup: clean slate on every machine this run asserts against --------------
// Generated hosts are ESSID-seeded, so their machine_id is identical across runs.
// Cleaning only at teardown lets a crashed run leave rows the next one reads as its
// own — so the target machines are cleared at SETUP.
await clearPublicIps(sr, [{ essid: ESSID, publicIp: PUBLIC_IP }]);
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await sr.from('patches').delete().eq('machine_id', NPC_MACHINE);
await sr.from('patches').delete().eq('machine_id', VICTIM_MACHINE);
await sr.from('sessions').delete().eq('player_key', attacker.publicKeyHex);

await seedPublicIps(sr, [{ essid: ESSID, publicIp: PUBLIC_IP }]);
await sr.from('home_network_occupants').insert({
  essid: ESSID,
  owner_key: victim.publicKeyHex,
  workstation_machine_id: VICTIM_MACHINE,
  workstation_username: 'victim',
  workstation_machine_name: VICTIM_HOSTNAME,
  workstation_root_hash: md5('victim-root-secret'),
});

console.log(`NPC host    ${npcHost.hostname} (${npcHost.ip}, ${npcHost.kind})  ${NPC_MACHINE}`);
console.log(`victim box  ${VICTIM_MACHINE}`);
console.log(
  `gateway     ${gatewayHost ? `${gatewayHost.hostname} (${gatewayHost.ip}, ${gatewayHost.kind})` : 'none generated'}`,
);
console.log('');

// === 1. Root on an NPC LAN host may install — the backdoor demo path ===========
await seedSession(NPC_MACHINE, 'root');
const npcRoot = await installNetcat(NPC_MACHINE);
check(
  'root session on an NPC LAN host installs /usr/bin/nc',
  npcRoot.status === 200 && (await ncRows(NPC_MACHINE)) === 1,
  `status ${npcRoot.status}${errorOf(npcRoot.body) ? ` ${errorOf(npcRoot.body)}` : ''}, rows ${await ncRows(NPC_MACHINE)}`,
);

// === 2. Guest on the same host may NOT — apt's root gate is client-side ========
await sr.from('patches').delete().eq('machine_id', NPC_MACHINE);
await seedSession(NPC_MACHINE, 'guest');
const npcGuest = await installNetcat(NPC_MACHINE);
check(
  'guest session on the same host is refused /usr/bin/nc',
  npcGuest.status === 403 && errorOf(npcGuest.body) === 'permission_denied' && (await ncRows(NPC_MACHINE)) === 0,
  `status ${npcGuest.status} ${errorOf(npcGuest.body) ?? '-'}, rows ${await ncRows(NPC_MACHINE)}`,
);

// === 3. Root on a FOREIGN player's workstation may install =====================
// The other resolver arm. `/usr/bin` is a different container from the `/etc` that
// testCrossPlayerSuElevate already covers, so its permissions are asserted here.
await seedSession(VICTIM_MACHINE, 'root');
const foreignRoot = await installNetcat(VICTIM_MACHINE);
check(
  "root session on another player's workstation installs /usr/bin/nc",
  foreignRoot.status === 200 && (await ncRows(VICTIM_MACHINE)) === 1,
  `status ${foreignRoot.status}${errorOf(foreignRoot.body) ? ` ${errorOf(foreignRoot.body)}` : ''}, rows ${await ncRows(VICTIM_MACHINE)}`,
);

// === 4. No session at all → L1 refuses before any permission walk ==============
await sr.from('patches').delete().eq('machine_id', VICTIM_MACHINE);
await sr.from('sessions').delete().eq('player_key', attacker.publicKeyHex);
const noSession = await installNetcat(VICTIM_MACHINE);
check(
  'no session on the target is refused',
  noSession.status === 403 && (await ncRows(VICTIM_MACHINE)) === 0,
  `status ${noSession.status} ${errorOf(noSession.body) ?? '-'}, rows ${await ncRows(VICTIM_MACHINE)}`,
);

// === 5. Root on an inner GATEWAY may install too ==============================
// A different tree from an ordinary sibling (router FS, not buildRemoteHostFs).
// Recorded because D5 accepts that a rooted gateway is plantable by construction:
// if this ever diverges from arm 1, the backdoor story on gateways changes with it.
if (gatewayHost !== undefined) {
  const gatewayMachine = machineIdForLanHost(gatewayHost, ESSID);
  await sr.from('patches').delete().eq('machine_id', gatewayMachine);
  await seedSession(gatewayMachine, 'root');
  const gatewayRoot = await installNetcat(gatewayMachine);
  check(
    'root session on an inner gateway installs /usr/bin/nc',
    gatewayRoot.status === 200 && (await ncRows(gatewayMachine)) === 1,
    `status ${gatewayRoot.status}${errorOf(gatewayRoot.body) ? ` ${errorOf(gatewayRoot.body)}` : ''}, rows ${await ncRows(gatewayMachine)}`,
  );
  await sr.from('patches').delete().eq('machine_id', gatewayMachine);
}

// --- Teardown ------------------------------------------------------------------
await sr.from('patches').delete().eq('machine_id', NPC_MACHINE);
await sr.from('patches').delete().eq('machine_id', VICTIM_MACHINE);
await sr.from('sessions').delete().eq('player_key', attacker.publicKeyHex);
await sr.from('home_network_occupants').delete().eq('essid', ESSID);
await clearPublicIps(sr, [{ essid: ESSID, publicIp: PUBLIC_IP }]);

const failed = results.filter((result) => !result.pass).length;
console.log('');
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
