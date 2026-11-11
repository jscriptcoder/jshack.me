// Wire-check for A TWO-HOP CONTRACT — a contract whose key box sits behind a front box, driven end
// to end against a running `vercel dev` + supabase, staging each job through the REAL
// `scripts/hireme.ts` and working it through the REAL /api endpoints. One contract per key-box
// route, each fronted by a web box, so the way in is the same and the way on is every route.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE PUBLIC ADDRESS IS THE FRONT BOX'S: a public scan shows its forwards and nothing else.
//   - THE FRONT ROUTE ROOTS THE FRONT BOX: its forgotten file holds its own word, laid by the
//     server on the front box, and the word opens root there over the forwarded :2222.
//   - FROM THAT ROOT SHELL: `apt install` writes onto the front box, `nmap` of the LAN reaches
//     all three hosts, and the key box's route works over the LAN on the key box's own ports.
//   - THE KEY BOX'S OWN DECOYS LEAD NOWHERE FROM THE HOP: before its route is worked, each is
//     worked to its empty end (web: a sweep finds no forgotten file; ftp: anonymous lands a guest
//     in an empty pub; mysql: the swept account opens no word and no key; snmp: silent to
//     public, read-only to a guess, shut to a sweep). The six contracts hold all four kinds.
//   - THE KEY BOX OPENS FROM THE HOP: root lands there, its auth.log names the front box's LAN
//     address, and root reads the key.
//   - THE JOB PAYS ONCE, and `show` names both boxes.
//
// Words and keys are compared and never printed. `show` prints them, so its output is checked
// and not echoed.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionTwoHop.ts
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
import { binaryStub } from '../src/core/generation/binaries.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { md5 } from '../src/core/generation/md5.js';
import { databaseIn } from '../src/core/mysql/datadir.js';
import { SNMPD_CONF_PATH, parseSnmpdConf, readSnmpdConf } from '../src/core/snmp/conf.js';
import {
  DEFAULT_DIRLIST,
  DIRLIST_PATH,
  formatDirlist,
} from '../src/core/network/defaultDirlist.js';
import {
  DEFAULT_WORDLIST,
  WORDLIST_PATH,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist.js';
import {
  missionShape,
  missionTopology,
  type MissionBoxRef,
  type MissionRoute,
  type MissionShape,
} from '../src/core/missions/missionShape.js';
import { missionFiles, missionLeakPath } from '../src/core/missions/missionLeak.js';
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
): Promise<{ status: number; body: Record<string, unknown> | null }> => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: response.status, body };
};

const errorOf = (body: Record<string, unknown> | null): string =>
  typeof body?.['error'] === 'string' ? body['error'] : '';

const portsOf = (body: Record<string, unknown> | null): readonly number[] =>
  ((body?.['ports'] ?? []) as readonly { port?: number }[])
    .map((entry) => entry.port)
    .filter((port): port is number => typeof port === 'number');

// `shell: true` so Windows resolves `npx.cmd`; the args carry no spaces, so quoting is moot.
const runHireme = (args: readonly string[]): string =>
  execFileSync('npx', ['tsx', 'scripts/hireme.ts', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  }).trim();

const ROUTES: readonly MissionRoute[] = ['hydra', 'msfconsole', 'web', 'ftp', 'mysql', 'snmp'];

/** The first two-hop contract on each key-box route behind a web front box, keeping its key in
 *  a plain file, which is where this check reads it. The topology is cheap and the shape is
 *  not, so a single-hop number is passed over before its shape is drawn. */
const numbersByRoute = (from: number): ReadonlyMap<MissionRoute, number> => {
  const found = new Map<MissionRoute, number>();
  for (let candidate = from; candidate < from + 60000 && found.size < ROUTES.length; candidate++) {
    if (!isMissionNumber(candidate) || missionTopology(candidate).frontBoxOctet === null) continue;
    const { kind, keyBox, frontBox, storage } = missionShape(candidate);
    if (kind !== 'key' || frontBox?.route !== 'web' || storage !== 'file') continue;
    if (found.has(keyBox.route)) continue;
    found.set(keyBox.route, candidate);
  }
  return found;
};

