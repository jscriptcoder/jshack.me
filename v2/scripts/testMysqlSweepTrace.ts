// Wire-payload smoke for the DATABASE door — `hydraCrack` against mysql.
// Drives the REAL /api/sessions endpoint against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `hydra <host> mysql` returns the accounts in the target's
//     `/var/lib/mysql/data.json`, and NOT the unix accounts in its `/etc/passwd`.
//   - Its trace lands at the target's `/var/log/mysql.log`, in mysql's own line
//     shape, and NOTHING is written to `auth.log`.
//   - The line that ACCEPTED a credential names the database it opened; the wall of
//     refusals before it names none.
//   - `hydra <host> ssh` on the same box still returns that box's own accounts and
//     still writes `auth.log`, unchanged.
//
// Unit tests inject a fake `upsertPatch`, so which PATH a row lands at is asserted
// against a spy rather than against the table. `patches` is keyed on
// `(machine_id, path, writer_key)`, and a sweep that wrote both files under one key,
// or that lost the second row to the upsert's conflict target, passes every unit test
// in the suite. Only a real round-trip can tell the two files apart. The same is true
// of the row's owner and permissions: a constraint the table enforces is invisible to
// a spy that accepts whatever it is handed.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMysqlSweepTrace.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable host.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan';
import { hostServices } from '../src/core/generation/remoteHostFs';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import { accountsIn } from '../src/core/sessions/passwdAccount';
import { parseMysqlDatabase } from '../src/core/mysql/types';
import { md5 } from '../src/core/generation/md5';
import {
  DEFAULT_WORDLIST,
  WORDLIST_PATH,
  WORDLIST_PERMISSIONS,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog';
import { MYSQL_LOG_OWNER, MYSQL_LOG_PATH } from '../src/core/logging/mysqlLog';
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

// Chosen because it generates a host running BOTH doors whose database ALSO gives up
// all three of its rungs to the starting wordlist. Both halves matter: the ssh control
// has to land on the same box, or "mysql wrote elsewhere" could just mean "a different
// machine", and a database that opens nothing would leave the accepted line — the one
// that names the database — with nothing to assert. Most networks satisfy neither; the
// guard below says so rather than silently passing on a box with nothing to find.
const ESSID = 'MYSQL-LAB-3';

const attacker = generateIdentity();
const attackerMachine = computeWorkstationId('datalab', attacker.publicKeyHex);

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

/** One file's content on the generated box, read the way each daemon reads its own. */
const fileAt = (root: Directory, segments: readonly string[]): string | null => {
  const parent = segments.slice(0, -1).reduce<Directory | undefined>((node, segment) => {
    const next = node?.entries.get(segment);
    return next !== undefined && next.kind === 'directory' ? next : undefined;
  }, root);
  const leaf = parent?.entries.get(segments.at(-1) ?? '');
  return leaf !== undefined && leaf.kind === 'file' ? leaf.content : null;
};

/** The wordlist word that opens a stored hash, or nothing. This is the oracle, and it
 *  reads the DATADIR FILE rather than the catalog row under test — an expectation
 *  computed through `accountsOn` would move with the very column this exists to check. */
const openerOf = (hash: string): string | undefined =>
  DEFAULT_WORDLIST.find((word) => md5(word) === hash);

const datadir = fileAt(baseFs, ['var', 'lib', 'mysql', 'data.json']);
const database = datadir === null ? null : parseMysqlDatabase(datadir);

if (database === null) {
  console.error(`${target.hostname} runs mysqld but holds no readable datadir.`);
  process.exit(2);
}

const asPairs = (accounts: readonly { username: string; opener: string | undefined }[]) =>
  accounts
    .flatMap((account) =>
      account.opener === undefined ? [] : [`${account.username}:${account.opener}`],
    )
    .sort();

const expectedFromDatabase = asPairs(
  database.credentials.map((credential) => ({
    username: credential.username,
    opener: openerOf(credential.passwordHash),
  })),
);

const expectedFromPasswd = asPairs(
  accountsIn(baseFs).map((account) => ({
    username: account.username,
    opener: openerOf(account.hash),
  })),
);

if (expectedFromDatabase.length === 0) {
  console.error(`${target.hostname}'s database opens to nothing in the starting wordlist.`);
  process.exit(2);
}

/** The `username:password` pairs an answer handed back, read out of an untyped body
 *  the way a client has to read it. */
const crackedIn = (body: unknown): readonly string[] => {
  if (typeof body !== 'object' || body === null) return [];
  const cracked = Object.getOwnPropertyDescriptor(body, 'cracked')?.value;
  if (!Array.isArray(cracked)) return [];
  return cracked
    .flatMap((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const username = Object.getOwnPropertyDescriptor(entry, 'username')?.value;
      const password = Object.getOwnPropertyDescriptor(entry, 'password')?.value;
      return typeof username === 'string' && typeof password === 'string'
        ? [`${username}:${password}`]
        : [];
    })
    .sort();
};

type LogRow = {
  readonly content: string | null;
  readonly owner: string | null;
  readonly write: readonly string[] | null;
};

const readLog = async (path: string): Promise<LogRow | null> => {
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

const clear = async () => {
  await sr.from('patches').delete().eq('machine_id', targetMachine);
  await sr.from('patches').delete().eq('machine_id', attackerMachine);
};

const seedWordlist = async () => {
  await sr.from('patches').upsert(
    {
      writer_key: attacker.publicKeyHex,
      machine_id: attackerMachine,
      path: WORDLIST_PATH,
      content: formatWordlist(DEFAULT_WORDLIST),
      owner: 'root',
      permissions: WORDLIST_PERMISSIONS,
      node_type: 'file',
      is_new: true,
    },
    { onConflict: 'writer_key,machine_id,path' },
  );
};

const sweep = (service: string) =>
  post(
    signRequest(attacker, 'hydraCrack', {
      essid: ESSID,
      target_ip: target.ip,
      service,
      caller_machine_id: attackerMachine,
      source_ip: '192.168.1.50',
    }),
  );

const main = async (): Promise<void> => {
  console.log(
    `target ${target.hostname} ${target.ip} — database "${database.name}", ` +
      `expecting ${JSON.stringify(expectedFromDatabase)} and none of ${JSON.stringify(expectedFromPasswd)}\n`,
  );

  await clear();
  await seedWordlist();

  const mysqlSweep = await sweep('mysql');
  check(
    'hydra <host> mysql is answered',
    mysqlSweep.status === 200,
    `status ${mysqlSweep.status} ${JSON.stringify(mysqlSweep.body)}`,
  );

  const opened = crackedIn(mysqlSweep.body);
  check(
    'it hands back the DATADIR-s accounts',
    JSON.stringify(opened) === JSON.stringify(expectedFromDatabase),
    `got ${JSON.stringify(opened)}`,
  );
  check(
    'and none of the box-s own unix accounts, which the same wordlist opens',
    expectedFromPasswd.every((pair) => !opened.includes(pair)),
    `passwd opens ${JSON.stringify(expectedFromPasswd)} — none may appear above`,
  );

  const mysqlLogAfterSweep = await readLog(MYSQL_LOG_PATH);
  check(
    'the sweep lands in the daemon-s OWN log',
    mysqlLogAfterSweep?.content?.includes('Access denied for user') === true,
    `${MYSQL_LOG_PATH}: ${
      mysqlLogAfterSweep === null
        ? 'no row'
        : `${(mysqlLogAfterSweep.content ?? '').split('\n').length} lines`
    }`,
  );
  check(
    'written in mysql-s shape, not sshd-s',
    mysqlLogAfterSweep !== null && !(mysqlLogAfterSweep.content ?? '').includes('sshd['),
    'no syslog `sshd[pid]:` tag in the database trace',
  );
  check(
    'the line that ACCEPTED a credential names the database it opened',
    (mysqlLogAfterSweep?.content ?? '').includes(`on ${database.name} using TCP/IP`),
    `looking for "on ${database.name} using TCP/IP"`,
  );
  check(
    'and the refusals name no database at all',
    (mysqlLogAfterSweep?.content ?? '')
      .split('\n')
      .filter((line) => line.includes('Access denied'))
      .every((line) => !line.includes(database.name)),
    'a client that never authenticated was never told which database it would have reached',
  );

  const authAfterMysql = await readLog(AUTH_LOG_PATH);
  check(
    'the mysql sweep writes NOTHING to auth.log',
    authAfterMysql === null,
    `auth.log: ${authAfterMysql === null ? 'no row' : 'a row exists — the routing leaked'}`,
  );

  check(
    'the log is root-owned and root-write, so a visitor cannot edit the record of their visit',
    mysqlLogAfterSweep?.owner === MYSQL_LOG_OWNER &&
      JSON.stringify(mysqlLogAfterSweep.write) === JSON.stringify(['root']),
    `owner=${mysqlLogAfterSweep?.owner} write=${JSON.stringify(mysqlLogAfterSweep?.write)}`,
  );

  // The ssh control, on the SAME box: teaching the database door to read its datadir
  // must not move the door every shipped trace already depends on.
  const sshSweep = await sweep('ssh');
  check('hydra <host> ssh is answered', sshSweep.status === 200, `status ${sshSweep.status}`);
  check(
    'and still hands back the box-s OWN accounts',
    JSON.stringify(crackedIn(sshSweep.body)) === JSON.stringify(expectedFromPasswd),
    `got ${JSON.stringify(crackedIn(sshSweep.body))}`,
  );

  const authAfterSsh = await readLog(AUTH_LOG_PATH);
  check(
    'the ssh sweep still lands in auth.log, byte-for-byte as before',
    authAfterSsh?.content?.includes('sshd[') === true,
    `auth.log: ${
      authAfterSsh === null ? 'no row' : `${(authAfterSsh.content ?? '').split('\n').length} lines`
    }`,
  );

  const mysqlLogAfterSsh = await readLog(MYSQL_LOG_PATH);
  check(
    'the ssh sweep did not append to mysql.log',
    mysqlLogAfterSsh?.content === mysqlLogAfterSweep?.content,
    'the database log is unchanged by a shell sweep',
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
