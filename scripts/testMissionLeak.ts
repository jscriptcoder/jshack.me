// Wire-check for THE WEB ROUTE — a contract whose key box leaves root's password in a forgotten
// file, driven end to end against a running `vercel dev` + supabase, staging the job through the
// REAL `scripts/hireme.ts` and working it through the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE SERVER READS `JSHACK_SECRETS` AT RUNTIME. Until now only the build did.
//   - BOTH FORWARDS ANSWER: nmap shows :80 and :2222.
//   - A DEFAULT SWEEP FINDS THE FILE, a fetch returns the word and never the account, and each
//     request is a line in the key box's access.log.
//   - THE WORD OPENS ROOT over ssh on :2222, and hydra finds it only once it is on the list.
//   - MSFCONSOLE FINDS NO ROOT through :80.
//   - THE JOB PAYS AS ON ANY ROUTE: root reads the key, and mailing it mints the pay.
//   - A GUEST SHELL CANNOT READ THE FILE OFF THE DISK, but gets it from `curl localhost`.
//   - A ROOT'S rm STICKS: the next visitor gets a 404, and the key is untouched.
//
// The word is compared and never printed. `show` prints it, so its output is checked and not
// echoed.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionLeak.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
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
import {
  DEFAULT_DIRLIST,
  DIRLIST_PATH,
  formatDirlist,
} from '../src/core/network/defaultDirlist.js';
import { LOOPBACK_IPV4 } from '../src/core/network/interfaces.js';
import { ACCESS_LOG_PATH } from '../src/core/logging/accessLog.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
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

