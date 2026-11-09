// Wire-check for DECOYS on a contract's network: the doors the gateway forwards that lead nowhere,
// driven end to end against a running `vercel dev` + supabase, staging two jobs through the REAL
// `scripts/hireme.ts` and working them through the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE SCAN NO LONGER TELLS THE ROUTE: nmap shows every forward, the route's and the decoys'.
//   - EACH DECOY LETS A PLAYER IN AS FAR AS THE REAL DOOR OF ITS KIND, ONTO NOTHING:
//       web   a default sweep finds no forgotten file;
//       ftp   `anonymous` lands at guest tier, in an empty pub;
//       snmp  `public` gets silence, a guessable community walks read-only with an ordinary
//             contact, and a sweep finds no read-write community;
//       mysql a sweep finds the application account, whose tables hold no word and no key;
//       ssh   a sweep over :2222 finds no root on an msfconsole box.
//   - THE ROUTE STILL PAYS: the hydra route's root falls to the sweep beside three decoys, reads
//     the key, and mailing it mints the pay.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionDecoys.ts
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
import { databaseIn } from '../src/core/mysql/datadir.js';
import { parseSnmpdConf, readSnmpdConf } from '../src/core/snmp/conf.js';
import {
  DEFAULT_WORDLIST,
  WORDLIST_PATH,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist.js';
import { missionShape, type MissionDecoy } from '../src/core/missions/missionShape.js';
import { missionKey, missionKeyPath } from '../src/core/missions/missionSecret.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';
import {
  isMissionNumber,
  missionAddressForNumber,
  missionEssid,
} from '../src/core/missions/missionNetwork.js';
import { createFsView } from '../src/core/filesystem/fsView.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import { asAbsPath } from '../src/core/types.js';
import type { Directory } from '../src/core/filesystem/types.js';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
const WALLET = process.env.WALLET_ENDPOINT ?? 'http://localhost:3100/api/wallet';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const secret = process.env.MISSION_KEY_SECRET;

if (!url || !serviceKey || !secret) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MISSION_KEY_SECRET');
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

const portNumbersOf = (body: unknown): readonly number[] =>
  ((body as { ports?: readonly { port?: number }[] } | null)?.ports ?? [])
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

/** A plain-file contract on `route` running exactly `decoys`, in any order. */
const numberWith = (route: 'hydra' | 'msfconsole', decoys: readonly MissionDecoy[]): number => {
  for (let candidate = 240000; candidate < 340000; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.route !== route || shape.storage !== 'file') continue;
    if ([...shape.decoys].sort().join(',') === [...decoys].sort().join(',')) return candidate;
  }
  throw new Error(`no ${route} contract with decoys ${decoys.join(', ')}`);
};

type Contract = {
  readonly missionNumber: number;
  readonly address: string;
  readonly keyBox: string;
  readonly gateway: string;
};

const contractOf = (missionNumber: number): Contract => {
  const essid = missionEssid(missionNumber);
  const keyBoxHost = generateHomeLan(essid).hosts.find((host) => host.kind === 'machine');
  if (keyBoxHost === undefined) throw new Error('a contract network has a key box');
  return {
    missionNumber,
    address: missionAddressForNumber(missionNumber) ?? '',
    keyBox: machineIdForLanHost(keyBoxHost, essid),
    gateway: computeApGatewayId(essid),
  };
};

// A: the hydra route behind three decoys. B: the msfconsole route behind ssh and a database.
const HYDRA = contractOf(numberWith('hydra', ['web', 'ftp', 'snmp']));
const MSF = contractOf(numberWith('msfconsole', ['ssh', 'mysql']));

const contractor = generateIdentityIn(RIDGEMONT);
const visitor = generateIdentityIn(RIDGEMONT);
const RUN = Date.now().toString(36).slice(-6);
const HANDLE = `dca${RUN}`;
const SECOND_HANDLE = `dcb${RUN}`;
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

