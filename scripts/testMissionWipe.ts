// Wire-check for A WIPE JOB: a contract whose client wants one table of a company's records emptied
// and the two beside it left alone, and reads the records box for it when the contractor mails in.
// Driven end to end against a running `vercel dev` + supabase, accepting through a board's REAL door
// and staging the rest through the REAL `scripts/hireme.ts`, and working each job through the REAL
// /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE BRIEFING DESCRIBES THE RECORDS, NEVER THEIR TABLE, and `show` names the kind, the
//     setting, the storage and the table.
//   - AN UNTOUCHED TABLE IS A MISS, and so is ONE WITH ROWS LEFT; the job stays open.
//   - THE APPLICATION ACCOUNT CANNOT DROP THE TABLE, and the sweep never finds database root.
//   - EVERY ROW DELETED PAYS ONCE; a later mail is told the job is closed, even with the box
//     since bricked.
//   - A TABLE BESIDE IT EMPTIED TOO IS A MISS.
//   - THE DATABASE ROUTE'S OWN `settings` TABLE EMPTIED CHANGES NOTHING: the wipe still pays.
//   - NO WALLET STILL COMPLETES: the job closes and nothing is paid.
//   - A BRICKED RECORDS BOX IS A MISS, even with the table emptied first.
//   - RECORDS IN FILES: the CSV removed by a root pays; a CSV left with uneven lines is a miss, and
//     finishing it down to the header then pays.
//   - THE RECORDS ARE ON THE INSIDE MACHINE: on a two-hop job, the front box rooted proves
//     nothing; the table emptied over the LAN from the front box pays.
//   - EVERY SETTING: one job in each of the eight, kept in a database or in files, emptied by a
//     DELETE or by a root saving the CSV down to its header, pays.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionWipe.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import type { Identity } from '../src/core/commands/types.js';
import { generateIdentityIn } from '../src/test/factories/identityIn.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { wifiPoolOf } from '../src/core/generation/generateWifi.js';
import { machineIdForLanHost } from '../src/core/generation/lanTopology.js';
import { buildMissionKeyBoxFs } from '../src/core/generation/missionKeyBoxFs.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { HIREME_DOMAIN } from '../src/core/generation/fixedSites.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { ROOT_FILE } from '../src/core/generation/baseFs.js';
import { md5 } from '../src/core/generation/md5.js';
import { databaseIn } from '../src/core/mysql/datadir.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import type { Directory, FileNode } from '../src/core/filesystem/types.js';
import {
  DEFAULT_WORDLIST,
  WORDLIST_PATH,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist.js';
import {
  missionShape,
  type MissionShape,
  type MissionStorage,
} from '../src/core/missions/missionShape.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';
import {
  missionRecords,
  missionSetting,
  recordsFilePath,
  type RecordSetting,
} from '../src/core/missions/missionRecords.js';
import {
  isMissionNumber,
  missionAddressForNumber,
  missionEssid,
} from '../src/core/missions/missionNetwork.js';
import { plaintextFor } from '../src/test/passwords.js';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
const WALLET = process.env.WALLET_ENDPOINT ?? 'http://localhost:3100/api/wallet';
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

const field = (body: unknown, name: string): unknown =>
  (body as Record<string, unknown> | null)?.[name];

const crackedOf = (body: unknown): readonly { username: string; password: string }[] =>
  (field(body, 'cracked') ?? []) as readonly { username: string; password: string }[];

// `shell: true` so Windows resolves `npx.cmd`; the args carry no spaces, so quoting is moot.
const runHireme = (args: readonly string[]): string =>
  execFileSync('npx', ['tsx', 'scripts/hireme.ts', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  }).trim();

const DATABASE_PORT = 3306;
const SSH_PORT = 2222;
const RUN = Date.now().toString(36).slice(-6);
const HIREME_IP = siteAddress(HIREME_DOMAIN) ?? '';

/** The first wipe jobs from `from` in `setting` that `wanted` accepts. */
const wipeNumbers = (
  from: number,
  count: number,
  wanted: (shape: MissionShape) => boolean,
  setting: RecordSetting = 'school',
): readonly number[] => {
  const found: number[] = [];
  for (let candidate = from; candidate < from + 80000 && found.length < count; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    if (missionSetting(candidate) !== setting) continue;
    const shape = missionShape(candidate);
    if (shape.kind === 'wipe' && wanted(shape)) found.push(candidate);
  }
  if (found.length < count) throw new Error(`only ${found.length} ${setting} wipe jobs`);
  return found;
};

/** A single-hop job whose records box falls to `route`, keeping its records in `storage`. */
const singleHop =
  (storage: MissionStorage, route: MissionShape['keyBox']['route'] = 'hydra') =>
  ({ frontBox, keyBox, storage: kept }: MissionShape): boolean =>
    frontBox === null && keyBox.route === route && kept === storage;

const [BOARD_JOB, BESIDE_JOB, NO_WALLET_JOB, BRICK_JOB] = wipeNumbers(
  400000,
  4,
  singleHop('database'),
) as [number, number, number, number];
const [SETTINGS_TABLE_JOB] = wipeNumbers(400000, 1, singleHop('database', 'mysql')) as [number];
const [REMOVED_JOB, UNEVEN_JOB] = wipeNumbers(400000, 2, singleHop('file')) as [number, number];
// A two-hop job whose front box falls to hydra, so a sweep over :2222 roots the front box.
const [INSIDE_JOB] = wipeNumbers(
  400000,
  1,
  ({ frontBox, storage }) => frontBox?.route === 'hydra' && storage === 'database',
) as [number];
/** One job in each setting, the storage alternating so each meets four settings. Drawn from
 *  further up, so none is a job above. */
const SETTING_PLAN: readonly (readonly [RecordSetting, MissionStorage])[] = [
  ['school', 'file'],
  ['police', 'database'],
  ['payroll', 'file'],
  ['dmv', 'database'],
  ['tournament', 'file'],
  ['admissions', 'database'],
  ['club', 'file'],
  ['registry', 'database'],
];
const SETTING_JOBS = SETTING_PLAN.map(([setting, storage]) => {
  const [found] = wipeNumbers(700000, 1, singleHop(storage), setting);
  if (found === undefined) throw new Error(`no ${setting} ${storage} wipe job`);
  return found;
});

type Job = {
  readonly missionNumber: number;
  readonly label: string;
  readonly handle: string;
  readonly address: string;
  readonly essid: string;
  readonly recordsBox: string;
  readonly recordsBoxIp: string;
  readonly front: string | null;
  readonly gateway: string;
  readonly wallet: string;
  /** The table the job asks emptied, and the two beside it. */
  readonly table: string;
  readonly beside: readonly string[];
  /** The application account a database job's records box keeps; none on a file job. */
  readonly login: { readonly username: string; readonly password: string } | null;
};

const jobOf = (missionNumber: number, label: string, index: number): Job => {
  const shape = missionShape(missionNumber);
  const essid = missionEssid(missionNumber);
  const lan = generateHomeLan(essid);
  const machineAt = (octet: number) => {
    const host = lan.hosts.find((candidate) => candidate.ip === `${lan.subnet}.${octet}`);
    if (host === undefined) throw new Error(`no host at .${octet} on ${essid}`);
    return machineIdForLanHost(host, essid);
  };
  const account = databaseIn(buildMissionKeyBoxFs(missionNumber))?.credentials.find(
    (credential) => credential.userType === 'user',
  );
  const [target, ...beside] = missionRecords(missionNumber).tables.map(({ name }) => name);
  return {
    missionNumber,
    label,
    handle: `wip${index}${RUN}`,
    address: missionAddressForNumber(missionNumber) ?? '',
    essid,
    recordsBox: machineAt(shape.keyBox.octet),
    recordsBoxIp: `${lan.subnet}.${shape.keyBox.octet}`,
    front: shape.frontBox === null ? null : machineAt(shape.frontBox.octet),
    gateway: computeApGatewayId(essid),
    wallet: `jsc${md5(`${RUN}:${missionNumber}`)}${md5(String(missionNumber)).slice(0, 8)}`,
    table: target ?? '',
    beside,
    login:
      account === undefined
        ? null
        : { username: account.username, password: plaintextFor(account.passwordHash) },
  };
};

const contractor = generateIdentityIn(RIDGEMONT);
const [homeEssid] = wifiPoolOf(RIDGEMONT);
const WORKSTATION = computeWorkstationId('newbie', contractor.publicKeyHex);

const BOARD = jobOf(BOARD_JOB, 'through the board', 0);
const BESIDE = jobOf(BESIDE_JOB, 'a table beside it emptied', 1);
const NO_WALLET = jobOf(NO_WALLET_JOB, 'no wallet', 2);
const BRICK = jobOf(BRICK_JOB, 'records box bricked', 3);
const SETTINGS_TABLE = jobOf(SETTINGS_TABLE_JOB, "the route's settings emptied", 4);
const REMOVED = jobOf(REMOVED_JOB, 'the CSV removed', 5);
const UNEVEN = jobOf(UNEVEN_JOB, 'uneven lines', 6);
const INSIDE = jobOf(INSIDE_JOB, 'records on the inside machine', 7);
const SETTINGS = SETTING_JOBS.map((missionNumber, index) =>
  jobOf(missionNumber, `${missionSetting(missionNumber)} setting`, 8 + index),
);
const ALL_JOBS = [
  BOARD,
  BESIDE,
  NO_WALLET,
  BRICK,
  SETTINGS_TABLE,
  REMOVED,
  UNEVEN,
  INSIDE,
  ...SETTINGS,
] as const;

const NOT_WIPED = "That's not what we asked for. Not wiped, no money.";
const CLOSED = 'That job is already closed.';

/** The application account a database job's statements run as. */
const loginOf = (job: Job): { readonly username: string; readonly password: string } => {
  if (job.login === null) throw new Error(`${job.label}: the records box has no database`);
  return job.login;
};

const seedWordlist = async () => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: WORKSTATION,
      path: WORDLIST_PATH,
      writer_key: contractor.publicKeyHex,
      content: formatWordlist(DEFAULT_WORDLIST),
      owner: 'root',
      node_type: 'file',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (error) throw new Error(`seed of the word list failed: ${error.message}`);
};

