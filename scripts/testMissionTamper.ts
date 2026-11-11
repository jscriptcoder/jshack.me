// Wire-check for A TAMPER JOB: a contract whose client wants one school grade changed or erased,
// and reads its own records box to see that it was. Driven end to end against a running
// `vercel dev` + supabase, staging each job through the REAL `scripts/hireme.ts` and working it
// through the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE RECORDS BOX IS A DATABASE: nmap shows :3306, the sweep finds the application account,
//     and SHOW TABLES lists grades and no api_keys. `show` names the change.
//   - THE CLIENT READS THE BOX ON ANY MAIL: before any change, and after a careless UPDATE that
//     gave every row the grade, the reply is that the records don't look right, and the job
//     stays accepted.
//   - THE RIGHT UPDATE PAYS ONCE: the grade changed on the one row, any mail completes the job
//     and mints the pay; a second mail is told the job is closed and pays nothing more.
//   - A BRICKED RECORDS BOX PAYS NOTHING: the grade changed, then root cracked over :2222 and
//     /boot/vmlinuz removed, and the client finds no records that read right.
//   - TWO HOPS: the records box behind a web front box is changed from a root shell on the front
//     box, over the LAN, and the mail pays.
//   - AN ERASE JOB: `show` names the row to erase; a DELETE with no WHERE takes every row and the
//     client says the records don't look right; on a fresh job the right DELETE ... WHERE pays
//     once, and a second mail is told the job is closed.
//   - A JOB KEEPING A FILE: `show` names the CSV, nmap shows no :3306, and the route's root reads
//     the CSV; saving it as `nano` saves it, the opened text as the base, with the target line
//     right pays once; on a fresh job the same save with another line deleted too is told the
//     records don't look right.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionTamper.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { execFileSync } from 'node:child_process';
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
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import { defaultFilePermissions } from '../src/core/filesystem/defaultPermissions.js';
import type { Directory, FileNode } from '../src/core/filesystem/types.js';
import { contentHash } from '../src/core/patches/contentHash.js';
import {
  DEFAULT_WORDLIST,
  WORDLIST_PATH,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist.js';
import { missionShape, type MissionShape } from '../src/core/missions/missionShape.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';
import {
  missionAction,
  missionRecords,
  recordsFilePath,
  type RecordAction,
} from '../src/core/missions/missionRecords.js';
import { missionLeakPath } from '../src/core/missions/missionLeak.js';
import {
  isMissionNumber,
  missionAddressForNumber,
  missionEssid,
} from '../src/core/missions/missionNetwork.js';
import { WEB_ROOT } from '../src/core/network/http.js';
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

const portsOf = (body: unknown): readonly number[] =>
  ((field(body, 'ports') ?? []) as readonly { port?: number }[])
    .map((entry) => entry.port)
    .filter((port): port is number => typeof port === 'number');

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

/** The first tamper jobs from `from` asking for `action` that `wanted` accepts. */
const tamperNumbers = (
  from: number,
  count: number,
  action: RecordAction,
  wanted: (shape: MissionShape) => boolean,
): readonly number[] => {
  const found: number[] = [];
  for (let candidate = from; candidate < from + 60000 && found.length < count; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.kind === 'tamper' && missionAction(candidate) === action && wanted(shape)) {
      found.push(candidate);
    }
  }
  if (found.length < count) throw new Error(`only ${found.length} tamper jobs from ${from}`);
  return found;
};

/** A single-hop job whose records box falls to hydra, so its root is on the list every player
 *  has, keeping its records in its database. */
const singleHopHydra = ({ frontBox, keyBox, storage }: MissionShape): boolean =>
  frontBox === null && keyBox.route === 'hydra' && storage === 'database';

/** The same, keeping its records in a file. */
const singleHopHydraFile = ({ frontBox, keyBox, storage }: MissionShape): boolean =>
  frontBox === null && keyBox.route === 'hydra' && storage === 'file';

