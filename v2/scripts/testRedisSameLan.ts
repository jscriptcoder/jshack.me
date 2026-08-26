// Wire-payload smoke for the SAME-LAN key-value vantage — B opens, reads and rewrites
// the store on A's box with both of them standing on one WiFi: no router, no NAT, no
// forward. Drives the REAL /api/sessions and /api/network endpoints against a running
// `vercel dev` + supabase, seeding both players' occupancy, leases and boxes via
// service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - the `redisConnect` / `redisStatement` routes resolving a fellow OCCUPANT: the
//     occupancy read that is both the LAN boundary and the target, the lease read that
//     is the address of record, and the target's own journal — every one a column
//     selection no unit test can get wrong.
//   - the brand-new `resolveOccupantScan` route, whose occupancy read selects the AUTH
//     columns the plain occupant LIST deliberately does not. Nothing about it crosses
//     the wire; it rebuilds A's tree. Get that select wrong and the scan silently
//     reports a neighbour running nothing.
//   - `nmap` and `redis-cli` AGREEING about one box: the port the scan advertises is
//     posted straight to `redisConnect`, which must open there. A scan that promised a
//     door the reach then refused is exactly what the old blank was protecting against.
//   - the sweep reaching the occupant while the STORE stays out of reach: `hydra ssh`
//     earns the guest account off the same box `hydra redis` correctly finds nothing on,
//     because A chose their root password and slice 6 mirrors it onto their store.
//   - the writer key every row lands under, and the source IP in A's log: B's LEASED
//     address, derived server-side, never the `source_ip` B's client sent.
//   - occupancy IS the reach — `nmcli disconnect` takes the box off the LAN outright,
//     which nothing on the public vantage behaves like.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testRedisSameLan.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { generateHomeLan } from '../src/core/generation/generateHomeLan';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity';
import { lanAddressFor } from '../src/core/network/lanAddress';
import { materializeWorkstationFs } from '../src/core/network/materializeWorkstationFs';
import { workstationGuestPassword } from '../src/core/generation/workstationFs';
import { ownStore } from '../src/core/redis/ownStore';
import { DATADIR_PATH } from '../src/core/redis/datadir';
import { REDIS_LOG_PATH } from '../src/core/logging/redisLog';
import { readOpenPorts, type OpenPort } from '../src/core/services/pidfile';
import {
  formatPidfileContent,
  pidfilePath,
  PIDFILE_PERMISSIONS,
} from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { WORDLIST_PATH, formatWordlist } from '../src/core/wordlist/defaultWordlist';
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

const crackedIn = (body: unknown): readonly { username?: string; password: string }[] =>
  (body as { cracked?: { username?: string; password: string }[] } | null)?.cracked ?? [];

// --- Two players on ONE access point. ---
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
const ATTACKER_LAN_IP = lanAddressFor(ESSID, ATTACKER_OCTET);

/** The address the attacker's client claims. Never what a defender's log records. */
const CLAIMED_SOURCE = '10.0.0.1';

/** A password the defender CHOSE, so no wordlist the game hands out contains it — and
 *  therefore, through slice 6's mirror, the password on their store. */
const CHOSEN_ROOT_PW = 'correct-horse-battery-staple';

/** A generated sibling on this ESSID that runs ssh on a port OTHER than 22, and the
 *  octet it stands on. A lease can be issued for that octet too, which is the collision
 *  the merge settles — and the odd port is how these checks tell the two boxes apart. */
const sibling = generateHomeLan(ESSID).hosts.flatMap((host) => {
  if (host.kind !== 'machine') return [];
  const sshd = readOpenPorts(resolveLanHostIdentity(host, ESSID).baseFs).find(
    (open) => open.service === SERVICE_CATALOG.ssh.service,
  );
  return sshd === undefined || sshd.port === SERVICE_CATALOG.ssh.defaultPort
    ? []
    : [{ host, port: sshd.port }];
})[0];

if (sibling === undefined) {
  console.error(`No generated host on ${ESSID} serves ssh off :22 — pick another ESSID.`);
  process.exit(2);
}

const NPC_OCTET = Number(sibling.host.ip.split('.')[3]);
const NPC_SSH_PORT = sibling.port;