const joinHome = async (player: Identity): Promise<number> => {
  const joined = await post(
    NETWORK,
    signRequest(player, 'registerNetwork', {
      essid: homeEssid,
      workstation_machine_id: WORKSTATION,
      workstation_username: 'newbie',
      workstation_machine_name: 'newbie',
      workstation_root_hash: md5('newbie-root-secret'),
    }),
  );
  return joined.status;
};

/** One statement over the records box's public door, from the contractor's own box. */
const statement = async (job: Job, line: string) => {
  const answer = await post(
    SESSIONS,
    signRequest(contractor, 'mysqlStatement', {
      essid: homeEssid,
      target_ip: job.address,
      port: DATABASE_PORT,
      ...loginOf(job),
      statement: line,
    }),
  );
  return {
    status: answer.status,
    failed: field(answer.body, 'failed'),
    output: ((field(answer.body, 'output') ?? []) as readonly string[]).join('\n'),
  };
};

const hydra = (job: Job, service: 'ssh' | 'mysql', port: number) =>
  post(
    SESSIONS,
    signRequest(contractor, 'hydraCrack', {
      essid: homeEssid,
      target_ip: job.address,
      service,
      caller_machine_id: WORKSTATION,
      port,
    }),
  );

/** The contractor sweeps the box behind the job's :2222 for root and logs in as it over ssh. */
const rootOver2222 = async (job: Job, name: string) => {
  const sweep = await hydra(job, 'ssh', SSH_PORT);
  const root = crackedOf(sweep.body).find(({ username }) => username === 'root');
  const sessionId = `ssh-${name}-${RUN}`;
  const shell = await post(
    SESSIONS,
    signRequest(contractor, 'authCreateSessionPublic', {
      session_id: sessionId,
      target: job.address,
      port: SSH_PORT,
      username: 'root',
      password: root?.password ?? '',
      parent_session_id: null,
      source_ip: null,
      kind: 'ssh',
    }),
  );
  return {
    sessionId,
    landedOn: field(shell.body, 'machine_id'),
    detail: `sweep ${sweep.status} root ${root === undefined ? 'missing' : 'found'}, ssh ${shell.status}`,
  };
};