const [WRONG_JOB, PAID_JOB, BRICKED_JOB] = tamperNumbers(400000, 3, 'change', singleHopHydra) as [
  number,
  number,
  number,
];
// A two-hop job behind a web front box, whose forgotten file gives the front box's root away.
const [INSIDE_JOB] = tamperNumbers(
  400000,
  1,
  'change',
  ({ frontBox, storage }) => frontBox?.route === 'web' && storage === 'database',
) as [number];
const [WIPED_JOB, ERASED_JOB] = tamperNumbers(400000, 2, 'erase', singleHopHydra) as [
  number,
  number,
];
// No mysql decoy, so a scan finding no :3306 says the records keep no database door.
const [FILED_JOB, BROKEN_JOB] = tamperNumbers(
  400000,
  2,
  'change',
  (shape) => singleHopHydraFile(shape) && !shape.keyBox.decoys.includes('mysql'),
) as [number, number];
const JOBS = [
  WRONG_JOB,
  PAID_JOB,
  BRICKED_JOB,
  INSIDE_JOB,
  WIPED_JOB,
  ERASED_JOB,
  FILED_JOB,
  BROKEN_JOB,
] as const;

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
  return {
    missionNumber,
    label,
    handle: `tmp${index}${RUN}`,
    address: missionAddressForNumber(missionNumber) ?? '',
    essid,
    recordsBox: machineAt(shape.keyBox.octet),
    recordsBoxIp: `${lan.subnet}.${shape.keyBox.octet}`,
    front: shape.frontBox === null ? null : machineAt(shape.frontBox.octet),
    gateway: computeApGatewayId(essid),
    wallet: `jsc${md5(`${RUN}:${missionNumber}`)}${md5(String(missionNumber)).slice(0, 8)}`,
    login:
      account === undefined
        ? null
        : { username: account.username, password: plaintextFor(account.passwordHash) },
  };
};

/** The application account a database job's statements run as. */
const loginOf = (job: Job): { readonly username: string; readonly password: string } => {
  if (job.login === null)
    throw new Error(`${job.label}: the records box has no application account`);
  return job.login;
};

const contractor = generateIdentityIn(RIDGEMONT);
const [homeEssid] = wifiPoolOf(RIDGEMONT);
const WORKSTATION = computeWorkstationId('newbie', contractor.publicKeyHex);

const WRONG = jobOf(WRONG_JOB, 'wrong', 0);
const PAID = jobOf(PAID_JOB, 'paid', 1);
const BRICKED = jobOf(BRICKED_JOB, 'bricked', 2);
const INSIDE = jobOf(INSIDE_JOB, 'two-hop', 3);
const WIPED = jobOf(WIPED_JOB, 'wiped erase', 4);
const ERASED = jobOf(ERASED_JOB, 'erase', 5);
const FILED = jobOf(FILED_JOB, 'file', 6);
const BROKEN = jobOf(BROKEN_JOB, 'broken file', 7);
const ALL_JOBS = [WRONG, PAID, BRICKED, INSIDE, WIPED, ERASED, FILED, BROKEN] as const;

const RECORDS_WRONG = "Our records don't look right. No change, no money.";
const CLOSED = 'That job is already closed.';

/** The row a change job asks changed, failing the check on an erase job. */
const changeTargetOf = (missionNumber: number) => {
  const { target } = missionRecords(missionNumber);
  if (target.action !== 'change') throw new Error(`contract ${missionNumber} is not a change`);
  return target;
};

/** The statement that changes the target's grade and nothing else. */
const rightUpdate = (missionNumber: number): string => {
  const target = changeTargetOf(missionNumber);
  return `UPDATE grades SET grade = '${target.to}' WHERE student = '${target.student}' AND subject = '${target.subject}'`;
};

