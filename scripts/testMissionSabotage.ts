// Wire-check for A SABOTAGE JOB: a contract whose client wants one machine taken down for good,
// and reads that machine to see whether it still boots. Driven end to end against a running
// `vercel dev` + supabase, staging each job through the REAL `scripts/hireme.ts` and working it
// through the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE CLIENT READS THE TARGET ON ANY MAIL: before anything is done the reply is that the
//     machine is still up, and the job stays accepted.
//   - A BOOT FILE GONE PAYS ONCE, NO REBOOT: root cracked over :2222, /boot/vmlinuz removed and
//     nothing else, and any mail completes the job and mints the pay; a second mail is told the
//     job is closed and pays nothing more. /boot/initrd.img alone does the same.
//   - ANYONE'S BRICK COUNTS: a second player roots the target and removes /boot/vmlinuz; the
//     contractor, who did nothing, mails and is paid.
//   - A BRICKED FRONT BOX LOSES A TWO-HOP JOB: the front box rooted and bricked, the client says
//     the machine is still up, and ssh can no longer reach the front box the target sits behind.
//   - EVERY MACHINE IS NAMED FOR WHAT IT IS: one job per machine a client can want down, from
//     the CCTV recorder (`<stem>-nvr`) to the billing server (`<stem>-billing`). `show` names
//     the machine and its box, root's ssh lands on the box the LAN names so, and its brick is
//     paid.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionSabotage.ts
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
import { missionShape, type MissionShape } from '../src/core/missions/missionShape.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';
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

/** The first sabotage jobs from `from` that `wanted` accepts. */
const sabotageNumbers = (
  from: number,
  count: number,
  wanted: (shape: MissionShape) => boolean,
): readonly number[] => {
  const found: number[] = [];
  for (let candidate = from; candidate < from + 60000 && found.length < count; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.kind === 'sabotage' && wanted(shape)) found.push(candidate);
  }
  if (found.length < count) throw new Error(`only ${found.length} sabotage jobs from ${from}`);
  return found;
};

/** A single-hop job whose target falls to hydra, so its root is on the list every player has. */
const singleHopHydra = ({ frontBox, keyBox }: MissionShape): boolean =>
  frontBox === null && keyBox.route === 'hydra';

const [UP_JOB, KERNEL_JOB, RIVAL_JOB, RAMDISK_JOB] = sabotageNumbers(400000, 4, singleHopHydra) as [
  number,
  number,
  number,
  number,
];
// A two-hop job whose front box falls to hydra, so a sweep over :2222 roots the front box.
const [FRONT_JOB] = sabotageNumbers(400000, 1, ({ frontBox }) => frontBox?.route === 'hydra') as [
  number,
];
/** Every machine a client can want down, and the suffix its box is named with. */
const ROLES = [
  { noun: 'CCTV recorder', suffix: 'nvr' },
  { noun: 'backup server', suffix: 'backup' },
  { noun: 'monitoring station', suffix: 'mon' },
  { noun: 'build server', suffix: 'ci' },
  { noun: 'licence server', suffix: 'lic' },
  { noun: 'door-access controller', suffix: 'access' },
  { noun: 'billing server', suffix: 'billing' },
] as const;

/** The machine a job asks taken down, read off the board's line. */
const machineOf = (missionNumber: number): string =>
  missionTerms(missionNumber).kind.replace(/^take down (a|an internal) /, '');

// One single-hop job per machine, from past the jobs above so none is worked twice.
const ROLE_JOBS = ROLES.map(({ noun }) => {
  const [found] = sabotageNumbers(
    500000,
    1,
    (shape) => singleHopHydra(shape) && machineOf(shape.missionNumber) === noun,
  );
  if (found === undefined) throw new Error(`no single-hop hydra job on a ${noun}`);
  return found;
});
const JOBS = [UP_JOB, KERNEL_JOB, RIVAL_JOB, RAMDISK_JOB, FRONT_JOB, ...ROLE_JOBS] as const;

