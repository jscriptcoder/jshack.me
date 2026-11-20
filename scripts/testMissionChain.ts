// Wire-check for A CHAIN JOB: a two-hop contract whose client wants a listener left on the front
// box, on a port the briefing names, and a last step done on the machine behind it: the machine
// taken down, a file on it destroyed, or a table of its records wiped. The client reads both
// boxes when the contractor mails in. Driven end to end against a running `vercel dev` + supabase,
// staging each job through the REAL `scripts/hireme.ts` and working it through the REAL /api
// endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE CLIENT READS THE FRONT BOX: the server reads a contract's front box as it reads the
//     target, its journal replayed, so a listener left there is seen.
//   - THE FIRST STEP UNFINISHED ANSWERS: before anything is done, and with a listener on another
//     port, the reply is that nothing is listening on the edge; with the listener in place and the
//     machine still up, that the machine is still up. The job stays accepted each time.
//   - BOTH STEPS PAY ONCE, IN EITHER ORDER: the listener left then the machine bricked pays; the
//     machine bricked then the listener left pays too; a second mail is told the job is closed.
//   - THE INSIDE MACHINE IS NOT THE EDGE: a listener on the port named left on the machine behind
//     the front box gets the listener's miss.
//   - A BRICKED FRONT BOX LOSES THE JOB: listener left and machine down, then the front box
//     bricked, and the reply is the listener's miss.
//   - A FILE DESTROYED OR RECORDS WIPED CAN BE THE LAST STEP: with the listener in place, the file
//     still at its path gets a destroy job's miss and the records still holding rows a wipe job's;
//     the file removed, or the records' CSV, then pays. The server lays each on the inside machine.
//   - `show` names the kind, the last step, what it asks for, and the port.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionChain.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import type { Identity } from '../src/core/commands/types.js';
import { generateIdentityIn } from '../src/test/factories/identityIn.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { wifiPoolOf } from '../src/core/generation/generateWifi.js';
import { machineIdForLanHost } from '../src/core/generation/lanTopology.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { md5 } from '../src/core/generation/md5.js';
import {
  DEFAULT_WORDLIST,
  WORDLIST_PATH,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist.js';
import {
  chainFinal,
  missionShape,
  type ChainFinal,
  type MissionShape,
} from '../src/core/missions/missionShape.js';
import { missionFileItem, missionFilePath } from '../src/core/missions/missionFileItem.js';
import { missionSetting, recordsFilePath } from '../src/core/missions/missionRecords.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';
import { chainJob } from '../src/core/missions/targetRoles.js';
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

const SSH_PORT = 2222;
const RUN = Date.now().toString(36).slice(-6);

/** The first chain jobs from `from` ending in `final` whose front box and target both fall to
 *  hydra, so a sweep over :2222 roots the front box and the target's root is a word on the
 *  default list, and that `wanted` accepts. */
const chainNumbers = (
  from: number,
  count: number,
  final: ChainFinal,
  wanted: (shape: MissionShape) => boolean = () => true,
): readonly number[] => {
  const bothHydra = ({ frontBox, keyBox }: MissionShape): boolean =>
    frontBox?.route === 'hydra' && keyBox.route === 'hydra';
  const found: number[] = [];
  for (let candidate = from; candidate < from + 240000 && found.length < count; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.kind !== 'chain' || chainFinal(candidate) !== final) continue;
    if (bothHydra(shape) && wanted(shape)) found.push(candidate);
  }
  if (found.length < count) throw new Error(`only ${found.length} chain jobs from ${from}`);
  return found;
};

const [STEPS_JOB, REVERSED_JOB, INSIDE_JOB, FRONT_BRICK_JOB] = chainNumbers(
  400000,
  4,
  'sabotage',
) as [number, number, number, number];
const [DESTROYING_JOB] = chainNumbers(400000, 1, 'destroy') as [number];
// Records kept in a CSV, so a root's `rm` of it wipes them without a database door to drive.
const [WIPING_JOB] = chainNumbers(400000, 1, 'wipe', ({ storage }) => storage === 'file') as [
  number,
];
const JOBS = [
  STEPS_JOB,
  REVERSED_JOB,
  INSIDE_JOB,
  FRONT_BRICK_JOB,
  DESTROYING_JOB,
  WIPING_JOB,
] as const;

