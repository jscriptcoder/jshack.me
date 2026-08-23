// Wire-payload smoke for the SAME-LAN database vantage — B cracks and then uses an
// account in A's database with A standing on the same WiFi: no router, no NAT, no
// forward. Drives the REAL /api/sessions endpoint against a running `vercel dev` +
// supabase, seeding both players' occupancy, leases and boxes via service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - the `mysqlConnect` / `mysqlStatement` routes resolving a fellow OCCUPANT: the
//     occupancy read that is both the LAN boundary and the target, the lease read that
//     is the address of record, and the target's own journal — every one a column
//     selection no unit test can get wrong.
//   - the `hydraCrack` route reaching a fellow occupant AT ALL, for EVERY service:
//     the same merge answers `ssh` and `mysql`, which is why this checks both.
//   - hydra and mysql AGREEING about one box across the LAN: the account the sweep
//     reports is posted straight to `mysqlConnect`, which must accept it.
//   - the writer key every row lands under. A's datadir, A's mysql.log and A's
//     auth.log must stay A's OWN rows however many neighbours write to them, because
//     `patches` is keyed `(machine_id, path, writer_key)` and a row per attacker would
//     fold to whichever was written last.
//   - the source IP in A's log: B's LEASED LAN address, derived server-side, never the
//     `source_ip` B's client sent.
//   - `nmcli disconnect` as the defence on this vantage — occupancy IS the reach.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMysqlSameLan.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { generateHomeLan } from '../src/core/generation/generateHomeLan';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity';
import { readOpenPorts } from '../src/core/services/pidfile';
import { lanAddressFor } from '../src/core/network/lanAddress';
import { materializeWorkstationFs } from '../src/core/network/materializeWorkstationFs';
import { workstationGuestPassword } from '../src/core/generation/workstationFs';
import { ownDatabase } from '../src/core/mysql/ownDatabase';
import { DATADIR_PATH } from '../src/core/mysql/datadir';
import { ALL_GENERATED_PASSWORDS } from '../src/core/generation/passwordPools';
import { formatPidfileContent, pidfilePath, PIDFILE_PERMISSIONS } from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { MYSQL_LOG_PATH } from '../src/core/logging/mysqlLog';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog';
import { WORDLIST_PATH, formatWordlist } from '../src/core/wordlist/defaultWordlist';
import { md5 } from '../src/core/generation/md5';

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

/** A seed that cannot be built must stop the run rather than soften into a passing
 *  check against an unmodified world. */
const failFast = (label: string, error: { readonly message: string } | null): void => {
  if (error === null) return;
  console.error(`FATAL: ${label} failed: ${error.message}`);
  process.exit(1);
};

const post = async (envelope: unknown): Promise<{ status: number; body: unknown }> => {
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

const crackedIn = (body: unknown): readonly { username: string; password: string }[] =>
  (body as { cracked?: { username: string; password: string }[] } | null)?.cracked ?? [];

// --- Two players on ONE access point. Everything below is what `nmcli connect` and
//     `apt install mysql` leave behind for each of them. ---
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

/** A generated sibling on this same ESSID, and the octet it stands on. A lease can be
 *  issued for that octet too — which is the collision the merge has to settle, and the
 *  one thing about this vantage the public path never had to answer.
 *
 *  It has to be serving ssh on a port OTHER than 22, because that port is how these
 *  checks tell the two boxes apart: the player's own box answers on 22, and a seeded
 *  sibling that also answered there would make "which box replied" unprovable. */
const siblings = generateHomeLan(ESSID).hosts.flatMap((host) => {
  if (host.kind !== 'machine') return [];
  const sshd = readOpenPorts(resolveLanHostIdentity(host, ESSID).baseFs).find(
    (open) => open.service === SERVICE_CATALOG.ssh.service,
  );
  return sshd === undefined || sshd.port === SERVICE_CATALOG.ssh.defaultPort
    ? []
    : [{ host, port: sshd.port }];
});
const sibling = siblings[0];

if (sibling === undefined) {
  console.error(`No generated host on ${ESSID} serves ssh off :22 — pick another ESSID.`);
  process.exit(2);
}

const npcHost = sibling.host;
const NPC_SSH_PORT = sibling.port;
const NPC_OCTET = Number(npcHost.ip.split('.')[3]);

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

/** The guest account on the defender's own box: its password is drawn from the
 *  crackable pool and seeded from their pubkey alone, so it is the account a
 *  neighbour's wordlist can actually reach. */
const DEFENDER_GUEST_PW = workstationGuestPassword(defender.publicKeyHex);

// The database `apt install mysql` writes onto the defender's box — drawn from their
// own key, so it is theirs and nobody else's.
const database = ownDatabase({
  ownerKeyHex: defender.publicKeyHex,
  hostname: DEFENDER_HOSTNAME,
  fs: materializeWorkstationFs(defenderOccupant, []),
});

/** An account in it whose plaintext this script can recover by matching the pool the
 *  generator draws from — a thing only a harness standing outside the game can do. */
const recoverable = database.credentials.flatMap((credential) => {
  const password = ALL_GENERATED_PASSWORDS.find((word) => md5(word) === credential.passwordHash);
  return password === undefined ? [] : [{ username: credential.username, password }];
})[0];

if (recoverable === undefined) {
  console.error('This defender key drew no recoverable database account — rerun.');
  process.exit(2);
}

const firstTable = Object.keys(database.tables)[0];
const firstColumn = database.tables[firstTable]?.columns[0]?.name;

const clean = async (store: SupabaseClient) => {
  await store.from('home_network_occupants').delete().eq('essid', ESSID);
  await store.from('network_lan_leases').delete().eq('essid', ESSID);
  for (const id of [DEFENDER_WS, ATTACKER_WS]) {
    await store.from('patches').delete().eq('machine_id', id);
  }
};

await clean(sr);

// The defender joined the WiFi and was issued a lease; the attacker holds one too but
// is NOT yet on the network — the first check is what that difference is worth.
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
  failFast(`seed ${row.path}`, error);
};