type Contract = {
  readonly route: MissionRoute;
  readonly missionNumber: number;
  readonly shape: MissionShape;
  readonly essid: string;
  readonly address: string;
  readonly subnet: string;
  readonly keyBox: string;
  readonly keyBoxIp: string;
  readonly front: string;
  readonly frontIp: string;
  readonly gateway: string;
  readonly handle: string;
};

const RUN = Date.now().toString(36).slice(-6);

const contractOf = (route: MissionRoute, missionNumber: number, index: number): Contract => {
  const shape = missionShape(missionNumber);
  const essid = missionEssid(missionNumber);
  const lan = generateHomeLan(essid);
  const hostAt = (octet: number) => {
    const host = lan.hosts.find((candidate) => candidate.ip === `${lan.subnet}.${octet}`);
    if (host === undefined) throw new Error(`no host at .${octet} on ${essid}`);
    return host;
  };
  const frontOctet = shape.frontBox?.octet ?? 0;
  return {
    route,
    missionNumber,
    shape,
    essid,
    address: missionAddressForNumber(missionNumber) ?? '',
    subnet: lan.subnet,
    keyBox: machineIdForLanHost(hostAt(shape.keyBox.octet), essid),
    keyBoxIp: `${lan.subnet}.${shape.keyBox.octet}`,
    front: machineIdForLanHost(hostAt(frontOctet), essid),
    frontIp: `${lan.subnet}.${frontOctet}`,
    gateway: computeApGatewayId(essid),
    handle: `hop${index}${RUN}`,
  };
};

const NUMBERS = numbersByRoute(300000);
const CONTRACTS = ROUTES.flatMap((route, index) => {
  const missionNumber = NUMBERS.get(route);
  return missionNumber === undefined ? [] : [contractOf(route, missionNumber, index)];
});

const contractor = generateIdentityIn(RIDGEMONT);
const [homeEssid] = wifiPoolOf(RIDGEMONT);
const WORKSTATION = computeWorkstationId('newbie', contractor.publicKeyHex);
const WALLET_ADDRESS = `jsc${randomBytes(20).toString('hex')}`;
const GATEWAY_SSH_PORT = 22;
const INSTALLED_BINARY_PERMS = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root', 'user', 'guest'],
};

const seedFile = async (machineId: string, path: string, content: string) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: machineId,
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

const readFile = async (
  machineId: string,
  tier: 'root' | 'guest',
  path: string,
): Promise<string | null> => {
  const answer = await post(
    NETWORK,
    signRequest(contractor, 'resolveCrossPlayerFs', { machine_id: machineId }),
  );
  if (answer.status !== 200) return null;
  const tree = deserializeTree((answer.body as { tree: SerializedDirectory }).tree);
  const read = createFsView(tree, { userType: tier }).read(asAbsPath(path));
  return read.ok ? read.content : null;
};

const authLogOf = async (machineId: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', '/var/log/auth.log');
  return ((data ?? []) as readonly { content?: string }[])
    .map((row) => row.content ?? '')
    .join('\n');
};

/** The machine and tier a session the server minted sits at, read off its row. */
const sessionAt = async (
  sessionId: string,
): Promise<{ machineId: string; userType: string } | null> => {
  const { data } = await sr
    .from('sessions')
    .select('machine_id, credentials')
    .eq('session_id', sessionId)
    .maybeSingle();
  const row = data as { machine_id?: string; credentials?: { userType?: string } } | null;
  return row?.machine_id === undefined
    ? null
    : { machineId: row.machine_id, userType: row.credentials?.userType ?? '' };
};

const balanceOf = async (address: string): Promise<number> => {
  const answer = await post(WALLET, { action: 'balance', address });
  return typeof answer.body?.['balance'] === 'number' ? answer.body['balance'] : -1;
};

