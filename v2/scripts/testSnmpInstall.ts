// Wire-payload smoke for the AGENT A PLAYER INSTALLS — a box nothing generated, running
// an agent because its owner typed `apt install snmp`, holding a community their own
// install drew for them. B, on the same WiFi, walks it, cracks it, and re-opens a port A
// closed. Drives the REAL /api/sessions endpoints against a running `vercel dev` +
// supabase, seeding both players' occupancy, leases and boxes via service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - the two config files an install plants, read SERVER-side off a PLAYER's journal
//     rather than a generated device's baseline. `/etc/snmp/snmpd.conf` decides whether
//     the agent answers anybody at all and `/var/lib/snmp/snmpd.conf` decides what a
//     read-write walk costs; both are column selections against a machine_id no unit
//     test can get wrong, on a vantage (a fellow occupant's own workstation) that no
//     SNMP wire-check has ever driven.
//   - the community a box answers to being the one DERIVED from its owner's pubkey,
//     across the wire, so a server that rebuilt the box from the wrong identity would
//     hand back a tier nobody earned.
//   - ROTATION surviving the round trip: the owner's own rewrite of both files lands as
//     patch rows, and the server afterwards refuses the community it replaced and
//     accepts the one that replaced it. Two files written by the client, read back by
//     three different server-side parsers, and nothing about that agreement is checked
//     by a compiler.
//   - `hydra` finding the lock on a player's own agent — `secretOn` reading a hash out
//     of a journal row — and reporting an agent that was never installed as a lock that
//     was never shut rather than as an empty sweep.
//   - the whole observable end to end: a port A denied is gone from B's reach, and the
//     set B pays a community for opens it again with nothing restarted.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSnmpInstall.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { lanAddressFor } from '../src/core/network/lanAddress';
import { materializeWorkstationFs } from '../src/core/network/materializeWorkstationFs';
import { ownStore } from '../src/core/redis/ownStore';
import { DATADIR_PATH as STORE_PATH } from '../src/core/redis/datadir';
import {
  formatPidfileContent,
  pidfilePath,
  PIDFILE_PERMISSIONS,
} from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { LOCAL_FILTER_SEED, RULES_V4_PATH } from '../src/core/network/iptablesRules';
import {
  consumeRwCommunity,
  formatSnmpdState,
  SNMPD_STATE_PATH,
  SNMPD_STATE_PERMISSIONS,
} from '../src/core/snmp/rwCommunity';
import {
  SNMPD_CONF_PATH,
  SNMPD_CONF_PERMISSIONS,
  SNMPD_CONF_SEED,
} from '../src/core/snmp/conf';
import { ownAgentCommunity } from '../src/core/snmp/ownAgent';
import { formatWordlist, WORDLIST_PATH } from '../src/core/wordlist/defaultWordlist';
import { md5 } from '../src/core/generation/md5';
import type { Directory, FilePermissions } from '../src/core/filesystem/types';
import type { OwnerPatchRow } from '../src/core/network/materializeMachineFs';

const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
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

