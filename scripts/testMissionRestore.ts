// Wire-check for A RESTORE-THE-RECORD JOB: white-hat work, a client hiring on behalf of its
// customer, one of whose records someone changed. The backup from before the change sits on the
// machine, and the customer has added rows since. The client hands over root (and the database
// login where the records are kept in a database) and reads the table when the contractor mails
// in. Driven end to end against a running `vercel dev` + supabase, accepting through a board's
// REAL door and staging the rest through the REAL `scripts/hireme.ts`, and working each job
// through the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE BRIEFING HANDS OVER ROOT AND THE DATABASE LOGIN, and names no person, value, table or
//     path; `show` names the kind, the change to undo, the backup and the rows added since.
//   - THE SERVER LAYS THE CHANGE AND THE BACKUP: root reads the root-only dump under
//     /var/backups, and the handed-over login, from the machine itself on `localhost`, reads the
//     changed value in the live table.
//   - AN UNTOUCHED TABLE, OR A THIRD VALUE, STILL HOLDS THE CHANGE.
//   - THE RIGHT UPDATE PAYS ONCE, with thanks, and a later mail is told the job is closed.
//   - THE VALUE BACK WITH ANOTHER ROW DELETED IS THE COLLATERAL MISS.
//   - ON FILES, THE BACKUP COPIED OVER THE LIVE CSV LOSES THE ROWS ADDED SINCE, the collateral
//     miss; the one cell put back on the live CSV pays.
//   - NO WALLET STILL COMPLETES.
//   - A BRICKED TARGET NEVER PAYS, nor a bricked edge machine on two hops.
//   - THE RECORDS ARE ON THE INSIDE MACHINE on two hops: the edge word over :2222, the inside
//     word from the edge machine, and the database login on `localhost` from the inside machine.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionRestore.ts
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
import { siteAddress } from '../src/core/generation/publisher.js';
import { HIREME_DOMAIN } from '../src/core/generation/fixedSites.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { md5 } from '../src/core/generation/md5.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import type { Directory, FileNode } from '../src/core/filesystem/types.js';
import { defaultFilePermissions } from '../src/core/filesystem/defaultPermissions.js';
import { contentHash } from '../src/core/patches/contentHash.js';
import { missionShape, type MissionShape } from '../src/core/missions/missionShape.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';
import {
  missionRecords,
  missionSetting,
  recordsBackupFiles,
  recordsFilePath,
  rowsAddedSince,
} from '../src/core/missions/missionRecords.js';
import {
  isMissionNumber,
  missionAddressForNumber,
  missionEssid,
} from '../src/core/missions/missionNetwork.js';

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

// `shell: true` so Windows resolves `npx.cmd`; the args carry no spaces, so quoting is moot.
const runHireme = (args: readonly string[]): string =>
  execFileSync('npx', ['tsx', 'scripts/hireme.ts', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  }).trim();

const SSH_PORT = 2222;
const DATABASE_PORT = 3306;
const RUN = Date.now().toString(36).slice(-6);
const HIREME_IP = siteAddress(HIREME_DOMAIN) ?? '';

/** The first restore jobs from `from` that `wanted` accepts, each with rows added since its
 *  backup, so copying the backup over the table loses some. */
const restoreNumbers = (
  from: number,
  count: number,
  wanted: (shape: MissionShape) => boolean,
): readonly number[] => {
  const found: number[] = [];
  for (let candidate = from; candidate < from + 80000 && found.length < count; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.kind === 'restore' && wanted(shape) && rowsAddedSince(candidate) > 0) {
      found.push(candidate);
    }
  }
  if (found.length < count) throw new Error(`only ${found.length} restore jobs from ${from}`);
  return found;
};

const inDatabase =
  (twoHop: boolean) =>
  ({ frontBox, storage }: MissionShape): boolean =>
    storage === 'database' && (frontBox !== null) === twoHop;
const inFiles = ({ frontBox, storage }: MissionShape): boolean =>
  storage === 'file' && frontBox === null;

