// Wire-check for A LOCK-THEM-OUT JOB: white-hat work, a client hiring on behalf of its customer,
// someone outside whom holds root's password on the customer's machine and has added an account
// of their own with it. The client hands over root with the leaked word in the briefing and reads
// the target's /etc/passwd when the contractor mails in. Driven end to end against a running
// `vercel dev` + supabase, accepting through a board's REAL door and staging the rest through the
// REAL `scripts/hireme.ts`, and working each job through the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE BRIEFING HANDS OVER ROOT with the leaked word, names the machine, and never mentions an
//     added account, a file or a tool; `show` tags the added account among the target's rows.
//   - THE SERVER LAYS THE INTRUDER'S ROW: the leaked word logs in over :2222 as root and as the
//     added account, both landing root, and a root reads the row in /etc/passwd at its place.
//   - A PASSWORD CHANGE IS NOT THE WHOLE LOCKOUT: `passwd root` alone, the added account's word
//     changed too, and the account taken off uid 0 each get the still-open reply.
//   - THE ADDED ROW REMOVED through a real /etc/passwd write, after `passwd root`, pays once, with
//     thanks, and a later mail is told the job is closed; in the other order, too, with the rows
//     reordered.
//   - ONE OF THEIR OWN ACCOUNTS SPOILED is the collateral miss, and putting it back then pays.
//   - NO WALLET STILL COMPLETES.
//   - A BRICKED TARGET NEVER PAYS, nor a bricked edge machine on two hops.
//   - THE INTRUDER IS ON THE INSIDE MACHINE on two hops: the edge word logs in over :2222, the
//     leaked word from the edge machine, and locking the inside machine pays.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionLockout.ts
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
import { PASSWD_FILE } from '../src/core/generation/baseFs.js';
import { md5 } from '../src/core/generation/md5.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import type { Directory, FileNode } from '../src/core/filesystem/types.js';
import { missionShape, type MissionShape } from '../src/core/missions/missionShape.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';
import { lockoutJob } from '../src/core/missions/targetRoles.js';
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
const RUN = Date.now().toString(36).slice(-6);
const HIREME_IP = siteAddress(HIREME_DOMAIN) ?? '';

/** The first lock-them-out jobs from `from` that `wanted` accepts. */
const lockoutNumbers = (
  from: number,
  count: number,
  wanted: (shape: MissionShape) => boolean,
): readonly number[] => {
  const found: number[] = [];
  for (let candidate = from; candidate < from + 80000 && found.length < count; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.kind === 'lockout' && wanted(shape)) found.push(candidate);
  }
  if (found.length < count) throw new Error(`only ${found.length} lock-them-out jobs from ${from}`);
  return found;
};

const singleHop = ({ frontBox }: MissionShape): boolean => frontBox === null;
const twoHop = ({ frontBox }: MissionShape): boolean => frontBox !== null;

const [BOARD_JOB, STUBBORN_JOB, REVERSED_JOB, COLLATERAL_JOB, NO_WALLET_JOB, BRICK_JOB] =
  lockoutNumbers(400000, 6, singleHop) as [number, number, number, number, number, number];
const [INSIDE_JOB, EDGE_BRICK_JOB] = lockoutNumbers(400000, 2, twoHop) as [number, number];
const JOBS = [
  BOARD_JOB,
  STUBBORN_JOB,
  REVERSED_JOB,
  COLLATERAL_JOB,
  NO_WALLET_JOB,
  BRICK_JOB,
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
  readonly account: string;
  readonly place: number;
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
  const { account, place } = lockoutJob(missionNumber);
  return {
    missionNumber,
    label,
    handle: `lck${index}${RUN}`,
    address: missionAddressForNumber(missionNumber) ?? '',
    essid,
    target: machineIdForLanHost(hostAt(shape.keyBox.octet), essid),
    targetIp: `${lan.subnet}.${shape.keyBox.octet}`,
    front:
      shape.frontBox === null ? null : machineIdForLanHost(hostAt(shape.frontBox.octet), essid),
    gateway: computeApGatewayId(essid),
    wallet: `jsc${md5(`${RUN}:${missionNumber}`)}${md5(String(missionNumber)).slice(0, 8)}`,
    account,
    place,
  };
};

const contractor = generateIdentityIn(RIDGEMONT);
const [homeEssid] = wifiPoolOf(RIDGEMONT);
const workstationOf = (player: Identity): string =>
  computeWorkstationId('newbie', player.publicKeyHex);