type Job = {
  readonly missionNumber: number;
  readonly label: string;
  readonly handle: string;
  readonly essid: string;
  readonly address: string;
  readonly target: string;
  readonly targetIp: string;
  readonly targetRoot: string;
  readonly front: string;
  readonly gateway: string;
  readonly wallet: string;
  readonly port: number;
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
  if (shape.frontBox === null) throw new Error(`chain job ${missionNumber} has no front box`);
  const targetRoot = DEFAULT_WORDLIST.find((word) => md5(word) === shape.keyBox.rootHash);
  if (targetRoot === undefined) throw new Error(`chain job ${missionNumber}: root not on the list`);
  return {
    missionNumber,
    label,
    handle: `chn${index}${RUN}`,
    essid,
    address: missionAddressForNumber(missionNumber) ?? '',
    target: machineIdForLanHost(hostAt(shape.keyBox.octet), essid),
    targetIp: `${lan.subnet}.${shape.keyBox.octet}`,
    targetRoot,
    front: machineIdForLanHost(hostAt(shape.frontBox.octet), essid),
    gateway: computeApGatewayId(essid),
    wallet: `jsc${md5(`${RUN}:${missionNumber}`)}${md5(String(missionNumber)).slice(0, 8)}`,
    port: chainJob(missionNumber).port,
  };
};

const contractor = generateIdentityIn(RIDGEMONT);
const [homeEssid] = wifiPoolOf(RIDGEMONT);
const workstation = computeWorkstationId('newbie', contractor.publicKeyHex);

const STEPS = jobOf(STEPS_JOB, 'the steps in order', 0);
const REVERSED = jobOf(REVERSED_JOB, 'the machine down first', 1);
const INSIDE = jobOf(INSIDE_JOB, 'listener on the inside machine', 2);
const FRONT_BRICK = jobOf(FRONT_BRICK_JOB, 'front box bricked', 3);
const DESTROYING = jobOf(DESTROYING_JOB, 'a file destroyed last', 4);
const WIPING = jobOf(WIPING_JOB, 'records wiped last', 5);
const ALL_JOBS = [STEPS, REVERSED, INSIDE, FRONT_BRICK, DESTROYING, WIPING] as const;

const nothingOnTheEdge = (job: Job): string =>
  `Nothing is listening on port ${job.port} on the edge. No listener, no money.`;
const STILL_UP = 'Their machine is still up. No outage, no money.';
const NOT_GONE = "We can't confirm that file is gone. Not gone, no money.";
const NOT_WIPED = "That's not what we asked for. Not wiped, no money.";
const CLOSED = 'That job is already closed.';

/** A classic port the client did not name. */
const otherPortOf = (job: Job): number => (job.port === 4444 ? 5555 : 4444);

const seedWordlist = async (player: Identity) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: workstation,
      path: WORDLIST_PATH,
      writer_key: player.publicKeyHex,
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
      workstation_machine_id: workstation,
      workstation_username: 'newbie',
      workstation_machine_name: 'newbie',
      workstation_root_hash: md5('newbie-root-secret'),
    }),
  );
  return joined.status;
};

/** The contractor sweeps the front box behind the job's :2222 for root and logs in as it over
 *  ssh, returning the shell. */