const scan = (contract: Contract) =>
  post(NETWORK, signRequest(contractor, 'resolvePublicScan', { target: contract.address }));

const hydra = (contract: Contract, service: 'ssh' | 'snmp' | 'mysql', port: number) =>
  post(
    SESSIONS,
    signRequest(contractor, 'hydraCrack', {
      essid: homeEssid,
      target_ip: contract.address,
      service,
      caller_machine_id: WORKSTATION,
      port,
    }),
  );

const walk = async (community: string) => {
  const answer = await post(
    SESSIONS,
    signRequest(contractor, 'snmpWalk', {
      essid: homeEssid,
      target_ip: HYDRA.address,
      community,
    }),
  );
  const body = answer.body as { tier?: unknown; identity?: { sysContact?: string } } | null;
  return { status: answer.status, tier: body?.tier, contact: body?.identity?.sysContact ?? null };
};

let doorKnocks = 0;

/** A login at a contract's public address, as `ftp` or `ssh` send it. */
const knock = (
  caller: typeof contractor,
  contract: Contract,
  door: { readonly kind: 'ftp' | 'ssh'; readonly port: number },
  username: string,
  password: string,
) => {
  doorKnocks += 1;
  return post(
    SESSIONS,
    signRequest(caller, 'authCreateSessionPublic', {
      session_id: `${door.kind}-${RUN}-${doorKnocks}`,
      target: contract.address,
      port: door.port,
      username,
      password,
      parent_session_id: null,
      source_ip: null,
      kind: door.kind,
    }),
  );
};

const readBox = async (caller: typeof contractor, contract: Contract): Promise<Directory | null> => {
  const answer = await post(
    NETWORK,
    signRequest(caller, 'resolveCrossPlayerFs', { machine_id: contract.keyBox }),
  );
  return answer.status === 200
    ? deserializeTree((answer.body as { tree: SerializedDirectory }).tree)
    : null;
};

const balanceOf = async (address: string): Promise<number> => {
  const answer = await post(WALLET, { action: 'balance', address });
  return (answer.body as { balance?: number } | null)?.balance ?? -1;
};

const cleanup = async () => {
  for (const contract of [HYDRA, MSF]) {
    await sr.from('hireme_missions').delete().eq('number', contract.missionNumber);
    for (const machineId of [contract.keyBox, contract.gateway]) {
      await sr.from('patches').delete().eq('machine_id', machineId);
    }
  }
  await sr.from('email_accounts').delete().eq('signed_up_by', contractor.publicKeyHex);
  await sr.from('email_sends').delete().eq('player_key', contractor.publicKeyHex);
  await sr.from('patches').delete().eq('machine_id', WORKSTATION);
  for (const player of [contractor, visitor]) {
    await sr.from('sessions').delete().eq('player_key', player.publicKeyHex);
    await sr.from('home_network_occupants').delete().eq('owner_key', player.publicKeyHex);
    await sr.from('network_lan_leases').delete().eq('owner_key', player.publicKeyHex);
  }
  await sr.from('wallet_transfers').delete().eq('to_address', WALLET_ADDRESS);
  await sr.from('wallet_balances').delete().eq('address', WALLET_ADDRESS);
};

const openMailbox = async (handle: string) => {
  const { error } = await sr.from('email_accounts').insert({
    handle,
    password_md5: md5('s3cret'),
    signed_up_by: contractor.publicKeyHex,
  });
  if (error) throw new Error(`mailbox insert failed: ${error.message}`);
};

