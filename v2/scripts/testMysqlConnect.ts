// Wire-payload smoke for the DATABASE LOGIN — `mysqlConnect`.
// Drives the REAL /api/sessions endpoint against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - The `mysqlConnect` action is DISPATCHED at all. A new action on an existing
//     endpoint is the one thing no unit test can see: the handler is called directly
//     there, so a route that never routes to it stays green all the way to production.
//   - A datadir account with its real password opens the database; the box's own unix
//     root password does not, on the same box, through the same door.
//   - A wrong password and an account the database has never held come back
//     IDENTICAL — same status, same body — over the wire and not merely in a return
//     value a test read directly.
//   - The connect line lands at the TARGET's `/var/log/mysql.log`, root-owned and
//     root-write. Unit tests inject a fake `upsertPatch`, so which machine_id and path
//     a row lands at, and whether the table accepts its owner and permissions, is
//     asserted against a spy rather than against the table.
//   - NO row appears in `sessions`. That is the whole mechanism behind "this door
//     reaches no filesystem": there is no row, so there is nothing to authorize with
//     and nothing to leak. A spy cannot prove an absence in a table it never sees.
//   - An account added by EDITING the datadir through `patches` logs in. Live, the
//     journal has to really be found and replayed; the unit test hands it over.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMysqlConnect.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable host.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan';
import { hostServices } from '../src/core/generation/remoteHostFs';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { accountsIn } from '../src/core/sessions/passwdAccount';
import { parseMysqlDatabase } from '../src/core/mysql/types';
import { ALL_GENERATED_PASSWORDS } from '../src/core/generation/passwordPools';
import { md5 } from '../src/core/generation/md5';
import { DATADIR_FILE } from '../src/core/generation/baseFs';
import { MYSQL_LOG_OWNER, MYSQL_LOG_PATH } from '../src/core/logging/mysqlLog';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog';
import type { Directory } from '../src/core/filesystem/types';

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

// Chosen for a host running BOTH doors: the unix control has to land on the SAME box,
// or "the passwd password was refused" could just mean "a different machine".
const ESSID = 'MYSQL-LAB-3';
const CLIENT_IP = '192.168.1.50';

const client = generateIdentity();

const serves = (host: LanHost, spec: (typeof SERVICE_CATALOG)[keyof typeof SERVICE_CATALOG]) =>
  hostServices(ESSID, host).some((service) => service.spec === spec);

const target = generateHomeLan(ESSID).hosts.find(
  (host) =>
    host.kind === 'machine' &&
    serves(host, SERVICE_CATALOG.mysql) &&
    serves(host, SERVICE_CATALOG.ssh),
);

if (target === undefined) {
  console.error(`ESSID ${ESSID} has no host running BOTH mysql and ssh — pick another ESSID.`);
  process.exit(2);
}

const { baseFs, machineId: targetMachine } = resolveLanHostIdentity(target, ESSID);

const fileAt = (root: Directory, segments: readonly string[]): string | null => {
  const parent = segments.slice(0, -1).reduce<Directory | undefined>((node, segment) => {
    const next = node?.entries.get(segment);
    return next !== undefined && next.kind === 'directory' ? next : undefined;
  }, root);
  const leaf = parent?.entries.get(segments.at(-1) ?? '');
  return leaf !== undefined && leaf.kind === 'file' ? leaf.content : null;
};

const DATADIR_PATH = '/var/lib/mysql/data.json';
const datadir = fileAt(baseFs, ['var', 'lib', 'mysql', 'data.json']);
const database = datadir === null ? null : parseMysqlDatabase(datadir);

if (database === null) {
  console.error(`${target.hostname} runs mysqld but holds no readable datadir.`);
  process.exit(2);
}

/** The plaintext behind a stored hash. Recovered from the generation pool rather than
 *  cracked — this script needs to KNOW a good password, which is a different thing. */
const plaintextOf = (hash: string): string | undefined =>
  ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === hash);

const databaseLogin = database.credentials.flatMap((credential) => {
  const password = plaintextOf(credential.passwordHash);
  return password === undefined ? [] : [{ username: credential.username, password }];
})[0];

const unixLogin = accountsIn(baseFs).flatMap((account) => {
  const password = plaintextOf(account.hash);
  return password === undefined ? [] : [{ username: account.username, password }];
})[0];

if (databaseLogin === undefined || unixLogin === undefined) {
  console.error(`${target.hostname} has no recoverable database AND unix account to contrast.`);
  process.exit(2);
}

type LogRow = {
  readonly content: string | null;
  readonly owner: string | null;
  readonly write: readonly string[] | null;
};

const readRow = async (path: string): Promise<LogRow | null> => {
  const { data } = await sr
    .from('patches')
    .select('content, owner, permissions')
    .eq('machine_id', targetMachine)
    .eq('path', path)
    .maybeSingle();
  if (typeof data !== 'object' || data === null) return null;
  const at = (field: string): unknown => Object.getOwnPropertyDescriptor(data, field)?.value;
  const permissions = at('permissions');
  const write =
    typeof permissions === 'object' && permissions !== null
      ? Object.getOwnPropertyDescriptor(permissions, 'write')?.value
      : undefined;
  return {
    content: typeof at('content') === 'string' ? String(at('content')) : null,
    owner: typeof at('owner') === 'string' ? String(at('owner')) : null,
    write: Array.isArray(write) ? write.map(String) : null,
  };
};