// The defender's box as `systemctl start sshd`, `apt install mysql` and
// `systemctl start mysqld` leave it.
await seedPatch({
  machineId: DEFENDER_WS,
  path: pidfilePath(SERVICE_CATALOG.ssh),
  content: formatPidfileContent(SERVICE_CATALOG.ssh, SERVICE_CATALOG.ssh.defaultPort),
  writerKey: defender.publicKeyHex,
});
await seedPatch({
  machineId: DEFENDER_WS,
  path: pidfilePath(SERVICE_CATALOG.mysql),
  content: formatPidfileContent(SERVICE_CATALOG.mysql, SERVICE_CATALOG.mysql.defaultPort),
  writerKey: defender.publicKeyHex,
});
await seedPatch({
  machineId: DEFENDER_WS,
  path: DATADIR_PATH,
  content: JSON.stringify(database),
  writerKey: defender.publicKeyHex,
});
// The attacker's own wordlist, grown the only way a wordlist grows: by writing to a box.
await seedPatch({
  machineId: ATTACKER_WS,
  path: WORDLIST_PATH,
  content: formatWordlist(['hunter2', DEFENDER_GUEST_PW, recoverable.password]),
  writerKey: attacker.publicKeyHex,
});

const rowsOn = async (machineId: string, path: string) => {
  const { data } = await sr
    .from('patches')
    .select('content, writer_key')
    .eq('machine_id', machineId)
    .eq('path', path);
  return (data ?? []) as { content: string; writer_key: string }[];
};

const connectEnvelope = (over: Record<string, unknown> = {}) =>
  signRequest(attacker, 'mysqlConnect', {
    essid: ESSID,
    target_ip: DEFENDER_LAN_IP,
    port: SERVICE_CATALOG.mysql.defaultPort,
    username: recoverable.username,
    password: recoverable.password,
    // A claim the server must ignore on this vantage — the lease is the address.
    source_ip: '10.0.0.1',
    ...over,
  });

const sweepEnvelope = (over: Record<string, unknown> = {}) =>
  signRequest(attacker, 'hydraCrack', {
    essid: ESSID,
    target_ip: DEFENDER_LAN_IP,
    service: 'ssh',
    caller_machine_id: ATTACKER_WS,
    source_ip: '10.0.0.1',
    ...over,
  });

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

// --- 2. hydra reaches a fellow occupant at all — for ssh, which is not the database
//        door and is the whole point: the merge is the target resolution's. ---
const shellSweep = await post(await sweepEnvelope());
const guest = crackedIn(shellSweep.body).find((account) => account.username === 'guest');
check(
  '2. hydra earns a shell account on a real player box across the LAN',
  shellSweep.status === 200 && guest?.password === DEFENDER_GUEST_PW,
  `${shellSweep.status} ${textOf(shellSweep.body).slice(0, 140)}`,
);

// --- 3. …and the trace lands on THEIR box, under THEIR key, at the attacker's lease. ---
const authRows = await rowsOn(DEFENDER_WS, AUTH_LOG_PATH);
check(
  '3. the sweep is recorded on the target auth.log under the target owner key',
  authRows.length === 1 &&
    authRows[0]?.writer_key === defender.publicKeyHex &&
    (authRows[0]?.content ?? '').includes(ATTACKER_LAN_IP) &&
    !(authRows[0]?.content ?? '').includes('10.0.0.1'),
  `${authRows.length} row(s), writer=${authRows[0]?.writer_key?.slice(0, 12)}…`,
);

// --- 4. The same tool, the same address, the OTHER door. ---
const databaseSweep = await post(await sweepEnvelope({ service: 'mysql' }));
const account = crackedIn(databaseSweep.body)[0];
check(
  '4. hydra earns a database account on that same box',
  databaseSweep.status === 200 && account?.username === recoverable.username,
  `${databaseSweep.status} ${textOf(databaseSweep.body).slice(0, 140)}`,
);

