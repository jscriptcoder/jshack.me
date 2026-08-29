// Wire-payload smoke for the LOCAL FILTER — A closes a port to the network and keeps
// the service for themselves; B, standing on the same WiFi, finds it gone, and buys it
// back by cracking A's agent. Drives the REAL /api/sessions and /api/network endpoints
// against a running `vercel dev` + supabase, seeding both players' occupancy, leases
// and boxes via service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `portsOpenToNetwork` at every REMOTE reader that resolves a player's box from
//     somebody else's vantage: the shared service reach behind `redisConnect`, the
//     `resolveOccupantScan` answer, `reachDoor` behind `authCreateSessionSameLan`, and
//     the `hydraCrack` sweep. Each reads the target's journal for a file this filter
//     did not exist in until now — a column selection no unit test can get wrong.
//   - the `snmpSet` route writing a DENY into `/etc/iptables/rules.v4` under the
//     TARGET's writer key, into the same file its NAT forwards live in. The file is
//     read by three different parsers server-side and rewritten by two writers, and
//     nothing about that crosses the wire to be checked by a client.
//   - a filtered port being INDISTINGUISHABLE from a stopped daemon over the wire, not
//     merely refused: the whole defence rests on a caller learning nothing from the
//     refusal, and that is an equality between two live HTTP answers.
//   - scan and reach AGREEING about one box after a filter changes: the port the scan
//     stops advertising is the port the reach stops opening, and the port `snmpset`
//     re-opens is open to both again with no restart in between.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSnmpFilter.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { lanAddressFor } from '../src/core/network/lanAddress';
import { materializeWorkstationFs } from '../src/core/network/materializeWorkstationFs';
import { workstationGuestPassword } from '../src/core/generation/workstationFs';
import { ownStore } from '../src/core/redis/ownStore';
import { DATADIR_PATH as STORE_PATH } from '../src/core/redis/datadir';
import {
  formatPidfileContent,
  pidfilePath,
  PIDFILE_PERMISSIONS,
  type OpenPort,
} from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import {
  LOCAL_FILTER_SEED,
  RULES_V4_PATH,
  parseInputDenies,
} from '../src/core/network/iptablesRules';
import { formatSnmpdState } from '../src/core/snmp/rwCommunity';
import { formatWordlist, WORDLIST_PATH } from '../src/core/wordlist/defaultWordlist';
import { md5 } from '../src/core/generation/md5';

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

const post = (envelope: unknown) => postTo(SESSIONS, envelope);

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

const textOf = (body: unknown): string =>
  typeof body === 'object' && body !== null ? JSON.stringify(body) : String(body);

const portsIn = (body: unknown): readonly OpenPort[] =>
  (body as { ports?: OpenPort[] } | null)?.ports ?? [];

const foundIn = (body: unknown): boolean => (body as { found?: boolean } | null)?.found === true;

/** The denies the agent reports on its own filter. The walk answers with the TABLES a
 *  device holds — rendering them into OID lines is the client's half, and asking the
 *  wire for lines would be checking a screen rather than a payload. */
const filterDeniesIn = (body: unknown): readonly number[] =>
  ((body as { portTables?: { kind: string; denies?: number[] }[] } | null)?.portTables ?? [])
    .filter((table) => table.kind === 'filter')
    .flatMap((table) => table.denies ?? []);

const crackedIn = (body: unknown): readonly { password: string }[] =>
  (body as { cracked?: { password: string }[] } | null)?.cracked ?? [];

// --- Two players on ONE access point. Everything below is what `nmcli connect`,
//     `apt install redis` and `apt install snmp` leave behind for each of them. ---
const defender = generateIdentity();
const attacker = generateIdentity();

const ESSID = 'PIED-PIPER-GUEST';
const DEFENDER_HOSTNAME = 'anton';
const DEFENDER_WS = computeWorkstationId(DEFENDER_HOSTNAME, defender.publicKeyHex);
const DEFENDER_OCTET = 23;
const DEFENDER_LAN_IP = lanAddressFor(ESSID, DEFENDER_OCTET);

