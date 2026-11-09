// Wire-check for THE DATABASE ROUTE: a contract whose key box keeps root's password in a table its
// application account can read, driven end to end against a running `vercel dev` + supabase, staging
// the job through the REAL `scripts/hireme.ts` and working it through the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - BOTH FORWARDS ANSWER: nmap shows :3306 and :2222.
//   - THE SWEEP FINDS THE ACCOUNT and never database root, and leaves lines on the box.
//   - THE LOGIN AND THE STATEMENTS READ THE TABLE, over the public door and over `localhost` from
//     a guest shell on the box. The table came from the server's JSHACK_SECRETS at runtime.
//   - THE FILE ITSELF IS ROOT'S: a guest shell cannot cat it, and a root shell sees the word in it.
//   - THE WORD OPENS ROOT over ssh on :2222, and hydra finds it only once it is on the list. It
//     never opens database root. MSFCONSOLE FINDS NO ROOT through :3306.
//   - THE JOB PAYS AS ON ANY ROUTE: root reads the key, and mailing it mints the pay.
//   - THE JOURNAL WINS: a change to another table keeps `settings`, a DELETE sticks, and a root's
//     rm refuses the account. The key is untouched by any of it.
//
// The word is compared and never printed. `show` prints it, so its output is checked and not
// echoed. The password an account is swept with is treated the same way.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionMysql.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentityIn } from '../src/test/factories/identityIn.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { wifiPoolOf } from '../src/core/generation/generateWifi.js';
import { machineIdForLanHost } from '../src/core/generation/lanTopology.js';
import { buildMissionKeyBoxFs } from '../src/core/generation/missionKeyBoxFs.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { md5 } from '../src/core/generation/md5.js';
import { LOOPBACK_IPV4 } from '../src/core/network/interfaces.js';
import { MYSQL_LOG_PATH } from '../src/core/logging/mysqlLog.js';
import { DATADIR_PATH, databaseIn } from '../src/core/mysql/datadir.js';
import {
  DEFAULT_WORDLIST,
  WORDLIST_PATH,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist.js';
import { missionShape } from '../src/core/missions/missionShape.js';
import { missionKey, missionKeyPath } from '../src/core/missions/missionSecret.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';
import {
  isMissionNumber,
  missionAddressForNumber,
  missionEssid,
} from '../src/core/missions/missionNetwork.js';
import { createFsView } from '../src/core/filesystem/fsView.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import { plaintextFor } from '../src/test/passwords.js';
import { asAbsPath } from '../src/core/types.js';
import type { Directory } from '../src/core/filesystem/types.js';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
const WALLET = process.env.WALLET_ENDPOINT ?? 'http://localhost:3100/api/wallet';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const secret = process.env.MISSION_KEY_SECRET;

if (!url || !serviceKey || !secret || !process.env.JSHACK_SECRETS) {
  console.error(
    'Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MISSION_KEY_SECRET, JSHACK_SECRETS',
  );
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

const portsOf = (body: unknown): readonly number[] =>
  ((body as { ports?: readonly { port?: number }[] } | null)?.ports ?? [])
    .map((entry) => entry.port)
    .filter((port): port is number => typeof port === 'number');

const crackedUsernames = (body: unknown): readonly string[] =>
  ((body as { cracked?: readonly { username: string }[] } | null)?.cracked ?? []).map(
    (entry) => entry.username,
  );

// `shell: true` so Windows resolves `npx.cmd`; the args carry no spaces, so quoting is moot.
const runHireme = (args: readonly string[]): string =>
  execFileSync('npx', ['tsx', 'scripts/hireme.ts', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  }).trim();

const databaseNumber = (from: number): number => {
  for (let candidate = from; candidate < from + 20000; candidate += 1) {
    // A contract that keeps its key in a plain file, which is where this check reads it.
    if (
      isMissionNumber(candidate) &&
      missionShape(candidate).route === 'mysql' &&
      missionShape(candidate).storage === 'file'
    ) {
      return candidate;
    }
  }
  throw new Error(`no database route number found from ${from}`);
};

const DATABASE_NUMBER = databaseNumber(220000);
const ESSID = missionEssid(DATABASE_NUMBER);
const ADDRESS = missionAddressForNumber(DATABASE_NUMBER) ?? '';
const KEY_PATH = missionKeyPath(DATABASE_NUMBER);
const KEY = missionKey(DATABASE_NUMBER, secret);
const WORD = plaintextFor(missionShape(DATABASE_NUMBER).keyBoxRootHash);
const DATABASE_PORT = 3306;

const account = databaseIn(buildMissionKeyBoxFs(DATABASE_NUMBER))?.credentials.find(
  (credential) => credential.userType === 'user',
);
if (account === undefined) throw new Error('a database route has an account');
const ACCOUNT = account.username;
const ACCOUNT_PASSWORD = plaintextFor(account.passwordHash);

const keyBoxHost = generateHomeLan(ESSID).hosts.find((host) => host.kind === 'machine');
if (keyBoxHost === undefined) throw new Error('a contract network has a key box');
const KEY_BOX = machineIdForLanHost(keyBoxHost, ESSID);
const GATEWAY = computeApGatewayId(ESSID);

const contractor = generateIdentityIn(RIDGEMONT);
const visitor = generateIdentityIn(RIDGEMONT);
const shellPlayer = generateIdentityIn(RIDGEMONT);
const RUN = Date.now().toString(36).slice(-6);
const HANDLE = `dbl${RUN}`;
const [homeEssid] = wifiPoolOf(RIDGEMONT);
const WORKSTATION = computeWorkstationId('newbie', contractor.publicKeyHex);
const WALLET_ADDRESS = `jsc${randomBytes(20).toString('hex')}`;

const seedFile = async (path: string, content: string) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: WORKSTATION,
      path,
      writer_key: contractor.publicKeyHex,
      content,
      owner: 'root',
      node_type: 'file',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (error) throw new Error(`seed of ${path} failed: ${error.message}`);
};

type Login = { readonly username: string; readonly password: string };
const ACCOUNT_LOGIN: Login = { username: ACCOUNT, password: ACCOUNT_PASSWORD };

/** A database login, as the `mysql` command sends it from a workstation. */
const connect = (login: Login) =>
  post(
    SESSIONS,
    signRequest(contractor, 'mysqlConnect', {
      essid: homeEssid,
      target_ip: ADDRESS,
      port: DATABASE_PORT,
      ...login,
    }),
  );

/** One statement over the public door, returning its printed output as one string. */
const statement = async (
  line: string,
): Promise<{ readonly status: number; readonly failed: unknown; readonly output: string }> => {
  const answer = await post(
    SESSIONS,
    signRequest(contractor, 'mysqlStatement', {
      essid: homeEssid,
      target_ip: ADDRESS,
      port: DATABASE_PORT,
      ...ACCOUNT_LOGIN,
      statement: line,
    }),
  );
  const body = answer.body as { output?: readonly string[]; failed?: unknown } | null;
  return {
    status: answer.status,
    failed: body?.failed,
    output: (body?.output ?? []).join('\n'),
  };
};

const hydra = (service: 'ssh' | 'mysql', port: number) =>
  post(
    SESSIONS,
    signRequest(contractor, 'hydraCrack', {
      essid: homeEssid,
      target_ip: ADDRESS,
      service,
      caller_machine_id: WORKSTATION,
      port,
    }),
  );

let sshKnocks = 0;

/** A login over the forward to the box's own sshd. */
const sshToKeyBox = (caller: typeof contractor, username: string, password: string) => {
  sshKnocks += 1;
  return post(
    SESSIONS,
    signRequest(caller, 'authCreateSessionPublic', {
      session_id: `ssh-${RUN}-${sshKnocks}`,
      target: ADDRESS,
      port: 2222,
      username,
      password,
      parent_session_id: null,
      source_ip: null,
      kind: 'ssh',
    }),
  );
};

const readBox = async (caller: typeof contractor): Promise<Directory | null> => {
  const answer = await post(
    NETWORK,
    signRequest(caller, 'resolveCrossPlayerFs', { machine_id: KEY_BOX }),
  );
  return answer.status === 200
    ? deserializeTree((answer.body as { tree: SerializedDirectory }).tree)
    : null;
};

const readFile = (tree: Directory | null, tier: 'root' | 'guest', path: string): string | null => {
  if (tree === null) return null;
  const read = createFsView(tree, { userType: tier }).read(asAbsPath(path));
  return read.ok ? read.content : null;
};

const mysqlLogOfKeyBox = async (): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', KEY_BOX)
    .eq('path', MYSQL_LOG_PATH);
  return ((data ?? []) as readonly { content?: string }[])
    .map((row) => row.content ?? '')
    .join('\n');
};

