// Wire-check for AN INFILTRATE JOB: a contract whose client mails the contractor a file with the
// briefing and wants it put at a path on one machine, in place of the company's own, and reads
// that machine for it when the contractor mails in. Driven end to end against a running
// `vercel dev` + supabase, accepting through a board's REAL door and staging the rest through the
// REAL `scripts/hireme.ts`, and working each job through the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE BRIEFING CARRIES THE FILE: accepting an infiltrate offer through the board's /accept
//     lays a briefing whose attachment is the client's file, under its own name, read back byte
//     for byte as `mail save` reads it.
//   - THE CLIENT READS THE TARGET ON ANY MAIL: before anything is done the company's own file
//     is at the path, and the reply is that the client's file is not in place.
//   - ONLY THE CLIENT'S FILE COUNTS: root cracked over :2222 writes another file at the path,
//     and the reply is the same miss.
//   - THE CLIENT'S FILE AT THE PATH PAYS ONCE: written as root on the target, as `scp` writes it,
//     and the mail completes the job and mints the pay; a second mail is told the job is closed
//     and pays nothing more.
//   - ANYONE'S PLACING COUNTS: a second player roots the target and puts the file there; the
//     contractor, who did nothing, mails and is paid.
//   - A FILE GONE BEFORE THE MAIL IS A MISS: put there, then removed, and the mail is told it is
//     not in place.
//   - A BRICKED TARGET IS A MISS: put there, then /boot/vmlinuz removed, and the mail is told it
//     is not in place.
//   - THE FRONT BOX IS NOT THE TARGET: on a two-hop job the front box rooted and the file put at
//     the same path there, and the mail is told it is not in place.
//   - `show` names the item and the path.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionInfiltrate.ts
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
import {
  DEFAULT_WORDLIST,
  WORDLIST_PATH,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist.js';
import { missionShape, type MissionShape } from '../src/core/missions/missionShape.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';
import {
  missionFileName,
  missionFilePath,
  missionPlantContent,
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

/** The first infiltrate jobs from `from` that `wanted` accepts. */
const infiltrateNumbers = (
  from: number,
  count: number,
  wanted: (shape: MissionShape) => boolean,
): readonly number[] => {
  const found: number[] = [];
  for (let candidate = from; candidate < from + 60000 && found.length < count; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.kind === 'infiltrate' && wanted(shape)) found.push(candidate);
  }
  if (found.length < count) throw new Error(`only ${found.length} infiltrate jobs from ${from}`);
  return found;
};

/** A single-hop job whose target falls to hydra, so its root is on the list every player has. */
const singleHopHydra = ({ frontBox, keyBox }: MissionShape): boolean =>
  frontBox === null && keyBox.route === 'hydra';

const [PLACED_JOB, RIVAL_JOB, REMOVED_JOB, BRICK_JOB] = infiltrateNumbers(
  400000,
  4,
  singleHopHydra,
) as [number, number, number, number];
// A two-hop job whose front box falls to hydra, so a sweep over :2222 roots the front box.
const [FRONT_JOB] = infiltrateNumbers(400000, 1, ({ frontBox }) => frontBox?.route === 'hydra') as [
  number,
];
const JOBS = [PLACED_JOB, RIVAL_JOB, REMOVED_JOB, BRICK_JOB, FRONT_JOB] as const;

type Job = {
  readonly missionNumber: number;
  readonly label: string;
  readonly handle: string;
  readonly address: string;
  readonly target: string;
  readonly front: string | null;
  readonly gateway: string;
  readonly wallet: string;
  readonly path: string;
  readonly ours: string;
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
    handle: `inf${index}${RUN}`,
    address: missionAddressForNumber(missionNumber) ?? '',
    target: machineIdForLanHost(hostAt(shape.keyBox.octet), essid),
    front:
      shape.frontBox === null ? null : machineIdForLanHost(hostAt(shape.frontBox.octet), essid),
    gateway: computeApGatewayId(essid),
    wallet: `jsc${md5(`${RUN}:${missionNumber}`)}${md5(String(missionNumber)).slice(0, 8)}`,
    path: missionFilePath(missionNumber),
    ours: missionPlantContent(missionNumber, missionSecret),
  };
};

const contractor = generateIdentityIn(RIDGEMONT);
const rival = generateIdentityIn(RIDGEMONT);
const [homeEssid] = wifiPoolOf(RIDGEMONT);
const workstationOf = (player: Identity): string =>
  computeWorkstationId('newbie', player.publicKeyHex);