/** A root's write of `content` at `path` on the records box. */
const writeAsRoot = (job: Job, path: string, content: string) =>
  post(
    PATCHES,
    signRequest(contractor, 'upsertPatch', {
      machine_id: job.recordsBox,
      path,
      content,
      owner: 'root',
      is_new: false,
      node_type: 'file',
      permissions: ROOT_FILE,
    }),
  );

/** A root's `rm` of one file on the records box. */
const removeAsRoot = (job: Job, path: string) =>
  post(
    PATCHES,
    signRequest(contractor, 'removePatch', { machine_id: job.recordsBox, path, owner: 'root' }),
  );

const nodeAt = (tree: Directory, path: string): FileNode | undefined =>
  path
    .split('/')
    .filter((segment) => segment !== '')
    .reduce<FileNode | undefined>(
      (node, segment) => (node?.kind === 'directory' ? node.entries.get(segment) : undefined),
      tree,
    );

/** The records file as the caller's root shell reads it, or null when it cannot. */
const readRecordsFile = async (job: Job): Promise<string | null> => {
  const answer = await post(
    NETWORK,
    signRequest(contractor, 'resolveCrossPlayerFs', { machine_id: job.recordsBox }),
  );
  if (answer.status !== 200) return null;
  const tree = deserializeTree((answer.body as { tree: SerializedDirectory }).tree);
  const node = nodeAt(tree, recordsFilePath(job.missionNumber));
  return node?.kind === 'file' ? node.content : null;
};

