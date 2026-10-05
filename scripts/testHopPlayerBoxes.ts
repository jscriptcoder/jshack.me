// Wire-check — from a box on a network, the players' workstations on that network are as
// reachable as they are to someone living there, and a login made through a player's
// workstation is logged under that player's own address.
//
// Bob lives on another network. What puts him on HOP-NEIGHBOURS-WIFI is a root shell he
// holds on one of its generated boxes. Carol and Dave live on it, each running sshd.
//   - At home, Bob asks who is on the network and is refused: he is not standing on it.
//   - From the box he holds, he is shown Carol and Dave at their leased addresses.
//   - From that box he logs in to Carol's workstation; her auth.log names the box.
//   - From Carol's workstation he logs in to Dave's; Dave's auth.log names Carol's lease.
//   - Naming the network from home, or naming a box he holds no shell on, is refused.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testHopPlayerBoxes.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env/fixture.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { machineIdForLanHost } from '../src/core/generation/lanTopology.js';
import { workstationGuestPassword } from '../src/core/generation/workstationFs.js';
import { lanAddressFor } from '../src/core/network/lanAddress.js';
import { formatPidfileContent } from '../src/core/services/pidfile.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog.js';
import { leaveNetwork, standOnNetwork } from './standVantage.js';

const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
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

const errorOf = (body: unknown): string | undefined => (body as { error?: string } | null)?.error;

const ESSID = 'HOP-NEIGHBOURS-WIFI';
const ELSEWHERE = 'BOB-ELSEWHERE-WIFI';
const CAROL_OCTET = 60;
const DAVE_OCTET = 61;

const bob = generateIdentity();
const carol = generateIdentity();
const dave = generateIdentity();
const CAROL_WS = computeWorkstationId('rig', carol.publicKeyHex);
const DAVE_WS = computeWorkstationId('rig', dave.publicKeyHex);
const CAROL_IP = lanAddressFor(ESSID, CAROL_OCTET);
const DAVE_IP = lanAddressFor(ESSID, DAVE_OCTET);

const npcBox = generateHomeLan(ESSID).hosts.find((host) => host.kind === 'machine');
if (npcBox === undefined) {
  console.error(`ESSID ${ESSID} has no generated machine — pick another.`);
  process.exit(2);
}
const NPC_BOX = machineIdForLanHost(npcBox, ESSID);

const WORLD_PID = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };

/** The owner started sshd on :22 — a fresh workstation serves nothing until then. */
const sshdOn = (machineId: string, owner: ReturnType<typeof generateIdentity>) => ({
  machine_id: machineId,
  path: '/var/run/sshd.pid',
  content: formatPidfileContent(SERVICE_CATALOG.ssh, 22),
  owner: 'root',
  permissions: WORLD_PID,
  node_type: 'file',
  writer_key: owner.publicKeyHex,
  updated_at: new Date().toISOString(),
});

/** Who is on ESSID, asked from `box` (omitted: from Bob's own workstation). */
const listFrom = (box?: string) =>
  post(
    NETWORK,
    signRequest(bob, 'resolveOccupants', {
      essid: ESSID,
      ...(box === undefined ? {} : { caller_machine_id: box }),
    }),
  );

/** A guest login on the workstation at `targetIp`, run from `box`. */
const loginFrom = (sessionId: string, targetIp: string, password: string, box?: string) =>
  post(
    SESSIONS,
    signRequest(bob, 'authCreateSessionSameLan', {
      session_id: sessionId,
      essid: ESSID,
      target_ip: targetIp,
      username: 'guest',
      password,
      port: 22,
      parent_session_id: null,
      ...(box === undefined ? {} : { caller_machine_id: box }),
    }),
  );

/** The last line of a workstation's auth.log, as its owner's journal holds it. */
const lastAuthLine = async (machineId: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', AUTH_LOG_PATH)
    .maybeSingle();
  const content = (data as { content: string | null } | null)?.content ?? '';
  return content.trim().split('\n').at(-1) ?? '';
};

const cleanUp = async () => {
  await leaveNetwork(sr, ESSID);
  await leaveNetwork(sr, ELSEWHERE);
  for (const machineId of [CAROL_WS, DAVE_WS]) {
    await sr.from('patches').delete().eq('machine_id', machineId);
  }
  await sr.from('sessions').delete().eq('player_key', bob.publicKeyHex);
};

