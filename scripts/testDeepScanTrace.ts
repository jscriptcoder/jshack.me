// Wire-payload smoke for the deep SCAN trace — an `nmap` of a deep layer is recorded by the
// same signed `nmapScan` action as a LAN one, naming the box it runs from. The server works
// out from that box's live session which layer the target is on and the address the box is
// seen at there, and lands ONE aggregate /var/log/kern.log line on each touched deep host.
// A SWITCH fronting the layer filters it by its live /etc/switch/acl.conf, so a denied port
// drops from the trace. Drives /api/patches (nmapScan) against `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - a gateway's sweep of the layer it fronts is logged from that layer's `.1`;
//   - a deep host's sweep of its own layer is logged from its own address there, and its
//     sweep of the LAN from the inner gateway it reaches the LAN through;
//   - a deep gateway's sweep of the layer it sits on is logged from its own address there;
//   - a SWITCH replays its journal to read acl.conf, so a `deny 22` patch filters :22 out
//     of the trace and removing it re-opens it (the materialize → ACL read path);
//   - a caller with no shell on the box they name, or a target on a layer that box does not
//     reach, is refused and logs nothing.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testDeepScanTrace.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no suitable network.

import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeApGatewayId, computeDeepGatewayId } from '../src/core/identity/router.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { crackableEssidPool } from '../src/core/generation/generateWifi.js';
import { generateDeepLayer } from '../src/core/generation/generateDeepLayer.js';
import { chainLinks, type ChainLink } from '../src/core/generation/lanTopology.js';
import { hostMachineId } from '../src/core/generation/remoteHostId.js';

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

const layerOf = (essid: string, link: ChainLink) =>
  generateDeepLayer(
    essid,
    { machineId: link.machineId, kind: link.host.kind },
    { hangsChild: link.hangsChild },
  );

// --- The network. The chain belongs to the ACCESS POINT, so the shape under test is a
//     property of the ESSID: a network whose inner ROUTER fronts a layer that hangs a child
//     ROUTER (so that child fronts a layer of its own below), and which also carries an inner
//     SWITCH for the ACL case. ---
const suitable = (essid: string): boolean => {
  const links = chainLinks(essid);
  const innerRouter = links.find(
    (link) => link.parentMachineId === null && link.host.kind === 'router',
  );
  const innerSwitch = links.find(
    (link) => link.parentMachineId === null && link.host.kind === 'switch',
  );
  if (innerRouter === undefined || innerSwitch === undefined) return false;
  return layerOf(essid, innerRouter).childGateway?.kind === 'router';
};
const ESSID = crackableEssidPool.find(suitable);
if (ESSID === undefined) {
  console.error(
    'no network in the crackable pool has a router chain two gateways deep and a switch',
  );
  process.exit(2);
}

// The acting player holds a shell on every box a check scans from; mallory holds none.
const alice = generateIdentity();
const mallory = generateIdentity();

const links = chainLinks(ESSID);
const INNER_R = links.find((link) => link.parentMachineId === null && link.host.kind === 'router')!;
const INNER_S = links.find((link) => link.parentMachineId === null && link.host.kind === 'switch')!;
const R_LAYER = layerOf(ESSID, INNER_R);
const R_NPC_ID = hostMachineId(R_LAYER.host, ESSID);
const R_CHILD = R_LAYER.childGateway!;
const R_CHILD_ID = computeDeepGatewayId(INNER_R.machineId, Number(R_CHILD.ip.split('.')[3]));
const CHILD_LINK = links.find((link) => link.machineId === R_CHILD_ID)!;
const CHILD_LAYER = layerOf(ESSID, CHILD_LINK);
const S_LAYER = layerOf(ESSID, INNER_S);
const S_NPC_ID = hostMachineId(S_LAYER.host, ESSID);
const EDGE_ID = computeApGatewayId(ESSID);
const LAN_SUBNET = generateHomeLan(ESSID).subnet;

const ACL_PATH = '/etc/switch/acl.conf';
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };
const TOUCHED = [R_NPC_ID, R_CHILD_ID, S_NPC_ID, INNER_S.machineId, EDGE_ID];