const defenderOccupant = {
  owner_key: defender.publicKeyHex,
  workstation_machine_id: DEFENDER_WS,
  workstation_username: 'gilfoyle',
  workstation_machine_name: DEFENDER_HOSTNAME,
  workstation_root_hash: md5(CHOSEN_ROOT_PW),
};

const attackerOccupant = {
  owner_key: attacker.publicKeyHex,
  workstation_machine_id: ATTACKER_WS,
  workstation_username: 'mallory',
  workstation_machine_name: ATTACKER_HOSTNAME,
  workstation_root_hash: md5('attacker-root-secret'),
};

/** The guest account on the defender's own box — drawn from the crackable pool, so it
 *  is the account a neighbour's wordlist can actually reach. */
const DEFENDER_GUEST_PW = workstationGuestPassword(defender.publicKeyHex);

/** The store `apt install redis` writes onto the defender's box, locked to whatever
 *  `/etc/passwd` says root's password is. */
const store = ownStore({
  ownerKeyHex: defender.publicKeyHex,
  hostname: DEFENDER_HOSTNAME,
  fs: materializeWorkstationFs(defenderOccupant, []),
});
const firstKey = Object.keys(store.keys)[0];

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
  'defender occupancy seed',
  (await sr.from('home_network_occupants').insert({ essid: ESSID, ...defenderOccupant })).error,
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

// The defender's box as `systemctl start sshd`, `apt install redis` and
// `systemctl start redis` leave it.
await seedPatch({
  machineId: DEFENDER_WS,
  path: pidfilePath(SERVICE_CATALOG.ssh),
  content: formatPidfileContent(SERVICE_CATALOG.ssh, SERVICE_CATALOG.ssh.defaultPort),
  writerKey: defender.publicKeyHex,
});
await seedPatch({
  machineId: DEFENDER_WS,
  path: pidfilePath(SERVICE_CATALOG.redis),
  content: formatPidfileContent(SERVICE_CATALOG.redis, SERVICE_CATALOG.redis.defaultPort),
  writerKey: defender.publicKeyHex,
});
await seedPatch({
  machineId: DEFENDER_WS,
  path: DATADIR_PATH,
  content: JSON.stringify(store),
  writerKey: defender.publicKeyHex,
});
// The attacker's own wordlist, grown the only way a wordlist grows: by writing to a box.
await seedPatch({
  machineId: ATTACKER_WS,
  path: WORDLIST_PATH,
  content: formatWordlist(['hunter2', DEFENDER_GUEST_PW]),
  writerKey: attacker.publicKeyHex,
});

const rowOn = async (machineId: string, path: string) => {
  const { data } = await sr
    .from('patches')
    .select('content, writer_key')
    .eq('machine_id', machineId)
    .eq('path', path);
  return (data ?? []) as { content: string; writer_key: string }[];
};

const release = async (octet: number) => {
  failFast(
    'lease move',
    (
      await sr
        .from('network_lan_leases')
        .update({ octet })
        .eq('essid', ESSID)
        .eq('owner_key', defender.publicKeyHex)
    ).error,
  );
};

const connectEnvelope = (targetIp: string = DEFENDER_LAN_IP, port?: number) =>
  signRequest(attacker, 'redisConnect', {
    essid: ESSID,
    target_ip: targetIp,
    port: port ?? SERVICE_CATALOG.redis.defaultPort,
    source_ip: CLAIMED_SOURCE,
  });

const statementEnvelope = (statement: string, password?: string) =>
  signRequest(attacker, 'redisStatement', {
    essid: ESSID,
    target_ip: DEFENDER_LAN_IP,
    port: SERVICE_CATALOG.redis.defaultPort,
    statement,
    ...(password === undefined ? {} : { password }),
    source_ip: CLAIMED_SOURCE,
  });

const sweepEnvelope = (service: string) =>
  signRequest(attacker, 'hydraCrack', {
    essid: ESSID,
    target_ip: DEFENDER_LAN_IP,
    service,
    caller_machine_id: ATTACKER_WS,
    source_ip: CLAIMED_SOURCE,
  });

const scanEnvelope = (identity: typeof attacker, target: string = DEFENDER_LAN_IP) =>
  signRequest(identity, 'resolveOccupantScan', { essid: ESSID, target });