const sessionRowCount = async (): Promise<number> => {
  const { count } = await sr
    .from('sessions')
    .select('session_id', { count: 'exact', head: true })
    .eq('player_key', client.publicKeyHex);
  return count ?? 0;
};

const clear = async () => {
  await sr.from('patches').delete().eq('machine_id', targetMachine);
  await sr.from('sessions').delete().eq('player_key', client.publicKeyHex);
};

const connect = (username: string, password: string, ip = target.ip) =>
  post(
    signRequest(client, 'mysqlConnect', {
      essid: ESSID,
      target_ip: ip,
      username,
      password,
      source_ip: CLIENT_IP,
    }),
  );

/** Plant an edited datadir the way a rooted player would: one row at the datadir path
 *  on the target's machine, which is what the journal replay has to pick up. */
const plantDatadir = async (content: string) => {
  await sr.from('patches').upsert(
    {
      writer_key: client.publicKeyHex,
      machine_id: targetMachine,
      path: DATADIR_PATH,
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
    `target ${target.hostname} ${target.ip} — database "${database.name}", ` +
      `db login ${databaseLogin.username}, unix login ${unixLogin.username}\n`,
  );

  await clear();

  const opened = await connect(databaseLogin.username, databaseLogin.password);
  check(
    'a datadir account with its real password opens the database',
    opened.status === 200,
    `status ${opened.status} ${JSON.stringify(opened.body)}`,
  );
  check(
    'and the answer carries nothing but that it opened',
    JSON.stringify(opened.body) === JSON.stringify({ ok: true }),
    `body ${JSON.stringify(opened.body)}`,
  );

  const afterOpen = await readRow(MYSQL_LOG_PATH);
  check(
    'the connection is recorded on the TARGET, naming the database it opened',
    (afterOpen?.content ?? '').includes(
      `${databaseLogin.username}@${CLIENT_IP} on ${database.name} using TCP/IP`,
    ),
    `${MYSQL_LOG_PATH}: ${afterOpen === null ? 'no row' : (afterOpen.content ?? '').trim()}`,
  );
  check(
    'the log is root-owned and root-write, so a visitor cannot edit the record of their visit',
    afterOpen?.owner === MYSQL_LOG_OWNER &&
      JSON.stringify(afterOpen.write) === JSON.stringify(['root']),
    `owner=${afterOpen?.owner} write=${JSON.stringify(afterOpen?.write)}`,
  );
  check(
    'and NOTHING is written to auth.log — a database login is not a shell login',
    (await readRow(AUTH_LOG_PATH)) === null,
    'auth.log has no row',
  );

  check(
    'no session row is minted, which is what leaves this door nothing to authorize with',
    (await sessionRowCount()) === 0,
    'sessions holds no row for this player',
  );

  const wrongPassword = await connect(databaseLogin.username, 'not-the-one');
  const noSuchAccount = await connect('nobody-by-that-name', 'not-the-one');
  check(
    'a wrong password and an unknown account come back identical, over the wire',
    wrongPassword.status === noSuchAccount.status &&
      JSON.stringify(wrongPassword.body) === JSON.stringify(noSuchAccount.body),
    `${wrongPassword.status} ${JSON.stringify(wrongPassword.body)} vs ` +
      `${noSuchAccount.status} ${JSON.stringify(noSuchAccount.body)}`,
  );
  check(
    'and both are refusals, not accidental successes',
    wrongPassword.status === 401,
    `status ${wrongPassword.status}`,
  );

  const unix = await connect(unixLogin.username, unixLogin.password);
  check(
    'the box own unix account opens nothing here — two locks, two keys',
    unix.status === 401,
    `${unixLogin.username} with its real shell password: status ${unix.status}`,
  );

  const recorded = ((await readRow(MYSQL_LOG_PATH))?.content ?? '')
    .split('\n')
    .filter((line) => line.length > 0);
  const accepted = recorded.filter((line) => line.includes('using TCP/IP')).length;
  const refused = recorded.filter((line) => line.includes('Access denied')).length;
  check(
    'every attempt is on the record — ONE line each, accepted and refused alike',
    recorded.length === 4 && accepted === 1 && refused === 3,
    `${recorded.length} lines for 4 attempts: ${accepted} accepted, ${refused} refused`,
  );

  await plantDatadir(
    JSON.stringify({
      ...database,
      credentials: [
        ...database.credentials,
        { username: 'planted', passwordHash: md5('let-me-in'), userType: 'root' },
      ],
    }),
  );
  const planted = await connect('planted', 'let-me-in');
  check(
    'an account added by editing the datadir really logs in',
    planted.status === 200,
    `status ${planted.status} ${JSON.stringify(planted.body)} — the journal is read, not the seed`,
  );

  await plantDatadir('not json at all');
  const tampered = await connect(databaseLogin.username, databaseLogin.password);
  check(
    'a datadir edited into nonsense exposes no accounts at all',
    tampered.status === 401,
    `status ${tampered.status} — an unreadable database admits nobody, including its real accounts`,
  );

  const missing = await connect(databaseLogin.username, databaseLogin.password, '192.168.99.99');
  check(
    'an address that is no host on this LAN is unreachable, not a bad password',
    missing.status === 404,
    `status ${missing.status} ${JSON.stringify(missing.body)}`,
  );

  await clear();

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
