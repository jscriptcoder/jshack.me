// Wire-payload smoke for the DATABASE DOOR ON A DEEP LAYER — `mysqlConnect` and
// `mysqlStatement` reached through a NAT forward on the player's own inner gateway.
// Drives the REAL /api/sessions + /api/patches endpoints against a running
// `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - Both database actions ROUTE THROUGH A FORWARD at all. Unit tests call the
//     handlers directly, so a chain resolver wired only into ssh stays green there.
//   - The address is the ROUTE's. Behind NAT the deep box has only ever seen the
//     fronting gateway's `.1`, so the refusal the player reads and the line the
//     defender finds must be that one string — asserted here against the row the
//     table really holds, not against a spy.
//   - Every write lands on the DEEP box's machine id. The gateway carried the packet
//     and ran nothing; a row filed against it is a change that reaches no database.
//   - The GATEWAY records NOTHING. NAT does not log, and an absence is a thing no
//     injected `upsertPatch` can prove.
//   - The terminal deep box's JOURNAL is replayed. The chain resolver hands back a
//     seeded tree, so a datadir edited down here is written and never read back
//     unless the door materializes on top of it.
//   - A stopped mysqld and a pulled forward both refuse mid-session, which is what
//     the client turns into `ERROR 2013`.
//   - NO row appears in `sessions` — this door holds no session at any depth.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMysqlDeep.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable network.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan';
import { crackableEssidPool } from '../src/core/generation/generateWifi';
import { buildDeepHostFs, generateDeepLayer } from '../src/core/generation/generateDeepLayer';
import { computeInnerGatewayId } from '../src/core/identity/router';
import { hostMachineId } from '../src/core/generation/remoteHostId';
import { databaseIn } from '../src/core/mysql/datadir';
import { readOpenPorts } from '../src/core/services/pidfile';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { ALL_GENERATED_PASSWORDS } from '../src/core/generation/passwordPools';
import { md5 } from '../src/core/generation/md5';
import { DATADIR_FILE } from '../src/core/generation/baseFs';
import { MYSQL_LOG_OWNER, MYSQL_LOG_PATH } from '../src/core/logging/mysqlLog';
import { WORDLIST_PATH, formatWordlist } from '../src/core/wordlist/defaultWordlist';
import type { MysqlDatabase } from '../src/core/mysql/types';

const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
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

const post = async (
  endpoint: string,
  envelope: unknown,
): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const errorOf = (body: unknown): string | undefined =>
  (body as { error?: string } | null)?.error;
const outputOf = (body: unknown): readonly string[] =>
  (body as { output?: readonly string[] } | null)?.output ?? [];

// --- The network. Both facts are per-network rolls — a twelfth of layers run a
//     database, and only some carry an account whose plaintext is recoverable — so
//     the ESSID is SEARCHED for. Naming one would leave this passing on a fixture
//     and failing on a re-roll. ---
const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

type DeepTarget = {
  readonly essid: string;
  readonly gateway: LanHost;
  readonly gatewayId: string;
  readonly deepIp: string;
  readonly deepId: string;
  readonly hostname: string;
  readonly natIp: string;
  readonly database: MysqlDatabase;
};

const deepDatabaseOn = (essid: string): DeepTarget | null => {
  const gateway = generateHomeLan(essid).hosts.find(
    (host) => host.kind === 'router' && octetOf(host) !== 1,
  );
  if (gateway === undefined) return null;
  const gatewayId = computeInnerGatewayId(essid, octetOf(gateway));
  const layer = generateDeepLayer(essid, { machineId: gatewayId, kind: 'router' });
  const fs = buildDeepHostFs(essid, layer.host);
  const database = databaseIn(fs);
  if (database === null) return null;
  if (!readOpenPorts(fs).some((open) => open.service === SERVICE_CATALOG.mysql.service)) return null;
  const recoverable = database.credentials.some((credential) =>
    ALL_GENERATED_PASSWORDS.some((word) => md5(word) === credential.passwordHash),
  );
  if (!recoverable) return null;
  return {
    essid,
    gateway,
    gatewayId,
    deepIp: layer.host.ip,
    deepId: hostMachineId(layer.host, essid),
    hostname: layer.host.hostname,
    natIp: `${layer.subnet}.1`,
    database,
  };
};