const cleanup = async () => {
  await sr
    .from('hireme_missions')
    .delete()
    .in(
      'number',
      CONTRACTS.map((contract) => contract.missionNumber),
    );
  await sr.from('email_accounts').delete().eq('signed_up_by', contractor.publicKeyHex);
  await sr.from('email_sends').delete().eq('player_key', contractor.publicKeyHex);
  for (const machineId of [
    WORKSTATION,
    ...CONTRACTS.flatMap((contract) => [contract.keyBox, contract.front, contract.gateway]),
  ]) {
    await sr.from('patches').delete().eq('machine_id', machineId);
  }
  await sr.from('sessions').delete().eq('player_key', contractor.publicKeyHex);
  await sr.from('home_network_occupants').delete().eq('owner_key', contractor.publicKeyHex);
  await sr.from('network_lan_leases').delete().eq('owner_key', contractor.publicKeyHex);
  await sr.from('wallet_transfers').delete().eq('to_address', WALLET_ADDRESS);
  await sr.from('wallet_balances').delete().eq('address', WALLET_ADDRESS);
};

/** Works the web front box from the public internet to a root shell, returning its id. */
const rootTheFront = async (contract: Contract): Promise<string | null> => {
  const { route, missionNumber, address, front } = contract;
  const frontRef: MissionBoxRef = { missionNumber, role: 'front' };
  const frontWord = plaintextFor(contract.shape.frontBox?.rootHash ?? '');
  const leakRequest = (missionLeakPath(frontRef) ?? '').replace('/var/www/html', '');

  const page = await post(
    NETWORK,
    signRequest(contractor, 'resolveHttpFetch', { target: address, port: 80, path: leakRequest }),
  );
  check(
    `${route}: curl <address> returns the front box's own word`,
    page.status === 200 && String(page.body?.['content'] ?? '').includes(frontWord),
    `status ${page.status}`,
  );

  const shell = `ssh-front-${route}-${RUN}`;
  const rooted = await post(
    SESSIONS,
    signRequest(contractor, 'authCreateSessionPublic', {
      session_id: shell,
      target: address,
      port: 2222,
      username: 'root',
      password: frontWord,
      parent_session_id: null,
      source_ip: null,
    }),
  );
  check(
    `${route}: ssh root@<address> -p 2222 with that word lands root on the front box`,
    rooted.status === 200 && rooted.body?.['machine_id'] === front,
    `status ${rooted.status} ${errorOf(rooted.body)}`,
  );
  return rooted.status === 200 ? shell : null;
};

/** From the front box's root shell: install a tool, sweep the LAN. */
const standOnTheFront = async (contract: Contract) => {
  const { route, essid, subnet, front } = contract;
  const installed = await post(
    PATCHES,
    signRequest(contractor, 'upsertPatch', {
      machine_id: front,
      path: '/usr/bin/hydra',
      content: binaryStub('hydra'),
      owner: 'root',
      permissions: INSTALLED_BINARY_PERMS,
      is_new: true,
      node_type: 'file',
    }),
  );
  check(
    `${route}: apt install hydra on the front box writes /usr/bin/hydra`,
    installed.status === 200,
    `status ${installed.status} ${errorOf(installed.body)}`,
  );

  const swept = await post(
    PATCHES,
    signRequest(contractor, 'nmapScan', {
      essid,
      target: `${subnet}.1-254`,
      caller_machine_id: front,
    }),
  );
  check(
    `${route}: nmap of the LAN from the front box reaches the gateway, itself and the key box`,
    swept.status === 200 && swept.body?.['hostsLogged'] === 3,
    `status ${swept.status} hosts ${String(swept.body?.['hostsLogged'] ?? '-')}`,
  );
};