// --- 1. The LAN boundary: you reach a box on a WiFi by being ON that WiFi. ---
const offTheLan = await post(await connectEnvelope());
check(
  '1. a caller who is not on the WiFi reaches no occupant there',
  offTheLan.status === 404 && errorOf(offTheLan.body) === 'host_unreachable',
  `${offTheLan.status} ${errorOf(offTheLan.body)}`,
);

failFast(
  'attacker occupancy seed',
  (await sr.from('home_network_occupants').insert({ essid: ESSID, ...attackerOccupant })).error,
);

// --- 2. The scan is what makes the box FINDABLE at all — the gap this slice closed.
//        Its ports are the defender's own, read from their journal server-side. ---
const scanned = await postTo(NETWORK, await scanEnvelope(attacker));
const scannedPorts = portsIn(scanned.body);
check(
  '2. nmap of a neighbour reports the services THEY are running',
  foundIn(scanned.body) &&
    scannedPorts.some((open) => open.port === SERVICE_CATALOG.redis.defaultPort) &&
    scannedPorts.some((open) => open.port === SERVICE_CATALOG.ssh.defaultPort),
  textOf(scanned.body),
);

// --- 3. …and it is generic rather than redis-shaped: whatever the box holds. ---
check(
  '3. the scan names each daemon rather than a fixed pair',
  scannedPorts.some((open) => open.service === SERVICE_CATALOG.redis.service) &&
    scannedPorts.some((open) => open.service === SERVICE_CATALOG.ssh.service),
  scannedPorts.map((open) => `${open.port}/${open.service}`).join(' '),
);

// --- 4. A non-occupant learns nothing. Without this boundary one signed request per
//        address would enumerate every player's running services. ---
const stranger = generateIdentity();
const strangerScan = await postTo(NETWORK, await scanEnvelope(stranger));
check(
  '4. a stranger to the WiFi is refused the neighbour’s port list',
  strangerScan.status === 403 && errorOf(strangerScan.body) === 'not_an_occupant',
  `${strangerScan.status} ${errorOf(strangerScan.body)}`,
);

// --- 5. What the scan advertised, the door OPENS. Two tools, one box. ---
const opened = await post(await connectEnvelope());
check(
  '5. redis-cli opens the port nmap advertised, and names the neighbour’s box',
  opened.status === 200 &&
    (opened.body as { hostname?: string } | null)?.hostname === DEFENDER_HOSTNAME,
  textOf(opened.body),
);

// --- 6. …and the first question is refused. Proximity is not authorization. ---
const unauthed = await post(await statementEnvelope('KEYS *'));
check(
  '6. a neighbour’s store is locked too — the mirror has no vantage in it',
  textOf(unauthed.body).includes('NOAUTH'),
  textOf(unauthed.body),
);

// --- 7. The DEAD END, on this vantage as on the public one: the defender chose their
//        root password, so no wordlist the game hands out reaches their store. ---
const sweptStore = await post(await sweepEnvelope('redis'));
check(
  '7. hydra finds nothing against a chosen password, standing right beside the box',
  sweptStore.status === 200 && crackedIn(sweptStore.body).length === 0,
  textOf(sweptStore.body),
);

// --- 8. …while the SWEEP still reaches that box for a door whose secret is drawn.
//        The store is out of reach, not the machine. ---
const sweptShell = await post(await sweepEnvelope('ssh'));
check(
  '8. hydra earns the guest account on the same neighbour it could not sweep the store of',
  crackedIn(sweptShell.body).some((found) => found.password === DEFENDER_GUEST_PW),
  textOf(sweptShell.body),
);

// --- 9. Which leaves one way in: hold the password because you took the box. ---
const authed = await post(await statementEnvelope(`GET ${firstKey}`, CHOSEN_ROOT_PW));
// Compared against the rendered LINE rather than the serialized body: the value is
// itself JSON, so every quote in it is escaped once more inside `JSON.stringify(body)`
// and a raw-substring match against that would fail on a correct answer.
const answered = (authed.body as { output?: readonly string[] } | null)?.output?.[0] ?? '';
check(
  '9. root’s password opens the store, and the value is the defender’s own',
  authed.status === 200 && answered.includes(store.keys[firstKey ?? ''] ?? ''),
  answered,
);

