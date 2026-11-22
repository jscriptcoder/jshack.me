// Wire-check for A CLEANUP JOB: white-hat work, a client hiring on behalf of its customer, whose
// machine runs an intruder's listener and implant. The client hands over root in the briefing and
// reads the target for both gone when the contractor mails in. Driven end to end against a running
// `vercel dev` + supabase, accepting through a board's REAL door and staging the rest through the
// REAL `scripts/hireme.ts`, and working each job through the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE BRIEFING HANDS OVER ROOT: it names the customer, the machine and the port, carries the
//     login for :2222, and names no path; the word in it logs in as root on the target.
//   - THE SERVER LAYS THE INTRUDER'S WORK: a root on the target reads the implant at the path
//     `show` names, its listener's pidfile under the machine's service account, the decoys and
//     the cron placeholders, and the service account in /etc/passwd.
//   - THE LISTENER IS READ BEFORE THE IMPLANT: untouched, the mail says something still answers;
//     the listener killed, it says the implant is still there; the implant removed too, it pays
//     once, with thanks, and a later mail is told the job is closed.
//   - A ROOT MAY REMOVE THE IMPLANT through the write gate, which reads the mission secret for
//     where the implant hides.
//   - ANYONE'S KILL AND RM COUNT: a second player logs in with the leaked word and cleans up; the
//     contractor, who did nothing, mails and is paid.
//   - ANY LISTENER ON THE PORT IS A MISS: killed, the implant removed, and a listener started
//     there again by someone else, and the mail says something still answers.
//   - AN OVERWRITTEN IMPLANT IS GONE, and NO WALLET STILL COMPLETES.
//   - A BRICKED TARGET NEVER PAYS: the mail is told the machine was taken down, and the job stays
//     open; so does a bricked edge machine on two hops.
//   - THE IMPLANT IS ON THE INSIDE MACHINE on two hops: the edge word logs in over :2222, the
//     inside word from the edge machine, and cleaning the inside machine pays.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionCleanup.ts
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
import { ROOT_FILE } from '../src/core/generation/baseFs.js';
import { md5 } from '../src/core/generation/md5.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import type { Directory, FileNode } from '../src/core/filesystem/types.js';
import { missionShape, type MissionShape } from '../src/core/missions/missionShape.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';
import { cleanupJob } from '../src/core/missions/targetRoles.js';
import { cleanupPlant } from '../src/core/missions/cleanupPlant.js';
import {
  isMissionNumber,
  missionAddressForNumber,
  missionEssid,
} from '../src/core/missions/missionNetwork.js';
import {
  PIDFILE_PERMISSIONS,
  formatListenerContent,
  listenerPidfilePath,
} from '../src/core/services/pidfile.js';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
const WALLET = process.env.WALLET_ENDPOINT ?? 'http://localhost:3100/api/wallet';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const missionSecret = process.env.MISSION_KEY_SECRET;

if (!url || !serviceKey || !missionSecret) {
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

/** The first cleanup jobs from `from` that `wanted` accepts. */
const cleanupNumbers = (
  from: number,
  count: number,
  wanted: (shape: MissionShape) => boolean,
): readonly number[] => {
  const found: number[] = [];
  for (let candidate = from; candidate < from + 60000 && found.length < count; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.kind === 'cleanup' && wanted(shape)) found.push(candidate);
  }
  if (found.length < count) throw new Error(`only ${found.length} cleanup jobs from ${from}`);
  return found;
};

const singleHop = ({ frontBox }: MissionShape): boolean => frontBox === null;
const twoHop = ({ frontBox }: MissionShape): boolean => frontBox !== null;

const [BOARD_JOB, RIVAL_JOB, RELISTEN_JOB, OVERWRITE_JOB, NO_WALLET_JOB, BRICK_JOB] =
  cleanupNumbers(400000, 6, singleHop) as [number, number, number, number, number, number];
const [INSIDE_JOB, EDGE_BRICK_JOB] = cleanupNumbers(400000, 2, twoHop) as [number, number];
const JOBS = [
  BOARD_JOB,
  RIVAL_JOB,
  RELISTEN_JOB,
  OVERWRITE_JOB,
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
  readonly port: number;
  readonly implantPath: string;
  readonly pidfile: string;
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
  const { port } = cleanupJob(missionNumber);
  return {
    missionNumber,
    label,
    handle: `cln${index}${RUN}`,
    address: missionAddressForNumber(missionNumber) ?? '',
    essid,
    target: machineIdForLanHost(hostAt(shape.keyBox.octet), essid),
    targetIp: `${lan.subnet}.${shape.keyBox.octet}`,
    front:
      shape.frontBox === null ? null : machineIdForLanHost(hostAt(shape.frontBox.octet), essid),
    gateway: computeApGatewayId(essid),
    wallet: `jsc${md5(`${RUN}:${missionNumber}`)}${md5(String(missionNumber)).slice(0, 8)}`,
    port,
    implantPath: cleanupPlant(missionNumber, missionSecret).implant.path,
    pidfile: listenerPidfilePath(port),
  };
};