const main = async () => {
  if (homeEssid === undefined || HYDRA.address === '' || MSF.address === '') {
    console.error('the world does not hold what this check assumes');
    process.exit(2);
  }
  console.log(`hydra contract ${HYDRA.missionNumber} at ${HYDRA.address}`);
  console.log(`msfconsole contract ${MSF.missionNumber} at ${MSF.address}\n`);
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
  await openMailbox(HANDLE);
  await openMailbox(SECOND_HANDLE);
  runHireme(['accept', HANDLE, '--number', String(HYDRA.missionNumber)]);
  runHireme(['accept', SECOND_HANDLE, '--number', String(MSF.missionNumber)]);

  // === 1. THE SCAN SHOWS EVERY FORWARD, SO IT NO LONGER TELLS THE ROUTE. ===
  const hydraScan = await scan(HYDRA);
  const hydraPorts = portNumbersOf(hydraScan.body);
  check(
    'nmap of the hydra contract shows :2222 beside its decoys :80, :21 and :161',
    hydraScan.status === 200 && [2222, 80, 21, 161].every((port) => hydraPorts.includes(port)),
    `status ${hydraScan.status} ports=[${hydraPorts.join(',')}]`,
  );
  const msfScan = await scan(MSF);
  const msfPorts = portNumbersOf(msfScan.body);
  check(
    'nmap of the msfconsole contract shows :80 beside its decoys :2222 and :3306',
    msfScan.status === 200 && [80, 2222, 3306].every((port) => msfPorts.includes(port)),
    `status ${msfScan.status} ports=[${msfPorts.join(',')}]`,
  );

  // === 2. THE WEB DECOY: A SWEEP FINDS THE STOCK PAGE AND NOTHING ELSE. ===
  const swept = await post(
    NETWORK,
    signRequest(contractor, 'resolveHttpSweep', {
      target: HYDRA.address,
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
    'a default gobuster of the web decoy finds no forgotten file',
    swept.status === 200 && found.every((path) => /index\.html$/.test(path)),
    `status ${swept.status} found [${found.join(', ')}]`,
  );

  // === 3. THE FTP DECOY: ANONYMOUS LANDS AS A GUEST, IN AN EMPTY PUB. ===
  const anonymous = await knock(visitor, HYDRA, { kind: 'ftp', port: 21 }, 'anonymous', 'x');
  check(
    'ftp <address> anonymous opens a guest session on the key box',
    anonymous.status === 200 &&
      (anonymous.body as { userType?: string } | null)?.userType === 'guest' &&
      (anonymous.body as { machine_id?: string } | null)?.machine_id === HYDRA.keyBox,
    `status ${anonymous.status}`,
  );
  const asAnonymous = await readBox(visitor, HYDRA);
  const pub =
    asAnonymous === null
      ? null
      : createFsView(asAnonymous, { userType: 'guest' }).list(asAbsPath('/srv/ftp/pub'));
  check(
    'and pub holds nothing',
    pub !== null && pub.ok && pub.entries.length === 0,
    `read ${asAnonymous === null ? 'failed' : 'ok'}`,
  );

  // === 4. THE SNMP DECOY: SILENT TO PUBLIC, READ-ONLY TO A GUESS, SHUT TO A SWEEP. ===
  const guessable =
    parseSnmpdConf(readSnmpdConf(buildMissionKeyBoxFs(HYDRA.missionNumber))).roCommunity ?? '';
  const silent = await walk('public');
  check('snmpwalk <address> gets silence', silent.status === 404, `status ${silent.status}`);
  const guessed = await walk(guessable);
  check(
    'the guessable community walks read-only, with an ordinary contact',
    guessed.status === 200 && guessed.tier === 'read-only' && guessed.contact === 'netops@corp.local',
    `status ${guessed.status} tier ${String(guessed.tier)} contact ${guessed.contact}`,
  );
  const communitySweep = await hydra(HYDRA, 'snmp', 161);
  check(
    'hydra <address> snmp finds no read-write community',
    communitySweep.status === 200 && crackedOf(communitySweep.body).length === 0,
    `status ${communitySweep.status} cracked ${crackedOf(communitySweep.body).length}`,
  );

  // === 5. THE DATABASE DECOY: THE ACCOUNT FALLS, ONTO TABLES WITH NO WORD AND NO KEY. ===
  const databaseSweep = await hydra(MSF, 'mysql', 3306);
  const account = crackedOf(databaseSweep.body)[0];
  check(
    'hydra <address> mysql finds the application account',
    databaseSweep.status === 200 && account !== undefined,
    `status ${databaseSweep.status}`,
  );
  const tables = await post(
    SESSIONS,
    signRequest(contractor, 'mysqlStatement', {
      essid: homeEssid,
      target_ip: MSF.address,
      port: 3306,
      username: account?.username ?? '',
      password: account?.password ?? '',
      statement: 'SHOW TABLES',
    }),
  );
  const listed = ((tables.body as { output?: readonly string[] } | null)?.output ?? []).join('\n');
  const generated = Object.keys(databaseIn(buildMissionKeyBoxFs(MSF.missionNumber))?.tables ?? {});
  check(
    'its tables are the generated application, with no settings and no api_keys',
    tables.status === 200 &&
      generated.length > 0 &&
      generated.every((table) => listed.includes(table)) &&
      !listed.includes('settings') &&
      !listed.includes('api_keys'),
    `status ${tables.status}`,
  );

  // === 6. THE SSH DECOY: THE SWEEP OVER :2222 FINDS NO ROOT ON AN MSFCONSOLE BOX. ===
  const rootSweep = await hydra(MSF, 'ssh', 2222);
  check(
    'hydra <address> ssh -s 2222 finds no root',
    rootSweep.status === 200 &&
      !crackedOf(rootSweep.body).some(({ username }) => username === 'root'),
    `status ${rootSweep.status} cracked [${crackedOf(rootSweep.body)
      .map(({ username }) => username)
      .join(', ')}]`,
  );

  // === 7. THE ROUTE STILL PAYS, BESIDE THREE DECOYS. ===
  const routeSweep = await hydra(HYDRA, 'ssh', 2222);
  const root = crackedOf(routeSweep.body).find(({ username }) => username === 'root');
  check(
    'hydra <address> ssh -s 2222 finds root on the hydra contract',
    routeSweep.status === 200 && root !== undefined,
    `status ${routeSweep.status}`,
  );
  const rooted = await knock(contractor, HYDRA, { kind: 'ssh', port: 2222 }, 'root', root?.password ?? '');
  const asRoot = await readBox(contractor, HYDRA);
  const keyPath = missionKeyPath(HYDRA.missionNumber);
  const key = missionKey(HYDRA.missionNumber, secret);
  const read =
    asRoot === null ? null : createFsView(asRoot, { userType: 'root' }).read(asAbsPath(keyPath));
  check(
    'that root reads the key',
    rooted.status === 200 && read !== null && read.ok && read.content.trim() === key,
    `ssh ${rooted.status}`,
  );
  const terms = missionTerms(HYDRA.missionNumber);
  const mailed = await post(
    NETWORK,
    signRequest(contractor, 'resolveMail', {
      op: 'send',
      password: 's3cret',
      subject: 'the job',
      handle: HANDLE,
      to: terms.client.handle,
      body: `${key}\n${WALLET_ADDRESS}\n`,
    }),
  );
  check(
    'mailing the key pays as before decoys',
    mailed.status === 200 && (await balanceOf(WALLET_ADDRESS)) === terms.pay,
    `status ${mailed.status} balance ${await balanceOf(WALLET_ADDRESS)} (want ${terms.pay})`,
  );

  // === 8. `show` TELLS THE OPERATOR THE ROUTE FROM THE BLUR. ===
  const shown = runHireme(['show', HYDRA.address]);
  check(
    '`show` tags each decoy forward and leaves the route untagged',
    shown.includes(':2222 -> key box :22\n') &&
      shown.includes(':80 -> key box :80 (decoy)') &&
      shown.includes(':21 -> key box :21 (decoy)') &&
      shown.includes(':161 -> key box :161 (decoy)'),
    '(output not echoed: it holds the key)',
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