const post = async (envelope: unknown) => {
  const response = await fetch(SESSIONS, {
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

const tierIn = (body: unknown): string | undefined =>
  (body as { tier?: string } | null)?.tier;

const hostnameIn = (body: unknown): string | undefined =>
  (body as { identity?: { hostname?: string } } | null)?.identity?.hostname;

/** A device renders one table per question it can be asked, so naming the kind is what
 *  keeps an assertion about the filter from silently reading whichever table came first. */
const deniesIn = (body: unknown, kind: string): readonly number[] =>
  ((body as { portTables?: { kind: string; denies?: number[] }[] } | null)?.portTables ?? [])
    .filter((table) => table.kind === kind)
    .flatMap((table) => table.denies ?? []);

const crackedIn = (body: unknown): readonly { password: string }[] =>
  (body as { cracked?: { password: string }[] } | null)?.cracked ?? [];

// --- Two players on ONE access point. Everything below is what `nmcli connect`,
//     `apt install redis` and `apt install snmp` leave behind for each of them. ---
const owner = generateIdentity();
const neighbour = generateIdentity();

const ESSID = 'NAKATOMI-PLAZA';
const OWNER_HOSTNAME = 'nebuchadnezzar';
const OWNER_WS = computeWorkstationId(OWNER_HOSTNAME, owner.publicKeyHex);
const OWNER_OCTET = 31;
const OWNER_LAN_IP = lanAddressFor(ESSID, OWNER_OCTET);

const NEIGHBOUR_HOSTNAME = 'logos';
const NEIGHBOUR_WS = computeWorkstationId(NEIGHBOUR_HOSTNAME, neighbour.publicKeyHex);
const NEIGHBOUR_OCTET = 64;
const NEIGHBOUR_LAN_IP = lanAddressFor(ESSID, NEIGHBOUR_OCTET);

/** The community the OWNER'S OWN INSTALL would have drawn — the thing under test, not a
 *  fixture chosen for convenience. Whether this particular string also happens to sit in
 *  the shipped wordlist is a property of the draw and belongs to the unit rate test; here
 *  B's wordlist is seeded with it so the checks are about the DOOR rather than the odds. */
const INSTALLED_COMMUNITY = ownAgentCommunity(owner.publicKeyHex);
const ROTATED_COMMUNITY = 'a-string-its-owner-chose';

const STORE_PORT = SERVICE_CATALOG.redis.defaultPort;
const AGENT_PORT = SERVICE_CATALOG.snmp.defaultPort;

const ownerOccupant = {
  owner_key: owner.publicKeyHex,
  workstation_machine_id: OWNER_WS,
  workstation_username: 'neo',
  workstation_machine_name: OWNER_HOSTNAME,
  workstation_root_hash: md5('owner-root-secret'),
};

const neighbourOccupant = {
  owner_key: neighbour.publicKeyHex,
  workstation_machine_id: NEIGHBOUR_WS,
  workstation_username: 'trinity',
  workstation_machine_name: NEIGHBOUR_HOSTNAME,
  workstation_root_hash: md5('neighbour-root-secret'),
};

const store = ownStore({
  ownerKeyHex: owner.publicKeyHex,
  hostname: OWNER_HOSTNAME,
  fs: materializeWorkstationFs(ownerOccupant, []),
});

const clean = async () => {
  await sr.from('home_network_occupants').delete().eq('essid', ESSID);
  await sr.from('network_lan_leases').delete().eq('essid', ESSID);
  for (const id of [OWNER_WS, NEIGHBOUR_WS]) {
    await sr.from('patches').delete().eq('machine_id', id);
  }
};

await clean();

failFast(
  'lease seed',
  (
    await sr.from('network_lan_leases').insert([
      { essid: ESSID, owner_key: owner.publicKeyHex, octet: OWNER_OCTET },
      { essid: ESSID, owner_key: neighbour.publicKeyHex, octet: NEIGHBOUR_OCTET },
    ])
  ).error,
);
failFast(
  'occupancy seed',
  (
    await sr
      .from('home_network_occupants')
      .insert([
        { essid: ESSID, ...ownerOccupant },
        { essid: ESSID, ...neighbourOccupant },
      ])
  ).error,
);

const seedPatch = async (row: {
  machineId: string;
  path: string;
  content: string | null;
  writerKey: string;
  permissions?: FilePermissions;
}) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: row.machineId,
      path: row.path,
      writer_key: row.writerKey,
      content: row.content,
      owner: 'root',
      node_type: 'file',
      permissions: row.permissions ?? PIDFILE_PERMISSIONS,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  failFast(`seed ${row.path}`, error);
};

/** A's box as `apt install redis`, `systemctl start redis-server`, `apt install snmp` and
 *  `systemctl start snmpd` leave it. The two configs are exactly what the install plants:
 *  the world-readable seed, and the hash of the community it drew for this owner. */
const seedOwnerBox = async (options: {
  readonly rules: string;
  readonly stateHash?: string;
  readonly conf?: string;
  readonly agentRunning?: boolean;
}) => {
  await seedPatch({
    machineId: OWNER_WS,
    path: pidfilePath(SERVICE_CATALOG.redis),
    content: formatPidfileContent(SERVICE_CATALOG.redis, STORE_PORT),
    writerKey: owner.publicKeyHex,
  });
  await seedPatch({
    machineId: OWNER_WS,
    path: pidfilePath(SERVICE_CATALOG.snmp),
    content: (options.agentRunning ?? true)
      ? formatPidfileContent(SERVICE_CATALOG.snmp, AGENT_PORT)
      : null,
    writerKey: owner.publicKeyHex,
  });
  await seedPatch({
    machineId: OWNER_WS,
    path: STORE_PATH,
    content: JSON.stringify(store),
    writerKey: owner.publicKeyHex,
  });
  await seedPatch({
    machineId: OWNER_WS,
    path: SNMPD_CONF_PATH,
    content: options.conf ?? SNMPD_CONF_SEED,
    writerKey: owner.publicKeyHex,
    permissions: SNMPD_CONF_PERMISSIONS,
  });
  await seedPatch({
    machineId: OWNER_WS,
    path: SNMPD_STATE_PATH,
    content:
      options.stateHash === undefined
        ? formatSnmpdState(md5(INSTALLED_COMMUNITY))
        : options.stateHash,
    writerKey: owner.publicKeyHex,
    permissions: SNMPD_STATE_PERMISSIONS,
  });
  await seedPatch({
    machineId: OWNER_WS,
    path: RULES_V4_PATH,
    content: options.rules,
    writerKey: owner.publicKeyHex,
  });
};

await seedOwnerBox({ rules: LOCAL_FILTER_SEED });
// B's own wordlist, holding the string A's install drew. The harness stands outside the
// game and hands B what a sweep would have earned.
await seedPatch({
  machineId: NEIGHBOUR_WS,
  path: WORDLIST_PATH,
  content: formatWordlist(['hunter2', INSTALLED_COMMUNITY]),
  writerKey: neighbour.publicKeyHex,
});

const walkEnvelope = (community: string) =>
  signRequest(neighbour, 'snmpWalk', {
    essid: ESSID,
    target_ip: OWNER_LAN_IP,
    community,
    source_ip: NEIGHBOUR_LAN_IP,
  });

const setEnvelope = (assignment: string, community: string) =>
  signRequest(neighbour, 'snmpSet', {
    essid: ESSID,
    target_ip: OWNER_LAN_IP,
    community,
    assignment,
    source_ip: NEIGHBOUR_LAN_IP,
  });

const crackEnvelope = () =>
  signRequest(neighbour, 'hydraCrack', {
    essid: ESSID,
    target_ip: OWNER_LAN_IP,
    service: 'snmp',
    caller_machine_id: NEIGHBOUR_WS,
    source_ip: NEIGHBOUR_LAN_IP,
  });

const storeEnvelope = () =>
  signRequest(neighbour, 'redisConnect', {
    essid: ESSID,
    target_ip: OWNER_LAN_IP,
    port: STORE_PORT,
    source_ip: NEIGHBOUR_LAN_IP,
  });

// --- 1. An installed agent answers anybody -----------------------------------------

const publicWalk = await post(await walkEnvelope('public'));
check(
  '1. a freshly installed agent answers `public` with the box its owner named',
  publicWalk.status === 200 &&
    tierIn(publicWalk.body) === 'read-only' &&
    hostnameIn(publicWalk.body) === OWNER_HOSTNAME,
  `${publicWalk.status} ${textOf(publicWalk.body)}`,
);

const noConf = await post(await walkEnvelope('public'));
await seedOwnerBox({ rules: LOCAL_FILTER_SEED, conf: '# blanked by its owner' });
const blankedWalk = await post(await walkEnvelope('public'));
check(
  '2. an agent whose config names no community answers nobody, as a stopped one does',
  noConf.status === 200 && blankedWalk.status === 404,
  `before ${noConf.status} | after ${blankedWalk.status} ${errorOf(blankedWalk.body)}`,
);

await seedOwnerBox({ rules: LOCAL_FILTER_SEED });

// --- 2. The community the install drew, over the wire --------------------------------

const rwWalk = await post(await walkEnvelope(INSTALLED_COMMUNITY));
check(
  '3. the community this owner’s own install drew buys the read-write tier',
  rwWalk.status === 200 && tierIn(rwWalk.body) === 'read-write',
  `${rwWalk.status} tier=${tierIn(rwWalk.body)}`,
);

const wrongWalk = await post(await walkEnvelope('not-the-one'));
check(
  '4. a community nobody drew is answered exactly as an absent device is',
  wrongWalk.status === 404 && errorOf(wrongWalk.body) === errorOf(blankedWalk.body),
  `${wrongWalk.status} ${errorOf(wrongWalk.body)} vs silent ${errorOf(blankedWalk.body)}`,
);

// --- 3. The crack ---------------------------------------------------------------------

const cracked = await post(await crackEnvelope());
check(
  '5. hydra recovers the community off a player’s own agent',
  cracked.status === 200 &&
    crackedIn(cracked.body).some((row) => row.password === INSTALLED_COMMUNITY),
  `${cracked.status} ${textOf(cracked.body)}`,
);

await seedOwnerBox({ rules: LOCAL_FILTER_SEED, stateHash: '' });
const noLock = await post(await crackEnvelope());
check(
  '6. a box whose owner never installed the agent reports a lock that was never shut',
  noLock.status === 404 && errorOf(noLock.body) === 'no_password_set',
  `${noLock.status} ${errorOf(noLock.body)}`,
);

await seedOwnerBox({ rules: LOCAL_FILTER_SEED });

// --- 4. Rotation, as the daemon performs it -------------------------------------------

/** The owner's own rewrite: `nano` puts the new community in the readable file and
 *  `systemctl restart snmpd` spends it. Computed with the SAME production function the
 *  daemon uses, then written as the client would, so the server reads back exactly what
 *  a real restart would have left. */
const rotate = async () => {
  const edited: OwnerPatchRow = {
    path: SNMPD_CONF_PATH,
    content: `${SNMPD_CONF_SEED}rwcommunity ${ROTATED_COMMUNITY}\n`,
    owner: 'root',
    permissions: SNMPD_CONF_PERMISSIONS,
    node_type: 'file',
    writer_key: owner.publicKeyHex,
    updated_at: new Date().toISOString(),
  };
  const boxAfterEdit: Directory = materializeWorkstationFs(ownerOccupant, [edited]);
  for (const consumed of consumeRwCommunity(boxAfterEdit)) {
    await seedPatch({
      machineId: OWNER_WS,
      path: consumed.path,
      content: consumed.content,
      writerKey: owner.publicKeyHex,
      permissions: consumed.permissions,
    });
  }
};

await rotate();

const afterRotationOld = await post(await walkEnvelope(INSTALLED_COMMUNITY));
check(
  '7. the community the owner replaced stops opening the door',
  afterRotationOld.status === 404,
  `${afterRotationOld.status} ${errorOf(afterRotationOld.body)}`,
);

const afterRotationNew = await post(await walkEnvelope(ROTATED_COMMUNITY));
check(
  '8. the community the owner chose opens it instead',
  afterRotationNew.status === 200 && tierIn(afterRotationNew.body) === 'read-write',
  `${afterRotationNew.status} tier=${tierIn(afterRotationNew.body)}`,
);

const stillPublic = await post(await walkEnvelope('public'));
check(
  '9. the rewrite left the file a file — the read-only community still answers',
  stillPublic.status === 200 && tierIn(stillPublic.body) === 'read-only',
  `${stillPublic.status} tier=${tierIn(stillPublic.body)}`,
);

// --- 5. The observable ------------------------------------------------------------------

await seedOwnerBox({ rules: `# mine\ndeny ${STORE_PORT}\n` });

const shutStore = await post(await storeEnvelope());
check(
  '10. a port its owner denied is gone from a neighbour’s reach',
  shutStore.status === 404,
  `${shutStore.status} ${errorOf(shutStore.body)}`,
);

const deniedWalk = await post(await walkEnvelope(INSTALLED_COMMUNITY));
check(
  '11. the agent reports that deny on its own filter table',
  deniedWalk.status === 200 && deniesIn(deniedWalk.body, 'filter').includes(STORE_PORT),
  `${deniedWalk.status} filter=${JSON.stringify(deniesIn(deniedWalk.body, 'filter'))}`,
);

const reopened = await post(
  await setEnvelope(`inputPort.${STORE_PORT}=permit`, INSTALLED_COMMUNITY),
);
check(
  '12. a stranger holding the community re-opens it',
  reopened.status === 200,
  `${reopened.status} ${textOf(reopened.body)}`,
);

const openStore = await post(await storeEnvelope());
check(
  '13. and the owner’s store answers the neighbourhood again, nothing restarted',
  openStore.status === 200,
  `${openStore.status} ${errorOf(openStore.body)}`,
);

// --- 6. The evidence ---------------------------------------------------------------------

const { data: logRows } = await sr
  .from('patches')
  .select('content,writer_key')
  .eq('machine_id', OWNER_WS)
  .eq('path', '/var/log/snmpd.log');

const logged = (logRows ?? []) as { content: string | null; writer_key: string }[];
check(
  '14. every visit accretes on the owner’s own log, under the owner’s key',
  logged.length === 1 && logged[0]?.writer_key === owner.publicKeyHex,
  `${logged.length} row(s) ${logged.map((row) => row.writer_key.slice(0, 8)).join(',')}`,
);

check(
  '15. and the lines carry the address the visitor actually arrived from',
  (logged[0]?.content ?? '').includes(NEIGHBOUR_LAN_IP),
  `${(logged[0]?.content ?? '').split('\n').filter(Boolean).length} line(s)`,
);

await clean();

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