const [BOARD_JOB, COLLATERAL_JOB, BRICK_JOB] = restoreNumbers(400000, 3, inDatabase(false)) as [
  number,
  number,
  number,
];
const [FILED_JOB, NO_WALLET_JOB] = restoreNumbers(400000, 2, inFiles) as [number, number];
const [INSIDE_JOB, EDGE_BRICK_JOB] = restoreNumbers(400000, 2, inDatabase(true)) as [
  number,
  number,
];
const JOBS = [
  BOARD_JOB,
  COLLATERAL_JOB,
  BRICK_JOB,
  FILED_JOB,
  NO_WALLET_JOB,
  INSIDE_JOB,
  EDGE_BRICK_JOB,
] as const;

type Job = {
  readonly missionNumber: number;
  readonly label: string;
  readonly handle: string;
  readonly address: string;
  readonly essid: string;
  readonly target: string;
  readonly targetIp: string;
  readonly front: string | null;
  readonly gateway: string;
  readonly wallet: string;
};

const jobOf = (missionNumber: number, label: string, index: number): Job => {
  const shape = missionShape(missionNumber);
  const essid = missionEssid(missionNumber);
  const lan = generateHomeLan(essid);
  const hostAt = (octet: number) => {
    const host = lan.hosts.find((candidate) => candidate.ip === `${lan.subnet}.${octet}`);
    if (host === undefined) throw new Error(`no host at .${octet} on ${essid}`);
    return host;
  };
  return {
    missionNumber,
    label,
    handle: `rst${index}${RUN}`,
    address: missionAddressForNumber(missionNumber) ?? '',
    essid,
    target: machineIdForLanHost(hostAt(shape.keyBox.octet), essid),
    targetIp: `${lan.subnet}.${shape.keyBox.octet}`,
    front:
      shape.frontBox === null ? null : machineIdForLanHost(hostAt(shape.frontBox.octet), essid),
    gateway: computeApGatewayId(essid),
    wallet: `jsc${md5(`${RUN}:${missionNumber}`)}${md5(String(missionNumber)).slice(0, 8)}`,
  };
};

const contractor = generateIdentityIn(RIDGEMONT);
const [homeEssid] = wifiPoolOf(RIDGEMONT);
const workstationOf = (player: Identity): string =>
  computeWorkstationId('newbie', player.publicKeyHex);

const BOARD = jobOf(BOARD_JOB, 'taken through the board', 0);
const COLLATERAL = jobOf(COLLATERAL_JOB, 'another row deleted', 1);
const BRICK = jobOf(BRICK_JOB, 'target bricked', 2);
const FILED = jobOf(FILED_JOB, 'kept in files', 3);
const NO_WALLET = jobOf(NO_WALLET_JOB, 'no wallet', 4);
const INSIDE = jobOf(INSIDE_JOB, 'the records on the inside machine', 5);
const EDGE_BRICK = jobOf(EDGE_BRICK_JOB, 'edge machine bricked', 6);
const ALL_JOBS = [BOARD, COLLATERAL, BRICK, FILED, NO_WALLET, INSIDE, EDGE_BRICK] as const;

const STILL_CHANGED = 'Their records still hold the change. Not restored, no money.';
const NOT_ALL_RESTORED =
  "That's not all you changed. Other records on their machine no longer read as they did. No money.";
const TOOK_IT_DOWN = 'You took our machine down. No money.';
const CLOSED = 'That job is already closed.';

/** The change a job asks undone: the row, the column, and the value before and after. */
const changeOf = (job: Job) => {
  const { target } = missionRecords(job.missionNumber);
  if (target.action !== 'change') throw new Error(`${job.label}: not a change`);
  return target;
};

/** The UPDATE that sets the changed cell to `value`, naming its row by the columns that fit it. */
const updateTo = (job: Job, value: string): string => {
  const { table, column, namedBy } = changeOf(job);
  const where = Object.entries(namedBy)
    .map(([name, named]) => `${name} = '${named}'`)
    .join(' AND ');
  return `UPDATE ${table} SET ${column} = '${value}' WHERE ${where}`;
};

