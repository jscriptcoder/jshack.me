// Wire-payload smoke for a database statement that CHANGES something — the write half
// of `mysqlStatement`. Drives the REAL /api/sessions endpoint against a running
// `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - The datadir write is WIRED AT ALL. The handler takes an `upsertPatch` dep now,
//     and a route that builds its deps without one throws at runtime while every unit
//     test stays green — the deps are handed over directly there.
//   - A change reaches `patches` at `/var/lib/mysql/data.json` for THIS machine, and
//     lands on no other path. Asserted over every path the machine has, because a
//     stray write is invisible to a check that only looks where it expects one.
//   - What lands still PARSES as a database and still carries the account list. The
//     reader collapses "unparseable" into "no database here", so a bad write shuts the
//     door on everyone — the player who made it included.
//   - A SECOND player, signing with their own identity, reads the change back. This is
//     the claim that makes a database a shared object rather than a private one, and
//     it cannot be shown with an injected journal: it needs the real table, keyed on
//     the machine rather than on whoever wrote the row.
//   - A session of READS still writes nothing — no datadir, no log line. A spy proves
//     an absence only in a table it can see; this proves it in the one the game keeps.
//   - The daemon's own log gains one line per change and one per refused change, and
//     none for any read. The tags and their order are what a defender reads, so the
//     whole sequence is asserted rather than counted.
//   - The tier ladder decides live: the bottom rung is refused an UPDATE, the middle
//     one performs it, and the account list is refused a write at every rung.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMysqlMutate.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable host.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan';
import { hostServices } from '../src/core/generation/remoteHostFs';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';

/** The port these checks address the daemon on. Own-LAN, so it is the daemon's own:
 *  a forwarded port is what reaches a box on a deeper layer instead. */
const MYSQL_PORT = SERVICE_CATALOG.mysql.defaultPort;
import { parseMysqlDatabase, type MysqlDatabase } from '../src/core/mysql/types';
import { DATADIR_PATH } from '../src/core/mysql/datadir';
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