const scanFrom = (
  identity: ReturnType<typeof generateIdentity>,
  machineId: string,
  target: string,
) =>
  post(
    PATCHES,
    signRequest(identity, 'nmapScan', { essid: ESSID, target, caller_machine_id: machineId }),
  );

const readKernLog = async (machineId: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('writer_key', apGatewayLogWriterKey(ESSID))
    .eq('machine_id', machineId)
    .eq('path', '/var/log/kern.log')
    .maybeSingle();
  return (data as { content?: string | null } | null)?.content ?? '';
};

const clearKernLog = (machineId: string) =>
  sr
    .from('patches')
    .delete()
    .eq('writer_key', apGatewayLogWriterKey(ESSID))
    .eq('machine_id', machineId)
    .eq('path', '/var/log/kern.log');

/** The probed-port list of the LAST kern.log line, parsed from `… probed ports A,B (N hits)`
 *  — `[]` for a `none` (0-hit) probe. */
const probedPortsOf = (content: string): readonly string[] => {
  const lastLine = content.trim().split('\n').filter(Boolean).at(-1) ?? '';
  const match = /probed ports (\S+) \(/.exec(lastLine);
  if (match === null || match[1] === 'none') return [];
  return match[1].split(',');
};

const cleanUp = async () => {
  for (const machineId of TOUCHED) {
    await sr.from('patches').delete().eq('machine_id', machineId);
  }
  await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);
};

// Clean slate, then alice's shells — as `ssh` would have left them, each stamped with the
// network it was opened on. A deep box's row carries the access point's ESSID: the layer it
// stands on is worked out from the box, never from the row.
await cleanUp();
const shells = [INNER_R.machineId, INNER_S.machineId, R_NPC_ID, R_CHILD_ID];
for (const [index, machineId] of shells.entries()) {
  const seeded = await sr.from('sessions').insert({
    session_id: `ssh-root-deep-scan-${index}`,
    player_key: alice.publicKeyHex,
    machine_id: machineId,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid: ESSID,
  });
  if (seeded.error) {
    console.error(`FATAL: session seed failed: ${seeded.error.message}`);
    process.exit(1);
  }
}

