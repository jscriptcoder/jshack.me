// Wire-check for A BACKDOOR JOB: a contract whose client wants a listener left on one machine,
// on a port the briefing names, and reads that machine for it when the contractor mails in.
// Driven end to end against a running `vercel dev` + supabase, staging each job through the REAL
// `scripts/hireme.ts` and working it through the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE CLIENT READS THE TARGET ON ANY MAIL: before anything is done the reply is that nothing
//     is listening on the port named, and the job stays accepted.
//   - ONLY THE PORT NAMED COUNTS: root cracked over :2222 leaves a listener on another port, and
//     the reply is the same miss.
//   - A LISTENER ON THE PORT NAMED PAYS ONCE: the listener's pidfile written as root on the
//     target, as `nc -l` writes it, and the mail completes the job and mints the pay; a second
//     mail is told the job is closed and pays nothing more.
//   - ANYONE'S LISTENER COUNTS: a second player roots the target and leaves the listener; the
//     contractor, who did nothing, mails and is paid.
//   - A LISTENER GONE BEFORE THE MAIL IS A MISS: left, then killed (its pidfile removed), and the
//     mail is told nothing is listening.
//   - A BRICKED TARGET IS A MISS: left, then /boot/vmlinuz removed, and the mail is told nothing
//     is listening.
//   - THE FRONT BOX IS NOT THE TARGET: on a two-hop job the front box rooted and the listener
//     left there, and the mail is told nothing is listening.
//   - `show` names the machine and the port.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionBackdoor.ts
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
import { backdoorJob } from '../src/core/missions/sabotageRoles.js';
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

/** The first backdoor jobs from `from` that `wanted` accepts. */
const backdoorNumbers = (
  from: number,
  count: number,
  wanted: (shape: MissionShape) => boolean,
): readonly number[] => {
  const found: number[] = [];
  for (let candidate = from; candidate < from + 60000 && found.length < count; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.kind === 'backdoor' && wanted(shape)) found.push(candidate);
  }
  if (found.length < count) throw new Error(`only ${found.length} backdoor jobs from ${from}`);
  return found;
};

/** A single-hop job whose target falls to hydra, so its root is on the list every player has. */
const singleHopHydra = ({ frontBox, keyBox }: MissionShape): boolean =>
  frontBox === null && keyBox.route === 'hydra';

const [PORT_JOB, RIVAL_JOB, KILLED_JOB, BRICK_JOB] = backdoorNumbers(400000, 4, singleHopHydra) as [
  number,
  number,
  number,
  number,
];
// A two-hop job whose front box falls to hydra, so a sweep over :2222 roots the front box.
const [FRONT_JOB] = backdoorNumbers(400000, 1, ({ frontBox }) => frontBox?.route === 'hydra') as [
  number,
];
const JOBS = [PORT_JOB, RIVAL_JOB, KILLED_JOB, BRICK_JOB, FRONT_JOB] as const;

type Job = {
  readonly missionNumber: number;
  readonly label: string;
  readonly handle: string;
  readonly address: string;
  readonly target: string;
  readonly front: string | null;
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
  return {
    missionNumber,
    label,
    handle: `bkd${index}${RUN}`,
    address: missionAddressForNumber(missionNumber) ?? '',
    target: machineIdForLanHost(hostAt(shape.keyBox.octet), essid),
    front:
      shape.frontBox === null ? null : machineIdForLanHost(hostAt(shape.frontBox.octet), essid),
    gateway: computeApGatewayId(essid),
    wallet: `jsc${md5(`${RUN}:${missionNumber}`)}${md5(String(missionNumber)).slice(0, 8)}`,
    port: backdoorJob(missionNumber).port,
  };
};

const contractor = generateIdentityIn(RIDGEMONT);
const rival = generateIdentityIn(RIDGEMONT);
const [homeEssid] = wifiPoolOf(RIDGEMONT);
const workstationOf = (player: Identity): string =>
  computeWorkstationId('newbie', player.publicKeyHex);

const PORT = jobOf(PORT_JOB, 'the port named', 0);
const RIVAL = jobOf(RIVAL_JOB, 'rival listener', 1);
const KILLED = jobOf(KILLED_JOB, 'listener killed', 2);
const BRICK = jobOf(BRICK_JOB, 'target bricked', 3);
const FRONT = jobOf(FRONT_JOB, 'listener on the front box', 4);
const ALL_JOBS = [PORT, RIVAL, KILLED, BRICK, FRONT] as const;

const nothingListening = (job: Job): string =>
  `Nothing is listening on port ${job.port}. No listener, no money.`;
const CLOSED = 'That job is already closed.';

/** A classic port the client did not name. */
const otherPortOf = (job: Job): number => (job.port === 4444 ? 5555 : 4444);

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

/** A root's `nc -l <port>` on `machineId`, as `player`: the one file that IS the open port. */
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
      subject: 'listening',
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
  console.log(`\n${job.label} job ${job.missionNumber} at ${job.address}, port ${job.port}`);
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