/** The key box's tree, read through the server as a player holding any session on it would. */
const listDir = async (
  machineId: string,
  tier: 'root' | 'guest',
  path: string,
): Promise<readonly string[] | null> => {
  const answer = await post(
    NETWORK,
    signRequest(contractor, 'resolveCrossPlayerFs', { machine_id: machineId }),
  );
  if (answer.status !== 200) return null;
  const tree = deserializeTree((answer.body as { tree: SerializedDirectory }).tree);
  const listed = createFsView(tree, { userType: tier }).list(asAbsPath(path));
  return listed.ok ? listed.entries : null;
};

const crackedOf = (body: Record<string, unknown> | null) =>
  (body?.['cracked'] ?? []) as readonly { username: string; password: string }[];

/** Works each of the key box's decoys from the front box to its empty end: each lets a player
 *  in as far as the real door of its kind would, onto nothing. */
const workTheInsideDecoys = async (contract: Contract, shell: string) => {
  const { route, missionNumber, essid, keyBox, keyBoxIp, front } = contract;
  const decoys = contract.shape.keyBox.decoys;
  await seedFile(front, DIRLIST_PATH, formatDirlist(DEFAULT_DIRLIST));
  await seedFile(front, WORDLIST_PATH, formatWordlist(DEFAULT_WORDLIST));
  const sweep = (service: 'mysql' | 'snmp', port: number) =>
    post(
      SESSIONS,
      signRequest(contractor, 'hydraCrack', {
        essid,
        target_ip: keyBoxIp,
        service,
        caller_machine_id: front,
        port,
      }),
    );

  if (decoys.includes('web')) {
    const swept = await post(
      NETWORK,
      signRequest(contractor, 'resolveOccupantSweep', {
        essid,
        target: keyBoxIp,
        port: 80,
        caller_machine_id: front,
      }),
    );
    const found = ((swept.body?.['results'] ?? []) as readonly { path: string; status: number }[])
      .filter((result) => result.status === 200)
      .map((result) => result.path);
    check(
      `${route}: gobuster of the key box's web decoy from the front box finds no forgotten file`,
      swept.status === 200 &&
        swept.body?.['dirlistFound'] === true &&
        found.every((path) => /index\.html$/.test(path)),
      `status ${swept.status} ${errorOf(swept.body)} found [${found.join(', ')}]`,
    );
  }

  if (decoys.includes('ftp')) {
    const ftpSession = `ftp-decoy-${route}-${RUN}`;
    const anonymous = await post(
      SESSIONS,
      signRequest(contractor, 'authCreateSession', {
        session_id: ftpSession,
        essid,
        target_ip: keyBoxIp,
        port: 21,
        username: 'anonymous',
        password: 'anything',
        parent_session_id: shell,
        caller_machine_id: front,
        kind: 'ftp',
      }),
    );
    const landed = await sessionAt(ftpSession);
    const pub = await listDir(keyBox, 'guest', '/srv/ftp/pub');
    check(
      `${route}: anonymous ftp from the front box lands a guest on the key box's decoy, in an empty pub`,
      anonymous.status === 200 &&
        landed?.machineId === keyBox &&
        landed.userType === 'guest' &&
        pub !== null &&
        pub.length === 0,
      `status ${anonymous.status} ${errorOf(anonymous.body)} tier ${landed?.userType ?? '-'} pub ${pub === null ? 'unread' : pub.length}`,
    );
  }

  if (decoys.includes('mysql')) {
    const swept = await sweep('mysql', 3306);
    const [account] = crackedOf(swept.body);
    const tables = await post(
      SESSIONS,
      signRequest(contractor, 'mysqlStatement', {
        essid,
        target_ip: keyBoxIp,
        port: 3306,
        username: account?.username ?? '',
        password: account?.password ?? '',
        statement: 'SHOW TABLES',
        caller_machine_id: front,
      }),
    );
    const listed = ((tables.body?.['output'] ?? []) as readonly string[]).join('\n');
    const generated = Object.keys(databaseIn(buildMissionKeyBoxFs(missionNumber))?.tables ?? {});
    check(
      `${route}: hydra from the front box opens the key box's database decoy onto no word and no key`,
      swept.status === 200 &&
        account !== undefined &&
        tables.status === 200 &&
        generated.length > 0 &&
        generated.every((table) => listed.includes(table)) &&
        !listed.includes('settings') &&
        !listed.includes('api_keys'),
      `sweep ${swept.status} tables ${tables.status} ${errorOf(tables.body)}`,
    );
  }

  if (decoys.includes('snmp')) {
    const walk = (community: string) =>
      post(
        SESSIONS,
        signRequest(contractor, 'snmpWalk', {
          essid,
          target_ip: keyBoxIp,
          community,
          caller_machine_id: front,
        }),
      );
    const guessable =
      parseSnmpdConf(readSnmpdConf(buildMissionKeyBoxFs(missionNumber))).roCommunity ?? '';
    const silent = await walk('public');
    const guessed = await walk(guessable);
    const identity = guessed.body?.['identity'] as { sysContact?: string } | undefined;
    const communities = await sweep('snmp', 161);
    check(
      `${route}: the key box's agent decoy is silent to public, read-only to a guess, shut to a sweep`,
      silent.status === 404 &&
        guessed.status === 200 &&
        guessed.body?.['tier'] === 'read-only' &&
        identity?.sysContact === 'netops@corp.local' &&
        communities.status === 200 &&
        crackedOf(communities.body).length === 0,
      `public ${silent.status} guess ${guessed.status} tier ${String(guessed.body?.['tier'] ?? '-')} sweep ${communities.status} cracked ${crackedOf(communities.body).length}`,
    );
  }
};