try {
  // 1. The inner router sweeps the layer it fronts: logged from that layer's `.1`.
  const s1 = await scanFrom(alice, INNER_R.machineId, `${R_LAYER.subnet}.1-254`);
  const npcLog = await readKernLog(R_NPC_ID);
  check(
    'inner router: the deep NPC logs the sweep from the layer .1, with :22 probed',
    s1.status === 200 &&
      npcLog.includes(`Port scan from ${R_LAYER.subnet}.1 —`) &&
      probedPortsOf(npcLog).includes('22'),
    `status=${s1.status} npcLog=${JSON.stringify(npcLog.trim())}`,
  );

  // 2. The same sweep touches every host on the layer, the child gateway included.
  const childLog = await readKernLog(R_CHILD_ID);
  check(
    'inner router: the child gateway logs the same sweep from the same .1',
    childLog.includes(`Port scan from ${R_LAYER.subnet}.1 —`),
    `childLog=${JSON.stringify(childLog.trim())}`,
  );

  // 3. The deep NPC sweeps its own layer: logged from its own address there.
  await clearKernLog(R_CHILD_ID);
  const s3 = await scanFrom(alice, R_NPC_ID, `${R_LAYER.subnet}.1-254`);
  const childFromNpc = await readKernLog(R_CHILD_ID);
  check(
    'deep host: a neighbour on its layer logs the sweep from the deep host’s own address',
    s3.status === 200 && childFromNpc.includes(`Port scan from ${R_LAYER.host.ip} —`),
    `status=${s3.status} childLog=${JSON.stringify(childFromNpc.trim())}`,
  );

  // 4. The deep NPC sweeps the LAN: logged from the inner router it leaves through.
  const s4 = await scanFrom(alice, R_NPC_ID, `${LAN_SUBNET}.1`);
  const edgeLog = await readKernLog(EDGE_ID);
  check(
    'deep host: the LAN gateway logs its sweep from the inner router’s LAN address',
    s4.status === 200 && edgeLog.includes(`Port scan from ${INNER_R.host.ip} —`),
    `status=${s4.status} edgeLog=${JSON.stringify(edgeLog.trim())}`,
  );

  // 5. The child gateway scans the layer it sits on: logged from its own address there.
  await clearKernLog(R_NPC_ID);
  const s5 = await scanFrom(alice, R_CHILD_ID, R_LAYER.host.ip);
  const npcFromChild = await readKernLog(R_NPC_ID);
  check(
    'deep gateway: the NPC on the layer it sits on logs the scan from the gateway’s own address',
    s5.status === 200 && npcFromChild.includes(`Port scan from ${R_CHILD.ip} —`),
    `status=${s5.status} npcLog=${JSON.stringify(npcFromChild.trim())}`,
  );

  // 6. The switch sweeps the layer it fronts (seeded acl.conf denies only 8080): :22 open,
  //    from the switch's `.1`.
  const s6 = await scanFrom(alice, INNER_S.machineId, S_LAYER.host.ip);
  const sLogBase = await readKernLog(S_NPC_ID);
  check(
    'switch: the deep NPC logs :22 from the switch layer .1 (the seed denies only 8080)',
    s6.status === 200 &&
      sLogBase.includes(`Port scan from ${S_LAYER.subnet}.1 —`) &&
      probedPortsOf(sLogBase).includes('22'),
    `status=${s6.status} sLog=${JSON.stringify(sLogBase.trim())}`,
  );

  // 7. A live `deny 22` on the switch's acl.conf drops :22 from the trace — the server
  //    replays the switch journal and reads the player's edit (materialize → ACL).
  await sr.from('patches').insert({
    machine_id: INNER_S.machineId,
    writer_key: alice.publicKeyHex,
    path: ACL_PATH,
    content: 'deny 22',
    owner: 'root',
    permissions: ROOT_ONLY,
    node_type: 'file',
    updated_at: new Date().toISOString(),
  });
  await clearKernLog(S_NPC_ID);
  await scanFrom(alice, INNER_S.machineId, S_LAYER.host.ip);
  const sLogDenied = await readKernLog(S_NPC_ID);
  check(
    'switch ACL: a live `deny 22` filters :22 out of the deep NPC trace',
    sLogDenied !== '' && !probedPortsOf(sLogDenied).includes('22'),
    `probed=[${probedPortsOf(sLogDenied).join(',')}] sLog=${JSON.stringify(sLogDenied.trim())}`,
  );

  // 8. Deleting the deny re-opens :22 on the next scan.
  await sr.from('patches').delete().eq('machine_id', INNER_S.machineId).eq('path', ACL_PATH);
  await clearKernLog(S_NPC_ID);
  await scanFrom(alice, INNER_S.machineId, S_LAYER.host.ip);
  const sLogReopened = await readKernLog(S_NPC_ID);
  check(
    'switch ACL: removing the `deny 22` line re-opens :22 on the next scan',
    probedPortsOf(sLogReopened).includes('22'),
    `probed=[${probedPortsOf(sLogReopened).join(',')}]`,
  );

  // 9. Naming a gateway without a shell on it is refused, and logs nothing.
  await clearKernLog(R_NPC_ID);
  const s9 = await scanFrom(mallory, INNER_R.machineId, `${R_LAYER.subnet}.1-254`);
  const npcAfterNoShell = await readKernLog(R_NPC_ID);
  check(
    'no shell: naming the inner router without a session on it is 403 no_session, nothing logged',
    s9.status === 403 &&
      (s9.body as { error?: string } | null)?.error === 'no_session' &&
      npcAfterNoShell === '',
    `status=${s9.status} body=${JSON.stringify(s9.body)} npcLog=${JSON.stringify(npcAfterNoShell)}`,
  );

  // 10. A layer below the one a box fronts is out of its reach: refused, nothing logged.
  const s10 = await scanFrom(alice, INNER_R.machineId, `${CHILD_LAYER.subnet}.1-254`);
  check(
    'reach: the inner router asking for the layer below its child is 403 wrong_network',
    s10.status === 403 && (s10.body as { error?: string } | null)?.error === 'wrong_network',
    `status=${s10.status} body=${JSON.stringify(s10.body)}`,
  );
} finally {
  await cleanUp();
}

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
