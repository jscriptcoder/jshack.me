// Wire-check for A DESTROY JOB: a contract whose client wants one of the company's files gone and
// reads the target for it when the contractor mails in. Driven end to end against a running
// `vercel dev` + supabase, accepting through a board's REAL door and staging the rest through the
// REAL `scripts/hireme.ts`, and working each job through the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE BRIEFING NAMES THE FILE, NEVER ITS PATH, and `show` names the kind, the item and the path.
//   - AN UNTOUCHED TARGET IS A MISS: the file is still there, and the mail pays nothing.
//   - A DELETED FILE PAYS ONCE: removed as root on the target, and the mail completes the job and
//     mints the pay; a later mail is told the job is closed, even with the target since bricked.
//   - AN OVERWRITTEN FILE PAYS, and so does A MOVED ONE: its bytes elsewhere, its path empty.
//   - THE SAME BYTES PUT BACK ARE STILL THERE: deleted, laid again exactly, and the mail is a miss;
//     one byte different and it pays.
//   - ANYONE'S DELETING COUNTS: a second player roots the target and removes the file; the
//     contractor, who did nothing, mails and is paid.
//   - NO WALLET STILL COMPLETES: the job closes and nothing is paid.
//   - A BRICKED TARGET IS A MISS: the file deleted, then /boot/vmlinuz removed, and the mail is told
//     the client cannot confirm it.
//   - THE FILE IS ON THE INSIDE MACHINE: on a two-hop job, rooting the front box proves nothing;
//     the file removed from the inside machine, reached through the front box, pays.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionDestroy.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import type { Identity } from '../src/core/commands/types.js';
import { generateIdentityIn } from '../src/test/factories/identityIn.js';
import { plaintextFor } from '../src/test/passwords.js';
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
import {
  DEFAULT_WORDLIST,
  WORDLIST_PATH,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist.js';
import { missionShape, type MissionShape } from '../src/core/missions/missionShape.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';
import {
  missionFileContent,
  missionFileItem,
  missionFileName,
  missionFilePath,
} from '../src/core/missions/missionFileItem.js';
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
const HIREME_IP = siteAddress(HIREME_DOMAIN) ?? '';

/** The first destroy jobs from `from` that `wanted` accepts. */
const destroyNumbers = (
  from: number,
  count: number,
  wanted: (shape: MissionShape) => boolean,
): readonly number[] => {
  const found: number[] = [];
  for (let candidate = from; candidate < from + 60000 && found.length < count; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.kind === 'destroy' && wanted(shape)) found.push(candidate);
  }
  if (found.length < count) throw new Error(`only ${found.length} destroy jobs from ${from}`);
  return found;
};

/** A single-hop job whose target falls to hydra, so its root is on the list every player has. */
const singleHopHydra = ({ frontBox, keyBox }: MissionShape): boolean =>
  frontBox === null && keyBox.route === 'hydra';

const [DELETED_JOB, OVERWRITTEN_JOB, MOVED_JOB, PUT_BACK_JOB, RIVAL_JOB, NO_WALLET_JOB, BRICK_JOB] =
  destroyNumbers(400000, 7, singleHopHydra) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
// A two-hop job whose front box falls to hydra, so a sweep over :2222 roots the front box.
const [INSIDE_JOB] = destroyNumbers(400000, 1, ({ frontBox }) => frontBox?.route === 'hydra') as [
  number,
];
const JOBS = [
  DELETED_JOB,
  OVERWRITTEN_JOB,
  MOVED_JOB,
  PUT_BACK_JOB,
  RIVAL_JOB,
  NO_WALLET_JOB,
  BRICK_JOB,
  INSIDE_JOB,
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
  readonly path: string;
  readonly theirs: string;
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
    handle: `des${index}${RUN}`,
    address: missionAddressForNumber(missionNumber) ?? '',
    essid,
    target: machineIdForLanHost(hostAt(shape.keyBox.octet), essid),
    targetIp: `${lan.subnet}.${shape.keyBox.octet}`,
    front:
      shape.frontBox === null ? null : machineIdForLanHost(hostAt(shape.frontBox.octet), essid),
    gateway: computeApGatewayId(essid),
    wallet: `jsc${md5(`${RUN}:${missionNumber}`)}${md5(String(missionNumber)).slice(0, 8)}`,
    path: missionFilePath(missionNumber),
    theirs: missionFileContent(missionNumber, missionSecret),
  };
};

const contractor = generateIdentityIn(RIDGEMONT);
const rival = generateIdentityIn(RIDGEMONT);
const [homeEssid] = wifiPoolOf(RIDGEMONT);
const workstationOf = (player: Identity): string =>
  computeWorkstationId('newbie', player.publicKeyHex);