const contentOf = (body: unknown): string => {
  const content = (body as { content?: unknown } | null)?.content;
  return typeof content === 'string' ? content : '';
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

const webNumber = (from: number): number => {
  for (let candidate = from; candidate < from + 20000; candidate += 1) {
    // A contract that keeps its key in a plain file, which is where this check reads it.
    if (
      isMissionNumber(candidate) &&
      missionShape(candidate).keyBox.route === 'web' &&
      missionShape(candidate).storage === 'file'
    ) {
      return candidate;
    }
  }
  throw new Error(`no web route number found from ${from}`);
};

const WEB_NUMBER = webNumber(200000);
const ESSID = missionEssid(WEB_NUMBER);
const ADDRESS = missionAddressForNumber(WEB_NUMBER) ?? '';
const KEY_PATH = missionKeyPath(WEB_NUMBER);
const KEY = missionKey(WEB_NUMBER, secret);
const LEAK_PATH = missionLeakPath(WEB_NUMBER) ?? '';
const LEAK_REQUEST = LEAK_PATH.replace('/var/www/html', '');
const WORD = plaintextFor(missionShape(WEB_NUMBER).keyBox.rootHash);

const keyBoxHost = generateHomeLan(ESSID).hosts.find((host) => host.kind === 'machine');
if (keyBoxHost === undefined) throw new Error('a contract network has a key box');
const KEY_BOX = machineIdForLanHost(keyBoxHost, ESSID);
const GATEWAY = computeApGatewayId(ESSID);

const contractor = generateIdentityIn(RIDGEMONT);
const guestPlayer = generateIdentityIn(RIDGEMONT);
const RUN = Date.now().toString(36).slice(-6);
const HANDLE = `leak${RUN}`;
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

const fetchAt = (path: string) =>
  post(NETWORK, signRequest(contractor, 'resolveHttpFetch', { target: ADDRESS, port: 80, path }));

const hydra = () =>
  post(
    SESSIONS,
    signRequest(contractor, 'hydraCrack', {
      essid: homeEssid,
      target_ip: ADDRESS,
      service: 'ssh',
      caller_machine_id: WORKSTATION,
      port: 2222,
    }),
  );

const readBox = async (caller: typeof contractor, machineId: string): Promise<Directory | null> => {
  const answer = await post(
    NETWORK,
    signRequest(caller, 'resolveCrossPlayerFs', { machine_id: machineId }),
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

const accessLogOfKeyBox = async (): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', KEY_BOX)
    .eq('path', ACCESS_LOG_PATH)
    .eq('writer_key', apGatewayLogWriterKey(ESSID))
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};

const balanceOf = async (address: string): Promise<number> => {
  const answer = await post(WALLET, { action: 'balance', address });
  return (answer.body as { balance?: number } | null)?.balance ?? -1;
};

const cleanup = async () => {
  await sr.from('hireme_missions').delete().eq('number', WEB_NUMBER);
  await sr.from('email_accounts').delete().eq('signed_up_by', contractor.publicKeyHex);
  await sr.from('email_sends').delete().eq('player_key', contractor.publicKeyHex);
  for (const machineId of [KEY_BOX, GATEWAY, WORKSTATION]) {
    await sr.from('patches').delete().eq('machine_id', machineId);
  }
  for (const player of [contractor, guestPlayer]) {
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
  console.log(`web route contract ${WEB_NUMBER} at ${ADDRESS}\n`);
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
  await seedFile(DIRLIST_PATH, formatDirlist(DEFAULT_DIRLIST));
  await seedFile(WORDLIST_PATH, formatWordlist(DEFAULT_WORDLIST));
  const { error: mailboxError } = await sr.from('email_accounts').insert({
    handle: HANDLE,
    password_md5: md5('s3cret'),
    signed_up_by: contractor.publicKeyHex,
  });
  if (mailboxError) throw new Error(`mailbox insert failed: ${mailboxError.message}`);

  // === 1. THE ACCEPT MAKES THE ADDRESS ANSWER, THROUGH BOTH FORWARDS. ===
  runHireme(['accept', HANDLE, '--number', String(WEB_NUMBER)]);
  const scan = await post(
    NETWORK,
    signRequest(contractor, 'resolvePublicScan', { target: ADDRESS }),
  );
  check(
    'nmap <address> shows :80 and :2222',
    scan.status === 200 && portsOf(scan.body).includes(80) && portsOf(scan.body).includes(2222),
    `status ${scan.status} ports=[${portsOf(scan.body).join(',')}]`,
  );

  // === 2. A DEFAULT SWEEP FINDS THE FILE. ===
  const swept = await post(
    NETWORK,
    signRequest(contractor, 'resolveHttpSweep', {
      target: ADDRESS,
      port: 80,
      caller_machine_id: WORKSTATION,
    }),
  );
  const found = (
    (swept.body as { results?: readonly { path: string; status: number }[] } | null)?.results ?? []
  )
    .filter((result) => result.status === 200)
    .map((result) => result.path);
  check(
    'a default gobuster finds the forgotten file',
    swept.status === 200 && found.includes(LEAK_REQUEST),
    `status ${swept.status} found [${found.join(', ')}] (want ${LEAK_REQUEST})`,
  );

  // === 3. THE FETCH HOLDS THE WORD AND NEVER THE ACCOUNT, AND LEAVES A LINE. ===
  const page = await fetchAt(LEAK_REQUEST);
  check(
    'curl returns the word, read by the server from JSHACK_SECRETS at runtime',
    page.status === 200 && contentOf(page.body).includes(WORD),
    `status ${page.status} ${page.status === 200 ? '' : JSON.stringify(page.body)}`,
  );
  check(
    'the file never names the account',
    page.status === 200 && !/root/i.test(contentOf(page.body)),
    `status ${page.status}`,
  );
  const accessLog = await accessLogOfKeyBox();
  check(
    'the sweep and the fetch are lines in the key box access.log',
    accessLog.split('\n').filter((line) => line.includes(`GET ${LEAK_REQUEST} `)).length === 2,
    `${accessLog.split('\n').filter((line) => line.length > 0).length} lines`,
  );

  // === 4. HYDRA NEEDS THE WORD ON ITS LIST. ===
  const without = await hydra();
  check(
    'without the word, hydra on :2222 finds no root',
    without.status === 200 && !crackedUsernames(without.body).includes('root'),
    `status ${without.status} cracked [${crackedUsernames(without.body).join(', ')}]`,
  );
  await seedFile(WORDLIST_PATH, formatWordlist([...DEFAULT_WORDLIST, WORD]));
  const withWord = await hydra();
  check(
    'with the word appended to passwords.txt, hydra finds root',
    withWord.status === 200 && crackedUsernames(withWord.body).includes('root'),
    `status ${withWord.status} cracked [${crackedUsernames(withWord.body).join(', ')}]`,
  );

  // === 5. MSFCONSOLE FINDS NO ROOT THROUGH :80. ===
  const exploited = await post(
    SESSIONS,
    signRequest(contractor, 'exploitCreateSession', {
      session_id: `msf-${RUN}`,
      essid: homeEssid,
      target_ip: ADDRESS,
      port: 80,
      caller_machine_id: WORKSTATION,
      parent_session_id: null,
    }),
  );
  // A shell names what it landed as `userType`, and an effect that opens no shell names it `tier`.
  const exploitBody = exploited.body as { userType?: string; tier?: string } | null;
  const exploitTier = exploitBody?.userType ?? exploitBody?.tier;
  check(
    'msfconsole through :80 finds no root',
    exploited.status === 200 && exploitTier !== undefined && exploitTier !== 'root',
    `status ${exploited.status} tier ${exploitTier ?? '-'}`,
  );
  await sr.from('sessions').delete().eq('session_id', `msf-${RUN}`);

  // === 6. THE WORD OPENS ROOT, AND THE KEY PAYS. ===
  const rooted = await post(
    SESSIONS,
    signRequest(contractor, 'authCreateSessionPublic', {
      session_id: `ssh-root-${RUN}`,
      target: ADDRESS,
      port: 2222,
      username: 'root',
      password: WORD,
      parent_session_id: null,
      source_ip: null,
    }),
  );
  check(
    'ssh root@<address> -p 2222 with the word lands root on the key box',
    rooted.status === 200 &&
      (rooted.body as { machine_id?: string } | null)?.machine_id === KEY_BOX,
    `status ${rooted.status}`,
  );
  const asRoot = await readBox(contractor, KEY_BOX);
  check(
    'that root shell reads the key',
    readFile(asRoot, 'root', KEY_PATH)?.trim() === KEY,
    `key path ${KEY_PATH}`,
  );
  const terms = missionTerms(WEB_NUMBER);
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

  // === 7. A GUEST CANNOT READ IT OFF THE DISK, BUT CAN ASK THE WEB SERVER. ===
  const { error: guestError } = await sr.from('sessions').insert({
    session_id: `ssh-guest-${RUN}-${randomInt(1_000_000)}`,
    player_key: guestPlayer.publicKeyHex,
    machine_id: KEY_BOX,
    credentials: { username: 'guest', userType: 'guest' },
    kind: 'ssh',
    essid: ESSID,
  });
  if (guestError) throw new Error(`guest session failed: ${guestError.message}`);
  const asGuest = await readBox(guestPlayer, KEY_BOX);
  check(
    'a guest shell cannot cat the file',
    asGuest !== null && readFile(asGuest, 'guest', LEAK_PATH) === null,
    `tree ${asGuest === null ? 'missing' : 'served'}`,
  );
  const loopback = await post(
    NETWORK,
    signRequest(guestPlayer, 'resolveOccupantFetch', {
      essid: ESSID,
      target: LOOPBACK_IPV4,
      port: 80,
      path: LEAK_REQUEST,
      caller_machine_id: KEY_BOX,
    }),
  );
  check(
    'that guest gets it from curl localhost',
    loopback.status === 200 && contentOf(loopback.body).includes(WORD),
    `status ${loopback.status}`,
  );

  // === 8. `show` NAMES IT ALL. ===
  const shown = runHireme(['show', ADDRESS]);
  check(
    '`show` prints the route, both forwards, the path and the word',
    shown.includes('Route:    web') &&
      shown.includes(':80 -> key box :80') &&
      shown.includes(':2222 -> key box :22') &&
      shown.includes(`Leak:     ${LEAK_PATH}`) &&
      shown.includes(`Word:     ${WORD}`),
    '(output not echoed: it holds the word)',
  );

  // === 9. A ROOT'S rm STICKS, AND LEAVES THE KEY. ===
  const removed = await post(
    PATCHES,
    signRequest(contractor, 'removePatch', { machine_id: KEY_BOX, path: LEAK_PATH, owner: 'root' }),
  );
  const afterRm = await fetchAt(LEAK_REQUEST);
  check(
    "after a root's rm, a later visitor gets a 404",
    removed.status === 200 && afterRm.status === 404,
    `rm status ${removed.status}, fetch status ${afterRm.status}`,
  );
  check(
    'the key file is unaffected',
    readFile(await readBox(contractor, KEY_BOX), 'root', KEY_PATH)?.trim() === KEY,
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