/** The contractor's mail to the job's client. */
const mailClient = (job: Job, body: string) =>
  post(
    NETWORK,
    signRequest(contractor, 'resolveMail', {
      op: 'send',
      password: 's3cret',
      handle: job.handle,
      to: missionTerms(job.missionNumber).client.handle,
      subject: 'wiped',
      body,
    }),
  );

/** One message as the mail client reads it. */
const readMessage = async (job: Job, number: number) => {
  const opened = await post(
    NETWORK,
    signRequest(contractor, 'resolveMail', {
      op: 'read',
      handle: job.handle,
      password: 's3cret',
      number,
      mark: false,
    }),
  );
  return field(opened.body, 'message') as { subject?: string; body?: string } | undefined;
};

/** The last mail in the handle's inbox, which is the client's answer to the last send. */
const lastReply = async (job: Job): Promise<string> => {
  const { data, error } = await sr
    .from('email_messages')
    .select('body')
    .eq('handle', job.handle)
    .order('number', { ascending: false })
    .limit(1);
  if (error) throw new Error(`inbox read failed: ${error.message}`);
  return ((data ?? []) as readonly { body: string }[])[0]?.body ?? '';
};

const stateOf = async (job: Job): Promise<string | null> => {
  const { data } = await sr
    .from('hireme_missions')
    .select('state')
    .eq('number', job.missionNumber)
    .maybeSingle();
  return (data as { state?: string } | null)?.state ?? null;
};

const balanceOf = async (address: string): Promise<number> => {
  const answer = await post(WALLET, { action: 'balance', address });
  const balance = field(answer.body, 'balance');
  return typeof balance === 'number' ? balance : -1;
};

const openMailbox = async (job: Job) => {
  const { error } = await sr.from('email_accounts').insert({
    handle: job.handle,
    password_md5: md5('s3cret'),
    signed_up_by: contractor.publicKeyHex,
  });
  if (error) throw new Error(`mailbox insert failed: ${error.message}`);
  // A sender gets 20 mails a window and this check sends more across its jobs; each job starts
  // the count afresh so the cap never answers for the client.
  await sr.from('email_sends').delete().eq('player_key', contractor.publicKeyHex);
};