const essid = crackableEssidPool.find((candidate) => deepDatabaseOn(candidate) !== null);
const target = essid === undefined ? null : deepDatabaseOn(essid);

if (target === null) {
  console.error('no network in the crackable pool fronts a deep database');
  process.exit(2);
}

const alice = generateIdentity();
const CLIENT_IP = '192.168.1.50';
const FORWARD_PORT = 33306;
const RULES = '/etc/iptables/rules.v4';
const DATADIR_PATH = '/var/lib/mysql/data.json';
const PIDFILE = `/var/run/${SERVICE_CATALOG.mysql.pidfile}`;
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };

// Planted rather than found, for the tier checks only: which rungs a generated
// database carries is a roll, and a Denied line needs an account that cannot write.
const ROOT_PW = 'let-me-in';
const GUEST_PW = 'let-me-look';
const laddered = JSON.stringify({
  ...target.database,
  credentials: [
    { username: 'dba', passwordHash: md5(ROOT_PW), userType: 'root' },
    { username: 'readonly', passwordHash: md5(GUEST_PW), userType: 'guest' },
  ],
});

const forwardTable = `# NAT port-forward table\nforward ${FORWARD_PORT} to ${target.deepIp}:3306\n`;

const connect = (username: string, password: string, port = FORWARD_PORT) =>
  post(
    SESSIONS,
    signRequest(alice, 'mysqlConnect', {
      essid: target.essid,
      target_ip: target.gateway.ip,
      port,
      username,
      password,
      source_ip: CLIENT_IP,
    }),
  );

const statement = (username: string, password: string, line: string, port = FORWARD_PORT) =>
  post(
    SESSIONS,
    signRequest(alice, 'mysqlStatement', {
      essid: target.essid,
      target_ip: target.gateway.ip,
      port,
      username,
      password,
      statement: line,
      source_ip: CLIENT_IP,
    }),
  );

const rowAt = async (machineId: string, path: string) => {
  const { data } = await sr
    .from('patches')
    .select('content, owner, machine_id')
    .eq('machine_id', machineId)
    .eq('path', path)
    .maybeSingle();
  if (typeof data !== 'object' || data === null) return null;
  const at = (field: string): unknown => Object.getOwnPropertyDescriptor(data, field)?.value;
  return {
    content: typeof at('content') === 'string' ? String(at('content')) : null,
    owner: typeof at('owner') === 'string' ? String(at('owner')) : null,
  };
};

/** Plant a row as service_role — the deep box's own state, which no player-signed
 *  write could reach without first rooting it. */
const plant = async (machineId: string, path: string, content: string | null) => {
  await sr.from('patches').upsert(
    {
      writer_key: alice.publicKeyHex,
      machine_id: machineId,
      path,
      content,
      owner: 'root',
      permissions: DATADIR_FILE,
      node_type: 'file',
      is_new: false,
    },
    { onConflict: 'writer_key,machine_id,path' },
  );
};