// --- 5. …and mysql ACCEPTS it. Two tools agreeing about one box is the claim the
//        whole credential layer rests on. ---
const opened = await post(
  await connectEnvelope({
    username: account?.username ?? recoverable.username,
    password: account?.password ?? recoverable.password,
  }),
);
check(
  '5. the account hydra reported opens the database over the LAN',
  opened.status === 200 && textOf(opened.body).includes(DEFENDER_HOSTNAME),
  `${opened.status} ${textOf(opened.body)}`,
);

// --- 6. The defender's log is the DEFENDER's row, at the attacker's LEASED address. ---
const logRows = await rowsOn(DEFENDER_WS, MYSQL_LOG_PATH);
check(
  '6. the connection is logged on the target, under the target owner key',
  logRows.length === 1 && logRows[0]?.writer_key === defender.publicKeyHex,
  `${logRows.length} row(s), writer=${logRows[0]?.writer_key?.slice(0, 12)}…`,
);
check(
  '7. the logged source is the LEASED LAN address, not the one the client sent',
  (logRows[0]?.content ?? '').includes(ATTACKER_LAN_IP) &&
    !(logRows[0]?.content ?? '').includes('10.0.0.1'),
  (logRows[0]?.content ?? '').split('\n').at(-2) ?? '(empty)',
);

// --- 8. A statement that CHANGES the database lands on the defender's own datadir
//        row — not a second row under the attacker's key. ---
const mutated = await post(
  await signRequest(attacker, 'mysqlStatement', {
    essid: ESSID,
    target_ip: DEFENDER_LAN_IP,
    port: SERVICE_CATALOG.mysql.defaultPort,
    username: recoverable.username,
    password: recoverable.password,
    statement: `UPDATE ${firstTable} SET ${firstColumn} = 'owned'`,
    source_ip: '10.0.0.1',
  }),
);
const datadirRows = await rowsOn(DEFENDER_WS, DATADIR_PATH);
check(
  '8. a mutation across the room is answered',
  mutated.status === 200 && !textOf(mutated.body).includes('command denied'),
  `${mutated.status} ${textOf(mutated.body).slice(0, 120)}`,
);
check(
  '9. it lands on ONE datadir row, and that row is the defender own',
  datadirRows.length === 1 &&
    datadirRows[0]?.writer_key === defender.publicKeyHex &&
    (datadirRows[0]?.content ?? '').includes('owned'),
  `${datadirRows.length} row(s), writer=${datadirRows[0]?.writer_key?.slice(0, 12)}…`,
);

// --- 10. `nmcli disconnect`: the lease outlives the occupancy row, and occupancy IS
//         the reach — so the next statement finds nothing at their address. ---
const departure = async () => {
  await sr
    .from('home_network_occupants')
    .delete()
    .eq('essid', ESSID)
    .eq('owner_key', defender.publicKeyHex);
};

await departure();
const departed = await post(
  await signRequest(attacker, 'mysqlStatement', {
    essid: ESSID,
    target_ip: DEFENDER_LAN_IP,
    port: SERVICE_CATALOG.mysql.defaultPort,
    username: recoverable.username,
    password: recoverable.password,
    statement: 'SHOW TABLES',
    source_ip: '10.0.0.1',
  }),
);
check(
  '10. the defender leaving the WiFi drops the intruder on their next statement',
  departed.status === 404 && errorOf(departed.body) === 'host_unreachable',
  `${departed.status} ${errorOf(departed.body)}`,
);

// --- 11. The defender reconnects onto the octet a generated sibling already fills.
//         A real occupant beats it: the precedence `nmap` renders, proven live. ---
failFast(
  'defender rejoin',
  (await sr.from('home_network_occupants').insert({ essid: ESSID, ...defenderOccupant })).error,
);
failFast(
  'collision re-lease',
  (
    await sr
      .from('network_lan_leases')
      .update({ octet: NPC_OCTET })
      .eq('essid', ESSID)
      .eq('owner_key', defender.publicKeyHex)
  ).error,
);
const collided = await post(await sweepEnvelope({ target_ip: npcHost.ip }));
check(
  '11. a real occupant answers at an address the generator also filled',
  collided.status === 200 &&
    (collided.body as { port?: number } | null)?.port === SERVICE_CATALOG.ssh.defaultPort &&
    crackedIn(collided.body).some((cracked) => cracked.password === DEFENDER_GUEST_PW),
  `${collided.status} ${textOf(collided.body).slice(0, 140)}`,
);

// --- 12. …and it is a MERGE, not a takeover: when they leave again, the seeded box
//         underneath is what the address answers as. ---
await departure();
const handedBack = await post(await sweepEnvelope({ target_ip: npcHost.ip }));
check(
  '12. the address falls back to the generated sibling once the player leaves',
  // The PORT is what tells the boxes apart: the player's own sshd is on 22, the seeded
  // sibling's on its own. Their accounts cannot: both are drawn from one small pool,
  // and a shared guest password is exactly the coincidence this check hit first time.
  handedBack.status === 200 &&
    (handedBack.body as { port?: number } | null)?.port === NPC_SSH_PORT,
  `${handedBack.status} ${textOf(handedBack.body).slice(0, 140)}`,
);

await clean(sr);

const failed = results.filter((result) => !result.pass).length;
console.log(`
${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