const stage = async (job: Job) => {
  await openMailbox(job);
  runHireme(['accept', job.handle, '--number', String(job.missionNumber)]);
  console.log(`\n${job.label} job ${job.missionNumber} at ${job.address}, table ${job.table}`);
};

/** A board fetch by the contractor, posting `form` when there is one. */
const fetchAt = (target: string, path: string, form?: string) =>
  post(
    NETWORK,
    signRequest(contractor, 'resolveHttpFetch', {
      target,
      port: 80,
      path,
      ...(form === undefined ? {} : { body: form }),
    }),
  );

/** The job taken as a contractor takes one: a board applied for at hireme.io, the job offered
 *  on it, and accepted through its /accept. The briefing's number in the inbox. */
const acceptThroughBoard = async (job: Job): Promise<number> => {
  await openMailbox(job);
  await fetchAt(HIREME_IP, '/apply', `email=${job.handle}`);
  const board = await sr
    .from('hireme_boards')
    .select('address')
    .eq('handle', job.handle)
    .maybeSingle();
  if (board.error || board.data === null) throw new Error(`no board for ${job.handle}`);
  const ref = randomBytes(3).toString('hex');
  const offered = await sr
    .from('hireme_missions')
    .insert({ number: job.missionNumber, handle: job.handle, state: 'offered', ref });
  if (offered.error) throw new Error(`offer insert failed: ${offered.error.message}`);
  const accepted = await fetchAt(
    (board.data as { address: string }).address,
    '/accept',
    `offer=${ref}`,
  );
  if (accepted.status !== 200) throw new Error(`accept answered ${accepted.status}`);
  const { data } = await sr
    .from('email_messages')
    .select('number')
    .eq('handle', job.handle)
    .order('number', { ascending: false })
    .limit(1);
  console.log(`\n${job.label} job ${job.missionNumber} at ${job.address}, table ${job.table}`);
  return ((data ?? []) as readonly { number: number }[])[0]?.number ?? 0;
};

const cleanup = async () => {
  await sr
    .from('hireme_missions')
    .delete()
    .in(
      'number',
      ALL_JOBS.map(({ missionNumber }) => missionNumber),
    );
  await sr.from('email_accounts').delete().eq('signed_up_by', contractor.publicKeyHex);
  await sr.from('email_sends').delete().eq('player_key', contractor.publicKeyHex);
  const machines = ALL_JOBS.flatMap((job) => [
    job.recordsBox,
    job.gateway,
    ...(job.front === null ? [] : [job.front]),
  ]);
  for (const machineId of [WORKSTATION, ...machines]) {
    await sr.from('patches').delete().eq('machine_id', machineId);
  }
  await sr.from('sessions').delete().eq('player_key', contractor.publicKeyHex);
  await sr.from('home_network_occupants').delete().eq('owner_key', contractor.publicKeyHex);
  await sr.from('network_lan_leases').delete().eq('owner_key', contractor.publicKeyHex);
  for (const job of ALL_JOBS) {
    await sr.from('wallet_transfers').delete().eq('to_address', job.wallet);
    await sr.from('wallet_balances').delete().eq('address', job.wallet);
  }
};

/** Whether the job is still open, unpaid, and the last reply is the miss. */
const missed = async (job: Job): Promise<boolean> =>
  (await lastReply(job)).startsWith(NOT_WIPED) &&
  (await stateOf(job)) === 'accepted' &&
  (await balanceOf(job.wallet)) <= 0;

/** Whether the job is completed, paid its quoted pay, and the last reply says so. */
const paidInFull = async (job: Job): Promise<boolean> => {
  const { pay } = missionTerms(job.missionNumber);
  return (
    (await lastReply(job)).startsWith(
      `The records are gone. §${pay.toLocaleString('en-US')} sent to ${job.wallet}.`,
    ) &&
    (await stateOf(job)) === 'completed' &&
    (await balanceOf(job.wallet)) === pay
  );
};