const main = async (): Promise<void> => {
  console.log(
    `essid ${target.essid} — gateway ${target.gateway.ip}, deep box ${target.hostname} ` +
      `${target.deepIp} behind NAT at ${target.natIp}, database "${target.database.name}"\n`,
  );

  await sr.from('patches').delete().eq('machine_id', target.gatewayId);
  await sr.from('patches').delete().eq('machine_id', target.deepId);
  // By session_id as well as player_key: the id is derived from the gateway and is
  // therefore the SAME every run, while alice is a fresh identity each time. Deleting
  // only her own rows leaves the previous run's row holding the id, and the insert
  // below fails on it — which would read here as "the door refused her", not as a
  // dirty table.
  const gatewaySession = `ssh-alice-gw-${target.gatewayId}`;
  await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);
  await sr.from('sessions').delete().eq('session_id', gatewaySession);
  const seeded = await sr.from('sessions').insert({
    session_id: gatewaySession,
    player_key: alice.publicKeyHex,
    machine_id: target.gatewayId,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid: target.essid,
  });
  if (seeded.error !== null) {
    console.error(`could not seed alice's root session on the gateway: ${seeded.error.message}`);
    process.exit(2);
  }

  const opened = await post(
    PATCHES,
    signRequest(alice, 'upsertPatch', {
      machine_id: target.gatewayId,
      path: RULES,
      content: forwardTable,
      owner: 'root',
      permissions: ROOT_ONLY,
      node_type: 'file',
    }),
  );
  check(
    'alice opens the forward on her own gateway rules.v4',
    opened.status === 200,
    `status=${opened.status} error=${errorOf(opened.body) ?? '-'}`,
  );

  // 1. The generated box's OWN credential, through the forward. Proves the generator
  //    and the live door agree about what opens this database.
  const own = target.database.credentials.flatMap((credential) => {
    const password = ALL_GENERATED_PASSWORDS.find((word) => md5(word) === credential.passwordHash);
    return password === undefined ? [] : [{ username: credential.username, password }];
  })[0];
  if (own === undefined) throw new Error('no recoverable account on the deep database');

  const login = await connect(own.username, own.password);
  check(
    'a deep database account opens through the forward, and the answer names the box',
    login.status === 200 &&
      JSON.stringify(login.body) === JSON.stringify({ ok: true, hostname: target.hostname }),
    `status=${login.status} body=${JSON.stringify(login.body)}`,
  );

  // 2. The line lands on the DEEP box, at the address NAT showed it.
  const deepLog = await rowAt(target.deepId, MYSQL_LOG_PATH);
  check(
    'the connection is recorded on the DEEP box, naming the fronting gateway .1',
    (deepLog?.content ?? '').includes(`${own.username}@${target.natIp}`) &&
      !(deepLog?.content ?? '').includes(CLIENT_IP),
    `${target.deepId}${MYSQL_LOG_PATH}: ${(deepLog?.content ?? 'no row').trim()}`,
  );
  check(
    'and it is root-owned, so a visitor cannot edit the record of their visit',
    deepLog?.owner === MYSQL_LOG_OWNER,
    `owner=${deepLog?.owner}`,
  );

  // 3. The gateway records NOTHING. NAT carried the packet and ran no daemon.
  const gatewayLog = await rowAt(target.gatewayId, MYSQL_LOG_PATH);
  check(
    'the GATEWAY records nothing — NAT does not log',
    gatewayLog === null,
    gatewayLog === null ? 'no mysql.log row on the gateway' : `unexpected row: ${gatewayLog.content}`,
  );

  // 4. No session at any depth.
  const { count } = await sr
    .from('sessions')
    .select('session_id', { count: 'exact', head: true })
    .eq('player_key', alice.publicKeyHex)
    .eq('machine_id', target.deepId);
  check(
    'the database door holds no session on the deep box',
    (count ?? 0) === 0,
    `sessions on ${target.deepId}: ${count ?? 0}`,
  );

  // 5. hydra down the SAME forward reaches the same database. The deep layer has no
  //    address a shell can name, so the sweep is the only way to learn these accounts
  //    — and it must answer with the DATABASE's, not the box's unix ones.
  await sr.from('patches').upsert(
    {
      machine_id: target.gatewayId,
      path: WORDLIST_PATH,
      writer_key: alice.publicKeyHex,
      content: formatWordlist([own.password, 'not-a-password']),
      owner: 'root',
      node_type: 'file',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  const swept = await post(
    SESSIONS,
    signRequest(alice, 'hydraCrackInnerGateway', {
      essid: target.essid,
      target: target.gateway.ip,
      service: 'mysql',
      port: FORWARD_PORT,
      caller_machine_id: target.gatewayId,
    }),
  );
  const cracked = (swept.body as { cracked?: { username: string; password: string }[] } | null)
    ?.cracked ?? [];
  check(
    'hydra down the same forward hands back the DEEP database accounts',
    swept.status === 200 &&
      cracked.some(
        (found) => found.username === own.username && found.password === own.password,
      ),
    `status=${swept.status} cracked=${JSON.stringify(cracked)}`,
  );

  // 6. A statement answers from the deep box's own datadir — through the journal,
  //    which is the hop the chain resolver hands back unreplayed.
  await plant(target.deepId, DATADIR_PATH, laddered);
  const shown = await statement('dba', ROOT_PW, 'SHOW TABLES');
  const tables = Object.keys(target.database.tables);
  check(
    'a statement answers from the deep datadir as the JOURNAL holds it',
    shown.status === 200 && tables.every((table) => outputOf(shown.body).join('\n').includes(table)),
    `status=${shown.status} tables=${tables.join(',')} output=${outputOf(shown.body).join(' | ')}`,
  );

  // 6. A refused write names the NAT address in BOTH places at once.
  const firstTable = tables[0] ?? 'orders';
  const denied = await statement('readonly', GUEST_PW, `DROP TABLE ${firstTable}`);
  check(
    'a refused write names the address NAT showed the box, not the caller claim',
    outputOf(denied.body).join('\n').includes(`'readonly'@'${target.natIp}'`) &&
      !outputOf(denied.body).join('\n').includes(CLIENT_IP),
    `output=${outputOf(denied.body).join(' | ')}`,
  );
  const afterDenied = await rowAt(target.deepId, MYSQL_LOG_PATH);
  check(
    'and the Denied line on the deep box names the SAME address',
    (afterDenied?.content ?? '').includes(`Denied`) &&
      (afterDenied?.content ?? '').includes(`'readonly'@'${target.natIp}'`),
    `${(afterDenied?.content ?? 'no row').trim().split('\n').slice(-1)[0]}`,
  );

  // 7. A write lands on the DEEP box's machine id.
  await statement('dba', ROOT_PW, `DROP TABLE ${firstTable}`);
  const datadirRow = await rowAt(target.deepId, DATADIR_PATH);
  const gatewayDatadir = await rowAt(target.gatewayId, DATADIR_PATH);
  check(
    'a change lands on the DEEP box datadir, and none on the gateway',
    datadirRow !== null &&
      !(datadirRow.content ?? '').includes(`"${firstTable}"`) &&
      gatewayDatadir === null,
    `deep row ${datadirRow === null ? 'missing' : 'present'}, gateway row ${gatewayDatadir === null ? 'absent' : 'PRESENT'}`,
  );

  // 8. A pulled forward drops the player — re-resolved per statement, not held.
  const pulled = await statement('dba', ROOT_PW, 'SHOW TABLES', FORWARD_PORT + 1);
  check(
    'a forward the gateway does not carry refuses, which the client reads as a lost connection',
    pulled.status === 404 && errorOf(pulled.body) === 'host_unreachable',
    `status=${pulled.status} error=${errorOf(pulled.body) ?? '-'}`,
  );

  // 9. A stopped mysqld does the same, by the same path.
  await plant(target.deepId, PIDFILE, null);
  const stopped = await statement('dba', ROOT_PW, 'SHOW TABLES');
  check(
    'a stopped mysqld refuses mid-session, and says so as a stopped daemon rather than a missing box',
    stopped.status === 404 && errorOf(stopped.body) === 'service_not_running',
    `status=${stopped.status} error=${errorOf(stopped.body) ?? '-'}`,
  );

  const failed = results.filter(({ pass }) => !pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

await main();