const post = async (envelope: unknown): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(SESSIONS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

// The same LAN the read smoke uses, so a failure here is about the write rather than
// about which box was picked.
const ESSID = 'MYSQL-LAB-3';
const CLIENT_IP = '192.168.1.50';

const client = generateIdentity();
// A different player on the same LAN. Never writes; only reads back what the first one
// changed, which is the whole point of them existing.
const neighbour = generateIdentity();

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

const seeded = fileAt(baseFs, ['var', 'lib', 'mysql', 'data.json']);
const generated = seeded === null ? null : parseMysqlDatabase(seeded);

if (generated === null) {
  console.error(`${target.hostname} runs mysqld but holds no readable datadir.`);
  process.exit(2);
}

// The ladder is PLANTED rather than found: the generator gives a read-only account to
// about half of all databases and database root to roughly one box in eight, so a
// script that went looking for three tiers would pass or fail on which host the ESSID
// drew. The tables and the name stay the box's own; only the accounts and one probe
// table are ours, so what is exercised is still a real generated database.
const ROOT_PASSWORD = 'wire-root';
const APP_PASSWORD = 'wire-app';
const GUEST_PASSWORD = 'wire-guest';

const PROBE = 'wire_probe';

const planted: MysqlDatabase = {
  ...generated,
  tables: {
    ...generated.tables,
    [PROBE]: {
      columns: [
        { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
        { name: 'note', type: 'VARCHAR', nullable: false },
      ],
      rows: [
        { id: 1, note: 'before' },
        { id: 2, note: 'untouched' },
      ],
    },
  },
  credentials: [
    { username: 'dba', passwordHash: md5(ROOT_PASSWORD), userType: 'root' },
    { username: 'app_rw', passwordHash: md5(APP_PASSWORD), userType: 'user' },
    { username: 'readonly', passwordHash: md5(GUEST_PASSWORD), userType: 'guest' },
  ],
};

const clear = async () => {
  await sr.from('patches').delete().eq('machine_id', targetMachine);
};

const plantDatadir = async () => {
  await sr.from('patches').upsert(
    {
      writer_key: client.publicKeyHex,
      machine_id: targetMachine,
      path: String(DATADIR_PATH),
      content: JSON.stringify(planted),
      owner: 'root',
      permissions: DATADIR_FILE,
      node_type: 'file',
      is_new: false,
    },
    { onConflict: 'writer_key,machine_id,path' },
  );
};

/** Every path this machine currently carries a row for, whoever wrote it. */
const writtenPaths = async (): Promise<readonly string[]> => {
  const { data } = await sr.from('patches').select('path').eq('machine_id', targetMachine);
  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((row) => Object.getOwnPropertyDescriptor(row, 'path')?.value)
    .filter((path): path is string => typeof path === 'string')
    .sort();
};

/** Every line the daemon has written to its own log for this machine, oldest first.
 *  The rows are keyed per writer, so this reads them all rather than assuming one. */
const logLines = async (): Promise<readonly string[]> => {
  const { data } = await sr
    .from('patches')
    .select('content, updated_at')
    .eq('machine_id', targetMachine)
    .eq('path', String(MYSQL_LOG_PATH))
    .order('updated_at', { ascending: true });
  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((row) => Object.getOwnPropertyDescriptor(row, 'content')?.value)
    .filter((content): content is string => typeof content === 'string')
    .flatMap((content) => content.split('\n'))
    .filter((line) => line.trim() !== '');
};

/** The datadir as the TABLE holds it, which is the only place a persisted write is
 *  visible — the endpoint would happily render a change that never landed. */
const storedDatadir = async (): Promise<MysqlDatabase | null> => {
  const { data } = await sr
    .from('patches')
    .select('content, updated_at')
    .eq('machine_id', targetMachine)
    .eq('path', String(DATADIR_PATH))
    .order('updated_at', { ascending: false })
    .limit(1);
  const rows = Array.isArray(data) ? data : [];
  const content = Object.getOwnPropertyDescriptor(rows[0] ?? {}, 'content')?.value;
  return typeof content === 'string' ? parseMysqlDatabase(content) : null;
};

const say = (
  identity: ReturnType<typeof generateIdentity>,
  account: { readonly username: string; readonly password: string },
  sql: string,
) =>
  post(
    signRequest(identity, 'mysqlStatement', {
      essid: ESSID,
      target_ip: target.ip,
      port: MYSQL_PORT,
      username: account.username,
      password: account.password,
      statement: sql,
      source_ip: CLIENT_IP,
    }),
  );

const DBA = { username: 'dba', password: ROOT_PASSWORD };
const APP = { username: 'app_rw', password: APP_PASSWORD };
const READONLY = { username: 'readonly', password: GUEST_PASSWORD };

const rendered = (body: unknown): string => {
  const output = Object.getOwnPropertyDescriptor(body ?? {}, 'output')?.value;
  return Array.isArray(output) ? output.map(String).join('\n') : '';
};

const main = async (): Promise<void> => {
  console.log(
    `target ${target.hostname} ${target.ip} — database "${planted.name}", ` +
      `machine ${targetMachine.slice(0, 12)}…\n`,
  );

  await clear();
  await plantDatadir();

  // A session of reads, first: whatever the write path does later, it must not be
  // doing it now.
  const beforePaths = await writtenPaths();
  await say(client, APP, 'SHOW TABLES');
  await say(client, APP, `SELECT * FROM ${PROBE}`);
  check(
    'a session of reads writes nothing to the machine at all — not even a log line',
    JSON.stringify(await writtenPaths()) === JSON.stringify(beforePaths),
    `${beforePaths.length} path(s) before, ${(await writtenPaths()).length} after two reads`,
  );

  const refused = await say(client, READONLY, `UPDATE ${PROBE} SET note = 'guest-was-here'`);
  check(
    'the bottom rung is refused an UPDATE on the wire',
    rendered(refused.body) ===
      `ERROR 1142 (42000): UPDATE command denied to user 'readonly'@'${CLIENT_IP}' for table '${PROBE}'`,
    rendered(refused.body),
  );
  check(
    'and its refusal leaves the stored datadir exactly as it was',
    (await storedDatadir())?.tables[PROBE]?.rows[0]?.['note'] === 'before',
    `note is ${JSON.stringify((await storedDatadir())?.tables[PROBE]?.rows[0]?.['note'])}`,
  );

  const updated = await say(client, APP, `UPDATE ${PROBE} SET note = 'moved' WHERE id = '1'`);
  check(
    'the application account performs the UPDATE, in legacy own two lines',
    rendered(updated.body) ===
      'Query OK, 1 row affected (0.00 sec)\nRows matched: 1  Changed: 1  Warnings: 0',
    rendered(updated.body).replace('\n', ' / '),
  );

  check(
    'the change is in the journal, at the datadir and the daemon own log and nowhere else',
    JSON.stringify(await writtenPaths()) ===
      JSON.stringify([String(MYSQL_LOG_PATH), String(DATADIR_PATH)].sort()),
    (await writtenPaths()).join(', ') || '(none)',
  );

  const stored = await storedDatadir();
  check(
    'what landed still reads as a database, account list and all',
    stored !== null &&
      stored.name === planted.name &&
      stored.credentials.map((credential) => credential.username).join(',') ===
        'dba,app_rw,readonly',
    stored === null
      ? 'unparseable — this box would now read as having no database'
      : `${Object.keys(stored.tables).length} table(s), ${stored.credentials.length} account(s)`,
  );
  check(
    'and it holds the new value, not the rendered promise of one',
    stored?.tables[PROBE]?.rows[0]?.['note'] === 'moved' &&
      stored?.tables[PROBE]?.rows[1]?.['note'] === 'untouched',
    JSON.stringify(stored?.tables[PROBE]?.rows),
  );

  // The claim a fake journal cannot make: somebody else, signing as themselves, meets
  // the change on their next statement.
  const nextOccupant = await say(neighbour, APP, `SELECT note FROM ${PROBE} WHERE id = '1'`);
  check(
    'a second player on the LAN reads the change back as their own next statement',
    rendered(nextOccupant.body).includes('moved'),
    rendered(nextOccupant.body).split('\n')[3] ?? '(nothing)',
  );

  const deniedList = await say(client, DBA, "UPDATE credentials SET password_hash = 'x'");
  check(
    'the account list is refused a write even by database root',
    rendered(deniedList.body) ===
      `ERROR 1142 (42000): UPDATE command denied to user 'dba'@'${CLIENT_IP}' for table 'credentials'`,
    rendered(deniedList.body),
  );

  const deniedDrop = await say(client, APP, `DROP TABLE ${PROBE}`);
  check(
    'the middle rung may edit rows but not remove the table they live in',
    rendered(deniedDrop.body) ===
      `ERROR 1142 (42000): DROP command denied to user 'app_rw'@'${CLIENT_IP}' for table '${PROBE}'`,
    rendered(deniedDrop.body),
  );

  const dropped = await say(client, DBA, `DROP TABLE ${PROBE}`);
  check(
    'database root drops it, on legacy own clock',
    rendered(dropped.body) === 'Query OK, 0 rows affected (0.01 sec)',
    rendered(dropped.body),
  );

  const afterDrop = await say(neighbour, APP, 'SHOW TABLES');
  check(
    'and the table is gone for everyone, not just for the player who dropped it',
    !rendered(afterDrop.body).includes(PROBE) && rendered(afterDrop.body).includes('credentials'),
    rendered(afterDrop.body).split('\n').slice(3, 5).join(' / '),
  );

  // What the daemon recorded about the whole run: two changes and three refusals,
  // and not one of the six reads. The tags and the order are the file a defender
  // reads, so they are asserted rather than counted.
  const recorded = await logLines();
  check(
    'the log holds one line per change and per refusal, and none for any read',
    recorded.map((line) => line.split('\t')[1]?.split(' ')[1]).join(',') ===
      'Denied,Query,Denied,Denied,Query',
    `${recorded.length} line(s): ${recorded.map((line) => line.split('\t')[1]).join(' | ')}`,
  );
  check(
    'and a change is recorded as the statement that made it',
    recorded.some((line) => line.endsWith(`Query\tUPDATE ${PROBE} SET note = 'moved' WHERE id = '1'`)),
    recorded.find((line) => line.includes('Query'))?.split('\t')[2] ?? '(none)',
  );

  await clear();

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
};

void main();
