// Wire-payload smoke for the DATABASE STATEMENT door — `mysqlStatement`.
// Drives the REAL /api/sessions endpoint against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - The `mysqlStatement` action is DISPATCHED at all. A new action on an existing
//     endpoint is the one thing no unit test can see: the handler is called directly
//     there, so a route that never routes to it stays green all the way to production.
//   - A statement comes back as RENDERED TEXT and nothing else — asserted on the wire
//     body, where a stray field would be readable by anyone watching, rather than on a
//     return value a test read directly.
//   - The credential is re-validated PER STATEMENT: the same line that answered a
//     moment ago is refused once the password is wrong, with no session row anywhere
//     to have kept it alive.
//   - A whole session of reads leaves `/var/log/mysql.log` exactly ONE line longer —
//     the login's. Unit tests inject a fake `upsertPatch`; only the table can show
//     that nothing else wrote to it.
//   - NO row appears in `sessions`, at any point. A spy cannot prove an absence in a
//     table it never sees.
//   - A table added by EDITING the datadir through `patches` is listed. Live, the
//     journal has to really be found and replayed; the unit test hands it over.
//   - A daemon stopped by deleting its pidfile stops answering — which is what closes
//     the player's prompt, and it has to be decided from the box's real filesystem.
//   - The account list is LISTED and DESCRIBABLE to the bottom rung while its SELECT is
//     refused — the tier ladder, decided from the datadir on the target rather than from
//     anything the client said about itself.
//   - No stored hash appears ANYWHERE in the bytes that come back from that refusal.
//     Shape-independent on purpose: a whole-value assertion only guards the fields
//     somebody thought to name, and this guards a field added later by someone who
//     never read this file.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMysqlQuery.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable host.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan';
import { hostServices } from '../src/core/generation/remoteHostFs';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { pidfilePath } from '../src/core/services/pidfile';
import { parseMysqlDatabase } from '../src/core/mysql/types';
import { ALL_GENERATED_PASSWORDS } from '../src/core/generation/passwordPools';
import { md5 } from '../src/core/generation/md5';
import { DATADIR_FILE } from '../src/core/generation/baseFs';
import { MYSQL_LOG_PATH } from '../src/core/logging/mysqlLog';
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

/** The RAW text comes back alongside the parsed body: a hash-leak check has to read
 *  the bytes that crossed, not a shape somebody chose to parse them into. */
const post = async (
  envelope: unknown,
): Promise<{ status: number; body: unknown; raw: string }> => {
  const response = await fetch(SESSIONS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const raw = await response.text();
  const body = ((): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })();
  return { status: response.status, body, raw };
};

// The same LAN the login smoke uses, so a failure here is about the statement door
// rather than about which box was picked.
const ESSID = 'MYSQL-LAB-3';
const CLIENT_IP = '192.168.1.50';

const client = generateIdentity();

const target = generateHomeLan(ESSID).hosts.find(
  (host: LanHost) =>
    host.kind === 'machine' &&
    hostServices(ESSID, host).some((service) => service.spec === SERVICE_CATALOG.mysql),
);