const contractor = generateIdentityIn(RIDGEMONT);
const rival = generateIdentityIn(RIDGEMONT);
const [homeEssid] = wifiPoolOf(RIDGEMONT);
const workstationOf = (player: Identity): string =>
  computeWorkstationId('newbie', player.publicKeyHex);

const BOARD = jobOf(BOARD_JOB, 'taken through the board', 0);
const RIVAL = jobOf(RIVAL_JOB, 'cleaned by a rival', 1);
const RELISTEN = jobOf(RELISTEN_JOB, 'a listener started again', 2);
const OVERWRITE = jobOf(OVERWRITE_JOB, 'the implant overwritten', 3);
const NO_WALLET = jobOf(NO_WALLET_JOB, 'no wallet', 4);
const BRICK = jobOf(BRICK_JOB, 'target bricked', 5);
const INSIDE = jobOf(INSIDE_JOB, 'the implant on the inside machine', 6);
const EDGE_BRICK = jobOf(EDGE_BRICK_JOB, 'edge machine bricked', 7);
const ALL_JOBS = [BOARD, RIVAL, RELISTEN, OVERWRITE, NO_WALLET, BRICK, INSIDE, EDGE_BRICK] as const;

const stillAnswers = (job: Job): string =>
  `Something still answers on port ${job.port}. Still there, no money.`;
const STILL_ON_THE_MACHINE =
  'It has stopped, but it is still on the machine. Still there, no money.';
const TOOK_IT_DOWN = 'You took our machine down. No money.';
const CLOSED = 'That job is already closed.';

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