const ATTACKER_HOSTNAME = 'cracklab';
const ATTACKER_WS = computeWorkstationId(ATTACKER_HOSTNAME, attacker.publicKeyHex);
const ATTACKER_OCTET = 61;

/** The community A's agent answers read-write. Seeded rather than rolled: this harness
 *  stands outside the game and hands B what a `hydra <host> snmp` sweep would have
 *  earned, so the checks after it are about the FILTER rather than about cracking. */
const RW_COMMUNITY = 'corpnet';

const STORE_PORT = SERVICE_CATALOG.redis.defaultPort;
const SSH_PORT = SERVICE_CATALOG.ssh.defaultPort;
const AGENT_PORT = SERVICE_CATALOG.snmp.defaultPort;

const defenderOccupant = {
  owner_key: defender.publicKeyHex,
  workstation_machine_id: DEFENDER_WS,
  workstation_username: 'gilfoyle',
  workstation_machine_name: DEFENDER_HOSTNAME,
  workstation_root_hash: md5('defender-root-secret'),
};

const attackerOccupant = {
  owner_key: attacker.publicKeyHex,
  workstation_machine_id: ATTACKER_WS,
  workstation_username: 'mallory',
  workstation_machine_name: ATTACKER_HOSTNAME,
  workstation_root_hash: md5('attacker-root-secret'),
};

const DEFENDER_GUEST_PW = workstationGuestPassword(defender.publicKeyHex);

const store = ownStore({
  ownerKeyHex: defender.publicKeyHex,
  hostname: DEFENDER_HOSTNAME,
  fs: materializeWorkstationFs(defenderOccupant, []),
});

const clean = async () => {
  await sr.from('home_network_occupants').delete().eq('essid', ESSID);
  await sr.from('network_lan_leases').delete().eq('essid', ESSID);
  for (const id of [DEFENDER_WS, ATTACKER_WS]) {
    await sr.from('patches').delete().eq('machine_id', id);
  }
};

await clean();

failFast(
  'lease seed',
  (
    await sr.from('network_lan_leases').insert([
      { essid: ESSID, owner_key: defender.publicKeyHex, octet: DEFENDER_OCTET },
      { essid: ESSID, owner_key: attacker.publicKeyHex, octet: ATTACKER_OCTET },
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
        { essid: ESSID, ...attackerOccupant },
      ])
  ).error,
);

const seedPatch = async (row: {
  machineId: string;
  path: string;
  content: string | null;
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
  failFast(`seed ${row.path}`, error);
};

/** A's box as `systemctl start sshd`, `apt install redis`, `systemctl start
 *  redis-server`, `apt install snmp` and `systemctl start snmpd` leave it — with the
 *  filter file the install plants, denying nothing at all. */
const seedDefenderBox = async (rules: string) => {
  await seedPatch({
    machineId: DEFENDER_WS,
    path: pidfilePath(SERVICE_CATALOG.ssh),
    content: formatPidfileContent(SERVICE_CATALOG.ssh, SSH_PORT),
    writerKey: defender.publicKeyHex,
  });
  await seedPatch({
    machineId: DEFENDER_WS,
    path: pidfilePath(SERVICE_CATALOG.redis),
    content: formatPidfileContent(SERVICE_CATALOG.redis, STORE_PORT),
    writerKey: defender.publicKeyHex,
  });
  await seedPatch({
    machineId: DEFENDER_WS,
    path: pidfilePath(SERVICE_CATALOG.snmp),
    content: formatPidfileContent(SERVICE_CATALOG.snmp, AGENT_PORT),
    writerKey: defender.publicKeyHex,
  });
  await seedPatch({
    machineId: DEFENDER_WS,
    path: STORE_PATH,
    content: JSON.stringify(store),
    writerKey: defender.publicKeyHex,
  });
  await seedPatch({
    machineId: DEFENDER_WS,
    path: '/var/lib/snmp/snmpd.conf',
    content: formatSnmpdState(md5(RW_COMMUNITY)),
    writerKey: defender.publicKeyHex,
  });
  await seedPatch({
    machineId: DEFENDER_WS,
    path: RULES_V4_PATH,
    content: rules,
    writerKey: defender.publicKeyHex,
  });
};

/** What A's box carries at the filter path right now, whoever last wrote it. */
const filterOnDefenderBox = async (): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', DEFENDER_WS)
    .eq('path', RULES_V4_PATH);
  return ((data ?? []) as { content: string | null }[]).map((row) => row.content ?? '').join('');
};