if (target === undefined) {
  console.error(`ESSID ${ESSID} has no host running mysql — pick another ESSID.`);
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

const accounts = database.credentials.flatMap((credential) => {
  const password = ALL_GENERATED_PASSWORDS.find(
    (candidate) => md5(candidate) === credential.passwordHash,
  );
  return password === undefined
    ? []
    : [{ username: credential.username, password, userType: credential.userType }];
});

const login = accounts[0];

// The tier claims need both rungs on ONE box, and the generator gives a read-only
// account to about half of all databases — so this is a property of the ESSID, checked
// rather than assumed.
const guest = accounts.find((account) => account.userType === 'guest');
const reader = accounts.find((account) => account.userType !== 'guest');

if (login === undefined) {
  console.error(`${target.hostname} has no recoverable database account.`);
  process.exit(2);
}

if (guest === undefined || reader === undefined) {
  console.error(
    `${target.hostname} has no recoverable account on BOTH sides of the credentials ` +
      `line — pick another ESSID.`,
  );
  process.exit(2);
}

const firstTable = Object.keys(database.tables)[0];
if (firstTable === undefined) {
  console.error(`${target.hostname} serves a database with no tables.`);
  process.exit(2);
}

const logLineCount = async (): Promise<number> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', targetMachine)
    .eq('path', MYSQL_LOG_PATH)
    .maybeSingle();
  const content = Object.getOwnPropertyDescriptor(data ?? {}, 'content')?.value;
  if (typeof content !== 'string') return 0;
  return content.split('\n').filter((line) => line.trim() !== '').length;
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

const plant = async (path: string, content: string | null, permissions: unknown) => {
  await sr.from('patches').upsert(
    {
      writer_key: client.publicKeyHex,
      machine_id: targetMachine,
      path,
      content,
      owner: 'root',
      permissions,
      node_type: 'file',
      is_new: false,
    },
    { onConflict: 'writer_key,machine_id,path' },
  );
};

const connect = (password: string) =>
  post(
    signRequest(client, 'mysqlConnect', {
      essid: ESSID,
      target_ip: target.ip,
      username: login.username,
      password,
      source_ip: CLIENT_IP,
    }),
  );

const statementAs = (
  account: { readonly username: string; readonly password: string },
  sql: string,
) =>
  post(
    signRequest(client, 'mysqlStatement', {
      essid: ESSID,
      target_ip: target.ip,
      username: account.username,
      password: account.password,
      statement: sql,
      source_ip: CLIENT_IP,
    }),
  );

const statement = (sql: string, password = login.password) =>
  statementAs({ username: login.username, password }, sql);

const rendered = (body: unknown): string => {
  const output = Object.getOwnPropertyDescriptor(body ?? {}, 'output')?.value;
  return Array.isArray(output) ? output.map(String).join('\n') : '';
};

const main = async (): Promise<void> => {
  console.log(
    `target ${target.hostname} ${target.ip} — database "${database.name}", ` +
      `account ${login.username}, first table ${firstTable}\n`,
  );

  await clear();
  await connect(login.password);
  const afterLogin = await logLineCount();

  const listed = await statement('SHOW TABLES');
  check(
    'the statement action is dispatched and answers a live database',
    listed.status === 200 && rendered(listed.body).includes(`Tables_in_${database.name}`),
    `status ${listed.status} — ${rendered(listed.body).split('\n')[1] ?? '(nothing)'}`,
  );
  check(
    'and the answer carries the rendering and NOTHING else',
    JSON.stringify(Object.keys(listed.body ?? {}).sort()) === JSON.stringify(['failed', 'output']),
    `keys ${JSON.stringify(Object.keys(listed.body ?? {}))}`,
  );

  const described = await statement(`DESCRIBE ${firstTable}`);
  check(
    'DESCRIBE renders the column metadata the generator drew',
    rendered(described.body).includes('| Field') && rendered(described.body).includes('Extra |'),
    rendered(described.body).split('\n')[1] ?? '(nothing)',
  );

  const selected = await statement(`SELECT * FROM ${firstTable}`);
  check(
    'SELECT renders rows and a count',
    /\d+ rows? in set \(0\.00 sec\)/.test(rendered(selected.body)),
    rendered(selected.body).split('\n').at(-1) ?? '(nothing)',
  );

  // Asked as the bottom rung on purpose. The account this script logs in with is
  // whichever one the box happened to draw, and a write is a permission problem only
  // BELOW the tier that may run it — the ladder itself is exercised in testMysqlMutate.
  const denied = await statementAs(guest, `DROP TABLE ${firstTable}`);
  check(
    'a write is refused as a PERMISSION problem, naming this connection',
    rendered(denied.body) ===
      `ERROR 1142 (42000): DROP command denied to user '${guest.username}'@'${CLIENT_IP}' for table '${firstTable}'`,
    rendered(denied.body),
  );

  // The whole point of re-validating per statement: nothing server-side remembers
  // that this credential worked a moment ago, because nothing ever recorded it.
  const stale = await statement('SHOW TABLES', 'not-the-password');
  check(
    'the credential is re-checked on every statement, not trusted from the login',
    stale.status === 401,
    `status ${stale.status} ${JSON.stringify(stale.body)}`,
  );

  // The account list, one door in. Listed and describable at every tier, readable only
  // above guest — `/etc` is traversable to a guest who still cannot open `passwd`.
  const listedToGuest = await statementAs(guest, 'SHOW TABLES');
  check(
    'the account list is listed to the bottom rung, beside the tables it may read',
    rendered(listedToGuest.body).includes('| credentials'),
    rendered(listedToGuest.body)
      .split('\n')
      .find((line) => line.includes('credentials')) ?? '(absent)',
  );

  const shapeToGuest = await statementAs(guest, 'DESCRIBE credentials');
  check(
    'and describable to it, so the bottom rung sees what the next credential buys',
    rendered(shapeToGuest.body).includes('| password_hash |') &&
      rendered(shapeToGuest.body).includes('| user_type'),
    rendered(shapeToGuest.body).split('\n')[3] ?? '(nothing)',
  );

  const refusedToGuest = await statementAs(guest, 'SELECT * FROM credentials');
  check(
    'while its SELECT is refused below user, naming the connection that asked',
    rendered(refusedToGuest.body) ===
      `ERROR 1142 (42000): SELECT command denied to user '${guest.username}'@'${CLIENT_IP}' ` +
        `for table 'credentials'`,
    rendered(refusedToGuest.body),
  );
  check(
    'and NO stored hash crosses the wire in that refusal, in any field',
    database.credentials.every(({ passwordHash }) => !refusedToGuest.raw.includes(passwordHash)),
    `${refusedToGuest.raw.length} bytes back, ${database.credentials.length} hashes looked for`,
  );

  const servedToReader = await statementAs(reader, 'SELECT * FROM credentials');
  check(
    'the same statement serves every hash inline one rung up',
    database.credentials.every(({ passwordHash }) => servedToReader.raw.includes(passwordHash)),
    rendered(servedToReader.body).split('\n').at(-1) ?? '(nothing)',
  );

  const ordinaryToGuest = await statementAs(guest, `SELECT * FROM ${firstTable}`);
  check(
    'and the bottom rung still reads the ordinary tables — the refusal is that table own',
    /\d+ rows? in set \(0\.00 sec\)|Empty set/.test(rendered(ordinaryToGuest.body)),
    rendered(ordinaryToGuest.body).split('\n').at(-1) ?? '(nothing)',
  );

  check(
    'a session of reads leaves mysql.log exactly one line longer — the login line',
    (await logLineCount()) === afterLogin,
    `${afterLogin} line(s) after login, ${await logLineCount()} after a session of reads`,
  );
  check(
    'and NO session row exists, at any point',
    (await sessionRowCount()) === 0,
    `${await sessionRowCount()} row(s) for this player`,
  );

  // A rooted player edits the datadir; the next statement has to see it.
  const edited = {
    ...database,
    tables: { ledger_x: { columns: [{ name: 'id', type: 'INT', nullable: false }], rows: [] } },
  };
  await plant(DATADIR_PATH, JSON.stringify(edited), DATADIR_FILE);
  const afterEdit = await statement('SHOW TABLES');
  check(
    'a table added by editing the datadir is listed — the journal is really replayed',
    rendered(afterEdit.body).includes('ledger_x') &&
      !rendered(afterEdit.body).includes(firstTable),
    rendered(afterEdit.body).split('\n')[3] ?? '(nothing)',
  );

  // Stopping the daemon is deleting its pidfile — the same source `nmap` reads.
  await plant(String(pidfilePath(SERVICE_CATALOG.mysql)), null, null);
  const afterStop = await statement('SHOW TABLES');
  check(
    'a daemon stopped mid-session stops answering, which is what closes the prompt',
    afterStop.status === 404,
    `status ${afterStop.status} ${JSON.stringify(afterStop.body)}`,
  );

  await clear();

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
};

void main();
