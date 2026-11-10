// Wire-check for THE SNMP ROUTE: a contract whose key box gives root's password as its agent's
// contact, driven end to end against a running `vercel dev` + supabase, staging the job through the
// REAL `scripts/hireme.ts` and working it through the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - BOTH FORWARDS ANSWER: nmap shows :161 as the agent and :2222, so a forward to :161 reaches it.
//   - A DEFAULT WALK GETS SILENCE, and the box's log says somebody tried.
//   - THE READ-ONLY COMMUNITY READS THE WORD, from a config the server wrote from JSHACK_SECRETS at
//     runtime, over the public door and over `localhost` from a guest shell on the box.
//   - THE SWEEP FINDS THE READ-WRITE COMMUNITY and never the read-only one, and the walk with what
//     it found shows the word too.
//   - THE WORD OPENS ROOT over ssh on :2222, and hydra finds it only once it is on the list.
//     MSFCONSOLE FINDS NO ROOT through :161.
//   - THE JOB PAYS AS ON ANY ROUTE: root reads the key, and mailing it mints the pay.
//   - THE READ-WRITE COMMUNITY CAN SHUT THE DOORS: a deny on the box's sshd closes :2222 and a
//     permit reopens it, a deny on :161 silences walks, and a forward written there opens nothing.
//   - THE JOURNAL WINS: a root changing the contact, removing the config or stopping the agent
//     changes what a later visitor finds. The key is untouched by any of it.
//
// The word is compared and never printed. `show` prints it, so its output is checked and not
// echoed. The communities are treated the same way.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionSnmp.ts
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
import { RULES_V4_PATH } from '../src/core/network/iptablesRules.js';
import { frontedSegment } from '../src/core/network/frontedSegment.js';
import { SNMPD_LOG_PATH } from '../src/core/logging/snmpdLog.js';
import { SNMPD_CONF_PATH, SNMPD_CONF_PERMISSIONS } from '../src/core/snmp/conf.js';
import { SNMPD_STATE_PATH } from '../src/core/snmp/rwCommunity.js';
import {
  DEFAULT_WORDLIST,
  WORDLIST_PATH,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist.js';
import { missionFiles } from '../src/core/missions/missionLeak.js';
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
import { parseSnmpdConf } from '../src/core/snmp/conf.js';
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
const rawSecrets = process.env.JSHACK_SECRETS;

if (!url || !serviceKey || !secret || !rawSecrets) {
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

type ScannedPort = { readonly port?: number; readonly service?: string };

const portsOf = (body: unknown): readonly ScannedPort[] =>
  (body as { ports?: readonly ScannedPort[] } | null)?.ports ?? [];

const portNumbersOf = (body: unknown): readonly number[] =>
  portsOf(body)
    .map((entry) => entry.port)
    .filter((port): port is number => typeof port === 'number');

const crackedOf = (body: unknown): readonly { username: string; password: string }[] =>
  (body as { cracked?: readonly { username: string; password: string }[] } | null)?.cracked ?? [];

// `shell: true` so Windows resolves `npx.cmd`; the args carry no spaces, so quoting is moot.
const runHireme = (args: readonly string[]): string =>
  execFileSync('npx', ['tsx', 'scripts/hireme.ts', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  }).trim();

const snmpNumber = (from: number): number => {
  for (let candidate = from; candidate < from + 20000; candidate += 1) {
    // A contract that keeps its key in a plain file, which is where this check reads it.
    if (
      isMissionNumber(candidate) &&
      missionShape(candidate).keyBox.route === 'snmp' &&
      missionShape(candidate).storage === 'file'
    ) {
      return candidate;
    }
  }
  throw new Error(`no snmp route number found from ${from}`);
};

const SNMP_NUMBER = snmpNumber(230000);
const ESSID = missionEssid(SNMP_NUMBER);
const ADDRESS = missionAddressForNumber(SNMP_NUMBER) ?? '';
const KEY_PATH = missionKeyPath(SNMP_NUMBER);
const KEY = missionKey(SNMP_NUMBER, secret);
const WORD = plaintextFor(missionShape(SNMP_NUMBER).keyBox.rootHash);
const SNMP_PORT = 161;

const laidConfig =
  missionFiles({ missionNumber: SNMP_NUMBER, role: 'key' }, { keySecret: secret, rawSecrets }).find(
    (laid) => laid.path === SNMPD_CONF_PATH,
  )?.content ?? '';
const READ_ONLY_COMMUNITY = parseSnmpdConf(laidConfig).roCommunity ?? '';
const READ_WRITE_COMMUNITY =
  DEFAULT_WORDLIST.find(
    (word) => md5(word) === missionShape(SNMP_NUMBER).keyBox.communityHash,
  ) ?? '';

const keyBoxHost = generateHomeLan(ESSID).hosts.find((host) => host.kind === 'machine');
if (keyBoxHost === undefined) throw new Error('a contract network has a key box');
const KEY_BOX = machineIdForLanHost(keyBoxHost, ESSID);
const GATEWAY = computeApGatewayId(ESSID);

const contractor = generateIdentityIn(RIDGEMONT);
const visitor = generateIdentityIn(RIDGEMONT);
const shellPlayer = generateIdentityIn(RIDGEMONT);
const RUN = Date.now().toString(36).slice(-6);
const HANDLE = `snm${RUN}`;
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

type Walked = {
  readonly status: number;
  readonly tier: unknown;
  readonly contact: string | null;
  readonly rendered: string;
};

/** A walk over the public door, as the `snmpwalk` command sends it from a workstation. */
const walk = async (community: string): Promise<Walked> => {
  const answer = await post(
    SESSIONS,
    signRequest(contractor, 'snmpWalk', { essid: homeEssid, target_ip: ADDRESS, community }),
  );
  const body = answer.body as { tier?: unknown; identity?: { sysContact?: string } } | null;
  return {
    status: answer.status,
    tier: body?.tier,
    contact: body?.identity?.sysContact ?? null,
    rendered: JSON.stringify(body),
  };
};

const set = (community: string, assignment: string) =>
  post(
    SESSIONS,
    signRequest(contractor, 'snmpSet', {
      essid: homeEssid,
      target_ip: ADDRESS,
      community,
      assignment,
    }),
  );

const hydra = (service: 'ssh' | 'snmp', port: number) =>
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

const scanAddress = () =>
  post(NETWORK, signRequest(contractor, 'resolvePublicScan', { target: ADDRESS }));

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

const patchRowsOfKeyBox = async (path: string): Promise<readonly { content?: string }[]> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', KEY_BOX)
    .eq('path', path);
  return (data ?? []) as readonly { content?: string }[];
};

const snmpdLogOfKeyBox = async (): Promise<string> =>
  (await patchRowsOfKeyBox(SNMPD_LOG_PATH)).map((row) => row.content ?? '').join('\n');

const removeFromKeyBox = (path: string) =>
  post(
    PATCHES,
    signRequest(contractor, 'removePatch', { machine_id: KEY_BOX, path, owner: 'root' }),
  );

const balanceOf = async (address: string): Promise<number> => {
  const answer = await post(WALLET, { action: 'balance', address });
  return (answer.body as { balance?: number } | null)?.balance ?? -1;
};

const cleanup = async () => {
  await sr.from('hireme_missions').delete().eq('number', SNMP_NUMBER);
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
  if (
    homeEssid === undefined ||
    ADDRESS === '' ||
    READ_ONLY_COMMUNITY === '' ||
    READ_WRITE_COMMUNITY === ''
  ) {
    console.error('the world does not hold what this check assumes');
    process.exit(2);
  }
  console.log(`snmp route contract ${SNMP_NUMBER} at ${ADDRESS}\n`);
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
  runHireme(['accept', HANDLE, '--number', String(SNMP_NUMBER)]);
  const scan = await scanAddress();
  check(
    'nmap <address> shows the agent on :161 beside :2222',
    scan.status === 200 &&
      portsOf(scan.body).find((entry) => entry.port === SNMP_PORT)?.service === 'snmp' &&
      portNumbersOf(scan.body).includes(2222),
    `status ${scan.status} ports=[${portNumbersOf(scan.body).join(',')}]`,
  );

  // === 2. A DEFAULT WALK GETS SILENCE, AND THE BOX KNOWS. ===
  const silent = await walk('public');
  check('snmpwalk <address> gets silence', silent.status === 404, `status ${silent.status}`);
  const guessedWrong = await walk('not-a-community');
  check(
    'so does a community the box does not hold',
    guessedWrong.status === 404,
    `status ${guessedWrong.status}`,
  );
  const failureLog = await snmpdLogOfKeyBox();
  check(
    'each leaves an authentication failure in snmpd.log on the key box',
    failureLog.split('\n').filter((line) => line.includes('Authentication failure')).length === 2,
    `${failureLog.split('\n').length} lines`,
  );

  // === 3. THE READ-ONLY COMMUNITY READS THE WORD. ===
  const readOnly = await walk(READ_ONLY_COMMUNITY);
  check(
    'a walk with the read-only community answers at that tier',
    readOnly.status === 200 && readOnly.tier === 'read-only',
    `status ${readOnly.status}`,
  );
  check(
    'and shows the word as the contact, read by the server from JSHACK_SECRETS at runtime',
    readOnly.contact?.includes(WORD) === true,
    '(output not echoed: it holds the word)',
  );
  check(
    'nothing in the walk says whose word it is',
    readOnly.rendered.length > 0 && !/root/i.test(readOnly.rendered),
    '(output not echoed: it holds the word)',
  );
  check(
    'and it leaves a success line in snmpd.log',
    (await snmpdLogOfKeyBox()).includes('Authentication succeeded'),
    SNMPD_LOG_PATH,
  );

  // === 4. THE SWEEP FINDS THE READ-WRITE COMMUNITY AND NEVER THE READ-ONLY ONE. ===
  const logBeforeSweep = await snmpdLogOfKeyBox();
  const swept = await hydra('snmp', SNMP_PORT);
  check(
    'hydra <address> snmp finds the read-write community on the default list',
    swept.status === 200 &&
      crackedOf(swept.body).length === 1 &&
      crackedOf(swept.body)[0]?.password === READ_WRITE_COMMUNITY,
    `status ${swept.status} cracked ${crackedOf(swept.body).length}`,
  );
  check(
    'the sweep leaves lines in snmpd.log',
    (await snmpdLogOfKeyBox()).length > logBeforeSweep.length,
    SNMPD_LOG_PATH,
  );
  await seedFile(WORDLIST_PATH, formatWordlist([READ_ONLY_COMMUNITY]));
  const sweptReadOnly = await hydra('snmp', SNMP_PORT);
  check(
    'a list holding only the read-only community finds nothing',
    sweptReadOnly.status === 200 && crackedOf(sweptReadOnly.body).length === 0,
    `status ${sweptReadOnly.status} cracked ${crackedOf(sweptReadOnly.body).length}`,
  );
  await seedFile(WORDLIST_PATH, formatWordlist(DEFAULT_WORDLIST));
  const readWrite = await walk(READ_WRITE_COMMUNITY);
  check(
    'a walk with what the sweep found answers at the read-write tier and shows the word',
    readWrite.status === 200 &&
      readWrite.tier === 'read-write' &&
      readWrite.contact?.includes(WORD) === true,
    `status ${readWrite.status}`,
  );

  // === 5. THE READ-ONLY COMMUNITY CANNOT WRITE. ===
  const refusedSet = await set(READ_ONLY_COMMUNITY, 'inputPort.22=deny');
  check(
    'a set with the read-only community is refused as not writable',
    refusedSet.status === 200 &&
      (refusedSet.body as { refusal?: { reason?: string } } | null)?.refusal?.reason ===
        'notWritable',
    `status ${refusedSet.status}`,
  );
  check(
    'and writes nothing',
    (await patchRowsOfKeyBox(RULES_V4_PATH)).length === 0,
    RULES_V4_PATH,
  );

  // === 6. A GUEST SHELL CAN READ THE CONFIG AND NOT THE COMMUNITY'S HASH. ===
  const { error: shellError } = await sr.from('sessions').insert({
    session_id: `ssh-shell-${RUN}`,
    player_key: shellPlayer.publicKeyHex,
    machine_id: KEY_BOX,
    credentials: { username: 'guest', userType: 'guest' },
    kind: 'ssh',
    essid: ESSID,
  });
  if (shellError) throw new Error(`guest session failed: ${shellError.message}`);
  const asGuest = await readBox(shellPlayer);
  check(
    'a guest shell on the box can cat the config, and sees the word in it',
    readFile(asGuest, 'guest', SNMPD_CONF_PATH)?.includes(WORD) === true,
    SNMPD_CONF_PATH,
  );
  check(
    'and cannot read the hashed read-write community',
    readFile(asGuest, 'guest', SNMPD_STATE_PATH) === null,
    SNMPD_STATE_PATH,
  );
  const localWalk = await post(
    SESSIONS,
    signRequest(shellPlayer, 'snmpWalk', {
      essid: ESSID,
      target_ip: LOOPBACK_IPV4,
      community: READ_ONLY_COMMUNITY,
      caller_machine_id: KEY_BOX,
    }),
  );
  check(
    'that guest can run snmpwalk localhost <community>',
    localWalk.status === 200 && JSON.stringify(localWalk.body).includes(WORD),
    `status ${localWalk.status}`,
  );
  check(
    'someone who never held a session reads nothing of the box',
    (await readBox(visitor)) === null,
    'resolveCrossPlayerFs',
  );

  // === 7. HYDRA NEEDS THE WORD ON ITS LIST, AND A HOLE FINDS NO ROOT. ===
  const without = await hydra('ssh', 2222);
  check(
    'without the word, hydra finds no root on :2222',
    without.status === 200 && !crackedOf(without.body).some((entry) => entry.username === 'root'),
    `status ${without.status} cracked ${crackedOf(without.body).length}`,
  );
  await seedFile(WORDLIST_PATH, formatWordlist([...DEFAULT_WORDLIST, WORD]));
  const withWord = await hydra('ssh', 2222);
  check(
    'with the word appended to passwords.txt, hydra finds root on :2222',
    withWord.status === 200 && crackedOf(withWord.body).some((entry) => entry.username === 'root'),
    `status ${withWord.status} cracked ${crackedOf(withWord.body).length}`,
  );
  const exploited = await post(
    SESSIONS,
    signRequest(contractor, 'exploitCreateSession', {
      session_id: `msf-${RUN}`,
      essid: homeEssid,
      target_ip: ADDRESS,
      port: SNMP_PORT,
      caller_machine_id: WORKSTATION,
      parent_session_id: null,
    }),
  );
  // A shell names what it landed as `userType`, and an effect that opens no shell names it `tier`.
  const exploitBody = exploited.body as { userType?: string; tier?: string } | null;
  const exploitTier = exploitBody?.userType ?? exploitBody?.tier;
  check(
    'msfconsole through :161 finds no root',
    exploited.status === 200 && exploitTier !== undefined && exploitTier !== 'root',
    `status ${exploited.status} tier ${exploitTier ?? '-'}`,
  );
  await sr.from('sessions').delete().eq('session_id', `msf-${RUN}`);

  // === 8. THE WORD OPENS ROOT, WHO READS THE KEY, AND THE KEY PAYS. ===
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
  const terms = missionTerms(SNMP_NUMBER);
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
    shown.includes('Route:    snmp') &&
      shown.includes(':161 -> key box :161') &&
      shown.includes(':2222 -> key box :22') &&
      shown.includes(`Leak:     ${SNMPD_CONF_PATH}`) &&
      shown.includes(`Word:     ${WORD}`),
    '(output not echoed: it holds the word)',
  );

  // === 10. THE READ-WRITE COMMUNITY CAN SHUT THE DOORS. ===
  const denied = await set(READ_WRITE_COMMUNITY, 'inputPort.22=deny');
  const closedLogin = await sshToKeyBox(visitor, 'root', WORD);
  check(
    'inputPort.22=deny closes :2222 to a later visitor',
    denied.status === 200 && closedLogin.status === 404,
    `set ${denied.status}, login ${closedLogin.status}`,
  );
  const permitted = await set(READ_WRITE_COMMUNITY, 'inputPort.22=permit');
  const reopenedLogin = await sshToKeyBox(visitor, 'root', WORD);
  check(
    'inputPort.22=permit opens it again',
    permitted.status === 200 && reopenedLogin.status === 200,
    `set ${permitted.status}, login ${reopenedLogin.status}`,
  );
  await sr.from('sessions').delete().eq('player_key', visitor.publicKeyHex);

  // Aimed inside the segment the agent says this box fronts, so the set really lands and the
  // check below is about a rule on the box rather than about a refusal.
  const segment = frontedSegment({ essid: ESSID, machineId: KEY_BOX, kind: keyBoxHost.kind });
  const forwardTarget = `${segment.split('.').slice(0, 3).join('.')}.9:22`;
  const forwardWritten = await set(READ_WRITE_COMMUNITY, `forward.8080=${forwardTarget}`);
  const scanAfterForward = await scanAddress();
  check(
    'a forward written on the key box opens nothing on the gateway',
    (forwardWritten.body as { ok?: boolean } | null)?.ok === true &&
      [...portNumbersOf(scanAfterForward.body)].sort().join(',') ===
        [...portNumbersOf(scan.body)].sort().join(','),
    `set ${forwardWritten.status}, ports=[${portNumbersOf(scanAfterForward.body).join(',')}]`,
  );

  const silenced = await set(READ_WRITE_COMMUNITY, 'inputPort.161=deny');
  const walkThroughDeny = await walk(READ_ONLY_COMMUNITY);
  check(
    'inputPort.161=deny silences a later walk',
    silenced.status === 200 && walkThroughDeny.status === 404,
    `set ${silenced.status}, walk ${walkThroughDeny.status}`,
  );
  const lifted = await removeFromKeyBox(RULES_V4_PATH);
  const walkAfterLift = await walk(READ_ONLY_COMMUNITY);
  check(
    'a root over :2222 can lift it, by removing the rules',
    lifted.status === 200 && walkAfterLift.status === 200,
    `rm ${lifted.status}, walk ${walkAfterLift.status}`,
  );

  // === 11. A ROOT'S EDITS STICK, AND LEAVE THE KEY. ===
  const contactChanged = await post(
    PATCHES,
    signRequest(contractor, 'upsertPatch', {
      machine_id: KEY_BOX,
      path: SNMPD_CONF_PATH,
      content: `rocommunity ${READ_ONLY_COMMUNITY}\nsyscontact nobody\n`,
      owner: 'root',
      permissions: SNMPD_CONF_PERMISSIONS,
      node_type: 'file',
    }),
  );
  const afterContact = await walk(READ_ONLY_COMMUNITY);
  check(
    "after a root changes the contact, a later walk no longer shows the word",
    contactChanged.status === 200 && afterContact.contact === 'nobody',
    `write ${contactChanged.status}, walk ${afterContact.status}`,
  );
  const removed = await removeFromKeyBox(SNMPD_CONF_PATH);
  const readOnlyAfterRm = await walk(READ_ONLY_COMMUNITY);
  const readWriteAfterRm = await walk(READ_WRITE_COMMUNITY);
  check(
    "after a root's rm of the config, the read-only community gets silence",
    removed.status === 200 && readOnlyAfterRm.status === 404,
    `rm ${removed.status}, walk ${readOnlyAfterRm.status}`,
  );
  check(
    'and the read-write one still answers, with no word',
    readWriteAfterRm.status === 200 && readWriteAfterRm.contact?.includes(WORD) !== true,
    `walk ${readWriteAfterRm.status}`,
  );
  const stopped = await removeFromKeyBox('/var/run/snmpd.pid');
  const afterStop = await walk(READ_WRITE_COMMUNITY);
  check(
    'after the agent stops, every walk gets silence',
    stopped.status === 200 && afterStop.status === 404,
    `rm ${stopped.status}, walk ${afterStop.status}`,
  );
  check(
    'the key file is unaffected by any of it',
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
