// Wire-check for the TRACE a zone transfer leaves: `dig @<server> axfr` runs entirely
// client-side, so the name server would otherwise learn nothing about who mapped it.
// The client fires a signed `recordZoneTransfer` naming the box it ran from, and the
// SERVER writes one line to that name server's own `/var/log/named.log`. Drives the REAL
// /api/patches endpoint against a running `vercel dev` + supabase, seeding the actor's
// occupancy/lease and hop session via service_role (as the join and an ssh hop would) so
// the server places the caller and derives a real source address.
//
// Net-new under test (the locally-untypechecked api/ runtime), after the caller-placement
// move (criteria 6–7, 9):
//   - the server PLACES the caller from where they stand, not their home public IP: a
//     transfer run at home is sourced from the actor's own LAN lease address, and one run
//     from a hop is sourced from that box's address on the name server's own segment (a
//     deep name server's deep address) — a client-supplied `source_ip` is ignored;
//   - a caller on a network it is not standing on is refused `wrong_network`, and a box it
//     holds no shell on `no_session` — and writes nothing;
//   - the server RECOMPUTES the verdict from generation (never the client's claim): an
//     open name server logs `transfer of '<zone>/IN': AXFR ended: N records`, a closed
//     one logs `zone transfer '<zone>/IN' denied`;
//   - a target that is NOT a name server writes nothing;
//   - repeated transfers ACCRETE into the single (machine_id, path, key) row, keyed to the
//     name server's NETWORK, never the caller.
//
// Fixtures are DERIVED from generation (the same pure functions the server calls), so a
// re-roll of the world cannot leave the check asserting against a stale address.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testNamedXfrTrace.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable name server.

import { createClient } from '@supabase/supabase-js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import {
  allowsZoneTransfer,
  nameServerMachineIdAt,
  zoneRecordsFor,
} from '../src/core/generation/generateDnsZone.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { chainLinks, segmentsReachedFrom } from '../src/core/generation/lanTopology.js';
import { resolveDeepScanHosts } from '../src/core/scan/deepScanHosts.js';
import { buildDirectory } from '../src/test/factories/filesystem.js';
import { leasedAddress } from '../src/core/network/lanAddress.js';
import { lanZoneName } from '../src/core/network/resolveName.js';
import { NAMED_LOG_PATH } from '../src/core/logging/namedLog.js';
import { publicAddressOf } from './publicAddressOf.js';
import { standOnNetwork, leaveNetwork } from './standVantage.js';

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

// --- The world, DERIVED. The actor's HOME is OSCORP, which carries a CLOSED Layer-1 name
//     server she reaches from home. GRAD carries an OPEN name server deep behind an inner
//     gateway, reached by standing on that gateway — her hop. Each is found by asking
//     generation the same questions the endpoint asks, so the check and the server agree. ---
const HOME_ESSID = 'OSCORP-GUEST';
const HOME_OCTET = 77;
const HOP_ESSID = 'GRAD-STUDENT-WIFI';

const nameServersOf = (essid: string): readonly string[] =>
  zoneRecordsFor(essid).map((record) => record.ip).filter((ip) => nameServerMachineIdAt(essid, ip) !== null);

const closedServer = nameServersOf(HOME_ESSID).find((ip) => !allowsZoneTransfer(HOME_ESSID, ip));
const openServer = nameServersOf(HOP_ESSID).find(
  (ip) => ip.startsWith('10.') && allowsZoneTransfer(HOP_ESSID, ip),
);
// A non-name-server box on the HOME LAN itself (so it is reachable from home — a deep
// box would be refused as unreachable, not as a non-server).
const homeNonServer = generateHomeLan(HOME_ESSID)
  .hosts.map((host) => host.ip)
  .find((ip) => nameServerMachineIdAt(HOME_ESSID, ip) === null);

/** The inner gateway whose fronted layer carries `serverIp` — the box the actor stands on
 *  to reach a deep name server. */
const gatewayReaching = (essid: string, serverIp: string): string | undefined => {
  for (const link of chainLinks(essid)) {
    const resolution = resolveDeepScanHosts(essid, link, buildDirectory({}));
    if (resolution.hosts.some((entry) => entry.host.ip === serverIp)) return link.machineId;
  }
  return undefined;
};