await cleanUp();
await standOnNetwork(sr, ELSEWHERE, bob, 31);
await standOnNetwork(sr, ESSID, carol, CAROL_OCTET);
await standOnNetwork(sr, ESSID, dave, DAVE_OCTET);
await sr.from('patches').insert([sshdOn(CAROL_WS, carol), sshdOn(DAVE_WS, dave)]);
// Bob already holds a root shell on the generated box — how he got it is another check's
// business; this one starts from standing there.
await sr.from('sessions').insert({
  session_id: 'hop-npc-1',
  player_key: bob.publicKeyHex,
  machine_id: NPC_BOX,
  credentials: { username: 'root', userType: 'root' },
  parent_session_id: null,
  source_ip: null,
  kind: 'ssh',
  essid: ESSID,
});

// === 1. Asking from home: Bob is not standing on this network. ===
const fromHome = await listFrom();
check(
  'from home on another network, the occupant list is refused',
  fromHome.status === 403 && errorOf(fromHome.body) === 'wrong_network',
  `status=${fromHome.status} error=${errorOf(fromHome.body) ?? '-'}`,
);

// === 2. Asking from the box he holds there: Carol and Dave, at their leases. ===
const fromBox = await listFrom(NPC_BOX);
const listed = ((fromBox.body as { occupants?: { localIp: string }[] } | null)?.occupants ?? [])
  .map((occupant) => occupant.localIp)
  .sort();
check(
  'from the box he holds on the network, both occupants are listed at their leases',
  fromBox.status === 200 && JSON.stringify(listed) === JSON.stringify([CAROL_IP, DAVE_IP]),
  `status=${fromBox.status} listed=${listed.join(',')}`,
);

// === 3. From that box, into Carol's workstation; her log names the box. ===
const intoCarol = await loginFrom(
  'hop-carol-1',
  CAROL_IP,
  workstationGuestPassword(carol.publicKeyHex),
  NPC_BOX,
);
check(
  'from the box, a guest login on Carol’s workstation lands',
  intoCarol.status === 200 &&
    (intoCarol.body as { machine_id?: string } | null)?.machine_id === CAROL_WS,
  `status=${intoCarol.status} ${JSON.stringify(intoCarol.body)}`,
);
const carolLine = await lastAuthLine(CAROL_WS);
check(
  'Carol’s auth.log names the box Bob stood on',
  carolLine.includes(`from ${npcBox.ip}`),
  carolLine || '(no line)',
);

// === 4. From Carol's workstation, into Dave's; his log names Carol's lease. ===
const intoDave = await loginFrom(
  'hop-dave-1',
  DAVE_IP,
  workstationGuestPassword(dave.publicKeyHex),
  CAROL_WS,
);
check(
  'from Carol’s workstation, a guest login on Dave’s lands',
  intoDave.status === 200 &&
    (intoDave.body as { machine_id?: string } | null)?.machine_id === DAVE_WS,
  `status=${intoDave.status} ${JSON.stringify(intoDave.body)}`,
);
const daveLine = await lastAuthLine(DAVE_WS);
check(
  'Dave’s auth.log names Carol’s lease, not unknown',
  daveLine.includes(`from ${CAROL_IP}`),
  daveLine || '(no line)',
);

// === 5. Refusals: naming the network from home, or a box he holds no shell on. ===
const crafted = await loginFrom(
  'hop-crafted-1',
  DAVE_IP,
  workstationGuestPassword(dave.publicKeyHex),
);
check(
  'a login naming this network from home is refused',
  crafted.status === 403 && errorOf(crafted.body) === 'wrong_network',
  `status=${crafted.status} error=${errorOf(crafted.body) ?? '-'}`,
);
// By now Bob holds shells on the generated box, Carol's and Dave's — so the box he names
// here is one nobody has ever given him.
const borrowed = await loginFrom(
  'hop-borrowed-1',
  CAROL_IP,
  workstationGuestPassword(carol.publicKeyHex),
  computeWorkstationId('rig', generateIdentity().publicKeyHex),
);
check(
  'naming a box he holds no shell on is refused',
  borrowed.status === 403 && errorOf(borrowed.body) === 'no_session',
  `status=${borrowed.status} error=${errorOf(borrowed.body) ?? '-'}`,
);

await cleanUp();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