/** Nothing, then the wrong port, then the port named: two misses, then paid once and closed. */
const workThePortJob = async () => {
  const job = PORT;
  await stage(job);
  const pay = missionTerms(job.missionNumber).pay;

  const shown = runHireme(['show', job.address]);
  const noun = backdoorJob(job.missionNumber).role.noun;
  check(
    `show names the machine, a ${noun}, and the port, ${job.port}`,
    shown.includes(`Kind:     backdoor, ${noun}`) && shown.includes(`Port:     ${job.port}`),
    shown
      .split('\n')
      .filter((line) => line.includes('Kind:') || line.includes('Port:'))
      .join(' | '),
  );

  const early = await mailClient(job, `it is listening\n${job.wallet}\n`);
  check(
    'a mail before anything is done is told nothing is listening on the port named',
    early.status === 200 && (await lastReply(job)).startsWith(nothingListening(job)),
    `status ${early.status}`,
  );
  check(
    'the job stays accepted and pays nothing',
    (await stateOf(job)) === 'accepted' && (await balanceOf(job.wallet)) <= 0,
    `${await stateOf(job)}`,
  );

  const rooted = await rootOver2222(contractor, job, 'port');
  check(
    "hydra cracks the target's root over :2222, and ssh lands root on the target box",
    rooted.landedOn === job.target,
    rooted.detail,
  );

  const elsewhere = await listenAsRoot(contractor, job.target, otherPortOf(job));
  const wrongPort = await mailClient(job, `it is listening\n${job.wallet}\n`);
  check(
    'a listener on another port is the same miss, and the job stays accepted',
    elsewhere.status === 200 &&
      wrongPort.status === 200 &&
      (await lastReply(job)).startsWith(nothingListening(job)) &&
      (await stateOf(job)) === 'accepted',
    `listen ${elsewhere.status}, mail ${wrongPort.status}`,
  );

  const listening = await listenAsRoot(contractor, job.target, job.port);
  const paid = await mailClient(job, `it is listening\n${job.wallet}\n`);
  check(
    'a listener on the port named completes the job and pays the quoted pay',
    listening.status === 200 &&
      paid.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) === pay,
    `listen ${listening.status}, mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
  );
  check(
    "the client says it's in and names the wallet",
    (await lastReply(job)).startsWith(
      `We're in. §${pay.toLocaleString('en-US')} sent to ${job.wallet}.`,
    ),
    'reply read',
  );

  const killed = await removeAsRoot(contractor, job.target, listenerPidfilePath(job.port));
  const again = await mailClient(job, `once more\n${job.wallet}\n`);
  check(
    'once paid, a killed listener changes nothing: a second mail is told the job is closed',
    killed.status === 200 &&
      again.status === 200 &&
      (await lastReply(job)).startsWith(CLOSED) &&
      (await balanceOf(job.wallet)) === pay,
    `kill ${killed.status}, mail ${again.status}, balance ${await balanceOf(job.wallet)}`,
  );
};

/** Another player leaves the listener; the contractor, who did nothing, is paid. */
const workTheRivalJob = async () => {
  const job = RIVAL;
  await stage(job);
  const pay = missionTerms(job.missionNumber).pay;

  const rooted = await rootOver2222(rival, job, 'rival');
  const listening = await listenAsRoot(rival, job.target, job.port);
  check(
    'a second player roots the target and leaves a listener on the port named',
    rooted.landedOn === job.target && listening.status === 200,
    `${rooted.detail}, listen ${listening.status}`,
  );

  const paid = await mailClient(job, `looks open to me\n${job.wallet}\n`);
  check(
    "the contractor's mail is paid for a listener somebody else left",
    paid.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) === pay,
    `mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
  );
};

/** The listener left, then killed before the mail: a miss. */
const workTheKilledJob = async () => {
  const job = KILLED;
  await stage(job);

  const rooted = await rootOver2222(contractor, job, 'killed');
  const listening = await listenAsRoot(contractor, job.target, job.port);
  const killed = await removeAsRoot(contractor, job.target, listenerPidfilePath(job.port));
  const mailed = await mailClient(job, `it is listening\n${job.wallet}\n`);
  check(
    'a listener killed before the mail is told nothing is listening',
    rooted.landedOn === job.target &&
      listening.status === 200 &&
      killed.status === 200 &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith(nothingListening(job)) &&
      (await stateOf(job)) === 'accepted',
    `${rooted.detail}, listen ${listening.status}, kill ${killed.status}, mail ${mailed.status}`,
  );
};

/** The listener left, then the target bricked: a box that does not boot listens on nothing. */
const workTheBrickJob = async () => {
  const job = BRICK;
  await stage(job);

  const rooted = await rootOver2222(contractor, job, 'brick');
  const listening = await listenAsRoot(contractor, job.target, job.port);
  const bricked = await removeAsRoot(contractor, job.target, '/boot/vmlinuz');
  const mailed = await mailClient(job, `it is listening\n${job.wallet}\n`);
  check(
    'a bricked target is told nothing is listening, its listener and all',
    rooted.landedOn === job.target &&
      listening.status === 200 &&
      bricked.status === 200 &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith(nothingListening(job)) &&
      (await stateOf(job)) === 'accepted',
    `${rooted.detail}, listen ${listening.status}, rm ${bricked.status}, mail ${mailed.status}`,
  );
};

/** The listener left on the front box of a two-hop job: the front box is not the target. */
const workTheFrontJob = async () => {
  const job = FRONT;
  await stage(job);

  const rooted = await rootOver2222(contractor, job, 'front');
  const listening =
    job.front === null ? { status: 0 } : await listenAsRoot(contractor, job.front, job.port);
  const mailed = await mailClient(job, `it is listening\n${job.wallet}\n`);
  check(
    'a listener on the front box is told nothing is listening: the front box is not the target',
    rooted.landedOn === job.front &&
      listening.status === 200 &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith(nothingListening(job)) &&
      (await stateOf(job)) === 'accepted' &&
      (await balanceOf(job.wallet)) <= 0,
    `${rooted.detail}, listen ${listening.status}, mail ${mailed.status}`,
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

  await workThePortJob();
  await workTheRivalJob();
  await workTheKilledJob();
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