type Job = {
  readonly missionNumber: number;
  readonly label: string;
  readonly handle: string;
  readonly address: string;
  readonly targetName: string;
  readonly target: string;
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
  const targetHost = hostAt(shape.keyBox.octet);
  return {
    missionNumber,
    label,
    handle: `sab${index}${RUN}`,
    address: missionAddressForNumber(missionNumber) ?? '',
    targetName: targetHost.hostname,
    target: machineIdForLanHost(targetHost, essid),
    front:
      shape.frontBox === null ? null : machineIdForLanHost(hostAt(shape.frontBox.octet), essid),
    gateway: computeApGatewayId(essid),
    wallet: `jsc${md5(`${RUN}:${missionNumber}`)}${md5(String(missionNumber)).slice(0, 8)}`,
  };
};

const contractor = generateIdentityIn(RIDGEMONT);
const rival = generateIdentityIn(RIDGEMONT);
const [homeEssid] = wifiPoolOf(RIDGEMONT);
const workstationOf = (player: Identity): string =>
  computeWorkstationId('newbie', player.publicKeyHex);

const UP = jobOf(UP_JOB, 'still up', 0);
const KERNEL = jobOf(KERNEL_JOB, 'kernel gone', 1);
const RIVAL = jobOf(RIVAL_JOB, 'rival brick', 2);
const RAMDISK = jobOf(RAMDISK_JOB, 'ramdisk gone', 3);
const FRONT = jobOf(FRONT_JOB, 'front box bricked', 4);
const ROLE_WORK = ROLES.map((role, index) => ({
  ...role,
  job: jobOf(ROLE_JOBS[index]!, `${role.noun} down`, 5 + index),
}));
const ALL_JOBS = [UP, KERNEL, RIVAL, RAMDISK, FRONT, ...ROLE_WORK.map(({ job }) => job)] as const;

const STILL_UP = 'Their machine is still up. No outage, no money.';
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

/** A contractor who mails before doing anything: the machine is still up. */
const workTheUpJob = async () => {
  const job = UP;
  await stage(job);

  const early = await mailClient(job, `it is done\n${job.wallet}\n`);
  check(
    'a mail before anything is done is told the machine is still up',
    early.status === 200 && (await lastReply(job)).startsWith(STILL_UP),
    `status ${early.status}`,
  );
  check(
    'the job stays accepted and pays nothing',
    (await stateOf(job)) === 'accepted' && (await balanceOf(job.wallet)) <= 0,
    `${await stateOf(job)}`,
  );
};

/** Root removes the kernel and nothing else: paid once, then closed. */
const workTheKernelJob = async () => {
  const job = KERNEL;
  await stage(job);
  const pay = missionTerms(job.missionNumber).pay;

  const rooted = await rootOver2222(contractor, job, 'kernel');
  check(
    "hydra cracks the target's root over :2222, and ssh lands root on the target box",
    rooted.landedOn === job.target,
    rooted.detail,
  );

  const removed = await removeAsRoot(contractor, job.target, '/boot/vmlinuz');
  const paid = await mailClient(job, `it is down\n${job.wallet}\n`);
  check(
    'rm /boot/vmlinuz with no reboot, and any mail completes the job and pays the quoted pay',
    removed.status === 200 &&
      paid.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) === pay,
    `rm ${removed.status}, mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
  );
  check(
    'the client says the machine is down and names the wallet',
    (await lastReply(job)).startsWith(
      `The machine is down. §${pay.toLocaleString('en-US')} sent to ${job.wallet}.`,
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

/** Another player takes the target down; the contractor, who did nothing, is paid. */
const workTheRivalJob = async () => {
  const job = RIVAL;
  await stage(job);
  const pay = missionTerms(job.missionNumber).pay;

  const rooted = await rootOver2222(rival, job, 'rival');
  const removed = await removeAsRoot(rival, job.target, '/boot/vmlinuz');
  check(
    'a second player roots the target and removes /boot/vmlinuz',
    rooted.landedOn === job.target && removed.status === 200,
    `${rooted.detail}, rm ${removed.status}`,
  );

  const paid = await mailClient(job, `looks done to me\n${job.wallet}\n`);
  check(
    "the contractor's mail is paid for a brick somebody else made",
    paid.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) === pay,
    `mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
  );
};

