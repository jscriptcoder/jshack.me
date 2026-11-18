// Wire-check for A CREDENTIAL JOB: a contract whose client wants the root login of one machine,
// mailed back on a line of its own, and tests it against that machine as it stands. Driven end to
// end against a running `vercel dev` + supabase, staging each job through the REAL
// `scripts/hireme.ts` and working it through the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE CLIENT READS THE TARGET ON EVERY MAIL: a mail with no password line, then a wrong
//     password, are both refused in the same words, and the job stays accepted.
//   - THE PASSWORD FOUND PAYS ONCE: root cracked over :2222, the word mailed, and the job completes
//     and mints the pay; a second mail is told the job is closed and pays nothing more.
//   - A PASSWORD SET WITH `passwd` PAYS: root's password changed from a root shell on the target,
//     the old word is refused and the new one pays.
//   - NO WALLET STILL COMPLETES: the right password with no wallet closes the job and pays nothing.
//   - A BRICKED TARGET IS A MISS: /boot/vmlinuz removed, and the right password is refused.
//   - THE FRONT BOX IS NOT THE TARGET: on a two-hop job the front box's password is refused.
//   - A SHARED PASSWORD PAYS: on a two-hop job whose boxes drew one password, the front box's
//     password opens the target too.
//   - `show` names the kind and the machine.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionCredential.ts
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
import { credentialRole } from '../src/core/missions/targetRoles.js';
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

/** The first credential jobs from `from` that `wanted` accepts. */
const credentialNumbers = (
  from: number,
  count: number,
  wanted: (shape: MissionShape) => boolean,
): readonly number[] => {
  const found: number[] = [];
  for (let candidate = from; candidate < from + 3_000_000 && found.length < count; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.kind === 'credential' && wanted(shape)) found.push(candidate);
  }
  if (found.length < count) throw new Error(`only ${found.length} credential jobs from ${from}`);
  return found;
};

/** A single-hop job whose target falls to hydra, so its root is on the list every player has. */
const singleHopHydra = ({ frontBox, keyBox }: MissionShape): boolean =>
  frontBox === null && keyBox.route === 'hydra';

const [PAID_JOB, PASSWD_JOB, NO_WALLET_JOB, BRICK_JOB] = credentialNumbers(
  400000,
  4,
  singleHopHydra,
) as [number, number, number, number];
// Two-hop jobs whose front box falls to hydra, so a sweep over :2222 finds the front box's word:
// one whose boxes drew different passwords, and one whose boxes drew the same.
const [FRONT_JOB] = credentialNumbers(
  400000,
  1,
  ({ frontBox, keyBox }) => frontBox?.route === 'hydra' && frontBox.rootHash !== keyBox.rootHash,
) as [number];
const [SHARED_JOB] = credentialNumbers(
  400000,
  1,
  ({ frontBox, keyBox }) => frontBox?.route === 'hydra' && frontBox.rootHash === keyBox.rootHash,
) as [number];
const JOBS = [PAID_JOB, PASSWD_JOB, NO_WALLET_JOB, BRICK_JOB, FRONT_JOB, SHARED_JOB] as const;

type Job = {
  readonly missionNumber: number;
  readonly label: string;
  readonly handle: string;
  readonly address: string;
  readonly target: string;
  readonly front: string | null;
  readonly gateway: string;
  readonly wallet: string;
  readonly noun: string;
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
    handle: `crd${index}${RUN}`,
    address: missionAddressForNumber(missionNumber) ?? '',
    target: machineIdForLanHost(hostAt(shape.keyBox.octet), essid),
    front:
      shape.frontBox === null ? null : machineIdForLanHost(hostAt(shape.frontBox.octet), essid),
    gateway: computeApGatewayId(essid),
    wallet: `jsc${md5(`${RUN}:${missionNumber}`)}${md5(String(missionNumber)).slice(0, 8)}`,
    noun: credentialRole(missionNumber).noun,
  };
};

const contractor = generateIdentityIn(RIDGEMONT);
const [homeEssid] = wifiPoolOf(RIDGEMONT);
const workstationOf = (player: Identity): string =>
  computeWorkstationId('newbie', player.publicKeyHex);