const rootTheFront = async (job: Job, name: string) => {
  const sweep = await post(
    SESSIONS,
    signRequest(contractor, 'hydraCrack', {
      essid: homeEssid,
      target_ip: job.address,
      service: 'ssh',
      caller_machine_id: workstation,
      port: SSH_PORT,
    }),
  );
  const root = crackedOf(sweep.body).find(({ username }) => username === 'root');
  const shell = `ssh-front-${name}-${RUN}`;
  const login = await post(
    SESSIONS,
    signRequest(contractor, 'authCreateSessionPublic', {
      session_id: shell,
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
    shell,
    rooted: field(login.body, 'machine_id') === job.front,
    detail: `sweep ${sweep.status} root ${root === undefined ? 'missing' : 'found'}, ssh ${login.status}`,
  };
};

/** From the front box's root shell, ssh in as root on the machine behind it over the LAN. */
const rootTheTarget = async (job: Job, shell: string, name: string) => {
  const sessionId = `ssh-target-${name}-${RUN}`;
  const login = await post(
    SESSIONS,
    signRequest(contractor, 'authCreateSession', {
      session_id: sessionId,
      essid: job.essid,
      target_ip: job.targetIp,
      username: 'root',
      password: job.targetRoot,
      parent_session_id: shell,
      caller_machine_id: job.front,
    }),
  );
  // A LAN login answers with the tier alone; the session row says which machine it stands on.
  const { data } = await sr
    .from('sessions')
    .select('machine_id')
    .eq('session_id', sessionId)
    .maybeSingle();
  const landedOn = (data as { machine_id?: string } | null)?.machine_id;
  return {
    rooted: field(login.body, 'userType') === 'root' && landedOn === job.target,
    detail: `ssh to the target ${login.status} ${String(field(login.body, 'userType'))}`,
  };
};

/** A root's `nc -l <port>` on `machineId`: the one file that IS the open port. */
const listenAsRoot = (machineId: string, port: number) =>
  post(
    PATCHES,
    signRequest(contractor, 'upsertPatch', {
      machine_id: machineId,
      path: listenerPidfilePath(port),
      content: formatListenerContent({ port, user: 'root', userType: 'root' }),
      owner: 'root',
      is_new: true,
      node_type: 'file',
      permissions: PIDFILE_PERMISSIONS,
    }),
  );

/** A root's `rm` of one file on `machineId`. */
const removeAsRoot = (machineId: string, path: string) =>
  post(
    PATCHES,
    signRequest(contractor, 'removePatch', { machine_id: machineId, path, owner: 'root' }),
  );

/** A root's `rm /boot/vmlinuz` on `machineId`: the box never boots again. */
const brick = (machineId: string) => removeAsRoot(machineId, '/boot/vmlinuz');

/** The contractor's mail to the job's client. */
const mailClient = (job: Job, body = `both done\n${job.wallet}\n`) =>
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

/** Whether the last reply is `line`, the job still accepted and nothing paid. */
const missedWith = async (job: Job, line: string): Promise<boolean> =>
  (await lastReply(job)).startsWith(line) &&
  (await stateOf(job)) === 'accepted' &&
  (await balanceOf(job.wallet)) <= 0;

/** Whether the job completed, paying the quoted pay, with the client saying both are done. */
const paidInFull = async (job: Job): Promise<boolean> => {
  const pay = missionTerms(job.missionNumber).pay;
  return (
    (await stateOf(job)) === 'completed' &&
    (await balanceOf(job.wallet)) === pay &&
    (await lastReply(job)).startsWith(
      `Both done. §${pay.toLocaleString('en-US')} sent to ${job.wallet}.`,
    )
  );
};

const stage = async (job: Job) => {
  const { error } = await sr.from('email_accounts').insert({
    handle: job.handle,
    password_md5: md5('s3cret'),
    signed_up_by: contractor.publicKeyHex,
  });
  if (error) throw new Error(`mailbox insert failed: ${error.message}`);
  // A sender gets 20 mails a window and this check sends more across its jobs; each job starts
  // the count afresh so the cap never answers for the client.
  await sr.from('email_sends').delete().eq('player_key', contractor.publicKeyHex);
  runHireme(['accept', job.handle, '--number', String(job.missionNumber)]);
  console.log(`\n${job.label} job ${job.missionNumber} at ${job.address}, port ${job.port}`);
};

const cleanup = async () => {
  await sr
    .from('hireme_missions')
    .delete()
    .in('number', [...JOBS]);
  await sr.from('email_accounts').delete().eq('signed_up_by', contractor.publicKeyHex);
  await sr.from('email_sends').delete().eq('player_key', contractor.publicKeyHex);
  const machines = ALL_JOBS.flatMap((job) => [job.target, job.front, job.gateway]);
  for (const machineId of [workstation, ...machines]) {
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

/** Nothing, the wrong port, the listener alone, then both: three misses, then paid once and
 *  closed. */
const workTheStepsJob = async () => {
  const job = STEPS;
  await stage(job);

  const shown = runHireme(['show', job.address]);
  const noun = chainJob(job.missionNumber).role.noun;
  check(
    `show names the kind, the last step, the machine, a ${noun}, and the port, ${job.port}`,
    shown.includes(`Kind:     chain, sabotage, ${noun}`) &&
      shown.includes(`Listener: :${job.port} on the front box`),
    shown
      .split('\n')
      .filter((line) => line.includes('Kind:') || line.includes('Listener:'))
      .join(' | '),
  );

  const early = await mailClient(job);
  check(
    'a mail before anything is done is told nothing is listening on the edge',
    early.status === 200 && (await missedWith(job, nothingOnTheEdge(job))),
    `status ${early.status}`,
  );

  const front = await rootTheFront(job, 'steps');
  check(
    "hydra cracks the front box's root over :2222, and ssh lands on it",
    front.rooted,
    front.detail,
  );

  const elsewhere = await listenAsRoot(job.front, otherPortOf(job));
  const wrongPort = await mailClient(job);
  check(
    'a listener on the front box on another port is the same miss',
    elsewhere.status === 200 &&
      wrongPort.status === 200 &&
      (await missedWith(job, nothingOnTheEdge(job))),
    `listen ${elsewhere.status}, mail ${wrongPort.status}`,
  );

  const listening = await listenAsRoot(job.front, job.port);
  const stillUp = await mailClient(job);
  check(
    'with the listener on the port named and the machine still up, the client says it is up',
    listening.status === 200 && stillUp.status === 200 && (await missedWith(job, STILL_UP)),
    `listen ${listening.status}, mail ${stillUp.status}`,
  );

  const target = await rootTheTarget(job, front.shell, 'steps');
  const bricked = await brick(job.target);
  const paid = await mailClient(job);
  check(
    'the machine behind the front box bricked over the LAN completes the job and pays once',
    target.rooted && bricked.status === 200 && paid.status === 200 && (await paidInFull(job)),
    `${target.detail}, rm ${bricked.status}, mail ${paid.status}, state ${await stateOf(job)}`,
  );

  const again = await mailClient(job, `once more\n${job.wallet}\n`);
  check(
    'a second mail is told the job is closed and pays nothing more',
    again.status === 200 &&
      (await lastReply(job)).startsWith(CLOSED) &&
      (await balanceOf(job.wallet)) === missionTerms(job.missionNumber).pay,
    `mail ${again.status}, balance ${await balanceOf(job.wallet)}`,
  );
};

/** The machine down first, then the listener: the outage alone is the listener's miss, and the
 *  listener after it pays. */
const workTheReversedJob = async () => {
  const job = REVERSED;
  await stage(job);

  const front = await rootTheFront(job, 'reversed');
  const target = await rootTheTarget(job, front.shell, 'reversed');
  const bricked = await brick(job.target);
  const downOnly = await mailClient(job);
  check(
    'with only the machine down, the client says nothing is listening on the edge',
    front.rooted &&
      target.rooted &&
      bricked.status === 200 &&
      downOnly.status === 200 &&
      (await missedWith(job, nothingOnTheEdge(job))),
    `${front.detail}, ${target.detail}, rm ${bricked.status}, mail ${downOnly.status}`,
  );

  const listening = await listenAsRoot(job.front, job.port);
  const paid = await mailClient(job);
  check(
    'the listener left after the outage completes the job and pays',
    listening.status === 200 && paid.status === 200 && (await paidInFull(job)),
    `listen ${listening.status}, mail ${paid.status}, state ${await stateOf(job)}`,
  );
};

/** The listener on the port named, left on the machine behind the front box: not the edge. */
const workTheInsideJob = async () => {
  const job = INSIDE;
  await stage(job);

  const front = await rootTheFront(job, 'inside');
  const target = await rootTheTarget(job, front.shell, 'inside');
  const listening = await listenAsRoot(job.target, job.port);
  const mailed = await mailClient(job);
  check(
    'a listener on the inside machine is told nothing is listening on the edge',
    front.rooted &&
      target.rooted &&
      listening.status === 200 &&
      mailed.status === 200 &&
      (await missedWith(job, nothingOnTheEdge(job))),
    `${front.detail}, ${target.detail}, listen ${listening.status}, mail ${mailed.status}`,
  );
};

/** Both steps done, then the front box bricked: its listener goes with it. */
const workTheFrontBrickJob = async () => {
  const job = FRONT_BRICK;
  await stage(job);

  const front = await rootTheFront(job, 'front-brick');
  const listening = await listenAsRoot(job.front, job.port);
  const target = await rootTheTarget(job, front.shell, 'front-brick');
  const targetDown = await brick(job.target);
  const frontDown = await brick(job.front);
  const mailed = await mailClient(job);
  check(
    'a bricked front box is told nothing is listening on the edge, the machine down and all',
    front.rooted &&
      target.rooted &&
      listening.status === 200 &&
      targetDown.status === 200 &&
      frontDown.status === 200 &&
      mailed.status === 200 &&
      (await missedWith(job, nothingOnTheEdge(job))),
    `${front.detail}, ${target.detail}, listen ${listening.status}, rm target ${targetDown.status}, rm front ${frontDown.status}, mail ${mailed.status}`,
  );
};

/** Whether `show` names the kind, the last step and what it asks for, and the listener's port. */
const showsTheJob = (job: Job, kindLine: string) => {
  const shown = runHireme(['show', job.address]);
  check(
    `show names ${kindLine} and the port, ${job.port}`,
    shown.includes(`Kind:     ${kindLine}`) &&
      shown.includes(`Listener: :${job.port} on the front box`),
    shown
      .split('\n')
      .filter((line) => line.includes('Kind:') || line.includes('Listener:'))
      .join(' | '),
  );
};

/** The listener left with the file still in place, a destroy job's miss; then the file removed
 *  from the inside machine, paid. */
const workTheDestroyingJob = async () => {
  const job = DESTROYING;
  await stage(job);
  showsTheJob(job, `chain, destroy, ${missionFileItem(job.missionNumber).noun}`);

  const front = await rootTheFront(job, 'destroying');
  const listening = await listenAsRoot(job.front, job.port);
  const stillThere = await mailClient(job);
  check(
    "with the listener in place and the file still at its path, the client gives a destroy job's miss",
    front.rooted &&
      listening.status === 200 &&
      stillThere.status === 200 &&
      (await missedWith(job, NOT_GONE)),
    `${front.detail}, listen ${listening.status}, mail ${stillThere.status}`,
  );

  const target = await rootTheTarget(job, front.shell, 'destroying');
  const removed = await removeAsRoot(job.target, missionFilePath(job.missionNumber));
  const paid = await mailClient(job);
  check(
    'the file removed from the inside machine completes the job and pays once',
    target.rooted && removed.status === 200 && paid.status === 200 && (await paidInFull(job)),
    `${target.detail}, rm ${removed.status}, mail ${paid.status}, state ${await stateOf(job)}`,
  );
};

/** The listener left with the records still holding rows, a wipe job's miss; then the records'
 *  CSV removed from the inside machine, paid. */
const workTheWipingJob = async () => {
  const job = WIPING;
  await stage(job);
  showsTheJob(job, `chain, wipe, ${missionSetting(job.missionNumber)}`);

  const front = await rootTheFront(job, 'wiping');
  const listening = await listenAsRoot(job.front, job.port);
  const rowsLeft = await mailClient(job);
  check(
    "with the listener in place and the records still holding rows, the client gives a wipe job's miss",
    front.rooted &&
      listening.status === 200 &&
      rowsLeft.status === 200 &&
      (await missedWith(job, NOT_WIPED)),
    `${front.detail}, listen ${listening.status}, mail ${rowsLeft.status}`,
  );

  const target = await rootTheTarget(job, front.shell, 'wiping');
  const removed = await removeAsRoot(job.target, recordsFilePath(job.missionNumber));
  const paid = await mailClient(job);
  check(
    "the records' CSV removed from the inside machine completes the job and pays once",
    target.rooted && removed.status === 200 && paid.status === 200 && (await paidInFull(job)),
    `${target.detail}, rm ${removed.status}, mail ${paid.status}, state ${await stateOf(job)}`,
  );
};

const main = async () => {
  if (homeEssid === undefined || ALL_JOBS.some((job) => job.address === '')) {
    console.error('the world does not hold what this check assumes');
    process.exit(2);
  }
  await cleanup();

  const status = await joinHome(contractor);
  if (status !== 200) {
    console.error(`Could not put the contractor on a network: status ${status}`);
    process.exit(2);
  }
  await seedWordlist(contractor);

  await workTheStepsJob();
  await workTheReversedJob();
  await workTheInsideJob();
  await workTheFrontBrickJob();
  await workTheDestroyingJob();
  await workTheWipingJob();

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