/** Root removes only the initial ramdisk: the box cannot boot either way. */
const workTheRamdiskJob = async () => {
  const job = RAMDISK;
  await stage(job);
  const pay = missionTerms(job.missionNumber).pay;

  const rooted = await rootOver2222(contractor, job, 'ramdisk');
  const removed = await removeAsRoot(contractor, job.target, '/boot/initrd.img');
  const paid = await mailClient(job, `done\n${job.wallet}\n`);
  check(
    'rm /boot/initrd.img alone completes the job and pays',
    rooted.landedOn === job.target &&
      removed.status === 200 &&
      paid.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) === pay,
    `${rooted.detail}, rm ${removed.status}, mail ${paid.status}, balance ${await balanceOf(job.wallet)}`,
  );
};

/** Each machine a client can want down: named for what it is, and paid for once it is down. */
const workTheRoleJobs = async () => {
  for (const { noun, suffix, job } of ROLE_WORK) {
    await stage(job);
    const pay = missionTerms(job.missionNumber).pay;

    const shown = runHireme(['show', job.address]);
    check(
      `show names a ${noun} and its box, -${suffix}`,
      shown.includes(`Kind:     sabotage, ${noun}`) &&
        job.targetName.endsWith(`-${suffix}`) &&
        shown.includes(job.targetName),
      shown.split('\n').find((line) => line.includes('Kind:')) ?? 'no Kind line',
    );

    const rooted = await rootOver2222(contractor, job, suffix);
    const removed = await removeAsRoot(contractor, job.target, '/boot/vmlinuz');
    const paid = await mailClient(job, `it is down\n${job.wallet}\n`);
    check(
      `root lands on ${job.targetName}, removes /boot/vmlinuz, and the mail is paid`,
      rooted.landedOn === job.target &&
        removed.status === 200 &&
        paid.status === 200 &&
        (await stateOf(job)) === 'completed' &&
        (await balanceOf(job.wallet)) === pay &&
        (await lastReply(job)).startsWith(
          `The machine is down. §${pay.toLocaleString('en-US')} sent to ${job.wallet}.`,
        ),
      `${rooted.detail}, rm ${removed.status}, mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
    );
  }
};

/** The front box bricked on a two-hop job: the target is still up, and out of reach. */
const workTheFrontJob = async () => {
  const job = FRONT;
  await stage(job);

  const rooted = await rootOver2222(contractor, job, 'front');
  const removed =
    job.front === null ? { status: 0 } : await removeAsRoot(contractor, job.front, '/boot/vmlinuz');
  check(
    'hydra roots the front box over :2222, and its root removes /boot/vmlinuz there',
    rooted.landedOn === job.front && removed.status === 200,
    `${rooted.detail}, rm ${removed.status}`,
  );

  const mailed = await mailClient(job, `it is down\n${job.wallet}\n`);
  check(
    'the client says the machine is still up: the front box was not the target',
    mailed.status === 200 &&
      (await lastReply(job)).startsWith(STILL_UP) &&
      (await stateOf(job)) === 'accepted' &&
      (await balanceOf(job.wallet)) <= 0,
    `mail ${mailed.status}, state ${await stateOf(job)}`,
  );

  const again = await rootOver2222(contractor, job, 'front-again');
  check(
    'ssh can no longer reach the front box, so the target is out of reach',
    again.landedOn === undefined,
    again.detail,
  );
};

const main = async () => {
  if (homeEssid === undefined || ALL_JOBS.some((job) => job.address === '')) {
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

  await workTheUpJob();
  await workTheKernelJob();
  await workTheRivalJob();
  await workTheRamdiskJob();
  await workTheFrontJob();
  await workTheRoleJobs();

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