/** Logs in as root on the key box over the LAN from the front shell, returning the session. */
const sshToKeyBox = async (contract: Contract, shell: string, password: string) => {
  const sessionId = `ssh-key-${contract.route}-${RUN}`;
  const login = await post(
    SESSIONS,
    signRequest(contractor, 'authCreateSession', {
      session_id: sessionId,
      essid: contract.essid,
      target_ip: contract.keyBoxIp,
      username: 'root',
      password,
      parent_session_id: shell,
      caller_machine_id: contract.front,
    }),
  );
  return { login, sessionId };
};

/** Works the key box's own route from the front shell to a root shell on the key box. */
const workTheKeyBox = async (contract: Contract, shell: string): Promise<boolean> => {
  const { route, missionNumber, essid, keyBox, keyBoxIp, front } = contract;
  const keyRef: MissionBoxRef = { missionNumber, role: 'key' };
  const keyWord = plaintextFor(contract.shape.keyBox.rootHash);
  let password = keyWord;

  if (route === 'hydra') {
    await seedFile(front, WORDLIST_PATH, formatWordlist([...DEFAULT_WORDLIST, keyWord]));
    const cracked = await post(
      SESSIONS,
      signRequest(contractor, 'hydraCrack', {
        essid,
        target_ip: keyBoxIp,
        service: 'ssh',
        caller_machine_id: front,
        port: 22,
      }),
    );
    const root = (
      (cracked.body?.['cracked'] ?? []) as readonly { username: string; password: string }[]
    ).find((entry) => entry.username === 'root');
    check(
      'hydra: hydra from the front box cracks the key box root on its own :22',
      cracked.status === 200 && root?.password === keyWord,
      `status ${cracked.status} ${errorOf(cracked.body)}`,
    );
    password = root?.password ?? '';
  }

  if (route === 'msfconsole') {
    const [door] = contract.shape.keyBox.services;
    const fired = await post(
      SESSIONS,
      signRequest(contractor, 'exploitCreateSession', {
        session_id: `msf-key-${RUN}`,
        essid,
        target_ip: keyBoxIp,
        port: door?.port ?? 0,
        caller_machine_id: front,
        parent_session_id: shell,
      }),
    );
    const landed = fired.body?.['machine_id'] === keyBox && fired.body?.['userType'] === 'root';
    check(
      `msfconsole: the pinned hole fires from the front box on the key box's own :${door?.port ?? '-'} to root`,
      fired.status === 200 && landed,
      `status ${fired.status} ${errorOf(fired.body)} tier ${String(fired.body?.['userType'] ?? '-')}`,
    );
    return fired.status === 200 && landed;
  }

  if (route === 'web') {
    const fetched = await post(
      NETWORK,
      signRequest(contractor, 'resolveOccupantFetch', {
        essid,
        target: keyBoxIp,
        port: 80,
        path: (missionLeakPath(keyRef) ?? '').replace('/var/www/html', ''),
        caller_machine_id: front,
      }),
    );
    check(
      "web: curl of the key box's forgotten file from the front box returns its word",
      fetched.status === 200 && String(fetched.body?.['content'] ?? '').includes(keyWord),
      `status ${fetched.status} ${errorOf(fetched.body)}`,
    );
  }

  if (route === 'ftp') {
    const ftp = await post(
      SESSIONS,
      signRequest(contractor, 'authCreateSession', {
        session_id: `ftp-key-${RUN}`,
        essid,
        target_ip: keyBoxIp,
        port: 21,
        username: 'anonymous',
        password: 'anything',
        parent_session_id: shell,
        caller_machine_id: front,
        kind: 'ftp',
      }),
    );
    const left = await readFile(keyBox, 'guest', missionLeakPath(keyRef) ?? '');
    check(
      "ftp: anonymous ftp from the front box reads the key box's left file and its word",
      ftp.status === 200 && left !== null && left.includes(keyWord),
      `status ${ftp.status} ${errorOf(ftp.body)} file ${left === null ? 'unread' : 'read'}`,
    );
  }

  if (route === 'mysql') {
    const account = databaseIn(buildMissionKeyBoxFs(missionNumber))?.credentials.find(
      (credential) => credential.userType === 'user',
    );
    const login = {
      username: account?.username ?? '',
      password: plaintextFor(account?.passwordHash ?? ''),
    };
    const selected = await post(
      SESSIONS,
      signRequest(contractor, 'mysqlStatement', {
        essid,
        target_ip: keyBoxIp,
        port: 3306,
        ...login,
        statement: 'SELECT * FROM settings',
        caller_machine_id: front,
      }),
    );
    check(
      "mysql: the application account reads the key box's settings and its word from the front box",
      selected.status === 200 && JSON.stringify(selected.body).includes(keyWord),
      `status ${selected.status} ${errorOf(selected.body)}`,
    );
  }

  if (route === 'snmp') {
    const config =
      missionFiles(keyRef, { keySecret: secret, rawSecrets }).find(
        (laid) => laid.path === SNMPD_CONF_PATH,
      )?.content ?? '';
    const walked = await post(
      SESSIONS,
      signRequest(contractor, 'snmpWalk', {
        essid,
        target_ip: keyBoxIp,
        community: parseSnmpdConf(config).roCommunity ?? '',
        caller_machine_id: front,
      }),
    );
    check(
      'snmp: snmpwalk of the key box from the front box reads its word',
      walked.status === 200 && JSON.stringify(walked.body).includes(keyWord),
      `status ${walked.status} ${errorOf(walked.body)}`,
    );
  }

  const { login, sessionId } = await sshToKeyBox(contract, shell, password);
  const landed = await sessionAt(sessionId);
  check(
    `${route}: ssh root@<key box> from the front box lands root on the key box`,
    login.status === 200 && landed?.machineId === keyBox && landed.userType === 'root',
    `status ${login.status} ${errorOf(login.body)}`,
  );
  const authLog = await authLogOf(keyBox);
  check(
    `${route}: the key box auth.log names the front box's LAN address`,
    authLog.includes(`from ${contract.frontIp}`),
    `${authLog.split('\n').filter((line) => line.length > 0).length} lines`,
  );
  return login.status === 200;
};

