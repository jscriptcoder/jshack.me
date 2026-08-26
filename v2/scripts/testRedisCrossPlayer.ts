// Wire-payload smoke for the PUBLIC key-value vantage — B opens, reads and rewrites
// the store on A's own box, reached through the forward A opened on their AP.
// Drives the REAL /api/sessions endpoint against a running `vercel dev` + supabase,
// seeding A's network, box and store via service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - the `redisConnect` / `redisStatement` routes resolving a PUBLIC address: the
//     public-IP lookup, the gateway journal read for the forward table, the occupancy
//     and lease reads that say whose box the forward names, and that box's own journal
//     — every one a column selection no unit test can get wrong.
//   - hydra and redis-cli AGREEING across the network, in BOTH directions. A store's
//     lock mirrors the box's root password, so which answer is correct depends on where
//     that password came from: a chosen one is out of every wordlist the game hands out
//     and the sweep must report NOTHING, while one the generator could have drawn is one
//     hydra earns and `AUTH` then accepts. Only a live run proves both handlers resolve
//     the same box from the same address.
//   - the writer key every row lands under. A's datadir and A's redis.log must stay A's
//     OWN rows however many strangers write to them, because `patches` is keyed
//     `(machine_id, path, writer_key)` and a row per attacker would fold to whichever
//     was written last — silently dropping the rest of the store.
//   - the source IP in A's log, derived SERVER-side from the attacker's verified key.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testRedisCrossPlayer.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { lanAddressFor } from '../src/core/network/lanAddress';
import { materializeWorkstationFs } from '../src/core/network/materializeWorkstationFs';
import { ownStore } from '../src/core/redis/ownStore';
import { DATADIR_PATH } from '../src/core/redis/datadir';
import { REDIS_LOG_PATH } from '../src/core/logging/redisLog';
import { ALL_GENERATED_PASSWORDS } from '../src/core/generation/passwordPools';
import { formatPidfileContent, pidfilePath, PIDFILE_PERMISSIONS } from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
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

const crackedIn = (body: unknown): { username?: string; password?: string }[] =>
  ((body as { cracked?: { username?: string; password?: string }[] } | null)?.cracked ?? []);

// --- The DEFENDER owns a box on their own AP and published its store. The ATTACKER
//     lives on a different network and reaches it only by its public IP. ---
const defender = generateIdentity();
const attacker = generateIdentity();

const TARGET_ESSID = 'PIED-PIPER-GUEST';
const TARGET_PUBLIC_IP = '203.0.113.79';
const TARGET_GATEWAY = computeApGatewayId(TARGET_ESSID);
const DEFENDER_HOSTNAME = 'anton';
const DEFENDER_WS = computeWorkstationId(DEFENDER_HOSTNAME, defender.publicKeyHex);
const DEFENDER_OCTET = 23;
const DEFENDER_LAN_IP = lanAddressFor(TARGET_ESSID, DEFENDER_OCTET);
// The door the defender opened. Deliberately neither 6379 nor 22: on a public address
// the port is whatever whoever wrote the forward chose.
const FORWARD_PORT = 46379;

const ATTACKER_ESSID = 'BEAN-THERE-WIFI';
const ATTACKER_PUBLIC_IP = '198.51.100.46';
const ATTACKER_WS = computeWorkstationId('cracklab', attacker.publicKeyHex);
// The address the attacker's own client claims. Never what a defender's log records.
const CLAIMED_SOURCE = '10.0.0.1';

/** The password the defender CHOSE. A real player types this into setup, so no wordlist
 *  the game hands out contains it — which is the whole of why their store holds. */
const CHOSEN_ROOT_PW = 'correct-horse-battery-staple';
/** …and a password the generator itself could have drawn, for the second half. The same
 *  box, the same door, a root password from the pool — and now the sweep bites. */
const DRAWN_ROOT_PW = ALL_GENERATED_PASSWORDS[0];
if (DRAWN_ROOT_PW === undefined) {
  console.error('the generator draws from an empty pool — rerun');
  process.exit(2);
}

const occupantWithRoot = (rootPassword: string) => ({
  owner_key: defender.publicKeyHex,
  workstation_machine_id: DEFENDER_WS,
  workstation_username: 'gilfoyle',
  workstation_machine_name: DEFENDER_HOSTNAME,
  workstation_root_hash: md5(rootPassword),
});