if (closedServer === undefined || openServer === undefined || homeNonServer === undefined) {
  console.error(
    `no usable fixtures: closed=${closedServer} open=${openServer} non-server=${homeNonServer}`,
  );
  process.exit(2);
}

const gateway = gatewayReaching(HOP_ESSID, openServer);
if (gateway === undefined) {
  console.error(`no inner gateway fronts ${openServer} on ${HOP_ESSID}`);
  process.exit(2);
}

const OPEN_ID = nameServerMachineIdAt(HOP_ESSID, openServer)!;
const CLOSED_ID = nameServerMachineIdAt(HOME_ESSID, closedServer)!;
const OPEN_ZONE = lanZoneName(HOP_ESSID);
const CLOSED_ZONE = lanZoneName(HOME_ESSID);
const OPEN_RECORDS = zoneRecordsFor(HOP_ESSID).length;

// The source each line must carry: at home, the actor's own LAN lease address; from the
// hop, the gateway's address on the deep segment the name server sits on. Both DERIVED.
const HOME_LAN_SOURCE = leasedAddress(HOME_ESSID, HOME_OCTET)!;
const HOME_PUBLIC_IP = publicAddressOf(HOME_ESSID);
const HOP_SOURCE = (segmentsReachedFrom(HOP_ESSID, gateway) ?? []).find((segment) =>
  openServer.startsWith(`${segment.subnet}.`),
)?.address;

if (HOP_SOURCE === undefined || HOP_SOURCE === null) {
  console.error(`no source segment for ${openServer} from ${gateway}`);
  process.exit(2);
}

const alice = generateIdentity();
const HOP_SESSION = 'xfr-hop-session';

const recordTransfer = (
  essid: string,
  serverIp: string,
  over: Record<string, unknown> = {},
) => post(PATCHES, signRequest(alice, 'recordZoneTransfer', { essid, server_ip: serverIp, ...over }));

/** The box's named.log as it holds it — read back through the journal keyed by the
 *  name server's NETWORK, not trusted from the handler's own answer. */
const readNamedLog = async (machineId: string, essid: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', NAMED_LOG_PATH)
    .eq('writer_key', apGatewayLogWriterKey(essid))
    .maybeSingle();
  return (data as { content?: string | null } | null)?.content ?? '';
};

/** Every named.log row on either target network, or under the actor's own key — how the
 *  no-server and refusal cases prove they wrote NOTHING. */
const namedLogRowCount = async (): Promise<number> => {
  const { count } = await sr
    .from('patches')
    .select('*', { count: 'exact', head: true })
    .in('writer_key', [
      apGatewayLogWriterKey(HOME_ESSID),
      apGatewayLogWriterKey(HOP_ESSID),
      alice.publicKeyHex,
    ])
    .eq('path', NAMED_LOG_PATH);
  return count ?? 0;
};

const axfrLineCount = async (): Promise<number> =>
  (await readNamedLog(OPEN_ID, HOP_ESSID)).split('\n').filter((line) => line.includes('AXFR ended')).length;

const clear = async () => {
  await sr
    .from('patches')
    .delete()
    .in('writer_key', [
      apGatewayLogWriterKey(HOME_ESSID),
      apGatewayLogWriterKey(HOP_ESSID),
      alice.publicKeyHex,
    ])
    .eq('path', NAMED_LOG_PATH);
  await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);
  await leaveNetwork(sr, HOME_ESSID);
};