const PLACED = jobOf(PLACED_JOB, 'the file put in place', 0);
const RIVAL = jobOf(RIVAL_JOB, 'rival placing', 1);
const REMOVED = jobOf(REMOVED_JOB, 'file removed', 2);
const BRICK = jobOf(BRICK_JOB, 'target bricked', 3);
const FRONT = jobOf(FRONT_JOB, 'file on the front box', 4);
const ALL_JOBS = [PLACED, RIVAL, REMOVED, BRICK, FRONT] as const;

const notInPlace = (job: Job): string =>
  `Our file is not at ${job.path}. No file in place, no money.`;
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
  const shell = await post(
    SESSIONS,
    signRequest(player, 'authCreateSessionPublic', {
      session_id: `ssh-${name}-${RUN}`,
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
    landedOn: field(shell.body, 'machine_id'),
    detail: `sweep ${sweep.status} root ${root === undefined ? 'missing' : 'found'}, ssh ${shell.status}`,
  };
};

/** A root's write of `content` over the file at `path` on `machineId`, as `player`, as `scp`
 *  writes a file it carries there. */
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

/** A root's `mkdir -p` of `directory` on `machineId`, as `player`: each level of it, a box
 *  that never had the directory refusing a file written into it. */
const mkdirAsRoot = async (player: Identity, machineId: string, directory: string) => {
  const levels = directory
    .split('/')
    .filter((part) => part !== '')
    .map((_part, index, parts) => `/${parts.slice(0, index + 1).join('/')}`);
  const statuses: number[] = [];
  for (const path of levels) {
    const made = await post(
      PATCHES,
      signRequest(player, 'upsertPatch', {
        machine_id: machineId,
        path,
        content: null,
        owner: 'root',
        is_new: true,
        node_type: 'directory',
        permissions: {
          read: ['root', 'user', 'guest'],
          write: ['root'],
          execute: ['root', 'user', 'guest'],
        },
      }),
    );
    statuses.push(made.status);
  }
  return statuses;
};

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
      subject: 'in place',
      body,
    }),
  );

/** One message as the mail client reads it, its attachment and all. */
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
  return field(opened.body, 'message') as
    | { subject?: string; body?: string; attachment?: { name: string; content: string } }
    | undefined;
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

/** Taken through the board: the briefing's file, then the company's file, another file and
 *  the client's file at the path: two misses, then paid once and closed. */
const workThePlacedJob = async () => {
  const job = PLACED;
  const briefingNumber = await acceptThroughBoard(job);
  const pay = missionTerms(job.missionNumber).pay;

  const briefing = await readMessage(job, briefingNumber);
  check(
    "the briefing carries the client's file under its own name, byte for byte",
    briefing?.attachment?.name === missionFileName(job.missionNumber) &&
      briefing.attachment.content === job.ours,
    `name ${briefing?.attachment?.name ?? 'none'}, ${briefing?.attachment?.content.length ?? 0} of ${job.ours.length} chars`,
  );
  check(
    'the briefing names the whole path and the rule',
    (briefing?.body ?? '').includes(`  ${job.path}\n`) &&
      (briefing?.body ?? '').includes('No file in place, no money. No wallet, no money.'),
    `${briefing?.subject ?? 'no briefing'}`,
  );

  const shown = runHireme(['show', job.address]);
  check(
    'show names the item and the path',
    shown.includes('Kind:     infiltrate, firmware image') &&
      shown.includes(`File:     ${job.path}, theirs `),
    shown
      .split('\n')
      .filter((line) => line.includes('Kind:') || line.includes('File:'))
      .join(' | '),
  );

  const early = await mailClient(job, `it is there\n${job.wallet}\n`);
  check(
    "a mail while the company's own file is at the path is told the client's is not in place",
    early.status === 200 && (await lastReply(job)).startsWith(notInPlace(job)),
    `status ${early.status}`,
  );
  check(
    'the job stays accepted and pays nothing',
    (await stateOf(job)) === 'accepted' && (await balanceOf(job.wallet)) <= 0,
    `${await stateOf(job)}`,
  );

  const rooted = await rootOver2222(contractor, job, 'placed');
  check(
    "hydra cracks the target's root over :2222, and ssh lands root on the target box",
    rooted.landedOn === job.target,
    rooted.detail,
  );

  const other = await writeAsRoot(contractor, job.target, job.path, `${job.ours}\n`);
  const wrongFile = await mailClient(job, `it is there\n${job.wallet}\n`);
  check(
    "the client's file with a newline added is the same miss, and the job stays accepted",
    other.status === 200 &&
      wrongFile.status === 200 &&
      (await lastReply(job)).startsWith(notInPlace(job)) &&
      (await stateOf(job)) === 'accepted',
    `write ${other.status}, mail ${wrongFile.status}`,
  );

  const placed = await writeAsRoot(contractor, job.target, job.path, job.ours);
  const paid = await mailClient(job, `it is there\n${job.wallet}\n`);
  check(
    "the client's file at the path completes the job and pays the quoted pay",
    placed.status === 200 &&
      paid.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) === pay,
    `write ${placed.status}, mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
  );
  check(
    "the client says it's in place and names the wallet",
    (await lastReply(job)).startsWith(
      `It's in place. §${pay.toLocaleString('en-US')} sent to ${job.wallet}.`,
    ),
    'reply read',
  );

  const removed = await removeAsRoot(contractor, job.target, job.path);
  const again = await mailClient(job, `once more\n${job.wallet}\n`);
  check(
    'once paid, a removed file changes nothing: a second mail is told the job is closed',
    removed.status === 200 &&
      again.status === 200 &&
      (await lastReply(job)).startsWith(CLOSED) &&
      (await balanceOf(job.wallet)) === pay,
    `rm ${removed.status}, mail ${again.status}, balance ${await balanceOf(job.wallet)}`,
  );
};