await seedDefenderBox(LOCAL_FILTER_SEED);
// B's own wordlist, grown the only way a wordlist grows: by writing to a box.
await seedPatch({
  machineId: ATTACKER_WS,
  path: WORDLIST_PATH,
  content: formatWordlist(['hunter2', DEFENDER_GUEST_PW]),
  writerKey: attacker.publicKeyHex,
});

const scanEnvelope = () =>
  signRequest(attacker, 'resolveOccupantScan', { essid: ESSID, target: DEFENDER_LAN_IP });

const storeEnvelope = () =>
  signRequest(attacker, 'redisConnect', {
    essid: ESSID,
    target_ip: DEFENDER_LAN_IP,
    port: STORE_PORT,
    source_ip: '10.0.0.1',
  });

const sshEnvelope = () =>
  signRequest(attacker, 'authCreateSessionSameLan', {
    // The same-LAN door mints a session UNDER the caller's own, so it needs one named.
    session_id: 'filter-ssh-attempt',
    essid: ESSID,
    target_ip: DEFENDER_LAN_IP,
    username: 'guest',
    password: DEFENDER_GUEST_PW,
    kind: 'ssh',
  });

const sweepEnvelope = () =>
  signRequest(attacker, 'hydraCrack', {
    essid: ESSID,
    target_ip: DEFENDER_LAN_IP,
    service: 'ssh',
    caller_machine_id: ATTACKER_WS,
    source_ip: '10.0.0.1',
  });

const walkEnvelope = () =>
  signRequest(attacker, 'snmpWalk', {
    essid: ESSID,
    target_ip: DEFENDER_LAN_IP,
    community: RW_COMMUNITY,
    source_ip: '10.0.0.1',
  });

const setEnvelope = (assignment: string) =>
  signRequest(attacker, 'snmpSet', {
    essid: ESSID,
    target_ip: DEFENDER_LAN_IP,
    community: RW_COMMUNITY,
    assignment,
    source_ip: '10.0.0.1',
  });

// === 1–2. The box before its owner closes anything. ===
const openScan = await postTo(NETWORK, await scanEnvelope());
check(
  '1. a neighbour scan of an unfiltered box names every daemon on it',
  foundIn(openScan.body) &&
    portsIn(openScan.body).some((open) => open.port === STORE_PORT) &&
    portsIn(openScan.body).some((open) => open.port === SSH_PORT),
  textOf(openScan.body),
);

const openStore = await post(await storeEnvelope());
check(
  '2. …and the store on it opens for them',
  openStore.status === 200,
  `${openStore.status} ${textOf(openStore.body)}`,
);

// === 3–6. The owner closes the store port to the network. ===
await seedDefenderBox(`${LOCAL_FILTER_SEED}deny ${STORE_PORT}\n`);

const filteredScan = await postTo(NETWORK, await scanEnvelope());
check(
  '3. a filtered port is simply gone from the neighbour scan',
  foundIn(filteredScan.body) &&
    !portsIn(filteredScan.body).some((open) => open.port === STORE_PORT) &&
    portsIn(filteredScan.body).some((open) => open.port === SSH_PORT),
  textOf(filteredScan.body),
);

const filteredStore = await post(await storeEnvelope());
check(
  '4. …and the store no longer answers the neighbour',
  filteredStore.status === 404 && errorOf(filteredStore.body) === 'service_not_running',
  `${filteredStore.status} ${errorOf(filteredStore.body)}`,
);