const BOARD = jobOf(BOARD_JOB, 'taken through the board', 0);
const STUBBORN = jobOf(STUBBORN_JOB, 'the added account kept', 1);
const REVERSED = jobOf(REVERSED_JOB, 'the row removed first', 2);
const COLLATERAL = jobOf(COLLATERAL_JOB, 'one of their own spoiled', 3);
const NO_WALLET = jobOf(NO_WALLET_JOB, 'no wallet', 4);
const BRICK = jobOf(BRICK_JOB, 'target bricked', 5);
const INSIDE = jobOf(INSIDE_JOB, 'the intruder on the inside machine', 6);
const EDGE_BRICK = jobOf(EDGE_BRICK_JOB, 'edge machine bricked', 7);
const ALL_JOBS = [
  BOARD,
  STUBBORN,
  REVERSED,
  COLLATERAL,
  NO_WALLET,
  BRICK,
  INSIDE,
  EDGE_BRICK,
] as const;

const stillOpen = (job: Job): string =>
  `Whoever has that password can still get into their ${lockoutJob(job.missionNumber).role.noun}. Still open, no money.`;
const NOT_ALL_CHANGED =
  "That's not all you changed. One of their own accounts no longer works as it did. No money.";
const TOOK_IT_DOWN = 'You took our machine down. No money.';
const CLOSED = 'That job is already closed.';
const FRESH_WORD = `Kestrel-${RUN}`;

/** The words the briefing hands over, edge machine first. */
const wordsIn = (briefing: string): readonly string[] =>
  [...briefing.matchAll(/^ {2}password: (\S+)$/gm)].map((match) => match[1] ?? '');

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