/** Taken through the board: the briefing and the report, a miss on the untouched table, no DROP
 *  for the application account, a miss with rows left, every row deleted and paid once, then
 *  closed whatever has become of the box. */
const workTheBoardJob = async () => {
  const job = BOARD;
  const briefingNumber = await acceptThroughBoard(job);
  const { pay } = missionTerms(job.missionNumber);

  const briefing = (await readMessage(job, briefingNumber))?.body ?? '';
  check(
    'the briefing describes the records and the rule, and names no table or file',
    briefing.includes(
      'Their records hold what each student scored in each subject. We want all of it gone.',
    ) &&
      briefing.includes('Not wiped, no money. No wallet, no money.') &&
      [job.table, ...job.beside, '/srv/'].every((word) => !briefing.includes(word)),
    `${briefing.length} chars`,
  );

  const shown = runHireme(['show', job.address]);
  check(
    'show names the kind, the setting, the storage and the table',
    shown.includes('Kind:     wipe, school') && shown.includes(`Storage:  database, table grades`),
    shown
      .split('\n')
      .filter((line) => line.includes('Kind:') || line.includes('Storage:'))
      .join(' | '),
  );

  const early = await mailClient(job, `all gone\n${job.wallet}\n`);
  check(
    'a mail about an untouched table gets the miss and pays nothing',
    early.status === 200 && (await missed(job)),
    `status ${early.status}, state ${await stateOf(job)}`,
  );

  const swept = await hydra(job, 'mysql', DATABASE_PORT);
  const usernames = crackedOf(swept.body).map(({ username }) => username);
  const dropped = await statement(job, 'DROP TABLE grades');
  const counted = await statement(job, 'SELECT * FROM grades');
  check(
    'the sweep finds the application account and never database root, and its DROP is refused',
    swept.status === 200 &&
      usernames.includes(loginOf(job).username) &&
      !usernames.includes('root') &&
      dropped.status === 200 &&
      dropped.failed === true &&
      dropped.output.includes('DROP command denied') &&
      counted.output.includes('|'),
    `sweep ${swept.status} cracked ${usernames.length}, drop ${dropped.status} ${dropped.output.split('\n')[0]}`,
  );

  const [firstRow] = missionRecords(job.missionNumber).tables[0]?.table.rows ?? [];
  const partly = await statement(job, `DELETE FROM grades WHERE id = '${firstRow?.['id']}'`);
  const partMail = await mailClient(job, `all gone\n${job.wallet}\n`);
  check(
    'one row deleted, the rest left, gets the miss',
    partly.status === 200 &&
      partly.failed === false &&
      partMail.status === 200 &&
      (await missed(job)),
    `delete ${partly.status}, mail ${partMail.status}`,
  );

  const wiped = await statement(job, 'DELETE FROM grades');
  const paid = await mailClient(job, `all gone\n${job.wallet}\n`);
  check(
    'every row deleted completes the job and pays the quoted pay',
    wiped.status === 200 &&
      wiped.failed === false &&
      paid.status === 200 &&
      (await paidInFull(job)),
    `delete ${wiped.status}, mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
  );

  const rooted = await rootOver2222(job, 'board');
  const bricked = await removeAsRoot(job, '/boot/vmlinuz');
  const again = await mailClient(job, `once more\n${job.wallet}\n`);
  check(
    'a later mail is told the job is closed without reading the box, now bricked, and pays nothing',
    rooted.landedOn === job.recordsBox &&
      bricked.status === 200 &&
      again.status === 200 &&
      (await lastReply(job)).startsWith(CLOSED) &&
      (await balanceOf(job.wallet)) === pay,
    `${rooted.detail}, brick ${bricked.status}, mail ${again.status}, balance ${await balanceOf(job.wallet)}`,
  );
};

/** The target emptied, and a table beside it emptied too. */
const workTheBesideJob = async () => {
  const job = BESIDE;
  await stage(job);

  const wiped = await statement(job, 'DELETE FROM grades');
  const besideToo = await statement(job, `DELETE FROM ${job.beside[0]}`);
  const mailed = await mailClient(job, `all gone\n${job.wallet}\n`);
  check(
    `a table beside it (${job.beside[0]}) emptied too gets the miss`,
    wiped.failed === false &&
      besideToo.failed === false &&
      mailed.status === 200 &&
      (await missed(job)),
    `delete ${wiped.status}/${besideToo.status}, mail ${mailed.status}`,
  );
};

/** The target emptied and no wallet named: the job closes and nothing is paid. */
const workTheNoWalletJob = async () => {
  const job = NO_WALLET;
  await stage(job);

  const wiped = await statement(job, 'DELETE FROM grades');
  const mailed = await mailClient(job, 'all gone\n');
  check(
    'with no wallet the job completes, the client says so, and nothing is paid',
    wiped.failed === false &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith('The records are gone. You sent no wallet') &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) <= 0,
    `delete ${wiped.status}, mail ${mailed.status}, state ${await stateOf(job)}`,
  );
};

/** The target emptied, then the records box bricked: the client can no longer read it. */
const workTheBrickJob = async () => {
  const job = BRICK;
  await stage(job);

  const wiped = await statement(job, 'DELETE FROM grades');
  const rooted = await rootOver2222(job, 'brick');
  const bricked = await removeAsRoot(job, '/boot/vmlinuz');
  const mailed = await mailClient(job, `all gone\n${job.wallet}\n`);
  check(
    'a records box that no longer boots gets the miss, even with the table emptied first',
    wiped.failed === false &&
      rooted.landedOn === job.recordsBox &&
      bricked.status === 200 &&
      mailed.status === 200 &&
      (await missed(job)),
    `delete ${wiped.status}, ${rooted.detail}, brick ${bricked.status}, mail ${mailed.status}`,
  );
};

/** On the database route the box keeps a `settings` table of its own, which the client never
 *  reads. */
const workTheSettingsTableJob = async () => {
  const job = SETTINGS_TABLE;
  await stage(job);

  const settings = await statement(job, 'DELETE FROM settings');
  const wiped = await statement(job, 'DELETE FROM grades');
  const left = await statement(job, 'SELECT * FROM settings');
  const paid = await mailClient(job, `all gone\n${job.wallet}\n`);
  check(
    "the database route's settings table emptied too changes nothing: the wipe pays",
    settings.failed === false &&
      wiped.failed === false &&
      !left.output.includes('|') &&
      paid.status === 200 &&
      (await paidInFull(job)),
    `delete settings ${settings.status} grades ${wiped.status}, mail ${paid.status}`,
  );
};

/** Records kept in files: a root removes the target's CSV. */
const workTheRemovedJob = async () => {
  const job = REMOVED;
  await stage(job);

  const shown = runHireme(['show', job.address]);
  check(
    'show names the CSV the table is kept in',
    shown.includes(`Storage:  file, ${recordsFilePath(job.missionNumber)}`),
    shown.split('\n').find((line) => line.includes('Storage:')) ?? 'no Storage line',
  );

  const rooted = await rootOver2222(job, 'removed');
  const opened = await readRecordsFile(job);
  const removed = await removeAsRoot(job, recordsFilePath(job.missionNumber));
  const paid = await mailClient(job, `all gone\n${job.wallet}\n`);
  check(
    "the route's root reads the CSV, removes it, and the mail pays",
    rooted.landedOn === job.recordsBox &&
      opened !== null &&
      opened.startsWith('id,student,subject,grade\n') &&
      removed.status === 200 &&
      paid.status === 200 &&
      (await paidInFull(job)),
    `${rooted.detail}, read ${opened === null ? 'failed' : 'ok'}, rm ${removed.status}, mail ${paid.status}`,
  );
};

/** Records kept in files: saved with uneven lines, then finished down to the header. */
const workTheUnevenJob = async () => {
  const job = UNEVEN;
  await stage(job);

  const rooted = await rootOver2222(job, 'uneven');
  const opened = (await readRecordsFile(job)) ?? '';
  const [header] = opened.split('\n');
  const path = recordsFilePath(job.missionNumber);
  const uneven = await writeAsRoot(job, path, `${header}\nAiden Marsh\n`);
  const early = await mailClient(job, `all gone\n${job.wallet}\n`);
  check(
    'a CSV left with uneven lines, which may still hold grades, gets the miss',
    rooted.landedOn === job.recordsBox &&
      uneven.status === 200 &&
      early.status === 200 &&
      (await missed(job)),
    `${rooted.detail}, write ${uneven.status}, mail ${early.status}`,
  );

  const finished = await writeAsRoot(job, path, `${header}\n`);
  const paid = await mailClient(job, `now it is\n${job.wallet}\n`);
  check(
    'the CSV finished down to its header then pays',
    finished.status === 200 && paid.status === 200 && (await paidInFull(job)),
    `write ${finished.status}, mail ${paid.status}`,
  );
};

/** A two-hop job: the front box rooted proves nothing; the table emptied over the LAN pays. */
const workTheInsideJob = async () => {
  const job = INSIDE;
  await stage(job);

  const rooted = await rootOver2222(job, 'inside-front');
  const early = await mailClient(job, `all gone\n${job.wallet}\n`);
  check(
    'on two hops, the front box rooted leaves the records in place: the miss',
    rooted.landedOn === job.front && early.status === 200 && (await missed(job)),
    `${rooted.detail}, mail ${early.status}`,
  );

  const wiped = await post(
    SESSIONS,
    signRequest(contractor, 'mysqlStatement', {
      essid: job.essid,
      target_ip: job.recordsBoxIp,
      port: DATABASE_PORT,
      ...loginOf(job),
      statement: 'DELETE FROM grades',
      caller_machine_id: job.front,
    }),
  );
  const paid = await mailClient(job, `all gone\n${job.wallet}\n`);
  check(
    'the table emptied over the LAN from the front box completes the job and pays',
    wiped.status === 200 &&
      field(wiped.body, 'failed') === false &&
      paid.status === 200 &&
      (await paidInFull(job)),
    `delete ${wiped.status}, mail ${paid.status}, state ${await stateOf(job)}`,
  );
};

/** One job in a setting: its table emptied by a DELETE, or its CSV saved down to its header. */
const workTheSettingJob = async (job: Job) => {
  await stage(job);
  const storage = missionShape(job.missionNumber).storage;
  const setting = missionSetting(job.missionNumber);

  const shown = runHireme(['show', job.address]);
  const emptied =
    storage === 'database'
      ? await statement(job, `DELETE FROM ${job.table}`)
      : await (async () => {
          const rooted = await rootOver2222(job, `setting-${setting}`);
          const [header] = ((await readRecordsFile(job)) ?? '').split('\n');
          const saved = await writeAsRoot(job, recordsFilePath(job.missionNumber), `${header}\n`);
          return {
            status: saved.status,
            failed: rooted.landedOn !== job.recordsBox || saved.status !== 200,
          };
        })();
  const paid = await mailClient(job, `all gone\n${job.wallet}\n`);
  check(
    `the ${setting} job kept in a ${storage}, its ${job.table} emptied, pays`,
    shown.includes(`Kind:     wipe, ${setting}`) &&
      emptied.failed === false &&
      paid.status === 200 &&
      (await paidInFull(job)),
    `empty ${emptied.status}, mail ${paid.status}, state ${await stateOf(job)}`,
  );
};

const main = async () => {
  if (HIREME_IP === '' || homeEssid === undefined || ALL_JOBS.some((job) => job.address === '')) {
    console.error('the world does not hold what this check assumes');
    process.exit(2);
  }
  await cleanup();

  const status = await joinHome(contractor);
  if (status !== 200) {
    console.error(`Could not put the contractor on a network: status ${status}`);
    process.exit(2);
  }
  await seedWordlist();

  await workTheBoardJob();
  await workTheBesideJob();
  await workTheNoWalletJob();
  await workTheBrickJob();
  await workTheSettingsTableJob();
  await workTheRemovedJob();
  await workTheUnevenJob();
  await workTheInsideJob();
  for (const job of SETTINGS) await workTheSettingJob(job);

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