const DELETED = jobOf(DELETED_JOB, 'the file deleted', 0);
const OVERWRITTEN = jobOf(OVERWRITTEN_JOB, 'the file overwritten', 1);
const MOVED = jobOf(MOVED_JOB, 'the file moved', 2);
const PUT_BACK = jobOf(PUT_BACK_JOB, 'the same bytes put back', 3);
const RIVAL = jobOf(RIVAL_JOB, 'rival deleting', 4);
const NO_WALLET = jobOf(NO_WALLET_JOB, 'no wallet', 5);
const BRICK = jobOf(BRICK_JOB, 'target bricked', 6);
const INSIDE = jobOf(INSIDE_JOB, 'the file on the inside machine', 7);
const ALL_JOBS = [DELETED, OVERWRITTEN, MOVED, PUT_BACK, RIVAL, NO_WALLET, BRICK, INSIDE] as const;

const NOT_GONE = "We can't confirm that file is gone. Not gone, no money.";
const CLOSED = 'That job is already closed.';

const seedWordlist = async (player: Identity) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: workstationOf(player),
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
      workstation_machine_id: workstationOf(player),
      workstation_username: 'newbie',
      workstation_machine_name: 'newbie',
      workstation_root_hash: md5('newbie-root-secret'),
    }),
  );
  return joined.status;
};