/** The contractor logs in as `username` over the job's :2222 with `password`. */
const loginOver2222 = async (job: Job, username: string, password: string, name: string) => {
  const sessionId = `ssh-${name}-${RUN}`;
  const shell = await post(
    SESSIONS,
    signRequest(contractor, 'authCreateSessionPublic', {
      session_id: sessionId,
      target: job.address,
      port: SSH_PORT,
      username,
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

/** `passwd <username>` from the contractor's root shell on the target. */
const passwdAsRoot = (job: Job, username: string, password: string) =>
  post(
    SESSIONS,
    signRequest(contractor, 'passwdChange', {
      machine_id: job.target,
      username,
      new_hash: md5(password),
    }),
  );

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

/** The target's `/etc/passwd` as the contractor's root session on it reads it. */
const passwdOn = async (job: Job): Promise<string | null> => {
  const viewed = await post(
    NETWORK,
    signRequest(contractor, 'resolveCrossPlayerFs', { machine_id: job.target }),
  );
  if (viewed.status !== 200) return null;
  const tree = deserializeTree((viewed.body as { tree: SerializedDirectory }).tree);
  const node = nodeAt(tree, '/etc/passwd');
  return node?.kind === 'file' ? node.content : null;
};

/** The target's `/etc/passwd` rewritten by `edit` over its rows as they stand, saved as `nano`
 *  saves it: a root's write of the whole file. */
const editPasswd = async (
  job: Job,
  edit: (rows: readonly string[]) => readonly string[],
): Promise<number> => {
  const content = await passwdOn(job);
  if (content === null) return 0;
  const rows = content.split('\n').filter((row) => row.length > 0);
  const written = await post(
    PATCHES,
    signRequest(contractor, 'upsertPatch', {
      machine_id: job.target,
      path: '/etc/passwd',
      content: edit(rows)
        .map((row) => `${row}\n`)
        .join(''),
      owner: 'root',
      is_new: false,
      node_type: 'file',
      permissions: PASSWD_FILE,
    }),
  );
  return written.status;
};

const nameOf = (row: string): string => row.split(':')[0] ?? '';
const withoutAccount =
  (name: string) =>
  (rows: readonly string[]): readonly string[] =>
    rows.filter((row) => nameOf(row) !== name);

/** The contractor's mail to the job's client. */
const mailClient = (job: Job, body: string) =>
  post(
    NETWORK,
    signRequest(contractor, 'resolveMail', {
      op: 'send',
      password: 's3cret',
      handle: job.handle,
      to: missionTerms(job.missionNumber).client.handle,
      subject: 'locked out',
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

/** The job accepted by the operator script; the words read from `show`, as the briefing holds
 *  them, edge machine first. */
const stage = async (job: Job): Promise<readonly string[]> => {
  await openMailbox(job);
  runHireme(['accept', job.handle, '--number', String(job.missionNumber)]);
  console.log(`\n${job.label} job ${job.missionNumber} at ${job.address}`);
  return [...runHireme(['show', job.address]).matchAll(/Login: {4}root \/ (\S+)/g)].map(
    (match) => match[1] ?? '',
  );
};

/** Staged and logged in as root on the single-hop target with the leaked word. */
const stageAndLogin = async (job: Job, name: string) => {
  const [word = ''] = await stage(job);
  return loginOver2222(job, 'root', word, name);
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
      `They're locked out. §${pay.toLocaleString('en-US')} sent to ${job.wallet}. Thank you for the help.`,
    ) &&
    (await stateOf(job)) === 'completed' &&
    (await balanceOf(job.wallet)) === pay
  );
};

/** Taken through the board: the briefing and the report, the leaked word as root and as the
 *  added account, the row read, `passwd root` alone a miss, then the row removed, paid once and
 *  closed. */
const workTheBoardJob = async () => {
  const job = BOARD;
  const briefing = await acceptThroughBoard(job);
  const terms = missionTerms(job.missionNumber);
  const { role } = lockoutJob(job.missionNumber);
  const [word = ''] = wordsIn(briefing);

  check(
    'the briefing names the customer and the machine, hands over root, and names no account, file or tool',
    briefing.includes(`Our customer is ${terms.targetCompany}.`) &&
      briefing.includes(`Someone outside has root's password on their ${role.noun},`) &&
      briefing.includes(`  ssh root@${job.address} -p 2222\n`) &&
      wordsIn(briefing).length === 1 &&
      briefing.includes('Still open, no money. No wallet, no money.') &&
      !briefing.includes(job.account) &&
      !briefing.includes('/etc') &&
      !briefing.includes('passwd'),
    `${briefing.length} chars, ${wordsIn(briefing).length} word(s)`,
  );

  const shown = runHireme(['show', job.address]);
  check(
    'show names the kind, the login handed over and the accounts with the intruder tagged',
    shown.includes(`Kind:     lockout, ${role.noun}`) &&
      shown.includes(`Login:    root / ${word}`) &&
      shown.includes(`${job.account} (intruder)`),
    shown
      .split('\n')
      .filter((line) => /Kind:|Accounts:/.test(line))
      .join(' | '),
  );

  const early = await mailClient(job, `locked out\n${job.wallet}\n`);
  check(
    'a mail about an untouched target says it is still open, and pays nothing',
    early.status === 200 && (await missed(job, stillOpen(job))),
    `status ${early.status}, state ${await stateOf(job)}`,
  );

  const asRoot = await loginOver2222(job, 'root', word, 'board');
  const asIntruder = await loginOver2222(job, job.account, word, 'board-intruder');
  check(
    'the leaked word logs in over :2222 as root and as the added account, both landing root',
    asRoot.landedOn === job.target &&
      asRoot.userType === 'root' &&
      asIntruder.landedOn === job.target &&
      asIntruder.userType === 'root',
    `root ${asRoot.status}/${String(asRoot.userType)}, added ${asIntruder.status}/${String(asIntruder.userType)}`,
  );

  const rows = ((await passwdOn(job)) ?? '').split('\n').filter((row) => row.length > 0);
  check(
    "a root reads the added row at its place, uid 0 under root's hash",
    rows.length === 5 &&
      rows[job.place] ===
        `${job.account}:${missionShape(job.missionNumber).keyBox.rootHash}:0:0:${job.account}:/var/lib/${job.account}:/bin/bash` &&
      nameOf(rows[0] ?? '') === 'root',
    `${rows.length} rows, ${job.account} at ${rows.findIndex((row) => nameOf(row) === job.account)} (want ${job.place})`,
  );

  const changed = await passwdAsRoot(job, 'root', FRESH_WORD);
  const halfway = await mailClient(job, `locked out\n${job.wallet}\n`);
  check(
    "root's password changed with passwd alone is still open",
    changed.status === 200 && halfway.status === 200 && (await missed(job, stillOpen(job))),
    `passwd ${changed.status}, mail ${halfway.status}`,
  );

  const removed = await editPasswd(job, withoutAccount(job.account));
  const paid = await mailClient(job, `locked out\n${job.wallet}\n`);
  check(
    'the added row removed through a write of /etc/passwd completes the job and pays, with thanks',
    removed === 200 && paid.status === 200 && (await paidInFull(job)),
    `write ${removed}, mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${terms.pay})`,
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

/** The added account kept in other ways: its word changed, then taken off uid 0; each still
 *  open, until it is gone. */
const workTheStubbornJob = async () => {
  const job = STUBBORN;
  const login = await stageAndLogin(job, 'stubborn');

  const rootChanged = await passwdAsRoot(job, 'root', FRESH_WORD);
  const addedChanged = await passwdAsRoot(job, job.account, `${FRESH_WORD}-2`);
  const both = await mailClient(job, `locked out\n${job.wallet}\n`);
  check(
    "root's and the added account's passwords both changed is still open",
    login.landedOn === job.target &&
      rootChanged.status === 200 &&
      addedChanged.status === 200 &&
      both.status === 200 &&
      (await missed(job, stillOpen(job))),
    `passwd ${rootChanged.status}/${addedChanged.status}, mail ${both.status}`,
  );

  const demoted = await editPasswd(job, (rows) =>
    rows.map((row) =>
      nameOf(row) === job.account
        ? row
            .split(':')
            .map((value, index) => (index === 2 || index === 3 ? '1002' : value))
            .join(':')
        : row,
    ),
  );
  const offRoot = await mailClient(job, `locked out\n${job.wallet}\n`);
  check(
    'the added account taken off uid 0 is still open',
    demoted === 200 && offRoot.status === 200 && (await missed(job, stillOpen(job))),
    `write ${demoted}, mail ${offRoot.status}`,
  );

  const removed = await editPasswd(job, withoutAccount(job.account));
  const paid = await mailClient(job, `locked out\n${job.wallet}\n`);
  check(
    'then removed, it pays',
    removed === 200 && paid.status === 200 && (await paidInFull(job)),
    `write ${removed}, mail ${paid.status}`,
  );
};

/** The row removed first, still open with root's word unchanged; then `passwd root` with the
 *  rows written back in another order, and paid. */
const workTheReversedJob = async () => {
  const job = REVERSED;
  const login = await stageAndLogin(job, 'reversed');

  const removed = await editPasswd(job, withoutAccount(job.account));
  const early = await mailClient(job, `locked out\n${job.wallet}\n`);
  check(
    "the added row removed with root's word unchanged is still open",
    login.landedOn === job.target &&
      removed === 200 &&
      early.status === 200 &&
      (await missed(job, stillOpen(job))),
    `write ${removed}, mail ${early.status}`,
  );

  const changed = await passwdAsRoot(job, 'root', FRESH_WORD);
  const reordered = await editPasswd(job, (rows) => [...rows].reverse());
  const paid = await mailClient(job, `locked out\n${job.wallet}\n`);
  check(
    'then passwd root, with the rows in another order, pays',
    changed.status === 200 && reordered === 200 && paid.status === 200 && (await paidInFull(job)),
    `passwd ${changed.status}, write ${reordered}, mail ${paid.status}`,
  );
};

/** Locked out, but `guest` removed with the intruder: the collateral miss, then guest put back
 *  and paid. */
const workTheCollateralJob = async () => {
  const job = COLLATERAL;
  const login = await stageAndLogin(job, 'collateral');
  const laid = ((await passwdOn(job)) ?? '').split('\n').filter((row) => row.length > 0);
  const guest = laid.find((row) => nameOf(row) === 'guest') ?? '';

  const changed = await passwdAsRoot(job, 'root', FRESH_WORD);
  const removed = await editPasswd(job, (rows) =>
    withoutAccount('guest')(withoutAccount(job.account)(rows)),
  );
  const spoiled = await mailClient(job, `locked out\n${job.wallet}\n`);
  check(
    'one of their own accounts removed along with the intruder is the collateral miss',
    login.landedOn === job.target &&
      guest !== '' &&
      changed.status === 200 &&
      removed === 200 &&
      spoiled.status === 200 &&
      (await missed(job, NOT_ALL_CHANGED)),
    `passwd ${changed.status}, write ${removed}, mail ${spoiled.status}`,
  );

  const restored = await editPasswd(job, (rows) => [...rows, guest]);
  const paid = await mailClient(job, `locked out\n${job.wallet}\n`);
  check(
    'their account put back, it pays',
    restored === 200 && paid.status === 200 && (await paidInFull(job)),
    `write ${restored}, mail ${paid.status}`,
  );
};

/** Locked out and no wallet named: the job closes and nothing is paid. */
const workTheNoWalletJob = async () => {
  const job = NO_WALLET;
  const login = await stageAndLogin(job, 'no-wallet');

  const changed = await passwdAsRoot(job, 'root', FRESH_WORD);
  const removed = await editPasswd(job, withoutAccount(job.account));
  const mailed = await mailClient(job, 'locked out\n');
  check(
    'with no wallet the job completes, the client says so, and nothing is paid',
    login.landedOn === job.target &&
      changed.status === 200 &&
      removed === 200 &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith("They're locked out. You sent no wallet") &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) <= 0,
    `passwd ${changed.status}, write ${removed}, mail ${mailed.status}, state ${await stateOf(job)}`,
  );
};

/** Locked out, then the target bricked: no money, and the job stays open. */
const workTheBrickJob = async () => {
  const job = BRICK;
  const login = await stageAndLogin(job, 'brick');

  const changed = await passwdAsRoot(job, 'root', FRESH_WORD);
  const removed = await editPasswd(job, withoutAccount(job.account));
  const bricked = await removeAsRoot(job.target, '/boot/vmlinuz');
  const mailed = await mailClient(job, `locked out\n${job.wallet}\n`);
  check(
    'a target that no longer boots is told it was taken down, even locked first, and stays open',
    login.landedOn === job.target &&
      changed.status === 200 &&
      removed === 200 &&
      bricked.status === 200 &&
      mailed.status === 200 &&
      (await missed(job, TOOK_IT_DOWN)),
    `passwd ${changed.status}, write ${removed}, brick ${bricked.status}, mail ${mailed.status}`,
  );
};

/** Two hops: the edge word over :2222, the leaked word from the edge machine, the inside machine
 *  locked, and paid. */
const workTheInsideJob = async () => {
  const job = INSIDE;
  const briefing = await acceptThroughBoard(job);
  const [edgeWord = '', insideWord = ''] = wordsIn(briefing);

  const edge = await loginOver2222(job, 'root', edgeWord, 'inside-edge');
  const early = await mailClient(job, `locked out\n${job.wallet}\n`);
  check(
    'on two hops the briefing hands over both logins, the edge one lands on the edge machine, and the untouched target is still open',
    wordsIn(briefing).length === 2 &&
      briefing.includes(
        `at ${job.targetIp}.\nThis is the password they have. From the edge machine:`,
      ) &&
      edge.landedOn === job.front &&
      early.status === 200 &&
      (await missed(job, stillOpen(job))),
    `${wordsIn(briefing).length} word(s), ssh ${edge.status}, mail ${early.status}`,
  );

  const inside = await loginInside(job, edge.sessionId, insideWord);
  // A login over the LAN answers with no machine id, so the session row says where it landed.
  const { data: landed } = await sr
    .from('sessions')
    .select('machine_id')
    .eq('session_id', `ssh-inside-${job.handle}`)
    .maybeSingle();
  const landedOn = (landed as { machine_id?: string } | null)?.machine_id;
  const changed = await passwdAsRoot(job, 'root', FRESH_WORD);
  const removed = await editPasswd(job, withoutAccount(job.account));
  const paid = await mailClient(job, `locked out\n${job.wallet}\n`);
  check(
    'the leaked word logs in from the edge machine, and the inside machine locked pays',
    inside.status === 200 &&
      landedOn === job.target &&
      changed.status === 200 &&
      removed === 200 &&
      paid.status === 200 &&
      (await paidInFull(job)),
    `ssh ${inside.status} on the target ${landedOn === job.target}, passwd ${changed.status}, write ${removed}, mail ${paid.status}`,
  );
};

/** Two hops: the target locked, the edge machine bricked: no money. */
const workTheEdgeBrickJob = async () => {
  const job = EDGE_BRICK;
  const [edgeWord = '', insideWord = ''] = await stage(job);

  const edge = await loginOver2222(job, 'root', edgeWord, 'edge-brick');
  const inside = await loginInside(job, edge.sessionId, insideWord);
  const changed = await passwdAsRoot(job, 'root', FRESH_WORD);
  const removed = await editPasswd(job, withoutAccount(job.account));
  const bricked = await removeAsRoot(job.front ?? '', '/boot/vmlinuz');
  const mailed = await mailClient(job, `locked out\n${job.wallet}\n`);
  check(
    'a bricked edge machine on two hops is told it was taken down, the target locked or not',
    edge.landedOn === job.front &&
      inside.status === 200 &&
      changed.status === 200 &&
      removed === 200 &&
      bricked.status === 200 &&
      mailed.status === 200 &&
      (await missed(job, TOOK_IT_DOWN)),
    `ssh ${edge.status}/${inside.status}, passwd ${changed.status}, write ${removed}, brick ${bricked.status}, mail ${mailed.status}`,
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
  await workTheStubbornJob();
  await workTheReversedJob();
  await workTheCollateralJob();
  await workTheNoWalletJob();
  await workTheBrickJob();
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