/** The store `apt install redis` writes onto the defender's box — drawn from their own
 *  key, and locked to whatever `/etc/passwd` says root's password is. Recomputed rather
 *  than edited when the root password changes, because the mirror is the point. */
const storeFor = (rootPassword: string) => {
  const occupant = occupantWithRoot(rootPassword);
  return ownStore({
    ownerKeyHex: defender.publicKeyHex,
    hostname: DEFENDER_HOSTNAME,
    fs: materializeWorkstationFs(occupant, []),
  });
};

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

const seedOccupants = async (rootPassword: string) => {
  await sr.from('home_network_occupants').delete().eq('essid', TARGET_ESSID);
  await sr.from('home_network_occupants').insert({
    essid: TARGET_ESSID,
    ...occupantWithRoot(rootPassword),
  });
};

await seedOccupants(CHOSEN_ROOT_PW);
await sr.from('home_network_occupants').insert({
  essid: ATTACKER_ESSID,
  owner_key: attacker.publicKeyHex,
  workstation_machine_id: ATTACKER_WS,
  workstation_username: 'mallory',
  workstation_machine_name: 'cracklab',
  workstation_root_hash: md5('attacker-root-secret'),
});

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
 *  store has no address an outsider can name. */
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

const seedStore = (rootPassword: string) =>
  seedPatch({
    machineId: DEFENDER_WS,
    path: DATADIR_PATH,
    content: JSON.stringify(storeFor(rootPassword)),
    writerKey: defender.publicKeyHex,
  });