/** The words the briefing hands over, edge machine first, the database's last. */
const wordsIn = (briefing: string): readonly string[] =>
  [...briefing.matchAll(/^ {2}password: (\S+)$/gm)].map((match) => match[1] ?? '');

/** The database account the briefing hands over. */
const accountIn = (briefing: string): string =>
  /^ {2}mysql localhost (\S+)$/m.exec(briefing)?.[1] ?? '';

const joinHome = async (player: Identity): Promise<number> => {
  const joined = await post(
    NETWORK,
    signRequest(player, 'registerNetwork', {
      essid: homeEssid,
      workstation_machine_id: workstationOf(player),
      workstation_username: 'newbie',
      workstation_machine_name: 'newbie',
      workstation_root_hash: md5('newbie-root-secret'),
    }),
  );
  return joined.status;
};

/** The contractor logs in as root over the job's :2222 with `password`. */
const loginOver2222 = async (job: Job, password: string, name: string) => {
  const sessionId = `ssh-${name}-${RUN}`;
  const shell = await post(
    SESSIONS,
    signRequest(contractor, 'authCreateSessionPublic', {
      session_id: sessionId,
      target: job.address,
      port: SSH_PORT,
      username: 'root',
      password,
      parent_session_id: null,
      source_ip: null,
      kind: 'ssh',
    }),
  );
  return {
    sessionId,
    landedOn: field(shell.body, 'machine_id'),
    userType: field(shell.body, 'userType'),
    status: shell.status,
  };
};

/** The contractor's ssh from the edge machine to the inside machine, as root. */
const loginInside = (job: Job, frontShell: string, password: string) =>
  post(
    SESSIONS,
    signRequest(contractor, 'authCreateSession', {
      session_id: `ssh-inside-${job.handle}`,
      essid: job.essid,
      target_ip: job.targetIp,
      username: 'root',
      password,
      parent_session_id: frontShell,
      caller_machine_id: job.front,
    }),
  );

/** One statement with the handed-over database login, run as `mysql localhost <account>` from a
 *  shell on the target itself. */
const localStatement = async (
  job: Job,
  login: { username: string; password: string },
  line: string,
) => {
  const answer = await post(
    SESSIONS,
    signRequest(contractor, 'mysqlStatement', {
      essid: job.essid,
      target_ip: '127.0.0.1',
      port: DATABASE_PORT,
      username: login.username,
      password: login.password,
      statement: line,
      caller_machine_id: job.target,
    }),
  );
  return {
    status: answer.status,
    failed: field(answer.body, 'failed'),
    output: ((field(answer.body, 'output') ?? []) as readonly string[]).join('\n'),
  };
};

/** A root's `rm` of one file on `machineId`, as the contractor. */
const removeAsRoot = (machineId: string, path: string) =>
  post(
    PATCHES,
    signRequest(contractor, 'removePatch', { machine_id: machineId, path, owner: 'root' }),
  );

const nodeAt = (tree: Directory, path: string): FileNode | undefined =>
  path
    .split('/')
    .filter((segment) => segment !== '')
    .reduce<FileNode | undefined>(
      (node, name) => (node?.kind === 'directory' ? node.entries.get(name) : undefined),
      tree,
    );

/** A file on the target as the contractor's root session on it reads it, or undefined. */
const fileOnTarget = async (job: Job, path: string): Promise<FileNode | undefined> => {
  const viewed = await post(
    NETWORK,
    signRequest(contractor, 'resolveCrossPlayerFs', { machine_id: job.target }),
  );
  if (viewed.status !== 200) return undefined;
  return nodeAt(deserializeTree((viewed.body as { tree: SerializedDirectory }).tree), path);
};

const textOnTarget = async (job: Job, path: string): Promise<string | null> => {
  const node = await fileOnTarget(job, path);
  return node?.kind === 'file' ? node.content : null;
};

/** A root's `nano` save of a file on the target: the whole new text, judged against what it
 *  opened. */