/** `player` sweeps the box behind the job's :2222 for root and logs in as it over ssh. */
const rootOver2222 = async (player: Identity, job: Job, name: string) => {
  const sweep = await post(
    SESSIONS,
    signRequest(player, 'hydraCrack', {
      essid: homeEssid,
      target_ip: job.address,
      service: 'ssh',
      caller_machine_id: workstationOf(player),
      port: SSH_PORT,
    }),
  );
  const root = crackedOf(sweep.body).find(({ username }) => username === 'root');
  const sessionId = `ssh-${name}-${RUN}`;
  const shell = await post(
    SESSIONS,
    signRequest(player, 'authCreateSessionPublic', {
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

/** The contractor's ssh from the front box to the inside machine, as root. */
const rootInside = (job: Job, frontShell: string) =>
  post(
    SESSIONS,
    signRequest(contractor, 'authCreateSession', {
      session_id: `ssh-inside-${RUN}`,
      essid: job.essid,
      target_ip: job.targetIp,
      username: 'root',
      password: plaintextFor(missionShape(job.missionNumber).keyBox.rootHash),
      parent_session_id: frontShell,
      caller_machine_id: job.front,
    }),
  );

/** A root's write of `content` at `path` on `machineId`, as `player`. `isNew` when nothing is at
 *  the path any more. */
const writeAsRoot = (
  player: Identity,
  { machineId, path, content, isNew }: {
    readonly machineId: string;
    readonly path: string;
    readonly content: string;
    readonly isNew: boolean;
  },
) =>
  post(
    PATCHES,
    signRequest(player, 'upsertPatch', {
      machine_id: machineId,
      path,
      content,
      owner: 'root',
      is_new: isNew,
      node_type: 'file',
      permissions: ROOT_FILE,
    }),
  );

/** A root's `rm` of one file on `machineId`, as `player`. */
const removeAsRoot = (player: Identity, machineId: string, path: string) =>
  post(PATCHES, signRequest(player, 'removePatch', { machine_id: machineId, path, owner: 'root' }));

/** The contractor's mail to the job's client. */
const mailClient = (job: Job, body: string) =>
  post(
    NETWORK,
    signRequest(contractor, 'resolveMail', {
      op: 'send',
      password: 's3cret',
      handle: job.handle,
      to: missionTerms(job.missionNumber).client.handle,
      subject: 'gone',
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

const stage = async (job: Job) => {
  await openMailbox(job);
  runHireme(['accept', job.handle, '--number', String(job.missionNumber)]);
  console.log(`\n${job.label} job ${job.missionNumber} at ${job.address}, path ${job.path}`);
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
  console.log(`\n${job.label} job ${job.missionNumber} at ${job.address}, path ${job.path}`);
  return ((data ?? []) as readonly { number: number }[])[0]?.number ?? 0;
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

/** Whether the job is still open, unpaid, and the last reply is the miss. */
const missed = async (job: Job): Promise<boolean> =>
  (await lastReply(job)).startsWith(NOT_GONE) &&
  (await stateOf(job)) === 'accepted' &&
  (await balanceOf(job.wallet)) <= 0;

/** Whether the job is completed, paid its quoted pay, and the last reply says so. */
const paidInFull = async (job: Job): Promise<boolean> => {
  const { pay } = missionTerms(job.missionNumber);
  return (
    (await lastReply(job)).startsWith(
      `It's gone. §${pay.toLocaleString('en-US')} sent to ${job.wallet}.`,
    ) &&
    (await stateOf(job)) === 'completed' &&
    (await balanceOf(job.wallet)) === pay
  );
};

/** Taken through the board: the briefing and the report, a miss on the untouched target, the file
 *  deleted and paid once, then closed whatever has become of the box. */
const workTheDeletedJob = async () => {
  const job = DELETED;
  const briefingNumber = await acceptThroughBoard(job);
  const { pay } = missionTerms(job.missionNumber);

  const briefing = (await readMessage(job, briefingNumber))?.body ?? '';
  check(
    "the briefing names the file and the rule, and never the file's path",
    briefing.includes(`  ${missionFileName(job.missionNumber)}\n`) &&
      briefing.includes('Not gone, no money. No wallet, no money.') &&
      !briefing.includes(job.path),
    `${briefing.length} chars`,
  );

  const shown = runHireme(['show', job.address]);
  check(
    'show names the kind, the item and the path',
    shown.includes(`Kind:     destroy, ${missionFileItem(job.missionNumber).noun}`) &&
      shown.includes(`File:     ${job.path}, `),
    shown
      .split('\n')
      .filter((line) => line.includes('Kind:') || line.includes('File:'))
      .join(' | '),
  );

  const early = await mailClient(job, `it is gone\n${job.wallet}\n`);
  check(
    'a mail about an untouched target gets the miss and pays nothing',
    early.status === 200 && (await missed(job)),
    `status ${early.status}, state ${await stateOf(job)}`,
  );

  const rooted = await rootOver2222(contractor, job, 'deleted');
  const removed = await removeAsRoot(contractor, job.target, job.path);
  const paid = await mailClient(job, `it is gone\n${job.wallet}\n`);
  check(
    'the file deleted as root completes the job and pays the quoted pay',
    rooted.landedOn === job.target &&
      removed.status === 200 &&
      paid.status === 200 &&
      (await paidInFull(job)),
    `${rooted.detail}, rm ${removed.status}, mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
  );

  const bricked = await removeAsRoot(contractor, job.target, '/boot/vmlinuz');
  const again = await mailClient(job, `once more\n${job.wallet}\n`);
  check(
    'a later mail is told the job is closed without reading the box, now bricked, and pays nothing',
    bricked.status === 200 &&
      again.status === 200 &&
      (await lastReply(job)).startsWith(CLOSED) &&
      (await balanceOf(job.wallet)) === pay,
    `brick ${bricked.status}, mail ${again.status}, balance ${await balanceOf(job.wallet)}`,
  );
};

/** Other bytes written over the file at its path. */
const workTheOverwrittenJob = async () => {
  const job = OVERWRITTEN;
  await stage(job);

  const rooted = await rootOver2222(contractor, job, 'overwritten');
  const written = await writeAsRoot(contractor, {
    machineId: job.target,
    path: job.path,
    content: 'nothing to see here\n',
    isNew: false,
  });
  const paid = await mailClient(job, `it is gone\n${job.wallet}\n`);
  check(
    'the file overwritten at its path completes the job and pays',
    rooted.landedOn === job.target &&
      written.status === 200 &&
      paid.status === 200 &&
      (await paidInFull(job)),
    `${rooted.detail}, write ${written.status}, mail ${paid.status}`,
  );
};

/** The file's bytes carried to another path, its own path left empty. */
const workTheMovedJob = async () => {
  const job = MOVED;
  await stage(job);

  const rooted = await rootOver2222(contractor, job, 'moved');
  const copied = await writeAsRoot(contractor, {
    machineId: job.target,
    path: `${job.path}.old`,
    content: job.theirs,
    isNew: true,
  });
  const removed = await removeAsRoot(contractor, job.target, job.path);
  const paid = await mailClient(job, `it is gone\n${job.wallet}\n`);
  check(
    'the file moved off its path completes the job and pays',
    rooted.landedOn === job.target &&
      copied.status === 200 &&
      removed.status === 200 &&
      paid.status === 200 &&
      (await paidInFull(job)),
    `${rooted.detail}, copy ${copied.status}, rm ${removed.status}, mail ${paid.status}`,
  );
};

/** Deleted, then laid again byte for byte: still there. One byte off, and it is not. */
const workThePutBackJob = async () => {
  const job = PUT_BACK;
  await stage(job);

  const rooted = await rootOver2222(contractor, job, 'put-back');
  const removed = await removeAsRoot(contractor, job.target, job.path);
  const restored = await writeAsRoot(contractor, {
    machineId: job.target,
    path: job.path,
    content: job.theirs,
    isNew: true,
  });
  const mailed = await mailClient(job, `it is gone\n${job.wallet}\n`);
  check(
    'the same bytes put back at the path count as still there',
    rooted.landedOn === job.target &&
      removed.status === 200 &&
      restored.status === 200 &&
      mailed.status === 200 &&
      (await missed(job)),
    `${rooted.detail}, rm ${removed.status}, write ${restored.status}, mail ${mailed.status}`,
  );

  const changed = await writeAsRoot(contractor, {
    machineId: job.target,
    path: job.path,
    content: `${job.theirs}\n`,
    isNew: false,
  });
  const paid = await mailClient(job, `it is gone now\n${job.wallet}\n`);
  check(
    'the same file with one byte more no longer counts, and pays',
    changed.status === 200 && paid.status === 200 && (await paidInFull(job)),
    `write ${changed.status}, mail ${paid.status}`,
  );
};

/** Another player deletes the file; the contractor, who did nothing, is paid. */
const workTheRivalJob = async () => {
  const job = RIVAL;
  await stage(job);

  const rooted = await rootOver2222(rival, job, 'rival');
  const removed = await removeAsRoot(rival, job.target, job.path);
  const paid = await mailClient(job, `looks gone to me\n${job.wallet}\n`);
  check(
    "the contractor's mail is paid for a file somebody else deleted",
    rooted.landedOn === job.target &&
      removed.status === 200 &&
      paid.status === 200 &&
      (await paidInFull(job)),
    `${rooted.detail}, rm ${removed.status}, mail ${paid.status}`,
  );
};

/** The file deleted and no wallet named: the job closes and nothing is paid. */
const workTheNoWalletJob = async () => {
  const job = NO_WALLET;
  await stage(job);

  const rooted = await rootOver2222(contractor, job, 'no-wallet');
  const removed = await removeAsRoot(contractor, job.target, job.path);
  const mailed = await mailClient(job, 'it is gone\n');
  check(
    'with no wallet the job completes, the client says so, and nothing is paid',
    rooted.landedOn === job.target &&
      removed.status === 200 &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith("It's gone. You sent no wallet") &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) <= 0,
    `${rooted.detail}, rm ${removed.status}, mail ${mailed.status}, state ${await stateOf(job)}`,
  );
};

/** The file deleted, then the target bricked: the client can no longer look. */
const workTheBrickJob = async () => {
  const job = BRICK;
  await stage(job);

  const rooted = await rootOver2222(contractor, job, 'brick');
  const removed = await removeAsRoot(contractor, job.target, job.path);
  const bricked = await removeAsRoot(contractor, job.target, '/boot/vmlinuz');
  const mailed = await mailClient(job, `it is gone\n${job.wallet}\n`);
  check(
    'a target that no longer boots gets the miss, even with the file destroyed first',
    rooted.landedOn === job.target &&
      removed.status === 200 &&
      bricked.status === 200 &&
      mailed.status === 200 &&
      (await missed(job)),
    `${rooted.detail}, rm ${removed.status}, brick ${bricked.status}, mail ${mailed.status}`,
  );
};

/** A two-hop job: the front box rooted proves nothing, the inside machine's file gone pays. */
const workTheInsideJob = async () => {
  const job = INSIDE;
  await stage(job);

  const rooted = await rootOver2222(contractor, job, 'inside-front');
  const early = await mailClient(job, `it is gone\n${job.wallet}\n`);
  check(
    'on two hops, the front box rooted leaves the file in place: the miss',
    rooted.landedOn === job.front && early.status === 200 && (await missed(job)),
    `${rooted.detail}, mail ${early.status}`,
  );

  const inside = await rootInside(job, rooted.sessionId);
  // A login over the LAN answers with no machine id, so the session row says where it landed.
  const { data: landed } = await sr
    .from('sessions')
    .select('machine_id')
    .eq('session_id', `ssh-inside-${RUN}`)
    .maybeSingle();
  const landedOn = (landed as { machine_id?: string } | null)?.machine_id;
  const removed = await removeAsRoot(contractor, job.target, job.path);
  const paid = await mailClient(job, `it is gone\n${job.wallet}\n`);
  check(
    'the file removed from the inside machine, through the front box, completes the job and pays',
    inside.status === 200 &&
      landedOn === job.target &&
      removed.status === 200 &&
      paid.status === 200 &&
      (await paidInFull(job)),
    `ssh ${inside.status} on the target ${landedOn === job.target}, rm ${removed.status}, mail ${paid.status}, state ${await stateOf(job)}`,
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
    await seedWordlist(player);
  }

  await workTheDeletedJob();
  await workTheOverwrittenJob();
  await workTheMovedJob();
  await workThePutBackJob();
  await workTheRivalJob();
  await workTheNoWalletJob();
  await workTheBrickJob();
  await workTheInsideJob();

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