const balanceOf = async (address: string): Promise<number> => {
  const answer = await post(WALLET, { action: 'balance', address });
  return (answer.body as { balance?: number } | null)?.balance ?? -1;
};

const cleanup = async () => {
  await sr.from('hireme_missions').delete().eq('number', DATABASE_NUMBER);
  await sr.from('email_accounts').delete().eq('signed_up_by', contractor.publicKeyHex);
  await sr.from('email_sends').delete().eq('player_key', contractor.publicKeyHex);
  for (const machineId of [KEY_BOX, GATEWAY, WORKSTATION]) {
    await sr.from('patches').delete().eq('machine_id', machineId);
  }
  for (const player of [contractor, visitor, shellPlayer]) {
    await sr.from('sessions').delete().eq('player_key', player.publicKeyHex);
    await sr.from('home_network_occupants').delete().eq('owner_key', player.publicKeyHex);
    await sr.from('network_lan_leases').delete().eq('owner_key', player.publicKeyHex);
  }
  await sr.from('wallet_transfers').delete().eq('to_address', WALLET_ADDRESS);
  await sr.from('wallet_balances').delete().eq('address', WALLET_ADDRESS);
};

const main = async () => {
  if (homeEssid === undefined || ADDRESS === '') {
    console.error('the world does not hold what this check assumes');
    process.exit(2);
  }
  console.log(`database route contract ${DATABASE_NUMBER} at ${ADDRESS}\n`);
  await cleanup();

  const joined = await post(
    NETWORK,
    signRequest(contractor, 'registerNetwork', {
      essid: homeEssid,
      workstation_machine_id: WORKSTATION,
      workstation_username: 'newbie',
      workstation_machine_name: 'newbie',
      workstation_root_hash: md5('newbie-root-secret'),
    }),
  );
  if (joined.status !== 200) {
    console.error(`Could not put the contractor on a network: status ${joined.status}`);
    process.exit(2);
  }
  await seedFile(WORDLIST_PATH, formatWordlist(DEFAULT_WORDLIST));
  const { error: mailboxError } = await sr.from('email_accounts').insert({
    handle: HANDLE,
    password_md5: md5('s3cret'),
    signed_up_by: contractor.publicKeyHex,
  });
  if (mailboxError) throw new Error(`mailbox insert failed: ${mailboxError.message}`);

  // === 1. THE ACCEPT MAKES THE ADDRESS ANSWER, THROUGH BOTH FORWARDS. ===
  runHireme(['accept', HANDLE, '--number', String(DATABASE_NUMBER)]);
  const scan = await post(
    NETWORK,
    signRequest(contractor, 'resolvePublicScan', { target: ADDRESS }),
  );
  check(
    'nmap <address> shows :3306 and :2222',
    scan.status === 200 && portsOf(scan.body).includes(3306) && portsOf(scan.body).includes(2222),
    `status ${scan.status} ports=[${portsOf(scan.body).join(',')}]`,
  );

  // === 2. THE SWEEP FINDS THE ACCOUNT, NEVER DATABASE ROOT, AND LEAVES LINES. ===
  const swept = await hydra('mysql', DATABASE_PORT);
  check(
    'hydra <address> mysql finds the application account and not database root',
    swept.status === 200 &&
      crackedUsernames(swept.body).includes(ACCOUNT) &&
      !crackedUsernames(swept.body).includes('root'),
    `status ${swept.status} cracked ${crackedUsernames(swept.body).length}`,
  );
  const sweepLog = await mysqlLogOfKeyBox();
  check(
    'the sweep leaves lines in mysql.log on the key box',
    sweepLog.includes(ACCOUNT),
    `${sweepLog.split('\n').length} lines`,
  );

  // === 3. THE LOGIN OPENS IT, AND THE TABLE HOLDS THE WORD. ===
  const opened = await connect(ACCOUNT_LOGIN);
  check('mysql <address> <account> opens', opened.status === 200, `status ${opened.status}`);
  const refused = await connect({ username: ACCOUNT, password: 'not-the-password' });
  check('a wrong password is refused', refused.status === 401, `status ${refused.status}`);
  const loginLog = await mysqlLogOfKeyBox();
  check(
    'the login leaves its own line',
    loginLog.split('\n').length > sweepLog.split('\n').length,
    `${loginLog.split('\n').length} lines`,
  );
  const tables = await statement('SHOW TABLES');
  check(
    'SHOW TABLES lists settings beside the generated tables',
    tables.status === 200 && tables.output.includes('settings') && tables.output.includes('users'),
    `status ${tables.status}`,
  );
  const selected = await statement('SELECT * FROM settings');
  check(
    'SELECT shows the word, read by the server from JSHACK_SECRETS at runtime',
    selected.status === 200 && selected.output.includes(WORD),
    `status ${selected.status}`,
  );
  check(
    'nothing in the table says whose word it is',
    selected.output.length > 0 && !/root/i.test(selected.output),
    '(output not echoed: it holds the word)',
  );

  // === 4. THE FILE IS ROOT'S, AND A GUEST SHELL STILL HAS THE DATABASE. ===
  const { error: shellError } = await sr.from('sessions').insert({
    session_id: `ssh-shell-${RUN}`,
    player_key: shellPlayer.publicKeyHex,
    machine_id: KEY_BOX,
    credentials: { username: 'guest', userType: 'guest' },
    kind: 'ssh',
    essid: ESSID,
  });
  if (shellError) throw new Error(`guest session failed: ${shellError.message}`);
  check(
    'a guest shell on the box cannot cat data.json',
    readFile(await readBox(shellPlayer), 'guest', DATADIR_PATH) === null,
    DATADIR_PATH,
  );
  const localLogin = await post(
    SESSIONS,
    signRequest(shellPlayer, 'mysqlConnect', {
      essid: ESSID,
      target_ip: LOOPBACK_IPV4,
      port: DATABASE_PORT,
      ...ACCOUNT_LOGIN,
      caller_machine_id: KEY_BOX,
    }),
  );
  check(
    'that guest can run mysql localhost <account>',
    localLogin.status === 200,
    `status ${localLogin.status}`,
  );
  const localSelect = await post(
    SESSIONS,
    signRequest(shellPlayer, 'mysqlStatement', {
      essid: ESSID,
      target_ip: LOOPBACK_IPV4,
      port: DATABASE_PORT,
      ...ACCOUNT_LOGIN,
      statement: 'SELECT * FROM settings',
      caller_machine_id: KEY_BOX,
    }),
  );
  check(
    'and read the table over localhost',
    localSelect.status === 200 &&
      ((localSelect.body as { output?: readonly string[] } | null)?.output ?? [])
        .join('\n')
        .includes(WORD),
    `status ${localSelect.status}`,
  );

  // === 5. HYDRA NEEDS THE WORD ON ITS LIST, AND THE WORD NEVER OPENS DATABASE ROOT. ===
  const without = await hydra('ssh', 2222);
  check(
    'without the word, hydra finds no root on :2222',
    without.status === 200 && !crackedUsernames(without.body).includes('root'),
    `status ${without.status} cracked ${crackedUsernames(without.body).length}`,
  );
  await seedFile(WORDLIST_PATH, formatWordlist([...DEFAULT_WORDLIST, WORD]));
  const withWord = await hydra('ssh', 2222);
  check(
    'with the word appended to passwords.txt, hydra finds root on :2222',
    withWord.status === 200 && crackedUsernames(withWord.body).includes('root'),
    `status ${withWord.status} cracked ${crackedUsernames(withWord.body).length}`,
  );
  const withWordOnDatabase = await hydra('mysql', DATABASE_PORT);
  check(
    'and not database root on :3306',
    withWordOnDatabase.status === 200 && !crackedUsernames(withWordOnDatabase.body).includes('root'),
    `status ${withWordOnDatabase.status}`,
  );
  const wordAsDatabaseRoot = await connect({ username: 'root', password: WORD });
  check(
    'the word is refused as database root',
    wordAsDatabaseRoot.status === 401,
    `status ${wordAsDatabaseRoot.status}`,
  );
  const exploited = await post(
    SESSIONS,
    signRequest(contractor, 'exploitCreateSession', {
      session_id: `msf-${RUN}`,
      essid: homeEssid,
      target_ip: ADDRESS,
      port: DATABASE_PORT,
      caller_machine_id: WORKSTATION,
      parent_session_id: null,
    }),
  );
  // A shell names what it landed as `userType`, and an effect that opens no shell names it `tier`.
  const exploitBody = exploited.body as { userType?: string; tier?: string } | null;
  const exploitTier = exploitBody?.userType ?? exploitBody?.tier;
  check(
    'msfconsole through :3306 finds no root',
    exploited.status === 200 && exploitTier !== undefined && exploitTier !== 'root',
    `status ${exploited.status} tier ${exploitTier ?? '-'}`,
  );
  await sr.from('sessions').delete().eq('session_id', `msf-${RUN}`);

  // === 6. THE WORD OPENS ROOT, WHO SEES IT IN THE FILE, AND THE KEY PAYS. ===
  const rooted = await sshToKeyBox(contractor, 'root', WORD);
  check(
    'ssh root@<address> -p 2222 with the word lands root on the key box',
    rooted.status === 200 &&
      (rooted.body as { machine_id?: string } | null)?.machine_id === KEY_BOX,
    `status ${rooted.status}`,
  );
  const asRoot = await readBox(contractor);
  check(
    'that root shell reads the key',
    readFile(asRoot, 'root', KEY_PATH)?.trim() === KEY,
    `key path ${KEY_PATH}`,
  );
  check(
    'and can cat data.json, and sees the word in it',
    readFile(asRoot, 'root', DATADIR_PATH)?.includes(WORD) === true,
    DATADIR_PATH,
  );
  const terms = missionTerms(DATABASE_NUMBER);
  const mailed = await post(
    NETWORK,
    signRequest(contractor, 'resolveMail', {
      op: 'send',
      password: 's3cret',
      subject: 'the job',
      handle: HANDLE,
      to: terms.client.handle,
      body: `${KEY}\n${WALLET_ADDRESS}\n`,
    }),
  );
  check(
    'mailing the key pays as on any route',
    mailed.status === 200 && (await balanceOf(WALLET_ADDRESS)) === terms.pay,
    `status ${mailed.status} balance ${await balanceOf(WALLET_ADDRESS)} (want ${terms.pay})`,
  );

  // === 7. `show` NAMES IT ALL. ===
  const shown = runHireme(['show', ADDRESS]);
  check(
    '`show` prints the route, both forwards, the path and the word',
    shown.includes('Route:    mysql') &&
      shown.includes(':3306 -> key box :3306') &&
      shown.includes(':2222 -> key box :22') &&
      shown.includes(`Leak:     ${DATADIR_PATH}`) &&
      shown.includes(`Word:     ${WORD}`),
    '(output not echoed: it holds the word)',
  );

  // === 8. A CHANGE TO ANOTHER TABLE KEEPS settings. ===
  const changed = await statement("UPDATE users SET role = 'editor'");
  const afterChange = await statement('SELECT * FROM settings');
  check(
    'a statement changing another table leaves settings and its word',
    changed.status === 200 && changed.failed === false && afterChange.output.includes(WORD),
    `update ${changed.status}, select ${afterChange.status}`,
  );

  // === 9. A DELETE STICKS, AND LEAVES THE KEY. ===
  const deleted = await statement("DELETE FROM settings WHERE name = 'admin_pass'");
  const afterDelete = await statement('SELECT * FROM settings');
  check(
    "after the account's DELETE, a later visitor no longer finds the row",
    deleted.status === 200 &&
      deleted.failed === false &&
      !afterDelete.output.includes(WORD) &&
      !afterDelete.output.includes('admin_pass'),
    `delete ${deleted.status}, select ${afterDelete.status}`,
  );
  check(
    'the key file is unaffected',
    readFile(await readBox(contractor), 'root', KEY_PATH)?.trim() === KEY,
    `key path ${KEY_PATH}`,
  );
  check(
    'the root password itself still works, since a table is not the login',
    (await sshToKeyBox(visitor, 'root', WORD)).status === 200,
    'over :2222',
  );

  // === 10. A ROOT'S rm STICKS, REFUSES THE ACCOUNT, AND LEAVES THE KEY. ===
  const removed = await post(
    PATCHES,
    signRequest(contractor, 'removePatch', {
      machine_id: KEY_BOX,
      path: DATADIR_PATH,
      owner: 'root',
    }),
  );
  const afterRm = await connect(ACCOUNT_LOGIN);
  check(
    "after a root's rm of data.json, the account's login is refused",
    removed.status === 200 && afterRm.status === 401,
    `rm ${removed.status}, login ${afterRm.status}`,
  );
  check(
    'the key file is still unaffected',
    readFile(await readBox(contractor), 'root', KEY_PATH)?.trim() === KEY,
    `key path ${KEY_PATH}`,
  );

  await cleanup();

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : 'the check crashed');
  await cleanup();
  process.exit(1);
});