/** The statement that deletes the target's row and nothing else. */
const rightDelete = (missionNumber: number): string => {
  const { target } = missionRecords(missionNumber);
  return `DELETE FROM grades WHERE student = '${target.student}' AND subject = '${target.subject}'`;
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

/** The contractor's mail to the job's client, saying nothing in particular. */
const mailClient = (job: Job, body: string) =>
  post(
    NETWORK,
    signRequest(contractor, 'resolveMail', {
      op: 'send',
      password: 's3cret',
      handle: job.handle,
      to: missionTerms(job.missionNumber).client.handle,
      subject: 'done',
      body,
    }),
  );

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

const stage = async (job: Job) => {
  const { error } = await sr.from('email_accounts').insert({
    handle: job.handle,
    password_md5: md5('s3cret'),
    signed_up_by: contractor.publicKeyHex,
  });
  if (error) throw new Error(`mailbox insert failed: ${error.message}`);
  runHireme(['accept', job.handle, '--number', String(job.missionNumber)]);
  console.log(`\n${job.label} job ${job.missionNumber} at ${job.address}`);
};

const cleanup = async () => {
  await sr
    .from('hireme_missions')
    .delete()
    .in('number', [...JOBS]);
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

/** A careless contractor: mails before touching anything, then gives every row the grade. */
const workTheWrongJob = async () => {
  const job = WRONG;
  await stage(job);
  const target = changeTargetOf(job.missionNumber);

  const shown = runHireme(['show', job.address]);
  check(
    'show names the kind, the storage and the change',
    shown.includes('Kind:     tamper, school, change') &&
      shown.includes('Storage:  database, table grades') &&
      shown.includes(
        `Change:   ${target.student}, ${target.subject}: ${target.from} -> ${target.to}`,
      ),
    shown.split('\n').find((line) => line.includes('Kind:')) ?? 'no Kind line',
  );

  const scan = await post(
    NETWORK,
    signRequest(contractor, 'resolvePublicScan', { target: job.address }),
  );
  check(
    'nmap <address> shows :3306',
    scan.status === 200 && portsOf(scan.body).includes(DATABASE_PORT),
    `status ${scan.status} ports=[${portsOf(scan.body).join(',')}]`,
  );

  const early = await mailClient(job, 'it is done');
  check(
    'a mail before any change is told the records do not look right',
    early.status === 200 && (await lastReply(job)).startsWith(RECORDS_WRONG),
    `status ${early.status}`,
  );

  const swept = await hydra(job, 'mysql', DATABASE_PORT);
  const usernames = crackedOf(swept.body).map(({ username }) => username);
  check(
    'hydra <address> mysql finds the application account and not database root',
    swept.status === 200 &&
      usernames.includes(loginOf(job).username) &&
      !usernames.includes('root'),
    `status ${swept.status} cracked ${usernames.length}`,
  );

  const tables = await statement(job, 'SHOW TABLES');
  check(
    'SHOW TABLES lists grades and no api_keys',
    tables.status === 200 &&
      tables.output.includes('grades') &&
      !tables.output.includes('api_keys'),
    `status ${tables.status}`,
  );
  const before = await statement(
    job,
    `SELECT grade FROM grades WHERE student = '${target.student}' AND subject = '${target.subject}'`,
  );
  check(
    'the target row holds the grade the briefing names',
    before.status === 200 && before.output.includes(`| ${target.from} `),
    `status ${before.status}`,
  );

  const careless = await statement(job, `UPDATE grades SET grade = '${target.to}'`);
  const carelessMail = await mailClient(job, 'done, check it');
  check(
    'an UPDATE with no WHERE lands, and the client says the records do not look right',
    careless.status === 200 &&
      careless.failed === false &&
      carelessMail.status === 200 &&
      (await lastReply(job)).startsWith(RECORDS_WRONG),
    `update ${careless.status}, mail ${carelessMail.status}`,
  );
  check('the job stays accepted', (await stateOf(job)) === 'accepted', `${await stateOf(job)}`);
};

/** The grade changed on the one row: paid once, then closed. */
const workThePaidJob = async () => {
  const job = PAID;
  await stage(job);
  const pay = missionTerms(job.missionNumber).pay;

  const changed = await statement(job, rightUpdate(job.missionNumber));
  const paid = await mailClient(job, `it is done\n${job.wallet}\n`);
  check(
    'the right UPDATE and any mail complete the job and pay the quoted pay',
    changed.status === 200 &&
      changed.failed === false &&
      paid.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) === pay,
    `update ${changed.status}, mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
  );
  check(
    'the client says the records look right and names the wallet',
    (await lastReply(job)).startsWith(
      `The records look right. §${pay.toLocaleString('en-US')} sent to ${job.wallet}.`,
    ),
    'reply read',
  );

  const again = await mailClient(job, `once more\n${job.wallet}\n`);
  check(
    'a second mail is told the job is closed and pays nothing more',
    again.status === 200 &&
      (await lastReply(job)).startsWith(CLOSED) &&
      (await balanceOf(job.wallet)) === pay,
    `status ${again.status}, balance ${await balanceOf(job.wallet)}`,
  );
};

/** The grade changed, then the box bricked by its own root: no records read right. */
const workTheBrickedJob = async () => {
  const job = BRICKED;
  await stage(job);

  const changed = await statement(job, rightUpdate(job.missionNumber));
  const rootSweep = await hydra(job, 'ssh', SSH_PORT);
  const root = crackedOf(rootSweep.body).find(({ username }) => username === 'root');
  const shell = await post(
    SESSIONS,
    signRequest(contractor, 'authCreateSessionPublic', {
      session_id: `ssh-bricked-${RUN}`,
      target: job.address,
      port: SSH_PORT,
      username: 'root',
      password: root?.password ?? '',
      parent_session_id: null,
      source_ip: null,
      kind: 'ssh',
    }),
  );
  check(
    'hydra cracks the records box root over :2222, and ssh lands root on it',
    changed.status === 200 &&
      root !== undefined &&
      shell.status === 200 &&
      field(shell.body, 'machine_id') === job.recordsBox,
    `update ${changed.status}, sweep ${rootSweep.status}, ssh ${shell.status}`,
  );

  const removed = await post(
    PATCHES,
    signRequest(contractor, 'removePatch', {
      machine_id: job.recordsBox,
      path: '/boot/vmlinuz',
      owner: 'root',
    }),
  );
  const mailed = await mailClient(job, `done\n${job.wallet}\n`);
  check(
    "after root's rm /boot/vmlinuz the client finds no records that read right",
    removed.status === 200 &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith(RECORDS_WRONG) &&
      (await stateOf(job)) === 'accepted' &&
      (await balanceOf(job.wallet)) <= 0,
    `rm ${removed.status}, mail ${mailed.status}, state ${await stateOf(job)}`,
  );
};

/** The records box behind a web front box, changed from a root shell on the front box. */
const workTheInsideJob = async () => {
  const job = INSIDE;
  await stage(job);
  const shape = missionShape(job.missionNumber);
  const frontWord = plaintextFor(shape.frontBox?.rootHash ?? '');
  const leakPath = (
    missionLeakPath({ missionNumber: job.missionNumber, role: 'front' }) ?? ''
  ).replace(WEB_ROOT, '');

  const page = await post(
    NETWORK,
    signRequest(contractor, 'resolveHttpFetch', { target: job.address, port: 80, path: leakPath }),
  );
  const shell = await post(
    SESSIONS,
    signRequest(contractor, 'authCreateSessionPublic', {
      session_id: `ssh-front-${RUN}`,
      target: job.address,
      port: SSH_PORT,
      username: 'root',
      password: frontWord,
      parent_session_id: null,
      source_ip: null,
    }),
  );
  check(
    "the front box's forgotten file gives its root, and ssh lands root on it",
    page.status === 200 && shell.status === 200 && field(shell.body, 'machine_id') === job.front,
    `curl ${page.status}, ssh ${shell.status}`,
  );

  const changed = await post(
    SESSIONS,
    signRequest(contractor, 'mysqlStatement', {
      essid: job.essid,
      target_ip: job.recordsBoxIp,
      port: DATABASE_PORT,
      ...loginOf(job),
      statement: rightUpdate(job.missionNumber),
      caller_machine_id: job.front,
    }),
  );
  const pay = missionTerms(job.missionNumber).pay;
  const paid = await mailClient(job, `changed it from the inside\n${job.wallet}\n`);
  check(
    'the right UPDATE from the front box, over the LAN, pays the two-hop pay',
    changed.status === 200 &&
      field(changed.body, 'failed') === false &&
      paid.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) === pay,
    `update ${changed.status}, mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
  );
};

/** A careless contractor on an erase job: a DELETE with no WHERE takes every row. */
const workTheWipedJob = async () => {
  const job = WIPED;
  await stage(job);

  const before = await statement(job, 'SELECT COUNT(*) FROM grades');
  const wiped = await statement(job, 'DELETE FROM grades');
  const after = await statement(job, 'SELECT * FROM grades');
  const mailed = await mailClient(job, `gone\n${job.wallet}\n`);
  check(
    'a DELETE with no WHERE lands, and the client says the records do not look right',
    before.status === 200 &&
      wiped.status === 200 &&
      wiped.failed === false &&
      !after.output.includes('|') &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith(RECORDS_WRONG),
    `delete ${wiped.status}, mail ${mailed.status}`,
  );
  check(
    'the wiped erase job stays accepted and pays nothing',
    (await stateOf(job)) === 'accepted' && (await balanceOf(job.wallet)) <= 0,
    `${await stateOf(job)}`,
  );
};

/** The failing grade deleted on the one row: paid once, then closed. */
const workTheErasedJob = async () => {
  const job = ERASED;
  await stage(job);
  const { target } = missionRecords(job.missionNumber);
  const pay = missionTerms(job.missionNumber).pay;

  const shown = runHireme(['show', job.address]);
  check(
    'show names an erase job and the row it asks gone',
    shown.includes('Kind:     tamper, school, erase') &&
      shown.includes(`Erase:    ${target.student}, ${target.subject} (F)`),
    shown.split('\n').find((line) => line.includes('Kind:')) ?? 'no Kind line',
  );

  const before = await statement(
    job,
    `SELECT grade FROM grades WHERE student = '${target.student}' AND subject = '${target.subject}'`,
  );
  check(
    'the row the briefing names holds a failing grade',
    before.status === 200 && before.output.includes('| F '),
    `status ${before.status}`,
  );

  const deleted = await statement(job, rightDelete(job.missionNumber));
  const paid = await mailClient(job, `it is gone\n${job.wallet}\n`);
  check(
    'the right DELETE and any mail complete the job and pay the quoted pay',
    deleted.status === 200 &&
      deleted.failed === false &&
      paid.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) === pay,
    `delete ${deleted.status}, mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
  );
  check(
    'the client says the records look right and names the wallet',
    (await lastReply(job)).startsWith(
      `The records look right. §${pay.toLocaleString('en-US')} sent to ${job.wallet}.`,
    ),
    'reply read',
  );

  const again = await mailClient(job, `once more\n${job.wallet}\n`);
  check(
    'a second mail on the erase job is told it is closed and pays nothing more',
    again.status === 200 &&
      (await lastReply(job)).startsWith(CLOSED) &&
      (await balanceOf(job.wallet)) === pay,
    `status ${again.status}, balance ${await balanceOf(job.wallet)}`,
  );
};

/** Hydra cracks the records box's root over :2222, and ssh lands a root shell there. */
const rootOnTheBox = async (job: Job, sessionId: string) => {
  const rootSweep = await hydra(job, 'ssh', SSH_PORT);
  const root = crackedOf(rootSweep.body).find(({ username }) => username === 'root');
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
    landed:
      root !== undefined &&
      shell.status === 200 &&
      field(shell.body, 'machine_id') === job.recordsBox,
    detail: `sweep ${rootSweep.status}, ssh ${shell.status}`,
  };
};

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

/** A root's `nano` save of the records file: the whole new text, judged against what it opened. */
const saveRecordsFile = (job: Job, opened: string, content: string) =>
  post(
    PATCHES,
    signRequest(contractor, 'upsertPatch', {
      machine_id: job.recordsBox,
      path: recordsFilePath(job.missionNumber),
      content,
      owner: 'root',
      permissions: defaultFilePermissions('root'),
      node_type: 'file',
      base_hash: contentHash(opened),
    }),
  );

/** The file's lines with the target's grade set to the one asked for: the header is line 0, so a
 *  row's line is its id. */
const withTargetChanged = (missionNumber: number, opened: string): readonly string[] => {
  const target = changeTargetOf(missionNumber);
  return opened
    .split('\n')
    .map((line, index) =>
      index === target.rowId ? line.replace(new RegExp(`,${target.from}$`), `,${target.to}`) : line,
    );
};

/** A root opens the CSV in `nano`, sets the target line's grade and saves: paid once, then closed. */
const workTheFiledJob = async () => {
  const job = FILED;
  await stage(job);
  const pay = missionTerms(job.missionNumber).pay;

  const shown = runHireme(['show', job.address]);
  check(
    'show names a job keeping its records in a file, and the file',
    shown.includes(`Storage:  file, ${recordsFilePath(job.missionNumber)}`) &&
      !shown.includes('table grades'),
    shown.split('\n').find((line) => line.includes('Storage:')) ?? 'no Storage line',
  );

  const scan = await post(
    NETWORK,
    signRequest(contractor, 'resolvePublicScan', { target: job.address }),
  );
  check(
    'nmap <address> shows no :3306 on a job keeping a file',
    scan.status === 200 && !portsOf(scan.body).includes(DATABASE_PORT),
    `status ${scan.status} ports=[${portsOf(scan.body).join(',')}]`,
  );

  const rooted = await rootOnTheBox(job, `ssh-filed-${RUN}`);
  const opened = await readRecordsFile(job);
  const target = changeTargetOf(job.missionNumber);
  check(
    "the route's root reads the CSV, the target line holding the grade the briefing names",
    rooted.landed &&
      opened !== null &&
      opened.startsWith('id,student,subject,grade\n') &&
      opened.includes(`\n${target.rowId},${target.student},${target.subject},${target.from}\n`),
    rooted.detail,
  );

  const early = await mailClient(job, 'it is done');
  check(
    'a mail before the file is saved is told the records do not look right',
    early.status === 200 && (await lastReply(job)).startsWith(RECORDS_WRONG),
    `status ${early.status}`,
  );

  const saved = await saveRecordsFile(
    job,
    opened ?? '',
    withTargetChanged(job.missionNumber, opened ?? '').join('\n'),
  );
  const paid = await mailClient(job, `it is done\n${job.wallet}\n`);
  check(
    'saving the target line right and any mail complete the job and pay the quoted pay',
    saved.status === 200 &&
      paid.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) === pay,
    `save ${saved.status}, mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
  );

  const again = await mailClient(job, `once more\n${job.wallet}\n`);
  check(
    'a second mail on the file job is told it is closed and pays nothing more',
    again.status === 200 &&
      (await lastReply(job)).startsWith(CLOSED) &&
      (await balanceOf(job.wallet)) === pay,
    `status ${again.status}, balance ${await balanceOf(job.wallet)}`,
  );
};

