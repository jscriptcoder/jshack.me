// Wire-payload smoke for the SCAN HONOURING THE FILTER — what a public address shows a
// stranger, and whether the door behind it agrees. Drives the REAL /api/network and
// /api/sessions endpoints against a running `vercel dev` + supabase, seeding the access
// point, its occupancy, its leases and both boxes via service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `scanResult` reading `portsOpenToNetwork` for the gateway's OWN ports. Every unit
//     test hands it a hand-built directory; that the filter survives a journal replay
//     over a seeded gateway base, off the real patches table, is provable only here.
//   - the forward-liveness gate reading the TARGET's filter, at both the scan
//     (`natPortResolver`) and the routing gate (`resolvePublicTarget`) — two readers of
//     two different journals that have to reach the same verdict about one box.
//   - a filtered forward being refused with the SAME words a stopped daemon gives. That
//     is an equality between two live HTTP answers and nothing else can prove it: until
//     this slice a stopped daemon failed at routing while a filtered one routed fine and
//     was refused a layer later under a name of its own, which told a stranger which port
//     somebody was defending.
//   - the gateway's own filter NOT touching a forward. An INPUT rule governs traffic a
//     box terminates, never traffic it passes through, and the two rules live one line
//     apart in one function.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSnmpScan.ts
//
// NOTE: `vercel dev` must itself be started under `npx dotenv -e .env.development.local
// --`, or every endpoint answers `not_configured` and the checks below fail in a way
// that looks like a product fault.
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { lanAddressFor } from '../src/core/network/lanAddress';
import { materializeWorkstationFs } from '../src/core/network/materializeWorkstationFs';
import { buildApGatewayBaseFs } from '../src/core/generation/routerFs';
import { ownStore } from '../src/core/redis/ownStore';
import { DATADIR_PATH as STORE_PATH } from '../src/core/redis/datadir';
import {
  formatPidfileContent,
  pidfilePath,
  readOpenPorts,
  PIDFILE_PERMISSIONS,
  type OpenPort,
} from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { LOCAL_FILTER_SEED, RULES_V4_PATH } from '../src/core/network/iptablesRules';
import { md5 } from '../src/core/generation/md5';
import { clearPublicIps, seedPublicIps } from './networkFixture';

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

const failFast = (label: string, error: { readonly message: string } | null): void => {
  if (error === null) return;
  console.error(`FATAL: ${label} failed: ${error.message}`);
  process.exit(1);
};

const postTo = async (endpoint: string, envelope: unknown) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

const textOf = (body: unknown): string =>
  typeof body === 'object' && body !== null ? JSON.stringify(body) : String(body);

const portsIn = (body: unknown): readonly OpenPort[] =>
  (body as { ports?: OpenPort[] } | null)?.ports ?? [];

const portNumbersIn = (body: unknown): readonly number[] =>
  portsIn(body).map((openPort) => openPort.port);

const foundIn = (body: unknown): boolean => (body as { found?: boolean } | null)?.found === true;

// --- One access point, one defender behind its NAT, one stranger scanning it. ---
const defender = generateIdentity();
const stranger = generateIdentity();

const ESSID = 'SCAN-HONESTY-WIFI';
const PUBLIC_IP = '203.0.113.44';
const GATEWAY_ID = computeApGatewayId(ESSID);

const DEFENDER_HOSTNAME = 'dinesh';
const DEFENDER_WS = computeWorkstationId(DEFENDER_HOSTNAME, defender.publicKeyHex);
const DEFENDER_OCTET = 37;
const DEFENDER_LAN_IP = lanAddressFor(ESSID, DEFENDER_OCTET);

const STRANGER_HOSTNAME = 'coldcaller';
const STRANGER_WS = computeWorkstationId(STRANGER_HOSTNAME, stranger.publicKeyHex);
const STRANGER_OCTET = 91;

const STORE_PORT = SERVICE_CATALOG.redis.defaultPort;
const SSH_PORT = SERVICE_CATALOG.ssh.defaultPort;
const AGENT_PORT = SERVICE_CATALOG.snmp.defaultPort;
/** The public port the defender published for their store. Deliberately not 6379: on a
 *  public address the port is whoever wrote the forward's to choose. */
const FORWARD_PORT = 26379;

/** What the access point's gateway serves before anyone filters anything, read from the
 *  same seed the server builds it from. Derived rather than hardcoded because the agent
 *  is pinned on every gateway while `sshd` is rolled per ESSID — the checks below assert
 *  the DELTA a filter makes, which is the claim, not the shape of the seed. */
const GATEWAY_OWN_PORTS: readonly number[] = readOpenPorts(buildApGatewayBaseFs(ESSID))
  .map((openPort) => openPort.port)
  .sort((left, right) => left - right);