const PAID = jobOf(PAID_JOB, 'the password found', 0);
const PASSWD = jobOf(PASSWD_JOB, 'a password set', 1);
const NO_WALLET = jobOf(NO_WALLET_JOB, 'no wallet', 2);
const BRICK = jobOf(BRICK_JOB, 'target bricked', 3);
const FRONT = jobOf(FRONT_JOB, "the front box's password", 4);
const SHARED = jobOf(SHARED_JOB, 'one password on both boxes', 5);
const ALL_JOBS = [PAID, PASSWD, NO_WALLET, BRICK, FRONT, SHARED] as const;

const refused = (job: Job): string =>
  `That login doesn't open their ${job.noun}. No login, no money.`;
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

/** The contractor sweeps the box behind the job's :2222 for root and logs in as it over ssh. */
const rootOver2222 = async (job: Job, name: string) => {
  const sweep = await post(
    SESSIONS,
    signRequest(contractor, 'hydraCrack', {
      essid: homeEssid,
      target_ip: job.address,
      service: 'ssh',
      caller_machine_id: workstationOf(contractor),
      port: SSH_PORT,
    }),
  );
  const root = crackedOf(sweep.body).find(({ username }) => username === 'root');
  const shell = await post(
    SESSIONS,
    signRequest(contractor, 'authCreateSessionPublic', {
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
    password: root?.password ?? '',
    landedOn: field(shell.body, 'machine_id'),
    detail: `sweep ${sweep.status} root ${root === undefined ? 'missing' : 'found'}, ssh ${shell.status}`,
  };
};

/** A root's `rm` of one file on `machineId`. */
const removeAsRoot = (machineId: string, path: string) =>
  post(
    PATCHES,
    signRequest(contractor, 'removePatch', { machine_id: machineId, path, owner: 'root' }),
  );

/** The contractor's mail to the job's client. */
const mailClient = (job: Job, body: string) =>
  post(
    NETWORK,
    signRequest(contractor, 'resolveMail', {
      op: 'send',
      password: 's3cret',
      handle: job.handle,
      to: missionTerms(job.missionNumber).client.handle,
      subject: 'the login',
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
  console.log(`\n${job.label} job ${job.missionNumber} at ${job.address}, a ${job.noun}`);
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

/** No line, then a wrong word, then the word found: two misses, then paid once and closed. */
const workThePaidJob = async () => {
  const job = PAID;
  await stage(job);
  const pay = missionTerms(job.missionNumber).pay;

  const shown = runHireme(['show', job.address]);
  check(
    `show names the kind and the machine, a ${job.noun}`,
    shown.includes(`Kind:     credential, ${job.noun}`),
    shown
      .split('\n')
      .filter((line) => line.includes('Kind:'))
      .join(' | '),
  );

  const noLine = await mailClient(job, `here it is\n${job.wallet}\n`);
  check(
    'a mail with no password line is refused, and the job stays accepted',
    noLine.status === 200 &&
      (await lastReply(job)).startsWith(refused(job)) &&
      (await stateOf(job)) === 'accepted',
    `status ${noLine.status}`,
  );

  const rooted = await rootOver2222(job, 'paid');
  check(
    "hydra cracks the target's root over :2222, and ssh lands root on the target box",
    rooted.landedOn === job.target && rooted.password !== '',
    rooted.detail,
  );

  const wrong = await mailClient(job, `password: not-${rooted.password}\n${job.wallet}\n`);
  check(
    'a wrong password is the same miss, and pays nothing',
    wrong.status === 200 &&
      (await lastReply(job)).startsWith(refused(job)) &&
      (await stateOf(job)) === 'accepted' &&
      (await balanceOf(job.wallet)) <= 0,
    `status ${wrong.status}`,
  );

  const paid = await mailClient(job, `  Password: ${rooted.password}\n${job.wallet}\n`);
  check(
    "root's password completes the job and pays the quoted pay",
    paid.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) === pay,
    `mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
  );
  check(
    'the client says the login works and names the wallet',
    (await lastReply(job)).startsWith(
      `That login works. §${pay.toLocaleString('en-US')} sent to ${job.wallet}.`,
    ),
    'reply read',
  );

  const again = await mailClient(job, `password: ${rooted.password}\n${job.wallet}\n`);
  check(
    'a second mail is told the job is closed and pays nothing more',
    again.status === 200 &&
      (await lastReply(job)).startsWith(CLOSED) &&
      (await balanceOf(job.wallet)) === pay,
    `mail ${again.status}, balance ${await balanceOf(job.wallet)}`,
  );
};

/** Root's password changed from a root shell: the old word is refused, the new one pays. */
const workThePasswdJob = async () => {
  const job = PASSWD;
  await stage(job);
  const pay = missionTerms(job.missionNumber).pay;
  const chosen = `Kestrel-${RUN}`;

  const rooted = await rootOver2222(job, 'passwd');
  const changed = await post(
    SESSIONS,
    signRequest(contractor, 'passwdChange', {
      machine_id: job.target,
      username: 'root',
      new_hash: md5(chosen),
    }),
  );
  check(
    "passwd from a root shell on the target changes root's password",
    rooted.landedOn === job.target && changed.status === 200,
    `${rooted.detail}, passwd ${changed.status}`,
  );

  const stale = await mailClient(job, `password: ${rooted.password}\n${job.wallet}\n`);
  check(
    'the password root had before is refused',
    stale.status === 200 &&
      (await lastReply(job)).startsWith(refused(job)) &&
      (await stateOf(job)) === 'accepted',
    `status ${stale.status}`,
  );

  const paid = await mailClient(job, `password: ${chosen}\n${job.wallet}\n`);
  check(
    'the password set with passwd completes the job and pays',
    paid.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) === pay,
    `mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
  );
};

/** The right password with no wallet: the job closes and nothing is paid. */
const workTheNoWalletJob = async () => {
  const job = NO_WALLET;
  await stage(job);

  const rooted = await rootOver2222(job, 'nowallet');
  const mailed = await mailClient(job, `password: ${rooted.password}\n`);
  check(
    'the right password with no wallet completes the job and pays nothing',
    mailed.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await lastReply(job)).startsWith('That login works. You sent no wallet') &&
      (await balanceOf(job.wallet)) <= 0,
    `${rooted.detail}, mail ${mailed.status}`,
  );
};

/** The right password, on a target that no longer boots. */
const workTheBrickJob = async () => {
  const job = BRICK;
  await stage(job);

  const rooted = await rootOver2222(job, 'brick');
  const bricked = await removeAsRoot(job.target, '/boot/vmlinuz');
  const mailed = await mailClient(job, `password: ${rooted.password}\n${job.wallet}\n`);
  check(
    'a target that no longer boots refuses the right password',
    rooted.landedOn === job.target &&
      bricked.status === 200 &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith(refused(job)) &&
      (await stateOf(job)) === 'accepted',
    `${rooted.detail}, rm ${bricked.status}, mail ${mailed.status}`,
  );
};

/** The front box's password on a two-hop job: the front box is not the target. */
const workTheFrontJob = async () => {
  const job = FRONT;
  await stage(job);

  const rooted = await rootOver2222(job, 'front');
  const mailed = await mailClient(job, `password: ${rooted.password}\n${job.wallet}\n`);
  check(
    "the front box's password is refused: the front box is not the target",
    rooted.landedOn === job.front &&
      rooted.password !== '' &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith(refused(job)) &&
      (await stateOf(job)) === 'accepted' &&
      (await balanceOf(job.wallet)) <= 0,
    `${rooted.detail}, mail ${mailed.status}`,
  );
};

/** Both boxes drew one password, so the word found on the front box opens the target too. */
const workTheSharedJob = async () => {
  const job = SHARED;
  await stage(job);
  const pay = missionTerms(job.missionNumber).pay;

  const rooted = await rootOver2222(job, 'shared');
  const mailed = await mailClient(job, `password: ${rooted.password}\n${job.wallet}\n`);
  check(
    'a front box password that also opens the target pays',
    rooted.landedOn === job.front &&
      mailed.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) === pay,
    `${rooted.detail}, mail ${mailed.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
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

  await workThePaidJob();
  await workThePasswdJob();
  await workTheNoWalletJob();
  await workTheBrickJob();
  await workTheFrontJob();
  await workTheSharedJob();

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
