// Wire-payload smoke for the PUBLIC database vantage — B cracks and then uses an
// account in A's own database, reached through the forward A opened on their AP.
// Drives the REAL /api/sessions endpoint against a running `vercel dev` + supabase,
// seeding A's network, box and database via service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - the `mysqlConnect` / `mysqlStatement` routes resolving a PUBLIC address: the
//     public-IP lookup, the gateway journal read for the forward table, the occupancy
//     and lease reads that say whose box the forward names, and that box's own journal
//     — every one a column selection no unit test can get wrong.
//   - hydra and mysql AGREEING across the network: the account the sweep reports is
//     posted straight to `mysqlConnect`, which must accept it. Only a live run proves
//     both handlers resolve the same box from the same address.
//   - the writer key every row lands under. A's datadir and A's mysql.log must stay
//     A's OWN rows however many strangers write to them, because `patches` is keyed
//     `(machine_id, path, writer_key)` and a row per attacker would fold to whichever
//     was written last — silently dropping the rest of the database.
//   - the source IP in A's log, derived SERVER-side from the attacker's verified key.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMysqlCrossPlayer.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { lanAddressFor } from '../src/core/network/lanAddress';
import { materializeWorkstationFs } from '../src/core/network/materializeWorkstationFs';
import { ownDatabase } from '../src/core/mysql/ownDatabase';
import { DATADIR_PATH } from '../src/core/mysql/datadir';
import { ALL_GENERATED_PASSWORDS } from '../src/core/generation/passwordPools';
import { formatPidfileContent, pidfilePath, PIDFILE_PERMISSIONS } from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { MYSQL_LOG_PATH } from '../src/core/logging/mysqlLog';
import { WORDLIST_PATH, formatWordlist } from '../src/core/wordlist/defaultWordlist';
import { md5 } from '../src/core/generation/md5';
import { clearPublicIps, seedPublicIps } from './networkFixture';

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

// --- The DEFENDER owns a box on their own AP and published its database. The
//     ATTACKER lives on a different network and reaches it only by its public IP. ---
const defender = generateIdentity();
const attacker = generateIdentity();

const TARGET_ESSID = 'PIED-PIPER-GUEST';
const TARGET_PUBLIC_IP = '203.0.113.78';
const TARGET_GATEWAY = computeApGatewayId(TARGET_ESSID);
const DEFENDER_HOSTNAME = 'anton';
const DEFENDER_WS = computeWorkstationId(DEFENDER_HOSTNAME, defender.publicKeyHex);
const DEFENDER_OCTET = 23;
const DEFENDER_LAN_IP = lanAddressFor(TARGET_ESSID, DEFENDER_OCTET);
// The door the defender opened. Deliberately neither 3306 nor 22: on a public address
// the port is whatever whoever wrote the forward chose.
const FORWARD_PORT = 43306;

const ATTACKER_ESSID = 'BEAN-THERE-WIFI';
const ATTACKER_PUBLIC_IP = '198.51.100.45';
const ATTACKER_WS = computeWorkstationId('cracklab', attacker.publicKeyHex);

const defenderOccupant = {
  owner_key: defender.publicKeyHex,
  workstation_machine_id: DEFENDER_WS,
  workstation_username: 'gilfoyle',
  workstation_machine_name: DEFENDER_HOSTNAME,
  workstation_root_hash: md5('defender-root-secret'),
};

// The database `apt install mysql` writes onto the defender's box — drawn from their
// own key, so it is theirs and nobody else's.
const database = ownDatabase({
  ownerKeyHex: defender.publicKeyHex,
  hostname: DEFENDER_HOSTNAME,
  fs: materializeWorkstationFs(defenderOccupant, []),
});

/** An account in it whose plaintext this script can recover by matching the pool the
 *  generator draws from — which is a thing only a harness standing outside the game
 *  can do, and the reason the sweep below has something to find. */
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

const clean = async () => {
  await clearPublicIps(sr, [
    { essid: TARGET_ESSID, publicIp: TARGET_PUBLIC_IP },
    { essid: ATTACKER_ESSID, publicIp: ATTACKER_PUBLIC_IP },
  ]);
  for (const essid of [TARGET_ESSID, ATTACKER_ESSID]) {
    await sr.from('home_network_occupants').delete().eq('essid', essid);
    await sr.from('network_lan_leases').delete().eq('essid', essid);
  }
  for (const id of [TARGET_GATEWAY, DEFENDER_WS, ATTACKER_WS]) {
    await sr.from('patches').delete().eq('machine_id', id);
  }
};

await clean();

await seedPublicIps(sr, [
  { essid: TARGET_ESSID, publicIp: TARGET_PUBLIC_IP },
  { essid: ATTACKER_ESSID, publicIp: ATTACKER_PUBLIC_IP },
]);
await sr
  .from('network_lan_leases')
  .insert({ essid: TARGET_ESSID, owner_key: defender.publicKeyHex, octet: DEFENDER_OCTET });
await sr.from('home_network_occupants').insert([
  { essid: TARGET_ESSID, ...defenderOccupant },
  {
    essid: ATTACKER_ESSID,
    owner_key: attacker.publicKeyHex,
    workstation_machine_id: ATTACKER_WS,
    workstation_username: 'mallory',
    workstation_machine_name: 'cracklab',
    workstation_root_hash: md5('attacker-root-secret'),
  },
]);

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
  if (error) throw new Error(`seed failed for ${row.path}: ${error.message}`);
};

/** The forward the defender wrote with `nano` on their own router. Without it their
 *  database has no address an outsider can name. */