/** `player` logs in as root over the job's :2222 with `password`. */
const loginOver2222 = async (player: Identity, job: Job, password: string, name: string) => {
  const sessionId = `ssh-${name}-${RUN}`;
  const shell = await post(
    SESSIONS,
    signRequest(player, 'authCreateSessionPublic', {
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
  return { sessionId, landedOn: field(shell.body, 'machine_id'), status: shell.status };
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

/** A root's `rm` of one file on `machineId`, as `player`: a `kill` of a listener is the same
 *  removal of its pidfile. */
const removeAsRoot = (player: Identity, machineId: string, path: string) =>
  post(PATCHES, signRequest(player, 'removePatch', { machine_id: machineId, path, owner: 'root' }));

/** A root's write of `content` at `path` on `machineId`, as `player`. */
const writeAsRoot = (player: Identity, machineId: string, path: string, content: string) =>
  post(
    PATCHES,
    signRequest(player, 'upsertPatch', {
      machine_id: machineId,
      path,
      content,
      owner: 'root',
      is_new: false,
      node_type: 'file',
      permissions: ROOT_FILE,
    }),
  );

/** A listener started on `port` on `machineId`, as `player`'s root: what `nc -l` writes. */
const listenAsRoot = (player: Identity, machineId: string, port: number) =>
  post(
    PATCHES,
    signRequest(player, 'upsertPatch', {
      machine_id: machineId,
      path: listenerPidfilePath(port),
      content: formatListenerContent({ port, user: 'root', userType: 'root' }),
      owner: 'root',
      is_new: true,
      node_type: 'file',
      permissions: PIDFILE_PERMISSIONS,
    }),
  );

const nodeAt = (tree: Directory, path: string): FileNode | undefined =>
  path
    .split('/')
    .filter((segment) => segment !== '')
    .reduce<FileNode | undefined>(
      (node, name) => (node?.kind === 'directory' ? node.entries.get(name) : undefined),
      tree,
    );

const contentAt = (tree: Directory, path: string): string | null => {
  const node = nodeAt(tree, path);
  return node?.kind === 'file' ? node.content : null;
};

/** The target as `player`'s root session on it reads it. */
const targetAsRoot = async (player: Identity, job: Job): Promise<Directory | null> => {
  const viewed = await post(
    NETWORK,
    signRequest(player, 'resolveCrossPlayerFs', { machine_id: job.target }),
  );
  return viewed.status === 200
    ? deserializeTree((viewed.body as { tree: SerializedDirectory }).tree)
    : null;
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
      subject: 'all clean',
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
  console.log(
    `\n${job.label} job ${job.missionNumber} at ${job.address}, implant ${job.implantPath}`,
  );
  const briefingNumber = ((data ?? []) as readonly { number: number }[])[0]?.number ?? 0;
  return (await readMessage(job, briefingNumber))?.body ?? '';
};

/** The job accepted by the operator script; the words read from `show`, as the briefing holds
 *  them, edge machine first. */
const stage = async (job: Job): Promise<readonly string[]> => {
  await openMailbox(job);
  runHireme(['accept', job.handle, '--number', String(job.missionNumber)]);
  console.log(
    `\n${job.label} job ${job.missionNumber} at ${job.address}, implant ${job.implantPath}`,
  );
  return [...runHireme(['show', job.address]).matchAll(/Login: {4}root \/ (\S+)/g)].map(
    (match) => match[1] ?? '',
  );
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
  for (const machineId of [workstationOf(contractor), workstationOf(rival), ...machines]) {
    await sr.from('patches').delete().eq('machine_id', machineId);
  }
  for (const player of [contractor, rival]) {
    await sr.from('sessions').delete().eq('player_key', player.publicKeyHex);
    await sr.from('home_network_occupants').delete().eq('owner_key', player.publicKeyHex);
    await sr.from('network_lan_leases').delete().eq('owner_key', player.publicKeyHex);
  }
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
      `It's gone. §${pay.toLocaleString('en-US')} sent to ${job.wallet}. Thank you for the help.`,
    ) &&
    (await stateOf(job)) === 'completed' &&
    (await balanceOf(job.wallet)) === pay
  );
};

/** Taken through the board: the briefing and the report, root with the word handed over, the
 *  laid files read, each miss in turn, then paid once and closed. */
const workTheBoardJob = async () => {
  const job = BOARD;
  const briefing = await acceptThroughBoard(job);
  const terms = missionTerms(job.missionNumber);
  const { role } = cleanupJob(job.missionNumber);
  const [word = ''] = wordsIn(briefing);

  check(
    'the briefing names the customer, the machine and the port, hands over root, and names no path',
    briefing.includes(`Our customer is ${terms.targetCompany}.`) &&
      briefing.includes(`Something on their ${role.noun} answers on port ${job.port},`) &&
      briefing.includes(`  ssh root@${job.address} -p 2222\n`) &&
      wordsIn(briefing).length === 1 &&
      briefing.includes('Still there, no money. No wallet, no money.') &&
      !briefing.includes(job.implantPath) &&
      !briefing.includes('/etc'),
    `${briefing.length} chars, ${wordsIn(briefing).length} word(s)`,
  );

  const shown = runHireme(['show', job.address]);
  check(
    'show names the kind, the port, the implant and the login handed over',
    shown.includes(`Kind:     cleanup, ${role.noun}`) &&
      shown.includes(`Port:     ${job.port}`) &&
      shown.includes(`Implant:  ${job.implantPath}, `) &&
      shown.includes(`Login:    root / ${word}`),
    shown
      .split('\n')
      .filter((line) => /Kind:|Port:|Implant:/.test(line))
      .join(' | '),
  );

  const early = await mailClient(job, `all clean\n${job.wallet}\n`);
  check(
    'a mail about an untouched target says something still answers, and pays nothing',
    early.status === 200 && (await missed(job, stillAnswers(job))),
    `status ${early.status}, state ${await stateOf(job)}`,
  );

  const login = await loginOver2222(contractor, job, word, 'board');
  const tree = await targetAsRoot(contractor, job);
  const { implant, decoys } = cleanupPlant(job.missionNumber, missionSecret);
  check(
    'the word in the briefing logs in as root on the target over :2222',
    login.status === 200 && login.landedOn === job.target,
    `ssh ${login.status}, landed on the target ${login.landedOn === job.target}`,
  );
  check(
    "a root on the target reads the implant, its listener under the machine's account, the decoys and the placeholders",
    tree !== null &&
      contentAt(tree, implant.path) === implant.content &&
      contentAt(tree, job.pidfile) ===
        formatListenerContent({ port: job.port, user: role.serviceAccount, userType: 'user' }) &&
      decoys.every(({ path, content }) => contentAt(tree, path) === content) &&
      ['cron.d', 'cron.daily', 'cron.hourly'].every(
        (place) => contentAt(tree, `/etc/${place}/.placeholder`) !== null,
      ) &&
      (contentAt(tree, '/etc/passwd') ?? '').includes(`\n${role.serviceAccount}:*:999:999:`),
    tree === null
      ? 'no tree'
      : `implant ${contentAt(tree, implant.path) === null ? 'missing' : 'read'}`,
  );

  const killed = await removeAsRoot(contractor, job.target, job.pidfile);
  const stopped = await mailClient(job, `all clean\n${job.wallet}\n`);
  check(
    'the listener killed, the mail says the implant is still on the machine',
    killed.status === 200 && stopped.status === 200 && (await missed(job, STILL_ON_THE_MACHINE)),
    `kill ${killed.status}, mail ${stopped.status}`,
  );

  const removed = await removeAsRoot(contractor, job.target, job.implantPath);
  const paid = await mailClient(job, `all clean\n${job.wallet}\n`);
  check(
    'the implant removed through the write gate completes the job and pays the quoted pay, with thanks',
    removed.status === 200 && paid.status === 200 && (await paidInFull(job)),
    `rm ${removed.status}, mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${terms.pay})`,
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

/** Another player logs in with the leaked word and cleans up; the contractor is paid. */
const workTheRivalJob = async () => {
  const job = RIVAL;
  const [word = ''] = await stage(job);

  const login = await loginOver2222(rival, job, word, 'rival');
  const killed = await removeAsRoot(rival, job.target, job.pidfile);
  const removed = await removeAsRoot(rival, job.target, job.implantPath);
  const paid = await mailClient(job, `looks clean to me\n${job.wallet}\n`);
  check(
    "the contractor's mail is paid for a target somebody else cleaned up",
    login.landedOn === job.target &&
      killed.status === 200 &&
      removed.status === 200 &&
      paid.status === 200 &&
      (await paidInFull(job)),
    `ssh ${login.status}, kill ${killed.status}, rm ${removed.status}, mail ${paid.status}`,
  );
};

/** Killed and removed, then a listener started on the port again by someone else: a miss. */
const workTheRelistenJob = async () => {
  const job = RELISTEN;
  const [word = ''] = await stage(job);

  const login = await loginOver2222(contractor, job, word, 'relisten');
  const killed = await removeAsRoot(contractor, job.target, job.pidfile);
  const removed = await removeAsRoot(contractor, job.target, job.implantPath);
  const rivalLogin = await loginOver2222(rival, job, word, 'relisten-rival');
  const listening = await listenAsRoot(rival, job.target, job.port);
  const mailed = await mailClient(job, `all clean\n${job.wallet}\n`);
  check(
    'any listener on the port is a miss, even one started after the implant is gone',
    login.landedOn === job.target &&
      killed.status === 200 &&
      removed.status === 200 &&
      rivalLogin.landedOn === job.target &&
      listening.status === 200 &&
      mailed.status === 200 &&
      (await missed(job, stillAnswers(job))),
    `kill ${killed.status}, rm ${removed.status}, listen ${listening.status}, mail ${mailed.status}`,
  );
};

/** The listener killed and the implant overwritten in place: gone, and paid. */
const workTheOverwriteJob = async () => {
  const job = OVERWRITE;
  const [word = ''] = await stage(job);

  const login = await loginOver2222(contractor, job, word, 'overwrite');
  const killed = await removeAsRoot(contractor, job.target, job.pidfile);
  const written = await writeAsRoot(contractor, job.target, job.implantPath, 'exit 0\n');
  const paid = await mailClient(job, `all clean\n${job.wallet}\n`);
  check(
    'the implant overwritten at its path counts as gone, and pays',
    login.landedOn === job.target &&
      killed.status === 200 &&
      written.status === 200 &&
      paid.status === 200 &&
      (await paidInFull(job)),
    `kill ${killed.status}, write ${written.status}, mail ${paid.status}`,
  );
};

/** Cleaned up and no wallet named: the job closes and nothing is paid. */
const workTheNoWalletJob = async () => {
  const job = NO_WALLET;
  const [word = ''] = await stage(job);

  const login = await loginOver2222(contractor, job, word, 'no-wallet');
  const killed = await removeAsRoot(contractor, job.target, job.pidfile);
  const removed = await removeAsRoot(contractor, job.target, job.implantPath);
  const mailed = await mailClient(job, 'all clean\n');
  check(
    'with no wallet the job completes, the client says so, and nothing is paid',
    login.landedOn === job.target &&
      killed.status === 200 &&
      removed.status === 200 &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith("It's gone. You sent no wallet") &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) <= 0,
    `kill ${killed.status}, rm ${removed.status}, mail ${mailed.status}, state ${await stateOf(job)}`,
  );
};

/** Cleaned up, then the target bricked: no money, and the job stays open. */
const workTheBrickJob = async () => {
  const job = BRICK;
  const [word = ''] = await stage(job);

  const login = await loginOver2222(contractor, job, word, 'brick');
  const killed = await removeAsRoot(contractor, job.target, job.pidfile);
  const removed = await removeAsRoot(contractor, job.target, job.implantPath);
  const bricked = await removeAsRoot(contractor, job.target, '/boot/vmlinuz');
  const mailed = await mailClient(job, `all clean\n${job.wallet}\n`);
  check(
    'a target that no longer boots is told it was taken down, even cleaned first, and stays open',
    login.landedOn === job.target &&
      killed.status === 200 &&
      removed.status === 200 &&
      bricked.status === 200 &&
      mailed.status === 200 &&
      (await missed(job, TOOK_IT_DOWN)),
    `kill ${killed.status}, rm ${removed.status}, brick ${bricked.status}, mail ${mailed.status}`,
  );
};

/** Two hops: the edge word over :2222, the inside word from the edge machine, the inside
 *  machine cleaned, and paid. */
const workTheInsideJob = async () => {
  const job = INSIDE;
  const briefing = await acceptThroughBoard(job);
  const [edgeWord = '', insideWord = ''] = wordsIn(briefing);

  const edge = await loginOver2222(contractor, job, edgeWord, 'inside-edge');
  const early = await mailClient(job, `all clean\n${job.wallet}\n`);
  check(
    'on two hops the briefing hands over both logins, the edge one lands on the edge machine, and the untouched target is a miss',
    wordsIn(briefing).length === 2 &&
      briefing.includes(`at ${job.targetIp}. From the edge machine:`) &&
      edge.landedOn === job.front &&
      early.status === 200 &&
      (await missed(job, stillAnswers(job))),
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
  const killed = await removeAsRoot(contractor, job.target, job.pidfile);
  const removed = await removeAsRoot(contractor, job.target, job.implantPath);
  const paid = await mailClient(job, `all clean\n${job.wallet}\n`);
  check(
    'the inside word logs in from the edge machine, and the inside machine cleaned pays',
    inside.status === 200 &&
      landedOn === job.target &&
      killed.status === 200 &&
      removed.status === 200 &&
      paid.status === 200 &&
      (await paidInFull(job)),
    `ssh ${inside.status} on the target ${landedOn === job.target}, kill ${killed.status}, rm ${removed.status}, mail ${paid.status}`,
  );
};

/** Two hops: the target cleaned, the edge machine bricked: no money. */
const workTheEdgeBrickJob = async () => {
  const job = EDGE_BRICK;
  const [edgeWord = '', insideWord = ''] = await stage(job);

  const edge = await loginOver2222(contractor, job, edgeWord, 'edge-brick');
  const inside = await loginInside(job, edge.sessionId, insideWord);
  const killed = await removeAsRoot(contractor, job.target, job.pidfile);
  const removed = await removeAsRoot(contractor, job.target, job.implantPath);
  const bricked = await removeAsRoot(contractor, job.front ?? '', '/boot/vmlinuz');
  const mailed = await mailClient(job, `all clean\n${job.wallet}\n`);
  check(
    'a bricked edge machine on two hops is told it was taken down, the target clean or not',
    edge.landedOn === job.front &&
      inside.status === 200 &&
      killed.status === 200 &&
      removed.status === 200 &&
      bricked.status === 200 &&
      mailed.status === 200 &&
      (await missed(job, TOOK_IT_DOWN)),
    `ssh ${edge.status}/${inside.status}, kill ${killed.status}, rm ${removed.status}, brick ${bricked.status}, mail ${mailed.status}`,
  );
};

const main = async () => {
  if (HIREME_IP === '' || homeEssid === undefined || ALL_JOBS.some((job) => job.address === '')) {
    console.error('the world does not hold what this check assumes');
    process.exit(2);
  }
  await cleanup();

  for (const player of [contractor, rival]) {
    const status = await joinHome(player);
    if (status !== 200) {
      console.error(`Could not put a player on a network: status ${status}`);
      process.exit(2);
    }
  }

  await workTheBoardJob();
  await workTheRivalJob();
  await workTheRelistenJob();
  await workTheOverwriteJob();
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