/** Another player puts the file there; the contractor, who did nothing, is paid. */
const workTheRivalJob = async () => {
  const job = RIVAL;
  await stage(job);
  const pay = missionTerms(job.missionNumber).pay;

  const rooted = await rootOver2222(rival, job, 'rival');
  const placed = await writeAsRoot(rival, job.target, job.path, job.ours);
  check(
    "a second player roots the target and puts the client's file at the path",
    rooted.landedOn === job.target && placed.status === 200,
    `${rooted.detail}, write ${placed.status}`,
  );

  const paid = await mailClient(job, `looks done to me\n${job.wallet}\n`);
  check(
    "the contractor's mail is paid for a file somebody else put there",
    paid.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) === pay,
    `mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
  );
};

/** The file put there, then removed before the mail: a miss. */
const workTheRemovedJob = async () => {
  const job = REMOVED;
  await stage(job);

  const rooted = await rootOver2222(contractor, job, 'removed');
  const placed = await writeAsRoot(contractor, job.target, job.path, job.ours);
  const removed = await removeAsRoot(contractor, job.target, job.path);
  const mailed = await mailClient(job, `it is there\n${job.wallet}\n`);
  check(
    'a file removed before the mail is told it is not in place',
    rooted.landedOn === job.target &&
      placed.status === 200 &&
      removed.status === 200 &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith(notInPlace(job)) &&
      (await stateOf(job)) === 'accepted',
    `${rooted.detail}, write ${placed.status}, rm ${removed.status}, mail ${mailed.status}`,
  );
};

/** The file put there, then the target bricked: a box that does not boot holds nothing. */
const workTheBrickJob = async () => {
  const job = BRICK;
  await stage(job);

  const rooted = await rootOver2222(contractor, job, 'brick');
  const placed = await writeAsRoot(contractor, job.target, job.path, job.ours);
  const bricked = await removeAsRoot(contractor, job.target, '/boot/vmlinuz');
  const mailed = await mailClient(job, `it is there\n${job.wallet}\n`);
  check(
    'a bricked target is told the file is not in place, the file and all',
    rooted.landedOn === job.target &&
      placed.status === 200 &&
      bricked.status === 200 &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith(notInPlace(job)) &&
      (await stateOf(job)) === 'accepted',
    `${rooted.detail}, write ${placed.status}, rm ${bricked.status}, mail ${mailed.status}`,
  );
};

/** The file put on the front box of a two-hop job: the front box is not the target. */
const workTheFrontJob = async () => {
  const job = FRONT;
  await stage(job);

  const rooted = await rootOver2222(contractor, job, 'front');
  // The front box keeps no firmware, so its root makes the directory first, as they would.
  const directory = job.path.slice(0, job.path.lastIndexOf('/'));
  const made = job.front === null ? [] : await mkdirAsRoot(contractor, job.front, directory);
  const placed =
    job.front === null
      ? { status: 0 }
      : await writeAsRoot(contractor, job.front, job.path, job.ours);
  const mailed = await mailClient(job, `it is there\n${job.wallet}\n`);
  check(
    'a file on the front box is told it is not in place: the front box is not the target',
    rooted.landedOn === job.front &&
      placed.status === 200 &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith(notInPlace(job)) &&
      (await stateOf(job)) === 'accepted' &&
      (await balanceOf(job.wallet)) <= 0,
    `${rooted.detail}, mkdir ${made.join('/')}, write ${placed.status}, mail ${mailed.status}`,
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

  await workThePlacedJob();
  await workTheRivalJob();
  await workTheRemovedJob();
  await workTheBrickJob();
  await workTheFrontJob();

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