const seedForward = (internalPort: number) =>
  seedPatch({
    machineId: TARGET_GATEWAY,
    path: '/etc/iptables/rules.v4',
    content: `forward ${FORWARD_PORT} to ${DEFENDER_LAN_IP}:${internalPort}`,
    writerKey: defender.publicKeyHex,
  });

const dropForward = async () => {
  await sr
    .from('patches')
    .delete()
    .eq('machine_id', TARGET_GATEWAY)
    .eq('path', '/etc/iptables/rules.v4');
};

// The defender's box as `apt install mysql` + `systemctl start mysqld` leave it.
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
await seedPatch({
  machineId: ATTACKER_WS,
  path: WORDLIST_PATH,
  content: formatWordlist(['hunter2', recoverable.password]),
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

const connectEnvelope = (over: Record<string, unknown> = {}) =>
  signRequest(attacker, 'mysqlConnect', {
    essid: ATTACKER_ESSID,
    target_ip: TARGET_PUBLIC_IP,
    port: FORWARD_PORT,
    username: recoverable.username,
    password: recoverable.password,
    source_ip: '10.0.0.1',
    ...over,
  });

// --- 1. No forward, no door: running a database is not publishing one. ---
const unpublished = await post(await connectEnvelope());
check(
  '1. a database its owner never forwarded is unreachable',
  unpublished.status === 404 && errorOf(unpublished.body) === 'host_unreachable',
  `${unpublished.status} ${errorOf(unpublished.body)}`,
);

await seedForward(SERVICE_CATALOG.mysql.defaultPort);

// --- 2. hydra earns an account in a stranger's database, over the network. ---
const swept = await post(
  await signRequest(attacker, 'hydraCrackPublic', {
    essid: ATTACKER_ESSID,
    target: TARGET_PUBLIC_IP,
    port: FORWARD_PORT,
    service: 'mysql',
    caller_machine_id: ATTACKER_WS,
  }),
);
const cracked = ((swept.body as { cracked?: { username: string; password: string }[] } | null)
  ?.cracked ?? [])[0];
check(
  '2. hydra earns a database account through the published port',
  swept.status === 200 && cracked?.username === recoverable.username,
  `${swept.status} ${textOf(swept.body)}`,
);

// --- 3. …and mysql then ACCEPTS it. The two tools agreeing about one box is the
//        claim the whole credential layer rests on. ---
const opened = await post(
  await connectEnvelope({
    username: cracked?.username ?? recoverable.username,
    password: cracked?.password ?? recoverable.password,
  }),
);
check(
  '3. the account hydra reported opens the database',
  opened.status === 200 && textOf(opened.body).includes(DEFENDER_HOSTNAME),
  `${opened.status} ${textOf(opened.body)}`,
);

// --- 4. The defender's log is the DEFENDER's row, at the attacker's real address. ---
const logRows = await rowOn(DEFENDER_WS, MYSQL_LOG_PATH);
check(
  '4. the connection is logged on the target, under the target owner key',
  logRows.length === 1 && logRows[0]?.writer_key === defender.publicKeyHex,
  `${logRows.length} row(s), writer=${logRows[0]?.writer_key?.slice(0, 12)}…`,
);
check(
  '5. the logged source IP is the one the SERVER derived, not the one sent',
  (logRows[0]?.content ?? '').includes(ATTACKER_PUBLIC_IP) &&
    !(logRows[0]?.content ?? '').includes('10.0.0.1'),
  (logRows[0]?.content ?? '').split('\n').at(-2) ?? '(empty)',
);

// --- 6. A statement that CHANGES the database lands on the defender's own datadir
//        row — not a second row under the attacker's key, which would fold to
//        whichever was written last and drop the other's database. ---
const mutated = await post(
  await signRequest(attacker, 'mysqlStatement', {
    essid: ATTACKER_ESSID,
    target_ip: TARGET_PUBLIC_IP,
    port: FORWARD_PORT,
    username: recoverable.username,
    password: recoverable.password,
    statement: `UPDATE ${firstTable} SET ${firstColumn} = 'owned'`,
    source_ip: '10.0.0.1',
  }),
);
const datadirRows = await rowOn(DEFENDER_WS, DATADIR_PATH);
check(
  '6. a mutation across the world is answered',
  mutated.status === 200 && !textOf(mutated.body).includes('command denied'),
  `${mutated.status} ${textOf(mutated.body).slice(0, 120)}`,
);
check(
  '7. it lands on ONE datadir row, and that row is the defender own',
  datadirRows.length === 1 &&
    datadirRows[0]?.writer_key === defender.publicKeyHex &&
    (datadirRows[0]?.content ?? '').includes('owned'),
  `${datadirRows.length} row(s), writer=${datadirRows[0]?.writer_key?.slice(0, 12)}…`,
);

// --- 8. The defender pulls the forward: the next statement finds nothing. ---
await dropForward();
const revoked = await post(
  await signRequest(attacker, 'mysqlStatement', {
    essid: ATTACKER_ESSID,
    target_ip: TARGET_PUBLIC_IP,
    port: FORWARD_PORT,
    username: recoverable.username,
    password: recoverable.password,
    statement: 'SHOW TABLES',
    source_ip: '10.0.0.1',
  }),
);
check(
  '8. pulling the forward drops the intruder on their next statement',
  revoked.status === 404 && errorOf(revoked.body) === 'host_unreachable',
  `${revoked.status} ${errorOf(revoked.body)}`,
);

await clean();

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
