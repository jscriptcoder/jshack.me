// Wire-check for the TRACE a zone transfer leaves: `dig @<server> axfr` runs entirely
// client-side, so the name server would otherwise learn nothing about who mapped it.
// The client fires a signed, session-less `recordZoneTransfer` and the SERVER writes one
// line to that box's own `/var/log/named.log`. Drives the REAL /api/patches endpoint
// against a running `vercel dev` + supabase, seeding the actor's home occupancy via
// service_role (as the join would) so the server-derived source IP is a real address.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - the server RECOMPUTES the verdict from generation (never the client's claim): an
//     open name server logs `transfer of '<zone>/IN': AXFR ended: N records`, a closed
//     one logs `zone transfer '<zone>/IN' denied` — a client cannot forge a success a
//     box refused it;
//   - the SOURCE is the actor's home public IP, resolved server-side from their verified
//     key (`resolveCrossPlayerSourceIp`) — a client-supplied `source_ip` is ignored;
//   - a target that is NOT a name server writes nothing (an ordinary `dig <name>` never
//     reaches this action at all — that half is a client concern, proven in dig.test.ts);
//   - one writer's repeated transfers ACCRETE into the single (machine_id, path, key)
//     row, oldest-first, rather than replacing themselves.
//
// Fixtures are DERIVED from generation (the same pure functions the server calls), so a
// re-roll of the world cannot leave the check asserting against a stale address.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testNamedXfrTrace.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable name server.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { md5 } from '../src/core/generation/md5';
import {
  allowsZoneTransfer,
  nameServerMachineIdAt,
  zoneRecordsFor,
} from '../src/core/generation/generateDnsZone';
import { lanZoneName } from '../src/core/network/resolveName';
import { NAMED_LOG_PATH } from '../src/core/logging/namedLog';
import { seedPublicIps, clearPublicIps } from './networkFixture';

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

// --- The world, DERIVED. Both name servers are real fixtures: GRAD's open transfer is a
//     deep box, OSCORP's is the closed Layer-1 one. Find each by asking generation the
//     same questions the endpoint asks, so the check and the server agree by construction. ---
const OPEN_ESSID = 'GRAD-STUDENT-WIFI';
const CLOSED_ESSID = 'OSCORP-GUEST';

const ipsOf = (essid: string): readonly string[] => zoneRecordsFor(essid).map((record) => record.ip);

const findServer = (essid: string, predicate: (ip: string) => boolean): string | undefined =>
  ipsOf(essid).find((ip) => nameServerMachineIdAt(essid, ip) !== null && predicate(ip));

const openServer = findServer(OPEN_ESSID, (ip) => ip.startsWith('10.') && allowsZoneTransfer(OPEN_ESSID, ip));
const closedServer = findServer(CLOSED_ESSID, (ip) => !allowsZoneTransfer(CLOSED_ESSID, ip));
const nonServer = ipsOf(OPEN_ESSID).find((ip) => nameServerMachineIdAt(OPEN_ESSID, ip) === null);

if (openServer === undefined || closedServer === undefined || nonServer === undefined) {
  console.error(
    `no usable fixtures: open=${openServer} closed=${closedServer} non-server=${nonServer}`,
  );
  process.exit(2);
}

const OPEN_ID = nameServerMachineIdAt(OPEN_ESSID, openServer)!;
const CLOSED_ID = nameServerMachineIdAt(CLOSED_ESSID, closedServer)!;
const OPEN_ZONE = lanZoneName(OPEN_ESSID);
const CLOSED_ZONE = lanZoneName(CLOSED_ESSID);
const OPEN_RECORDS = zoneRecordsFor(OPEN_ESSID).length;

// The actor. Her home network is seeded directly (a distinct ESSID from either target),
// so the server recovers HER public IP from her verified key — the address every trace
// line must carry, and the one a forged client `source_ip` must never displace.
const alice = generateIdentity();
const ALICE_HOME = 'NEUROMANCER-NET';
const ALICE_PUBLIC_IP = '203.0.113.181';

const recordTransfer = (essid: string, serverIp: string, over: Record<string, unknown> = {}) =>
  post(PATCHES, signRequest(alice, 'recordZoneTransfer', { essid, server_ip: serverIp, ...over }));

/** The box's named.log as it holds it — read back through the journal keyed by the
 *  CALLER's writer_key, not trusted from the handler's own answer. */
const readNamedLog = async (machineId: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', NAMED_LOG_PATH)
    .eq('writer_key', alice.publicKeyHex)
    .maybeSingle();
  return (data as { content?: string | null } | null)?.content ?? '';
};