const defenderOccupant = {
  owner_key: defender.publicKeyHex,
  workstation_machine_id: DEFENDER_WS,
  workstation_username: 'dinesh',
  workstation_machine_name: DEFENDER_HOSTNAME,
  workstation_root_hash: md5('defender-root-secret'),
};

const strangerOccupant = {
  owner_key: stranger.publicKeyHex,
  workstation_machine_id: STRANGER_WS,
  workstation_username: 'mallory',
  workstation_machine_name: STRANGER_HOSTNAME,
  workstation_root_hash: md5('stranger-root-secret'),
};

const store = ownStore({
  ownerKeyHex: defender.publicKeyHex,
  hostname: DEFENDER_HOSTNAME,
  fs: materializeWorkstationFs(defenderOccupant, []),
});

const clean = async () => {
  await clearPublicIps(sr, [{ essid: ESSID, publicIp: PUBLIC_IP }]);
  await sr.from('home_network_occupants').delete().eq('essid', ESSID);
  await sr.from('network_lan_leases').delete().eq('essid', ESSID);
  for (const machineId of [GATEWAY_ID, DEFENDER_WS, STRANGER_WS]) {
    await sr.from('patches').delete().eq('machine_id', machineId);
  }
};

await clean();
await seedPublicIps(sr, [{ essid: ESSID, publicIp: PUBLIC_IP }]);

failFast(
  'lease seed',
  (
    await sr.from('network_lan_leases').insert([
      { essid: ESSID, owner_key: defender.publicKeyHex, octet: DEFENDER_OCTET },
      { essid: ESSID, owner_key: stranger.publicKeyHex, octet: STRANGER_OCTET },
    ])
  ).error,
);
failFast(
  'occupancy seed',
  (
    await sr
      .from('home_network_occupants')
      .insert([
        { essid: ESSID, ...defenderOccupant },
        { essid: ESSID, ...strangerOccupant },
      ])
  ).error,
);

/** Plant a file the way its owner's own edit arrives. Loud on failure: a fixture that
 *  cannot be built must stop the run rather than soften into a check that passes against
 *  an unmodified world. */
const plant = async (row: {
  machineId: string;
  path: string;
  content: string;
  writerKey: string;
}) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: row.machineId,
      path: row.path,
      writer_key: row.writerKey,
      content: row.content,
      owner: 'root',
      node_type: 'file',
      permissions: PIDFILE_PERMISSIONS,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  failFast(`plant ${row.path} on ${row.machineId}`, error);
};

/** The gateway's own `/etc/iptables/rules.v4`: whatever forwards and denies this moment
 *  of the story calls for, in the one file that holds both chains. */
const gatewayRules = (...lines: readonly string[]) =>
  plant({
    machineId: GATEWAY_ID,
    path: RULES_V4_PATH,
    content: [LOCAL_FILTER_SEED, ...lines, ''].join('\n'),
    writerKey: defender.publicKeyHex,
  });

/** The defender's own box, as `apt install redis` + `systemctl start` leave it, carrying
 *  whatever their own filter says at this point. */
const defenderBox = async (...denies: readonly number[]) => {
  await plant({
    machineId: DEFENDER_WS,
    path: pidfilePath(SERVICE_CATALOG.redis),
    content: formatPidfileContent(SERVICE_CATALOG.redis, STORE_PORT),
    writerKey: defender.publicKeyHex,
  });
  await plant({
    machineId: DEFENDER_WS,
    path: pidfilePath(SERVICE_CATALOG.ssh),
    content: formatPidfileContent(SERVICE_CATALOG.ssh, SSH_PORT),
    writerKey: defender.publicKeyHex,
  });
  await plant({
    machineId: DEFENDER_WS,
    path: STORE_PATH,
    content: JSON.stringify(store),
    writerKey: defender.publicKeyHex,
  });
  await plant({
    machineId: DEFENDER_WS,
    path: RULES_V4_PATH,
    content: [LOCAL_FILTER_SEED, ...denies.map((port) => `deny ${port}`), ''].join('\n'),
    writerKey: defender.publicKeyHex,
  });
};

/** The defender's store STOPPED — the pidfile removed the way `systemctl stop` removes
 *  it. The counter-move this slice has to be indistinguishable from. */
const stopDefenderStore = async () => {
  const { error } = await sr
    .from('patches')
    .delete()
    .eq('machine_id', DEFENDER_WS)
    .eq('path', pidfilePath(SERVICE_CATALOG.redis));
  failFast('stop the store', error);
};

const scan = async () =>
  postTo(NETWORK, await signRequest(stranger, 'resolvePublicScan', { target: PUBLIC_IP }));