const main = async () => {
  const insideDecoys = new Set(CONTRACTS.flatMap(({ shape }) => shape.keyBox.decoys));
  if (homeEssid === undefined || CONTRACTS.length !== ROUTES.length || insideDecoys.size !== 4) {
    console.error('the world does not hold what this check assumes');
    process.exit(2);
  }
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

  for (const contract of CONTRACTS) {
    const { route, missionNumber, address, handle } = contract;
    console.log(`\n${route} key box, contract ${missionNumber} at ${address}`);
    const { error: mailboxError } = await sr.from('email_accounts').insert({
      handle,
      password_md5: md5('s3cret'),
      signed_up_by: contractor.publicKeyHex,
    });
    if (mailboxError) throw new Error(`mailbox insert failed: ${mailboxError.message}`);
    runHireme(['accept', handle, '--number', String(missionNumber)]);

    const scan = await post(
      NETWORK,
      signRequest(contractor, 'resolvePublicScan', { target: address }),
    );
    // The gateway answers its own sshd on :22 beside the forwards, as every gateway does.
    const forwarded = [
      GATEWAY_SSH_PORT,
      ...contract.shape.forwards.map(({ publicPort }) => publicPort),
    ].sort();
    check(
      `${route}: a public scan shows the gateway's sshd and the front box's forwards, nothing more`,
      scan.status === 200 &&
        JSON.stringify([...portsOf(scan.body)].sort()) === JSON.stringify(forwarded),
      `status ${scan.status} ports [${portsOf(scan.body).join(',')}] want [${forwarded.join(',')}]`,
    );

    const shell = await rootTheFront(contract);
    if (shell === null) continue;
    await standOnTheFront(contract);
    await workTheInsideDecoys(contract, shell);
    if (!(await workTheKeyBox(contract, shell))) continue;

    const key = missionKey(missionNumber, secret);
    const read = await readFile(contract.keyBox, 'root', missionKeyPath(missionNumber));
    check(`${route}: root on the key box reads the key`, read?.trim() === key, 'key not echoed');
  }

  // === THE JOB PAYS ONCE, AND `show` NAMES BOTH BOXES. ===
  const [paid] = CONTRACTS;
  if (paid !== undefined) {
    const terms = missionTerms(paid.missionNumber);
    const mail = () =>
      post(
        NETWORK,
        signRequest(contractor, 'resolveMail', {
          op: 'send',
          password: 's3cret',
          subject: 'the job',
          handle: paid.handle,
          to: terms.client.handle,
          body: `${missionKey(paid.missionNumber, secret)}\n${WALLET_ADDRESS}\n`,
        }),
      );
    const first = await mail();
    const second = await mail();
    const balance = await balanceOf(WALLET_ADDRESS);
    check(
      'mailing the key pays the two-hop job, and mailing it again pays nothing more',
      first.status === 200 && second.status === 200 && balance === terms.pay,
      `status ${first.status}/${second.status} balance ${balance} (want ${terms.pay})`,
    );

    const shown = runHireme(['show', paid.address]);
    check(
      '`show` names the template, both boxes and the forwards onto the front box',
      shown.includes('Template: two-hop') &&
        shown.includes(`Front box: ${paid.shape.stem}-web`) &&
        shown.includes(`Key box:   ${paid.shape.stem}-files`) &&
        shown.includes(':2222 -> front box :22') &&
        !shown.includes('-> key box'),
      '(output not echoed: it holds the words and the key)',
    );
    const keySection = shown
      .split('\n')
      .slice(shown.split('\n').indexOf(`  Key box:   ${paid.shape.stem}-files`));
    check(
      "`show` tags each of the key box's decoys",
      keySection.filter((line) => line.endsWith('(decoy)')).length ===
        paid.shape.keyBox.decoys.length && paid.shape.keyBox.decoys.length > 0,
      `${paid.shape.keyBox.decoys.length} decoys`,
    );
  }

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