/** Every named.log row this actor has authored anywhere — how the no-server case proves
 *  it wrote NOTHING, without needing a non-server box's machine id. */
const namedLogRowCount = async (): Promise<number> => {
  const { count } = await sr
    .from('patches')
    .select('*', { count: 'exact', head: true })
    .eq('writer_key', alice.publicKeyHex)
    .eq('path', NAMED_LOG_PATH);
  return count ?? 0;
};

const clear = async () => {
  await sr.from('patches').delete().eq('writer_key', alice.publicKeyHex).eq('path', NAMED_LOG_PATH);
  await sr.from('home_network_occupants').delete().eq('owner_key', alice.publicKeyHex);
  await clearPublicIps(sr, [{ essid: ALICE_HOME, publicIp: ALICE_PUBLIC_IP }]);
};

const main = async (): Promise<void> => {
  await clear();

  // The join state a real registerNetwork leaves: the actor's home public IP, and herself
  // as an occupant of its ESSID — which is where her source IP is derived from.
  await seedPublicIps(sr, [{ essid: ALICE_HOME, publicIp: ALICE_PUBLIC_IP }]);
  await sr.from('home_network_occupants').insert({
    essid: ALICE_HOME,
    owner_key: alice.publicKeyHex,
    workstation_machine_id: computeWorkstationId('skylab', alice.publicKeyHex),
    workstation_username: 'alice',
    workstation_machine_name: 'skylab',
    workstation_root_hash: md5('alice-root-secret'),
  });

  // === 1. A target that is not a name server writes nothing. Run first, on a clean slate,
  //        so a zero row-count is unambiguous. ===
  const noServer = await recordTransfer(OPEN_ESSID, nonServer);
  check(
    'a transfer aimed at a non-name-server box writes no named.log line',
    noServer.status === 200 && (await namedLogRowCount()) === 0,
    `status=${noServer.status} rows=${await namedLogRowCount()} (target ${nonServer})`,
  );

  // === 2. An open name server: one AXFR line, sourced from the actor's HOME public IP,
  //        with the record count dig reported — and a forged client source_ip ignored. ===
  const opened = await recordTransfer(OPEN_ESSID, openServer, { source_ip: '10.6.6.6' });
  const openLog = await readNamedLog(OPEN_ID);
  const openLine = openLog.trim().split('\n').filter(Boolean).at(-1) ?? '';
  check(
    'an open transfer lands one AXFR line naming the source, zone, and record count',
    opened.status === 200 &&
      openLine.includes(`client ${ALICE_PUBLIC_IP} (${OPEN_ZONE}): `) &&
      openLine.includes(`transfer of '${OPEN_ZONE}/IN': AXFR ended: ${OPEN_RECORDS} records`),
    `deep server ${openServer}; line=${JSON.stringify(openLine)}`,
  );
  check(
    'a client-supplied source_ip is ignored — the line carries her home IP, not the forged one',
    openLine.includes(ALICE_PUBLIC_IP) && !openLine.includes('10.6.6.6'),
    `line=${JSON.stringify(openLine)}`,
  );

  // === 3. A single writer's repeated transfers accrete into the ONE row, oldest-first. ===
  await recordTransfer(OPEN_ESSID, openServer);
  const accreted = await readNamedLog(OPEN_ID);
  const axfrLines = accreted.split('\n').filter((line) => line.includes('AXFR ended'));
  check(
    'a repeated transfer accretes a second AXFR line into the same row, not replacing it',
    axfrLines.length === 2,
    `${accreted.trim().split('\n').filter(Boolean).length} line(s) in the one row`,
  );

  // === 4. A closed name server refuses — the server recomputes the verdict, and the box
  //        still records the attempt, distinctly worded, naming the same source. ===
  const refused = await recordTransfer(CLOSED_ESSID, closedServer);
  const closedLog = await readNamedLog(CLOSED_ID);
  const closedLine = closedLog.trim().split('\n').filter(Boolean).at(-1) ?? '';
  check(
    'a refused transfer lands the denied line, naming the same source — no forged success',
    refused.status === 200 &&
      closedLine.includes(`client ${ALICE_PUBLIC_IP} (${CLOSED_ZONE}): zone transfer '${CLOSED_ZONE}/IN' denied`) &&
      !closedLine.includes('AXFR ended'),
    `Layer-1 server ${closedServer}; line=${JSON.stringify(closedLine)}`,
  );

  await clear();

  const passed = results.filter((result) => result.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