// The daemon stopped, with no filter at all: the answer a filter must be
// indistinguishable from.
await seedDefenderBox(LOCAL_FILTER_SEED);
await seedPatch({
  machineId: DEFENDER_WS,
  path: pidfilePath(SERVICE_CATALOG.redis),
  content: null,
  writerKey: defender.publicKeyHex,
});
const stoppedStore = await post(await storeEnvelope());
check(
  '5. a filtered port answers word for word as a STOPPED daemon does',
  stoppedStore.status === filteredStore.status &&
    errorOf(stoppedStore.body) === errorOf(filteredStore.body),
  `stopped ${stoppedStore.status} ${errorOf(stoppedStore.body)} vs filtered ${filteredStore.status} ${errorOf(filteredStore.body)}`,
);

await seedDefenderBox(
  `${LOCAL_FILTER_SEED}deny ${STORE_PORT}\ndeny ${SSH_PORT}\ndeny ${AGENT_PORT}\n`,
);
const everythingFiltered = await postTo(NETWORK, await scanEnvelope());
check(
  '6. a box with every port filtered is still UP, not down',
  foundIn(everythingFiltered.body) && portsIn(everythingFiltered.body).length === 0,
  textOf(everythingFiltered.body),
);

// === 7–8. ssh and the sweep honour it too, on their own paths. ===
const filteredSsh = await post(await sshEnvelope());
check(
  '7. ssh onto a filtered port is refused before any credential is judged',
  filteredSsh.status === 404,
  `${filteredSsh.status} ${textOf(filteredSsh.body)}`,
);

const filteredSweep = await post(await sweepEnvelope());
check(
  '8. a sweep of a filtered port finds nothing to attack',
  filteredSweep.status === 404 && crackedIn(filteredSweep.body).length === 0,
  `${filteredSweep.status} ${textOf(filteredSweep.body)}`,
);

// === 9–11. The way back in: the agent names what was closed, and re-opens it. ===
await seedDefenderBox(`${LOCAL_FILTER_SEED}deny ${STORE_PORT}\n`);

const walked = await post(await walkEnvelope());
check(
  '9. a read-write walk names the port the owner closed',
  walked.status === 200 && filterDeniesIn(walked.body).includes(STORE_PORT),
  `${walked.status} ${textOf(walked.body)}`,
);

const reopened = await post(await setEnvelope(`inputPort.${STORE_PORT}=permit`));
const filterAfter = await filterOnDefenderBox();
check(
  '10. …and a set re-opens it, in the owner’s own file',
  reopened.status === 200 && !parseInputDenies(filterAfter).includes(STORE_PORT),
  `${reopened.status} ${textOf(reopened.body)} | rules: ${JSON.stringify(filterAfter)}`,
);

const reopenedStore = await post(await storeEnvelope());
check(
  '11. …so the store answers the neighbour again, with nothing restarted',
  reopenedStore.status === 200,
  `${reopenedStore.status} ${textOf(reopenedStore.body)}`,
);

// === 12–13. The filter covers the agent itself, and refuses what it cannot route. ===
const closedAgent = await post(await setEnvelope(`inputPort.${AGENT_PORT}=deny`));
const silentWalk = await post(await walkEnvelope());
check(
  '12. closing 161 takes the agent itself silent, caller included',
  closedAgent.status === 200 && silentWalk.status === 404,
  `set ${closedAgent.status} | walk ${silentWalk.status} ${errorOf(silentWalk.body)}`,
);

await seedDefenderBox(LOCAL_FILTER_SEED);
const natOnWorkstation = await post(
  await setEnvelope(`natForward.2222=${DEFENDER_LAN_IP}:${SSH_PORT}`),
);
check(
  '13. a forward aimed at a box that fronts no segment is refused',
  // 200 with an error PDU, not an HTTP failure: the agent HEARD this and said no,
  // which is what real snmpset does and what the line on the device records.
  natOnWorkstation.status === 200 &&
    (natOnWorkstation.body as { refusal?: { reason?: string } } | null)?.refusal?.reason ===
      'wrongValue',
  `${natOnWorkstation.status} ${textOf(natOnWorkstation.body)}`,
);

await clean();

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
