// Wire-check for THE FTP ROUTE — a contract whose key box lets `anonymous` in and leaves root's
// password in `/srv/ftp/pub`, driven end to end against a running `vercel dev` + supabase, staging
// the job through the REAL `scripts/hireme.ts` and working it through the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - BOTH FORWARDS ANSWER: nmap shows :21 and :2222.
//   - A SESSION ROW HOLDS A USERNAME NO /etc/passwd DOES, opened over the public door and over
//     `localhost` from a shell on the box, with any password.
//   - THE FILE REACHES AN ANONYMOUS SESSION, and the key does not, over the live read.
//   - THE LOG NAMES IT: `[anonymous] OK LOGIN` and `OK DOWNLOAD`, read back off the box.
//   - ANONYMOUS IS NO LOGIN ANYWHERE ELSE: ssh and scp refuse it, and it cannot `put`.
//   - THE WORD OPENS ROOT over ssh on :2222 and over ftp on :21, and hydra finds it only once it
//     is on the list. MSFCONSOLE FINDS NO ROOT through :21.
//   - THE JOB PAYS AS ON ANY ROUTE: root reads the key, and mailing it mints the pay.
//   - THE DOOR READS THE LIVE CONFIG: a root's `NO` closes it and `YES` reopens it.
//   - A ROOT'S rm STICKS, and the key is untouched.
//
// The word is compared and never printed. `show` prints it, so its output is checked and not
// echoed.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionFtp.ts
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
import { RIDGEMONT } from '../src/core/generation/world.js';
import { md5 } from '../src/core/generation/md5.js';
import { LOOPBACK_IPV4 } from '../src/core/network/interfaces.js';
import { VSFTPD_LOG_PATH } from '../src/core/logging/vsftpdLog.js';
import {
  DEFAULT_WORDLIST,
  WORDLIST_PATH,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist.js';
import { missionShape } from '../src/core/missions/missionShape.js';
import { missionLeakPath } from '../src/core/missions/missionLeak.js';
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

const ftpNumber = (from: number): number => {
  for (let candidate = from; candidate < from + 20000; candidate += 1) {
    if (isMissionNumber(candidate) && missionShape(candidate).route === 'ftp') return candidate;
  }
  throw new Error(`no ftp route number found from ${from}`);
};

const FTP_NUMBER = ftpNumber(210000);
const ESSID = missionEssid(FTP_NUMBER);
const ADDRESS = missionAddressForNumber(FTP_NUMBER) ?? '';
const KEY_PATH = missionKeyPath(FTP_NUMBER);
const KEY = missionKey(FTP_NUMBER, secret);
const LEAK_PATH = missionLeakPath(FTP_NUMBER) ?? '';
const WORD = plaintextFor(missionShape(FTP_NUMBER).keyBoxRootHash);
const CONFIG_PATH = '/etc/vsftpd.conf';

const keyBoxHost = generateHomeLan(ESSID).hosts.find((host) => host.kind === 'machine');
if (keyBoxHost === undefined) throw new Error('a contract network has a key box');
const KEY_BOX = machineIdForLanHost(keyBoxHost, ESSID);
const GATEWAY = computeApGatewayId(ESSID);

const contractor = generateIdentityIn(RIDGEMONT);
const visitor = generateIdentityIn(RIDGEMONT);
const shellPlayer = generateIdentityIn(RIDGEMONT);
const RUN = Date.now().toString(36).slice(-6);
const HANDLE = `ftpl${RUN}`;
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

let doorKnocks = 0;

/** A login at the public address, as `ftp`, `scp` or `ssh` send it. */
const knock = (
  caller: typeof contractor,
  door: { readonly kind: 'ftp' | 'ssh' | 'scp'; readonly port: number },
  username: string,
  password: string,
) => {
  doorKnocks += 1;
  return post(
    SESSIONS,
    signRequest(caller, 'authCreateSessionPublic', {
      session_id: `${door.kind}-${RUN}-${doorKnocks}`,
      target: ADDRESS,
      port: door.port,
      username,
      password,
      parent_session_id: null,
      source_ip: null,
      kind: door.kind,
    }),
  );
};

const FTP_DOOR = { kind: 'ftp', port: 21 } as const;
const SSH_DOOR = { kind: 'ssh', port: 2222 } as const;
const SCP_DOOR = { kind: 'scp', port: 2222 } as const;

const anonymous = (caller: typeof contractor, password = 'anything') =>
  knock(caller, FTP_DOOR, 'anonymous', password);

const hydra = (service: 'ssh' | 'ftp', port: number) =>
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

const vsftpdLogOfKeyBox = async (): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', KEY_BOX)
    .eq('path', VSFTPD_LOG_PATH);
  return ((data ?? []) as readonly { content?: string }[])
    .map((row) => row.content ?? '')
    .join('\n');
};

