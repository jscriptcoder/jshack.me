// Wire-payload smoke for the deep SCAN trace (5b.5b) — a pivot `nmap` of a deep `/24`
// fires a fire-and-forget `nmapScanDeep` that lands ONE aggregate /var/log/kern.log line
// on each touched deep host (terminal NPC + child gateway), sourced from the fronting
// gateway's downstream `.1`. A SWITCH vantage filters its downstream by its live
// /etc/switch/acl.conf, so a denied port drops from the trace. Drives /api/patches
// (nmapScanDeep) against `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - the server re-derives the vantage from the verified key + vantage_machine_id (no
//     session needed) and regenerates its deep layer;
//   - it writes each touched deep host's kern.log keyed (machine_id, caller_key, path);
//   - a SWITCH vantage replays its journal to read acl.conf, so a `deny 22` patch filters
//     :22 out of the trace and removing it re-opens it (the materialize → ACL read path);
//   - a forged vantage (the edge .1) logs nothing.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testDeepScanTrace.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no suitable home.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import {
  computeApGatewayId,
  computeDeepGatewayId,
  computeInnerGatewayId,
} from '../src/core/identity/router';
import { generateHomeLan } from '../src/core/generation/generateHomeLan';
import { generateDeepLayer, seedNetworkDepth } from '../src/core/generation/generateDeepLayer';
import { hostMachineId } from '../src/core/generation/remoteHostId';

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

const post = async (endpoint: string, envelope: unknown): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const octetOf = (ip: string): number => Number(ip.split('.')[3]);

// --- The owner (alice). She scans her OWN deep chain; depth is single-player. Pick a
//     depth>=2 home whose inner ROUTER fronts a child gateway (so a range scan of its
//     deep /24 touches BOTH the NPC and the child) and that also carries an inner SWITCH
//     (always present) for the ACL case. ---
const ESSID = 'ABSTERGO-NET';
// The LAN is the ACCESS POINT's now, so its inner gateways are the same whoever is
// looking — resolved once, outside the identity search below. Only the DEPTH behind
// them is still per-owner, which is all that search is still looking for.
const lan = generateHomeLan(ESSID);
const innerR = lan.hosts.find((host) => host.kind === 'router' && octetOf(host.ip) !== 1);
const innerS = lan.hosts.find((host) => host.kind === 'switch');
if (innerR === undefined || innerS === undefined) {
  console.error('the ESSID’s LAN carries no inner router + switch to scan');
  process.exit(2);
}
const INNER_R_ID = computeInnerGatewayId(ESSID, octetOf(innerR.ip));

const suitable = (candidate: ReturnType<typeof generateIdentity>): boolean => {
  if (seedNetworkDepth(candidate.publicKeyHex, ESSID) < 2) return false;
  const child = generateDeepLayer(
    candidate.publicKeyHex,
    ESSID,
    { machineId: INNER_R_ID, kind: 'router' },
    { hangsChild: true },
  ).childGateway;
  return child !== null;
};
const alice = Array.from({ length: 400 }, () => generateIdentity()).find(suitable);
if (alice === undefined) {
  console.error('no identity seeds a depth>=2 home whose inner router fronts a child');
  process.exit(2);
}
const rDeep = generateDeepLayer(
  alice.publicKeyHex,
  ESSID,
  { machineId: INNER_R_ID, kind: 'router' },
  { hangsChild: true },
);
const R_NPC_ID = hostMachineId(rDeep.host, ESSID);
const rChild = rDeep.childGateway!;
const R_CHILD_ID = computeDeepGatewayId(alice.publicKeyHex, INNER_R_ID, octetOf(rChild.ip));

const INNER_S_ID = computeInnerGatewayId(ESSID, octetOf(innerS.ip));
const sDeep = generateDeepLayer(
  alice.publicKeyHex,
  ESSID,
  { machineId: INNER_S_ID, kind: 'switch' },
  { hangsChild: false },
);
const S_NPC_ID = hostMachineId(sDeep.host, ESSID);

const ACL_PATH = '/etc/switch/acl.conf';
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };

const scanDeep = (vantageId: string, target: string) =>
  post(PATCHES, signRequest(alice, 'nmapScanDeep', { essid: ESSID, target, vantage_machine_id: vantageId }));

const readKernLog = async (machineId: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('writer_key', alice.publicKeyHex)
    .eq('machine_id', machineId)
    .eq('path', '/var/log/kern.log')
    .maybeSingle();
  return (data as { content?: string | null } | null)?.content ?? '';
};