const knockOnStore = async (port: number) =>
  postTo(
    SESSIONS,
    await signRequest(stranger, 'redisConnect', {
      essid: ESSID,
      target_ip: PUBLIC_IP,
      port,
      source_ip: null,
    }),
  );

// === 1. The gateway's own doors, before anybody filters anything ===
await gatewayRules();
await defenderBox();

const baseline = await scan();
check(
  '1. a public scan names every door the access point serves',
  foundIn(baseline.body) &&
    portNumbersIn(baseline.body)
      .slice()
      .sort((left, right) => left - right)
      .join(',') === GATEWAY_OWN_PORTS.join(','),
  textOf(baseline.body),
);

// === 2. The gateway closes its own agent to the world (AC-10) ===
await gatewayRules(`deny ${AGENT_PORT}`);

const gatewayFiltered = await scan();
check(
  '2. a port the gateway denies is simply gone from the public scan',
  !portNumbersIn(gatewayFiltered.body).includes(AGENT_PORT),
  textOf(gatewayFiltered.body),
);
check(
  '3. …and the access point is still UP on everything else, not down',
  foundIn(gatewayFiltered.body) &&
    GATEWAY_OWN_PORTS.filter((port) => port !== AGENT_PORT).every((port) =>
      portNumbersIn(gatewayFiltered.body).includes(port),
    ),
  `${textOf(gatewayFiltered.body)} vs own ${GATEWAY_OWN_PORTS.join(',')}`,
);

// === 3. A forward the defender published, live end to end ===
await gatewayRules(`forward ${FORWARD_PORT} to ${DEFENDER_LAN_IP}:${STORE_PORT}`);

const published = await scan();
check(
  '4. a live forward is advertised at its public port',
  portNumbersIn(published.body).includes(FORWARD_PORT),
  textOf(published.body),
);

const openStore = await knockOnStore(FORWARD_PORT);
check(
  '5. …and the store behind it opens for a stranger',
  openStore.status === 200,
  `${openStore.status} ${textOf(openStore.body)}`,
);

// === 4. The TARGET's own filter closes the forward (AC-12) ===
await defenderBox(STORE_PORT);

const targetFiltered = await scan();
check(
  '6. a forward whose TARGET denied the internal port is gone from the scan',
  !portNumbersIn(targetFiltered.body).includes(FORWARD_PORT),
  textOf(targetFiltered.body),
);

const filteredStore = await knockOnStore(FORWARD_PORT);
check(
  '7. …and the door behind it refuses the same connection',
  filteredStore.status !== 200,
  `${filteredStore.status} ${textOf(filteredStore.body)}`,
);

// === 5. The equality the whole defence rests on ===
await defenderBox();
await stopDefenderStore();

const stoppedStore = await knockOnStore(FORWARD_PORT);
check(
  '8. a filtered forward is refused WORD FOR WORD as a stopped daemon is',
  stoppedStore.status === filteredStore.status &&
    errorOf(stoppedStore.body) === errorOf(filteredStore.body) &&
    errorOf(stoppedStore.body) !== undefined,
  `stopped ${stoppedStore.status} ${errorOf(stoppedStore.body)} vs filtered ${filteredStore.status} ${errorOf(filteredStore.body)}`,
);

const stoppedScan = await scan();
check(
  '9. …and both are equally absent from the scan',
  !portNumbersIn(stoppedScan.body).includes(FORWARD_PORT),
  textOf(stoppedScan.body),
);

// === 6. The gateway's filter does NOT reach traffic it only passes through ===
await defenderBox();
await gatewayRules(
  `forward ${FORWARD_PORT} to ${DEFENDER_LAN_IP}:${STORE_PORT}`,
  `deny ${FORWARD_PORT}`,
);

const gatewayDeniesForward = await scan();
check(
  '10. a gateway denying the PUBLIC port it forwards leaves that forward standing',
  portNumbersIn(gatewayDeniesForward.body).includes(FORWARD_PORT),
  textOf(gatewayDeniesForward.body),
);

const forwardStillOpen = await knockOnStore(FORWARD_PORT);
check(
  '11. …and the door it fronts still opens, because the gateway only passes it on',
  forwardStillOpen.status === 200,
  `${forwardStillOpen.status} ${textOf(forwardStillOpen.body)}`,
);

// === 7. A port the gateway SERVES is the gateway's, denied or not ===
await gatewayRules(
  `forward ${AGENT_PORT} to ${DEFENDER_LAN_IP}:${STORE_PORT}`,
  `deny ${AGENT_PORT}`,
);

const shadowed = await scan();
check(
  '12. a denied port the gateway serves stays dark even when a forward claims it',
  foundIn(shadowed.body) && !portNumbersIn(shadowed.body).includes(AGENT_PORT),
  textOf(shadowed.body),
);

await clean();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