/** The target line saved right, and another line deleted with it: the records read wrong. */
const workTheBrokenJob = async () => {
  const job = BROKEN;
  await stage(job);
  const target = changeTargetOf(job.missionNumber);
  const otherLine = target.rowId === 1 ? 2 : 1;

  const rooted = await rootOnTheBox(job, `ssh-broken-${RUN}`);
  const opened = (await readRecordsFile(job)) ?? '';
  const broken = withTargetChanged(job.missionNumber, opened).filter(
    (_line, index) => index !== otherLine,
  );
  const saved = await saveRecordsFile(job, opened, broken.join('\n'));
  const mailed = await mailClient(job, `done\n${job.wallet}\n`);
  check(
    'saving the target right with another line deleted is told the records do not look right',
    rooted.landed &&
      saved.status === 200 &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith(RECORDS_WRONG),
    `${rooted.detail}, save ${saved.status}, mail ${mailed.status}`,
  );
  check(
    'the broken file job stays accepted and pays nothing',
    (await stateOf(job)) === 'accepted' && (await balanceOf(job.wallet)) <= 0,
    `${await stateOf(job)}`,
  );
};

const main = async () => {
  if (homeEssid === undefined || ALL_JOBS.some((job) => job.address === '')) {
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
  await seedWordlist();

  await workTheWrongJob();
  await workThePaidJob();
  await workTheBrickedJob();
  await workTheInsideJob();
  await workTheWipedJob();
  await workTheErasedJob();
  await workTheFiledJob();
  await workTheBrokenJob();

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