// The defender's box as `apt install redis` + `systemctl start redis` leave it.
await seedPatch({
  machineId: DEFENDER_WS,
  path: pidfilePath(SERVICE_CATALOG.redis),
  content: formatPidfileContent(SERVICE_CATALOG.redis, SERVICE_CATALOG.redis.defaultPort),
  writerKey: defender.publicKeyHex,
});
await seedStore(CHOSEN_ROOT_PW);
await seedPatch({
  machineId: ATTACKER_WS,
  path: WORDLIST_PATH,
  content: formatWordlist(['hunter2', DRAWN_ROOT_PW]),
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

const connectEnvelope = () =>
  signRequest(attacker, 'redisConnect', {
    essid: ATTACKER_ESSID,
    target_ip: TARGET_PUBLIC_IP,
    port: FORWARD_PORT,
    source_ip: CLAIMED_SOURCE,
  });

const statementEnvelope = (statement: string, password?: string) =>
  signRequest(attacker, 'redisStatement', {
    essid: ATTACKER_ESSID,
    target_ip: TARGET_PUBLIC_IP,
    port: FORWARD_PORT,
    statement,
    ...(password === undefined ? {} : { password }),
    source_ip: CLAIMED_SOURCE,
  });

const sweepEnvelope = () =>
  signRequest(attacker, 'hydraCrackPublic', {
    essid: ATTACKER_ESSID,
    target: TARGET_PUBLIC_IP,
    port: FORWARD_PORT,
    service: 'redis',
    caller_machine_id: ATTACKER_WS,
  });

// --- 1. No forward, no door: running a store is not publishing one. ---
const unpublished = await post(await connectEnvelope());
check(
  '1. a store its owner never forwarded is unreachable',
  unpublished.status === 404 && errorOf(unpublished.body) === 'host_unreachable',
  `${unpublished.status} ${errorOf(unpublished.body)}`,
);

await seedForward(SERVICE_CATALOG.redis.defaultPort);

// --- 2. The connection opens for anybody, and names the BOX. The address named an
//        access point; which machine answered is something only the forward knows. ---
const opened = await post(await connectEnvelope());
check(
  '2. the store opens through the published port, and names the box behind it',
  opened.status === 200 && textOf(opened.body).includes(DEFENDER_HOSTNAME),
  `${opened.status} ${textOf(opened.body)}`,
);

// --- 3. …and the first question is refused, because a store between players is
//        ALWAYS locked. The lock is on the questions, never on the door. ---
const unauthed = await post(await statementEnvelope('KEYS *'));
check(
  '3. the first statement is refused: a player store is always locked',
  unauthed.status === 200 && textOf(unauthed.body).includes('NOAUTH'),
  `${unauthed.status} ${textOf(unauthed.body).slice(0, 120)}`,
);

// --- 4. The DEAD END. The defender chose their root password, so no wordlist the game
//        hands out contains it and the sweep must come back with nothing. This is the
//        design, not a gap: the store is out of a sweep's reach on purpose. ---
const sweptChosen = await post(await sweepEnvelope());
check(
  '4. hydra finds nothing against a lock the player chose themselves',
  sweptChosen.status === 200 && crackedIn(sweptChosen.body).length === 0,
  `${sweptChosen.status} ${textOf(sweptChosen.body).slice(0, 140)}`,
);

// --- 5. Which leaves exactly one way in: hold the password because you took the box.
//        `AUTH` spends it, and the store opens. ---
const authed = await post(await statementEnvelope('KEYS *', CHOSEN_ROOT_PW));
check(
  '5. the password the defender chose for root opens their store',
  authed.status === 200 && !textOf(authed.body).includes('NOAUTH'),
  `${authed.status} ${textOf(authed.body).slice(0, 140)}`,
);

// --- 6. A statement that CHANGES the store lands on the defender's own datadir row —
//        not a second row under the attacker's key, which would fold to whichever was
//        written last and drop the other's store. ---
const mutated = await post(await statementEnvelope('SET intruder:was-here yes', CHOSEN_ROOT_PW));
const datadirRows = await rowOn(DEFENDER_WS, DATADIR_PATH);
check(
  '6. a rewrite across the world is answered',
  mutated.status === 200 && !textOf(mutated.body).includes('NOAUTH'),
  `${mutated.status} ${textOf(mutated.body).slice(0, 120)}`,
);
check(
  '7. it lands on ONE datadir row, and that row is the defender own',
  datadirRows.length === 1 &&
    datadirRows[0]?.writer_key === defender.publicKeyHex &&
    (datadirRows[0]?.content ?? '').includes('intruder:was-here'),
  `${datadirRows.length} row(s), writer=${datadirRows[0]?.writer_key?.slice(0, 12)}…`,
);

// --- 8. The defender's log is the DEFENDER's row, at the attacker's real address. ---
const logRows = await rowOn(DEFENDER_WS, REDIS_LOG_PATH);
check(
  '8. the visit is logged on the target, under the target owner key',
  logRows.length === 1 && logRows[0]?.writer_key === defender.publicKeyHex,
  `${logRows.length} row(s), writer=${logRows[0]?.writer_key?.slice(0, 12)}…`,
);
check(
  '9. the logged source IP is the one the SERVER derived, not the one sent',
  (logRows[0]?.content ?? '').includes(ATTACKER_PUBLIC_IP) &&
    !(logRows[0]?.content ?? '').includes(CLAIMED_SOURCE),
  (logRows[0]?.content ?? '').split('\n').at(-2) ?? '(empty)',
);

// --- 10. The CHAIN. Same box, same door — but this defender's root password is one the
//         generator itself draws, so it is in the wordlist and hydra bites. ---
await seedOccupants(DRAWN_ROOT_PW);
await seedStore(DRAWN_ROOT_PW);
const sweptDrawn = await post(await sweepEnvelope());
const cracked = crackedIn(sweptDrawn.body)[0];
check(
  '10. hydra earns a store password that came from the pool',
  sweptDrawn.status === 200 && cracked?.password === DRAWN_ROOT_PW,
  `${sweptDrawn.status} ${textOf(sweptDrawn.body).slice(0, 140)}`,
);
check(
  '11. and reports it with NO login field: a store has one lock, not accounts',
  cracked !== undefined && cracked.username === undefined,
  `username=${String(cracked?.username)}`,
);

// --- 12. …and redis-cli then ACCEPTS it. The two tools agreeing about one box is the
//         claim the whole credential layer rests on, and only a live run proves it. ---
const spent = await post(await statementEnvelope('DBSIZE', cracked?.password ?? DRAWN_ROOT_PW));
check(
  '12. the password hydra reported opens the store',
  spent.status === 200 && !textOf(spent.body).includes('NOAUTH'),
  `${spent.status} ${textOf(spent.body).slice(0, 120)}`,
);

// --- 13. The defender pulls the forward: the next statement finds nothing. ---
await dropForward();
const revoked = await post(await statementEnvelope('DBSIZE', DRAWN_ROOT_PW));
check(
  '13. pulling the forward drops the intruder on their next statement',
  revoked.status === 404 && errorOf(revoked.body) === 'host_unreachable',
  `${revoked.status} ${errorOf(revoked.body)}`,
);

await clean();

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