// --- 10. A write lands on the DEFENDER's own datadir row. One box, one file. ---
await post(await statementEnvelope('SET intruder:was-here yes', CHOSEN_ROOT_PW));
const datadirRows = await rowOn(DEFENDER_WS, DATADIR_PATH);
check(
  '10. the rewritten store is ONE row, under the defender’s key',
  datadirRows.length === 1 && datadirRows[0]?.writer_key === defender.publicKeyHex,
  `${datadirRows.length} row(s), writer=${datadirRows[0]?.writer_key?.slice(0, 8)}`,
);

// --- 11. The defender's log is the DEFENDER's row, at the attacker's LEASED address —
//         never the one the attacker's client sent. ---
const logRows = await rowOn(DEFENDER_WS, REDIS_LOG_PATH);
check(
  '11. the log is one row under the defender’s key',
  logRows.length === 1 && logRows[0]?.writer_key === defender.publicKeyHex,
  `${logRows.length} row(s), writer=${logRows[0]?.writer_key?.slice(0, 8)}`,
);
check(
  '12. …and it names the attacker’s LEASED address, not the one they claimed',
  (logRows[0]?.content ?? '').includes(ATTACKER_LAN_IP) &&
    !(logRows[0]?.content ?? '').includes(CLAIMED_SOURCE),
  (logRows[0]?.content ?? '').split('\n')[0] ?? '',
);

// --- 13. The COLLISION. Move the defender onto an octet the generator also filled: a
//         real player answering there outranks the seeded sibling, and the scan must
//         report the defender's ports rather than the NPC's. ---
await release(NPC_OCTET);
const collided = await postTo(NETWORK, await scanEnvelope(attacker, sibling.host.ip));
const collidedPorts = portsIn(collided.body);
check(
  '13. an occupant standing on a generated octet is scanned as THEMSELVES',
  foundIn(collided.body) &&
    collidedPorts.some((open) => open.port === SERVICE_CATALOG.redis.defaultPort) &&
    !collidedPorts.some((open) => open.port === NPC_SSH_PORT),
  `${textOf(collided.body)} (sibling ssh would be :${NPC_SSH_PORT})`,
);
await release(DEFENDER_OCTET);

// --- 14. A bricked neighbour is DARK, not silent: the scan says the host is down. ---
await seedPatch({
  machineId: DEFENDER_WS,
  path: '/boot/vmlinuz',
  content: null,
  writerKey: defender.publicKeyHex,
});
const bricked = await postTo(NETWORK, await scanEnvelope(attacker));
check(
  '14. a bricked neighbour scans as down rather than as running nothing',
  bricked.status === 200 && !foundIn(bricked.body) && portsIn(bricked.body).length === 0,
  textOf(bricked.body),
);
await sr
  .from('patches')
  .delete()
  .eq('machine_id', DEFENDER_WS)
  .eq('path', '/boot/vmlinuz');

// --- 15. `systemctl stop redis` — and on THIS vantage the door says so, because the
//         caller is inside the network. Across NAT the same box falls silent instead. ---
await sr
  .from('patches')
  .delete()
  .eq('machine_id', DEFENDER_WS)
  .eq('path', pidfilePath(SERVICE_CATALOG.redis));
const stopped = await post(await statementEnvelope('DBSIZE', CHOSEN_ROOT_PW));
check(
  '15. a stopped daemon is named, not hidden — there is no NAT in between',
  stopped.status === 404 && errorOf(stopped.body) === 'service_not_running',
  `${stopped.status} ${errorOf(stopped.body)}`,
);

// --- 16. `nmcli disconnect` is the defence here: occupancy IS the reach. ---
await sr
  .from('home_network_occupants')
  .delete()
  .eq('essid', ESSID)
  .eq('owner_key', defender.publicKeyHex);
const departed = await post(await connectEnvelope());
check(
  '16. leaving the WiFi takes the box off the LAN, lease still held',
  departed.status === 404 && errorOf(departed.body) === 'host_unreachable',
  `${departed.status} ${errorOf(departed.body)}`,
);

await clean();

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