const writeConfig = (content: string) =>
  post(
    PATCHES,
    signRequest(contractor, 'upsertPatch', {
      machine_id: KEY_BOX,
      path: CONFIG_PATH,
      content,
      owner: 'root',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
      node_type: 'file',
    }),
  );

const balanceOf = async (address: string): Promise<number> => {
  const answer = await post(WALLET, { action: 'balance', address });
  return (answer.body as { balance?: number } | null)?.balance ?? -1;
};

const cleanup = async () => {
  await sr.from('hireme_missions').delete().eq('number', FTP_NUMBER);
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
  if (homeEssid === undefined || ADDRESS === '' || LEAK_PATH === '') {
    console.error('the world does not hold what this check assumes');
    process.exit(2);
  }
  console.log(`ftp route contract ${FTP_NUMBER} at ${ADDRESS}\n`);
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
  runHireme(['accept', HANDLE, '--number', String(FTP_NUMBER)]);
  const scan = await post(
    NETWORK,
    signRequest(contractor, 'resolvePublicScan', { target: ADDRESS }),
  );
  check(
    'nmap <address> shows :21 and :2222',
    scan.status === 200 && portsOf(scan.body).includes(21) && portsOf(scan.body).includes(2222),
    `status ${scan.status} ports=[${portsOf(scan.body).join(',')}]`,
  );

  // === 2. ANONYMOUS GETS IN WITH ANY PASSWORD, AT GUEST TIER. ===
  const anon = await anonymous(contractor);
  check(
    'ftp <address> anonymous opens a guest session on the key box',
    anon.status === 200 &&
      (anon.body as { userType?: string } | null)?.userType === 'guest' &&
      (anon.body as { machine_id?: string } | null)?.machine_id === KEY_BOX,
    `status ${anon.status}`,
  );
  const { data: anonRow } = await sr
    .from('sessions')
    .select('credentials, kind')
    .eq('session_id', `ftp-${RUN}-${doorKnocks}`)
    .maybeSingle();
  check(
    'the session row holds a username no /etc/passwd does',
    (anonRow as { credentials?: { username?: string } } | null)?.credentials?.username ===
      'anonymous',
    JSON.stringify(anonRow),
  );
  const emptyPassword = await anonymous(contractor, '');
  check(
    'an empty password opens it too',
    emptyPassword.status === 200,
    `status ${emptyPassword.status}`,
  );

  // === 3. THE SESSION SEES THE FILE AND NOT THE KEY. ===
  const asAnonymous = await readBox(contractor);
  const leaked = readFile(asAnonymous, 'guest', LEAK_PATH);
  const pubListing =
    asAnonymous === null
      ? []
      : (() => {
          const listed = createFsView(asAnonymous, { userType: 'guest' }).list(
            asAbsPath('/srv/ftp/pub'),
          );
          return listed.ok ? listed.entries : [];
        })();
  check(
    'pub/ lists the file',
    pubListing.includes(LEAK_PATH.split('/').at(-1) ?? ''),
    `${pubListing.length} entries`,
  );
  check(
    'the file holds the word, read by the server from JSHACK_SECRETS at runtime',
    leaked?.includes(WORD) === true,
    leaked === null ? 'no file' : 'file read',
  );
  check('the file never names the account', leaked !== null && !/root/i.test(leaked), LEAK_PATH);
  check(
    'an anonymous session cannot read the key',
    asAnonymous !== null && readFile(asAnonymous, 'guest', KEY_PATH) === null,
    `key path ${KEY_PATH}`,
  );

  // === 4. THE LOG NAMES THE VISIT. ===
  const transfer = await post(
    PATCHES,
    signRequest(contractor, 'recordFtpTransfer', {
      direction: 'download',
      machine_id: KEY_BOX,
      path: LEAK_PATH,
      bytes: leaked?.length ?? 0,
    }),
  );
  const logged = await vsftpdLogOfKeyBox();
  check(
    'vsftpd.log records [anonymous] OK LOGIN',
    logged.includes('[anonymous] OK LOGIN'),
    `${logged.split('\n').length} lines`,
  );
  check(
    'vsftpd.log records [anonymous] OK DOWNLOAD of the file',
    transfer.status === 200 && logged.includes('[anonymous] OK DOWNLOAD') && logged.includes(LEAK_PATH),
    `status ${transfer.status}`,
  );

  // === 5. ANONYMOUS IS AN FTP LOGIN AND NOTHING ELSE. ===
  const put = await post(
    PATCHES,
    signRequest(visitor, 'upsertPatch', {
      machine_id: KEY_BOX,
      path: '/srv/ftp/pub/dropped.txt',
      content: 'dropped',
      owner: 'anonymous',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
      node_type: 'file',
      is_new: true,
    }),
  );
  const visitorIn = await anonymous(visitor);
  const putAsAnonymous = await post(
    PATCHES,
    signRequest(visitor, 'upsertPatch', {
      machine_id: KEY_BOX,
      path: '/srv/ftp/pub/dropped.txt',
      content: 'dropped',
      owner: 'anonymous',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
      node_type: 'file',
      is_new: true,
    }),
  );
  check(
    'an anonymous session cannot put a file',
    put.status !== 200 && visitorIn.status === 200 && putAsAnonymous.status === 403,
    `no session ${put.status}, anonymous ${putAsAnonymous.status}`,
  );
  const overSsh = await knock(visitor, SSH_DOOR, 'anonymous', 'anything');
  const overScp = await knock(visitor, SCP_DOOR, 'anonymous', 'anything');
  const nobody = await knock(visitor, FTP_DOOR, 'nobody', 'anything');
  check(
    'ssh and scp refuse anonymous, and another unknown name fails at the ftp door',
    overSsh.status === 401 && overScp.status === 401 && nobody.status === 401,
    `ssh ${overSsh.status}, scp ${overScp.status}, unknown ${nobody.status}`,
  );

  // === 6. FROM A SHELL ON THE BOX, OVER localhost. ===
  const { error: shellError } = await sr.from('sessions').insert({
    session_id: `ssh-shell-${RUN}`,
    player_key: shellPlayer.publicKeyHex,
    machine_id: KEY_BOX,
    credentials: { username: 'guest', userType: 'guest' },
    kind: 'ssh',
    essid: ESSID,
  });
  if (shellError) throw new Error(`guest session failed: ${shellError.message}`);
  const local = await post(
    SESSIONS,
    signRequest(shellPlayer, 'authCreateSession', {
      session_id: `ftp-local-${RUN}`,
      essid: ESSID,
      target_ip: LOOPBACK_IPV4,
      port: 21,
      username: 'anonymous',
      password: 'anything',
      parent_session_id: `ssh-shell-${RUN}`,
      caller_machine_id: KEY_BOX,
      kind: 'ftp',
    }),
  );
  check(
    'a guest shell on the box can run ftp localhost anonymous',
    local.status === 200 && (local.body as { userType?: string } | null)?.userType === 'guest',
    `status ${local.status}`,
  );
  check(
    'that guest can also cat the file, since a guest may read it',
    readFile(await readBox(shellPlayer), 'guest', LEAK_PATH)?.includes(WORD) === true,
    LEAK_PATH,
  );

  // === 7. HYDRA NEEDS THE WORD ON ITS LIST, AND THE HOLE GIVES NO ROOT. ===
  const without = await hydra('ssh', 2222);
  const withoutFtp = await hydra('ftp', 21);
  check(
    'without the word, hydra finds no root on :2222 or :21',
    without.status === 200 &&
      withoutFtp.status === 200 &&
      !crackedUsernames(without.body).includes('root') &&
      !crackedUsernames(withoutFtp.body).includes('root'),
    `ssh ${without.status} [${crackedUsernames(without.body).join(', ')}], ftp ${withoutFtp.status} [${crackedUsernames(withoutFtp.body).join(', ')}]`,
  );
  await seedFile(WORDLIST_PATH, formatWordlist([...DEFAULT_WORDLIST, WORD]));
  const withWord = await hydra('ssh', 2222);
  check(
    'with the word appended to passwords.txt, hydra finds root',
    withWord.status === 200 && crackedUsernames(withWord.body).includes('root'),
    `status ${withWord.status} cracked [${crackedUsernames(withWord.body).join(', ')}]`,
  );
  const exploited = await post(
    SESSIONS,
    signRequest(contractor, 'exploitCreateSession', {
      session_id: `msf-${RUN}`,
      essid: homeEssid,
      target_ip: ADDRESS,
      port: 21,
      caller_machine_id: WORKSTATION,
      parent_session_id: null,
    }),
  );
  // A shell names what it landed as `userType`, and an effect that opens no shell names it `tier`.
  const exploitBody = exploited.body as { userType?: string; tier?: string } | null;
  const exploitTier = exploitBody?.userType ?? exploitBody?.tier;
  check(
    'msfconsole through :21 finds no root',
    exploited.status === 200 && exploitTier !== undefined && exploitTier !== 'root',
    `status ${exploited.status} tier ${exploitTier ?? '-'}`,
  );
  await sr.from('sessions').delete().eq('session_id', `msf-${RUN}`);

  // === 8. THE WORD OPENS ROOT, THROUGH EITHER DOOR, AND THE KEY PAYS. ===
  const rootOverFtp = await knock(contractor, FTP_DOOR, 'root', WORD);
  check(
    'ftp <address> root with the word opens a root session',
    rootOverFtp.status === 200 &&
      (rootOverFtp.body as { userType?: string } | null)?.userType === 'root',
    `status ${rootOverFtp.status}`,
  );
  const rooted = await knock(contractor, SSH_DOOR, 'root', WORD);
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
  const terms = missionTerms(FTP_NUMBER);
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

  // === 9. `show` NAMES IT ALL. ===
  const shown = runHireme(['show', ADDRESS]);
  check(
    '`show` prints the route, both forwards, the path and the word',
    shown.includes('Route:    ftp') &&
      shown.includes(':21 -> key box :21') &&
      shown.includes(':2222 -> key box :22') &&
      shown.includes(`Leak:     ${LEAK_PATH}`) &&
      shown.includes(`Word:     ${WORD}`),
    '(output not echoed: it holds the word)',
  );

  // === 10. THE DOOR READS THE LIVE CONFIG. ===
  const closed = await writeConfig('listen=YES\nanonymous_enable=NO\n');
  const refused = await anonymous(visitor);
  const refusalLog = await vsftpdLogOfKeyBox();
  check(
    "after a root's NO, a later visitor is refused and the log says so",
    closed.status === 200 && refused.status === 401 && refusalLog.includes('[anonymous] FAIL LOGIN'),
    `write ${closed.status}, login ${refused.status}`,
  );
  check(
    'the file is still there',
    readFile(await readBox(contractor), 'root', LEAK_PATH)?.includes(WORD) === true,
    LEAK_PATH,
  );
  const reopened = await writeConfig('listen=YES\nanonymous_enable=YES\n');
  const backIn = await anonymous(visitor);
  check(
    'setting it back reopens the door',
    reopened.status === 200 && backIn.status === 200,
    `write ${reopened.status}, login ${backIn.status}`,
  );

  // === 11. A ROOT'S rm STICKS, AND LEAVES THE KEY. ===
  const removed = await post(
    PATCHES,
    signRequest(contractor, 'removePatch', { machine_id: KEY_BOX, path: LEAK_PATH, owner: 'root' }),
  );
  check(
    "after a root's rm, a later visitor no longer finds the file",
    removed.status === 200 && readFile(await readBox(visitor), 'guest', LEAK_PATH) === null,
    `rm status ${removed.status}`,
  );
  check(
    'the key file is unaffected',
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