const main = async (): Promise<void> => {
  await clear();

  // The actor's home: an occupant of OSCORP with a LAN lease (where a home transfer is
  // sourced from), and a live hop session on GRAD's inner gateway (where a deep transfer
  // is sourced from).
  await standOnNetwork(sr, HOME_ESSID, alice, HOME_OCTET);
  const seeded = await sr.from('sessions').insert({
    session_id: HOP_SESSION,
    player_key: alice.publicKeyHex,
    machine_id: gateway,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid: HOP_ESSID,
  });
  if (seeded.error) {
    console.error(`hop session seed failed: ${seeded.error.message}`);
    process.exit(2);
  }

  // === 1. A target that is not a name server writes nothing. Run first, on a clean slate,
  //        so a zero row-count is unambiguous. ===
  const noServer = await recordTransfer(HOME_ESSID, homeNonServer);
  check(
    'a transfer aimed at a non-name-server box writes no named.log line',
    noServer.status === 200 && (await namedLogRowCount()) === 0,
    `status=${noServer.status} rows=${await namedLogRowCount()} (target ${homeNonServer})`,
  );

  // === 2. An own-LAN transfer from home is sourced from the actor's LAN lease — never her
  //        home PUBLIC IP — and a forged client source_ip is ignored. OSCORP's server
  //        refuses, so the line is the denial, which still names the source. ===
  const refused = await recordTransfer(HOME_ESSID, closedServer, { source_ip: '10.6.6.6' });
  const closedLog = await readNamedLog(CLOSED_ID, HOME_ESSID);
  const closedLine = closedLog.trim().split('\n').filter(Boolean).at(-1) ?? '';
  check(
    'an own-LAN transfer is sourced from the actor’s LAN address, not her public IP',
    refused.status === 200 &&
      closedLine.includes(`client ${HOME_LAN_SOURCE} (${CLOSED_ZONE}): zone transfer '${CLOSED_ZONE}/IN' denied`) &&
      !closedLine.includes(HOME_PUBLIC_IP) &&
      !closedLine.includes('10.6.6.6'),
    `home server ${closedServer}; lan=${HOME_LAN_SOURCE} public=${HOME_PUBLIC_IP}; line=${JSON.stringify(closedLine)}`,
  );

  // === 3. A transfer from the hop is sourced from that box's address on the deep segment
  //        the name server sits on — the open server hands its zone over. ===
  const opened = await recordTransfer(HOP_ESSID, openServer, { caller_machine_id: gateway });
  const openLog = await readNamedLog(OPEN_ID, HOP_ESSID);
  const openLine = openLog.trim().split('\n').filter(Boolean).at(-1) ?? '';
  check(
    'a transfer from a hop lands one AXFR line sourced from the hop’s deep address',
    opened.status === 200 &&
      openLine.includes(`client ${HOP_SOURCE} (${OPEN_ZONE}): `) &&
      openLine.includes(`transfer of '${OPEN_ZONE}/IN': AXFR ended: ${OPEN_RECORDS} records`),
    `deep server ${openServer} via gateway ${gateway}; source=${HOP_SOURCE}; line=${JSON.stringify(openLine)}`,
  );

  // === 4. Repeated transfers accrete into the ONE row, not replacing it. ===
  await recordTransfer(HOP_ESSID, openServer, { caller_machine_id: gateway });
  check(
    'a repeated transfer accretes a second AXFR line into the same row, not replacing it',
    (await axfrLineCount()) === 2,
    `${(await readNamedLog(OPEN_ID, HOP_ESSID)).trim().split('\n').filter(Boolean).length} line(s) in the one row`,
  );

  // === 5. A caller on a network it is not standing on is refused — she names her GRAD hop
  //        but addresses OSCORP, and nothing is written. ===
  const beforeWrong = await namedLogRowCount();
  const wrong = await recordTransfer(HOME_ESSID, closedServer, { caller_machine_id: gateway });
  check(
    'a transfer addressed to a network the caller is not standing on is refused wrong_network',
    wrong.status === 403 &&
      (wrong.body as { error?: string } | null)?.error === 'wrong_network' &&
      (await namedLogRowCount()) === beforeWrong,
    `status=${wrong.status} body=${JSON.stringify(wrong.body)}`,
  );

  // === 6. A caller naming a box it holds no shell on is refused, and writes nothing. ===
  const beforeNoSession = await axfrLineCount();
  const noSession = await recordTransfer(HOP_ESSID, openServer, { caller_machine_id: 'inner-gw-unheld' });
  check(
    'a transfer naming a box the caller holds no shell on is refused no_session',
    noSession.status === 403 &&
      (noSession.body as { error?: string } | null)?.error === 'no_session' &&
      (await axfrLineCount()) === beforeNoSession,
    `status=${noSession.status} body=${JSON.stringify(noSession.body)}`,
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