const saveOnTarget = (job: Job, path: string, opened: string, content: string) =>
  post(
    PATCHES,
    signRequest(contractor, 'upsertPatch', {
      machine_id: job.target,
      path,
      content,
      owner: 'root',
      permissions: defaultFilePermissions('root'),
      node_type: 'file',
      base_hash: contentHash(opened),
    }),
  );

/** The live CSV's text with the changed cell set back to the value before the change. */
const csvRestored = (job: Job, opened: string): string => {
  const { rowIndex, column, from } = changeOf(job);
  const lines = opened.split('\n');
  const at = (lines[0] ?? '').split(',').indexOf(column);
  return lines
    .map((line, index) =>
      index === rowIndex + 1
        ? line
            .split(',')
            .map((value, place) => (place === at ? from : value))
            .join(',')
        : line,
    )
    .join('\n');
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
      subject: 'restored',
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
 *  on it, and accepted through its /accept. Answers the briefing as the inbox holds it. */
const acceptThroughBoard = async (job: Job): Promise<string> => {
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
  if (accepted.status !== 200) {
    throw new Error(`accept answered ${accepted.status}: ${JSON.stringify(accepted.body)}`);
  }
  const { data } = await sr
    .from('email_messages')
    .select('number')
    .eq('handle', job.handle)
    .order('number', { ascending: false })
    .limit(1);
  console.log(`\n${job.label} job ${job.missionNumber} at ${job.address}`);
  const briefingNumber = ((data ?? []) as readonly { number: number }[])[0]?.number ?? 0;
  return (await readMessage(job, briefingNumber))?.body ?? '';
};

/** The job accepted by the operator script; the root words read from `show`, edge machine
 *  first, and the database login where there is one. */
const stage = async (job: Job) => {
  await openMailbox(job);
  runHireme(['accept', job.handle, '--number', String(job.missionNumber)]);
  console.log(`\n${job.label} job ${job.missionNumber} at ${job.address}`);
  const shown = runHireme(['show', job.address]);
  const database = /Database: (\S+) \/ (\S+)/.exec(shown);
  return {
    words: [...shown.matchAll(/Login: {4}root \/ (\S+)/g)].map((match) => match[1] ?? ''),
    database:
      database === null ? null : { username: database[1] ?? '', password: database[2] ?? '' },
  };
};

const cleanup = async () => {
  await sr
    .from('hireme_missions')
    .delete()
    .in('number', [...JOBS]);
  await sr.from('email_accounts').delete().eq('signed_up_by', contractor.publicKeyHex);
  await sr.from('email_sends').delete().eq('player_key', contractor.publicKeyHex);
  const machines = ALL_JOBS.flatMap((job) => [
    job.target,
    job.gateway,
    ...(job.front === null ? [] : [job.front]),
  ]);
  for (const machineId of [workstationOf(contractor), ...machines]) {
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

/** Whether the job is still open, unpaid, and the last reply is `miss`. */
const missed = async (job: Job, miss: string): Promise<boolean> =>
  (await lastReply(job)).startsWith(miss) &&
  (await stateOf(job)) === 'accepted' &&
  (await balanceOf(job.wallet)) <= 0;

/** Whether the job is completed, paid its quoted pay, and the last reply thanks the contractor. */
const paidInFull = async (job: Job): Promise<boolean> => {
  const { pay } = missionTerms(job.missionNumber);
  return (
    (await lastReply(job)).startsWith(
      `The records are back. §${pay.toLocaleString('en-US')} sent to ${job.wallet}. Thank you for the help.`,
    ) &&
    (await stateOf(job)) === 'completed' &&
    (await balanceOf(job.wallet)) === pay
  );
};

/** Taken through the board: the briefing and the report, root reading the backup, the database
 *  login reading the change, an untouched table and a third value still changed, then the
 *  right UPDATE paid once and closed. */
const workTheBoardJob = async () => {
  const job = BOARD;
  const briefing = await acceptThroughBoard(job);
  const terms = missionTerms(job.missionNumber);
  const { table, column, from, to, namedBy } = changeOf(job);
  const [rootWord = '', databaseWord = ''] = wordsIn(briefing);
  const login = { username: accountIn(briefing), password: databaseWord };

  check(
    'the briefing names the customer, hands over root and the database login, and names no person, value, table or path',
    briefing.includes(`Our customer is ${terms.targetCompany}.`) &&
      briefing.includes('changed one.') &&
      briefing.includes(`  ssh root@${job.address} -p 2222\n`) &&
      wordsIn(briefing).length === 2 &&
      login.username !== '' &&
      briefing.includes('Not restored, no money. No wallet, no money.') &&
      Object.values(namedBy).every((value) => !briefing.includes(value)) &&
      !new RegExp(`\\b${table}\\b`).test(briefing) &&
      !/\/var|\/srv|\.csv|\.sql|backups/.test(briefing),
    `${briefing.length} chars, ${wordsIn(briefing).length} word(s), account ${login.username}`,
  );

  const shown = runHireme(['show', job.address]);
  const [backup] = recordsBackupFiles(job.missionNumber);
  check(
    'show names the kind, both logins, the change to undo, the backup and the rows added since',
    shown.includes(`Kind:     restore, ${missionSetting(job.missionNumber)}`) &&
      shown.includes(`Login:    root / ${rootWord}`) &&
      shown.includes(`Database: ${login.username} / ${databaseWord}`) &&
      shown.includes(`: ${column} ${to} -> ${from}`) &&
      shown.includes(`Backup:   ${backup?.path}`) &&
      shown.includes(`Added since: ${rowsAddedSince(job.missionNumber)} row`),
    shown
      .split('\n')
      .filter((line) => /Kind:|Restore:|Backup:|Added since:/.test(line))
      .join(' | '),
  );

  const early = await mailClient(job, `done\n${job.wallet}\n`);
  check(
    'a mail about an untouched table says it still holds the change, and pays nothing',
    early.status === 200 && (await missed(job, STILL_CHANGED)),
    `status ${early.status}, state ${await stateOf(job)}`,
  );

  const shell = await loginOver2222(job, rootWord, 'board');
  const dump = await fileOnTarget(job, backup?.path ?? '');
  check(
    'root logs in over :2222 and reads the root-only dump from before the change',
    shell.landedOn === job.target &&
      shell.userType === 'root' &&
      dump?.kind === 'file' &&
      dump.content === backup?.content &&
      dump.perms.read.join(',') === 'root',
    `ssh ${shell.status}/${String(shell.userType)}, dump ${dump?.kind ?? 'missing'}`,
  );

  const where = Object.entries(namedBy)
    .map(([name, named]) => `${name} = '${named}'`)
    .join(' AND ');
  const selected = await localStatement(
    job,
    login,
    `SELECT ${column} FROM ${table} WHERE ${where}`,
  );
  check(
    'the database login, on localhost from the machine itself, reads the changed value',
    selected.status === 200 && selected.failed === false && selected.output.includes(`${to}`),
    `status ${selected.status}, failed ${String(selected.failed)}`,
  );

  const third = await localStatement(job, login, updateTo(job, `${to}${from}`));
  const thirdMail = await mailClient(job, `done\n${job.wallet}\n`);
  check(
    'a third value is still the change',
    third.failed === false && thirdMail.status === 200 && (await missed(job, STILL_CHANGED)),
    `update ${third.status}/${String(third.failed)}, mail ${thirdMail.status}`,
  );

  const right = await localStatement(job, login, updateTo(job, `${from}`));
  const paid = await mailClient(job, `done\n${job.wallet}\n`);
  check(
    'the value put back with the right UPDATE completes the job and pays, with thanks',
    right.failed === false && paid.status === 200 && (await paidInFull(job)),
    `update ${right.status}/${String(right.failed)}, mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${terms.pay})`,
  );

  const again = await mailClient(job, `once more\n${job.wallet}\n`);
  check(
    'a later mail is told the job is closed, and pays nothing more',
    again.status === 200 &&
      (await lastReply(job)).startsWith(CLOSED) &&
      (await balanceOf(job.wallet)) === terms.pay,
    `mail ${again.status}, balance ${await balanceOf(job.wallet)}`,
  );
};

/** The value put back, and another row deleted beside it: the collateral miss. */
const workTheCollateralJob = async () => {
  const job = COLLATERAL;
  const { words, database } = await stage(job);
  const shell = await loginOver2222(job, words[0] ?? '', 'collateral');
  const { table, rowIndex, from } = changeOf(job);
  const rows = missionRecords(job.missionNumber).tables[0]?.table.rows ?? [];
  const [idColumn = 'id'] = Object.keys(rows[0] ?? {});
  const other = rows.find((_row, index) => index !== rowIndex);
  const login = database ?? { username: '', password: '' };

  const right = await localStatement(job, login, updateTo(job, `${from}`));
  const deleted = await localStatement(
    job,
    login,
    `DELETE FROM ${table} WHERE ${idColumn} = '${other?.[idColumn]}'`,
  );
  const mailed = await mailClient(job, `done\n${job.wallet}\n`);
  check(
    'the value put back with another row deleted is the collateral miss',
    shell.landedOn === job.target &&
      right.failed === false &&
      deleted.failed === false &&
      mailed.status === 200 &&
      (await missed(job, NOT_ALL_RESTORED)),
    `update ${String(right.failed)}, delete ${String(deleted.failed)}, mail ${mailed.status}`,
  );
};

/** The value put back, then the target bricked: no money, and the job stays open. */
const workTheBrickJob = async () => {
  const job = BRICK;
  const { words, database } = await stage(job);
  const shell = await loginOver2222(job, words[0] ?? '', 'brick');

  const right = await localStatement(
    job,
    database ?? { username: '', password: '' },
    updateTo(job, `${changeOf(job).from}`),
  );
  const bricked = await removeAsRoot(job.target, '/boot/vmlinuz');
  const mailed = await mailClient(job, `done\n${job.wallet}\n`);
  check(
    'a target that no longer boots is told it was taken down, even restored first, and stays open',
    shell.landedOn === job.target &&
      right.failed === false &&
      bricked.status === 200 &&
      mailed.status === 200 &&
      (await missed(job, TOOK_IT_DOWN)),
    `update ${String(right.failed)}, brick ${bricked.status}, mail ${mailed.status}`,
  );
};

/** Kept in files: the backup copied over the live CSV loses the rows added since; the one cell
 *  put back on the live rows pays. */
const workTheFiledJob = async () => {
  const job = FILED;
  const { words, database } = await stage(job);
  const shell = await loginOver2222(job, words[0] ?? '', 'filed');
  const livePath = recordsFilePath(job.missionNumber);
  const { table } = changeOf(job);
  const backupPath = `/var/backups/records/${table}.csv`;
  const live = (await textOnTarget(job, livePath)) ?? '';
  const backup = await fileOnTarget(job, backupPath);

  check(
    'where the records are kept in files, show hands over no database login, and root reads the root-only backup of the table',
    database === null &&
      shell.landedOn === job.target &&
      backup?.kind === 'file' &&
      backup.perms.read.join(',') === 'root' &&
      live !== '',
    `ssh ${shell.status}, backup ${backup?.kind ?? 'missing'}, live ${live.length} chars`,
  );

  const copied = await saveOnTarget(
    job,
    livePath,
    live,
    backup?.kind === 'file' ? backup.content : '',
  );
  const copiedMail = await mailClient(job, `done\n${job.wallet}\n`);
  check(
    'the backup copied over the live CSV loses the rows added since, the collateral miss',
    copied.status === 200 && copiedMail.status === 200 && (await missed(job, NOT_ALL_RESTORED)),
    `save ${copied.status}, mail ${copiedMail.status}`,
  );

  const now = (await textOnTarget(job, livePath)) ?? '';
  const fixed = await saveOnTarget(job, livePath, now, csvRestored(job, live));
  const paid = await mailClient(job, `done\n${job.wallet}\n`);
  check(
    'the one cell put back on the live rows pays',
    fixed.status === 200 && paid.status === 200 && (await paidInFull(job)),
    `save ${fixed.status}, mail ${paid.status}`,
  );
};

/** Restored and no wallet named: the job closes and nothing is paid. */
const workTheNoWalletJob = async () => {
  const job = NO_WALLET;
  const { words } = await stage(job);
  const shell = await loginOver2222(job, words[0] ?? '', 'no-wallet');
  const livePath = recordsFilePath(job.missionNumber);
  const live = (await textOnTarget(job, livePath)) ?? '';

  const fixed = await saveOnTarget(job, livePath, live, csvRestored(job, live));
  const mailed = await mailClient(job, 'done\n');
  check(
    'with no wallet the job completes, the client says so, and nothing is paid',
    shell.landedOn === job.target &&
      fixed.status === 200 &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith('The records are back. You sent no wallet') &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) <= 0,
    `save ${fixed.status}, mail ${mailed.status}, state ${await stateOf(job)}`,
  );
};

/** Two hops: the edge word over :2222, the inside word from the edge machine, the database
 *  login on localhost from the inside machine, and paid. */
const workTheInsideJob = async () => {
  const job = INSIDE;
  const briefing = await acceptThroughBoard(job);
  const [edgeWord = '', insideWord = '', databaseWord = ''] = wordsIn(briefing);

  const edge = await loginOver2222(job, edgeWord, 'inside-edge');
  const inside = await loginInside(job, edge.sessionId, insideWord);
  // A login over the LAN answers with no machine id, so the session row says where it landed.
  const { data: landed } = await sr
    .from('sessions')
    .select('machine_id')
    .eq('session_id', `ssh-inside-${job.handle}`)
    .maybeSingle();
  const landedOn = (landed as { machine_id?: string } | null)?.machine_id;
  const right = await localStatement(
    job,
    { username: accountIn(briefing), password: databaseWord },
    updateTo(job, `${changeOf(job).from}`),
  );
  const paid = await mailClient(job, `done\n${job.wallet}\n`);
  check(
    'on two hops the briefing hands over three logins, and the database on the inside machine put right pays',
    wordsIn(briefing).length === 3 &&
      briefing.includes(`at ${job.targetIp}. From the edge machine:`) &&
      edge.landedOn === job.front &&
      inside.status === 200 &&
      landedOn === job.target &&
      right.failed === false &&
      paid.status === 200 &&
      (await paidInFull(job)),
    `${wordsIn(briefing).length} word(s), ssh ${edge.status}/${inside.status}, update ${String(right.failed)}, mail ${paid.status}`,
  );
};

/** Two hops: the records put right, the edge machine bricked: no money. */
const workTheEdgeBrickJob = async () => {
  const job = EDGE_BRICK;
  const { words, database } = await stage(job);
  const [edgeWord = '', insideWord = ''] = words;

  const edge = await loginOver2222(job, edgeWord, 'edge-brick');
  const inside = await loginInside(job, edge.sessionId, insideWord);
  const right = await localStatement(
    job,
    database ?? { username: '', password: '' },
    updateTo(job, `${changeOf(job).from}`),
  );
  const bricked = await removeAsRoot(job.front ?? '', '/boot/vmlinuz');
  const mailed = await mailClient(job, `done\n${job.wallet}\n`);
  check(
    'a bricked edge machine on two hops is told it was taken down, the records put right or not',
    edge.landedOn === job.front &&
      inside.status === 200 &&
      right.failed === false &&
      bricked.status === 200 &&
      mailed.status === 200 &&
      (await missed(job, TOOK_IT_DOWN)),
    `ssh ${edge.status}/${inside.status}, update ${String(right.failed)}, brick ${bricked.status}, mail ${mailed.status}`,
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
    console.error(`Could not put a player on a network: status ${status}`);
    process.exit(2);
  }

  await workTheBoardJob();
  await workTheCollateralJob();
  await workTheBrickJob();
  await workTheFiledJob();
  await workTheNoWalletJob();
  await workTheInsideJob();
  await workTheEdgeBrickJob();

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