const clearKernLog = (machineId: string) =>
  sr
    .from('patches')
    .delete()
    .eq('writer_key', alice.publicKeyHex)
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

// Clean slate on every machine this touches.
for (const machineId of [R_NPC_ID, R_CHILD_ID, S_NPC_ID, INNER_S_ID]) {
  await sr.from('patches').delete().eq('machine_id', machineId);
}

// 1. ROUTER vantage range scan: the NPC's kern.log records the scan from the gateway `.1`.
const s1 = await scanDeep(INNER_R_ID, `${rDeep.subnet}.1-254`);
const npcLog = await readKernLog(R_NPC_ID);
check(
  'router pivot: the deep NPC kern.log records the scan from the gateway .1, with :22 probed',
  s1.status === 200 &&
    npcLog.includes(`Port scan from ${rDeep.subnet}.1 —`) &&
    probedPortsOf(npcLog).includes('22'),
  `status=${s1.status} npcLog=${JSON.stringify(npcLog.trim())}`,
);

// 2. Same scan: the CHILD GATEWAY (a deep box one hop down) ALSO records the scan — a range
//    touches every host on the segment.
const childLog = await readKernLog(R_CHILD_ID);
check(
  'router pivot: the child gateway kern.log also records the scan from the same gateway .1',
  childLog.includes(`Port scan from ${rDeep.subnet}.1 —`),
  `childLog=${JSON.stringify(childLog.trim())}`,
);

// 3. SWITCH vantage baseline (seeded acl.conf denies only 8080): the deep NPC's :22 is open,
//    sourced from the switch's downstream `.1`.
const s3 = await scanDeep(INNER_S_ID, sDeep.host.ip);
const sLogBase = await readKernLog(S_NPC_ID);
check(
  'switch pivot: the deep NPC kern.log records :22 from the switch .1 (seed denies only 8080)',
  s3.status === 200 &&
    sLogBase.includes(`Port scan from ${sDeep.subnet}.1 —`) &&
    probedPortsOf(sLogBase).includes('22'),
  `status=${s3.status} sLog=${JSON.stringify(sLogBase.trim())}`,
);

// 4. SWITCH ACL filter: a live `deny 22` on the switch's acl.conf drops :22 from the trace —
//    the server replays the switch journal and reads the player's edit (materialize → ACL).
await sr.from('patches').insert({
  machine_id: INNER_S_ID,
  writer_key: alice.publicKeyHex,
  path: ACL_PATH,
  content: 'deny 22',
  owner: 'root',
  permissions: ROOT_ONLY,
  node_type: 'file',
  updated_at: new Date().toISOString(),
});
await clearKernLog(S_NPC_ID);
await scanDeep(INNER_S_ID, sDeep.host.ip);
const sLogDenied = await readKernLog(S_NPC_ID);
check(
  'switch ACL: a live `deny 22` on the switch filters :22 out of the deep NPC trace',
  !probedPortsOf(sLogDenied).includes('22'),
  `probed=[${probedPortsOf(sLogDenied).join(',')}] sLog=${JSON.stringify(sLogDenied.trim())}`,
);

// 5. Deleting the deny re-opens :22 on the next scan.
await sr.from('patches').delete().eq('machine_id', INNER_S_ID).eq('path', ACL_PATH);
await clearKernLog(S_NPC_ID);
await scanDeep(INNER_S_ID, sDeep.host.ip);
const sLogReopened = await readKernLog(S_NPC_ID);
check(
  'switch ACL: removing the `deny 22` line re-opens :22 on the next scan',
  probedPortsOf(sLogReopened).includes('22'),
  `probed=[${probedPortsOf(sLogReopened).join(',')}]`,
);

// 6. A forged vantage (the edge .1 router — a real box, but NOT a pivot vantage) logs nothing.
await clearKernLog(R_NPC_ID);
const EDGE_ID = computeApGatewayId(ESSID);
const s6 = await scanDeep(EDGE_ID, `${rDeep.subnet}.1-254`);
const npcAfterForged = await readKernLog(R_NPC_ID);
check(
  'forged vantage: scanning from the edge .1 (not a chain gateway) writes nothing',
  s6.status === 200 && npcAfterForged === '',
  `status=${s6.status} npcLog=${JSON.stringify(npcAfterForged)}`,
);

// Cleanup.
for (const machineId of [R_NPC_ID, R_CHILD_ID, S_NPC_ID, INNER_S_ID]) {
  await sr.from('patches').delete().eq('machine_id', machineId);
}

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
