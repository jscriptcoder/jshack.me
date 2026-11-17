// Wire-check for A PORTFORWARD JOB: a contract whose client wants one machine behind the
// contract's router reached from outside, on a public port the briefing names, and reads the
// router for it when the contractor mails in. Driven end to end against a running `vercel dev` +
// supabase, staging each job through the REAL `scripts/hireme.ts` and working it through the REAL
// /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE ROUTER IS THE WAY IN: a public scan shows the router's own :22 and the decoys, never
//     the public port named; hydra's sweep of :22 finds the router's admin, and ssh lands root
//     on the router.
//   - THE CLIENT READS THE ROUTER ON ANY MAIL: before anything is done the reply is that the
//     port named doesn't reach the machine, and the job stays accepted.
//   - ONLY THE MACHINE, ON ITS OWN PORT, COUNTS: the router's root forwards the port named to
//     the machine on another port, then to the router's own address, and each is the same miss.
//   - THE RIGHT FORWARD PAYS ONCE: the port named sent to the machine on its own port shows on a
//     public scan as the machine's service, and the mail completes the job and mints the pay; a
//     second mail is told the job is closed.
//   - ANYONE'S FORWARD COUNTS: a second player roots the router and writes the forward; the
//     contractor, who did nothing, mails and is paid.
//   - A FORWARD GONE BEFORE THE MAIL IS A MISS, and A BRICKED ROUTER IS A MISS.
//   - Every machine's service is reached through its forward: database, cache, intranet and
//     development server, one job each.
//   - `show` names the machine, the forward asked for, the router's route and a sealed target.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionPortforward.ts
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
import { buildApGatewayBaseFs } from '../src/core/generation/routerFs.js';
import { wifiPoolOf } from '../src/core/generation/generateWifi.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { md5 } from '../src/core/generation/md5.js';
import {
  DEFAULT_WORDLIST,
  WORDLIST_PATH,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist.js';
import { missionShape } from '../src/core/missions/missionShape.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';
import { portforwardJob, type PortforwardService } from '../src/core/missions/portforwardJob.js';
import {
  isMissionNumber,
  missionAddressForNumber,
  missionEssid,
} from '../src/core/missions/missionNetwork.js';
import {
  RULES_V4_PATH,
  RULES_V4_PERMISSIONS,
  readRulesV4,
  withForward,
  type ForwardTarget,
} from '../src/core/network/iptablesRules.js';

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

const portsOf = (body: unknown): readonly { port: number; service: string }[] =>
  (field(body, 'ports') ?? []) as readonly { port: number; service: string }[];

// `shell: true` so Windows resolves `npx.cmd`; the args carry no spaces, so quoting is moot.
const runHireme = (args: readonly string[]): string =>
  execFileSync('npx', ['tsx', 'scripts/hireme.ts', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  }).trim();

const ROUTER_SSH_PORT = 22;
const RUN = Date.now().toString(36).slice(-6);

/** The service a public scan names behind each machine's forward. */
const SCANNED_AS: Readonly<Record<PortforwardService, string>> = {
  mysql: 'mysql',
  redis: 'redis',
  web: 'http',
  ssh: 'ssh',
};

/** The first portforward jobs from `from` on the machine running `service`. */
const portforwardNumbers = (
  from: number,
  count: number,
  service: PortforwardService,
): readonly number[] => {
  const found: number[] = [];
  for (let candidate = from; candidate < from + 60000 && found.length < count; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    if (missionShape(candidate).kind !== 'portforward') continue;
    if (portforwardJob(candidate).machine.service === service) found.push(candidate);
  }
  if (found.length < count) throw new Error(`only ${found.length} ${service} jobs from ${from}`);
  return found;
};

const [MAIN_JOB] = portforwardNumbers(500000, 1, 'mysql') as [number];
const [RIVAL_JOB] = portforwardNumbers(500000, 1, 'redis') as [number];
const [REMOVED_JOB] = portforwardNumbers(500000, 1, 'web') as [number];
const [BRICK_JOB] = portforwardNumbers(500000, 1, 'ssh') as [number];
const JOBS = [MAIN_JOB, RIVAL_JOB, REMOVED_JOB, BRICK_JOB] as const;

type Job = {
  readonly missionNumber: number;
  readonly label: string;
  readonly handle: string;
  readonly address: string;
  readonly gateway: string;
  readonly subnet: string;
  readonly machineIp: string;
  readonly wallet: string;
  readonly publicPort: number;
  readonly insidePort: number;
  readonly noun: string;
  readonly service: PortforwardService;
  /** The router's forwards as it generates: the decoys. */
  readonly seedRules: string;
};

const jobOf = (missionNumber: number, label: string, index: number): Job => {
  const essid = missionEssid(missionNumber);
  const { subnet } = generateHomeLan(essid);
  const { machine, publicPort } = portforwardJob(missionNumber);
  return {
    missionNumber,
    label,
    handle: `pfw${index}${RUN}`,
    address: missionAddressForNumber(missionNumber) ?? '',
    gateway: computeApGatewayId(essid),
    subnet,
    machineIp: `${subnet}.${missionShape(missionNumber).keyBox.octet}`,
    wallet: `jsc${md5(`${RUN}:${missionNumber}`)}${md5(String(missionNumber)).slice(0, 8)}`,
    publicPort,
    insidePort: machine.insidePort,
    noun: machine.noun,
    service: machine.service,
    seedRules: readRulesV4(buildApGatewayBaseFs(essid)),
  };
};

const contractor = generateIdentityIn(RIDGEMONT);
const rival = generateIdentityIn(RIDGEMONT);
const [homeEssid] = wifiPoolOf(RIDGEMONT);
const workstationOf = (player: Identity): string =>
  computeWorkstationId('newbie', player.publicKeyHex);

const MAIN = jobOf(MAIN_JOB, 'customer database', 0);
const RIVAL = jobOf(RIVAL_JOB, 'rival forward, cache server', 1);
const REMOVED = jobOf(REMOVED_JOB, 'forward removed, staff intranet', 2);
const BRICK = jobOf(BRICK_JOB, 'router bricked, development server', 3);
const ALL_JOBS = [MAIN, RIVAL, REMOVED, BRICK] as const;

const noWayIn = (job: Job): string =>
  `Port ${job.publicPort} doesn't reach their ${job.noun}. No way in, no money.`;
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

const scan = (player: Identity, job: Job) =>
  post(NETWORK, signRequest(player, 'resolvePublicScan', { target: job.address }));

/** `player` sweeps the router's own :22 for its admin and logs in as root over ssh. */
const rootTheRouter = async (player: Identity, job: Job, name: string) => {
  const sweep = await post(
    SESSIONS,
    signRequest(player, 'hydraCrack', {
      essid: homeEssid,
      target_ip: job.address,
      service: 'ssh',
      caller_machine_id: workstationOf(player),
      port: ROUTER_SSH_PORT,
    }),
  );
  const root = crackedOf(sweep.body).find(({ username }) => username === 'root');
  const shell = await post(
    SESSIONS,
    signRequest(player, 'authCreateSessionPublic', {
      session_id: `ssh-${name}-${RUN}`,
      target: job.address,
      port: ROUTER_SSH_PORT,
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

/** A root's save of the router's forwards, as `nano` writes it: the decoys as they generate,
 *  plus the port named sent to `target`, or nothing more for `null`. */
const saveForward = (player: Identity, job: Job, target: ForwardTarget | null) =>
  post(
    PATCHES,
    signRequest(player, 'upsertPatch', {
      machine_id: job.gateway,
      path: RULES_V4_PATH,
      content: withForward(job.seedRules, job.publicPort, target),
      owner: 'root',
      is_new: false,
      node_type: 'file',
      permissions: RULES_V4_PERMISSIONS,
    }),
  );

const TO_THE_MACHINE = (job: Job): ForwardTarget => ({
  internalIp: job.machineIp,
  internalPort: job.insidePort,
});

/** A root's `rm` of one file on the router, as `player`. */
const removeOnRouter = (player: Identity, job: Job, path: string) =>
  post(
    PATCHES,
    signRequest(player, 'removePatch', { machine_id: job.gateway, path, owner: 'root' }),
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
      subject: 'open',
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
  console.log(
    `\n${job.label} job ${job.missionNumber} at ${job.address}, :${job.publicPort} -> ${job.machineIp}:${job.insidePort}`,
  );
};

const cleanup = async () => {
  await sr
    .from('hireme_missions')
    .delete()
    .in('number', [...JOBS]);
  await sr.from('email_accounts').delete().eq('signed_up_by', contractor.publicKeyHex);
  await sr.from('email_sends').delete().eq('player_key', contractor.publicKeyHex);
  for (const machineId of [
    workstationOf(contractor),
    workstationOf(rival),
    ...ALL_JOBS.map(({ gateway }) => gateway),
  ]) {
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

/** Whether a public scan shows the port named answering as the machine's service. */
const scanReaches = async (player: Identity, job: Job) => {
  const scanned = await scan(player, job);
  const open = portsOf(scanned.body).find(({ port }) => port === job.publicPort);
  return {
    reaches: scanned.status === 200 && open?.service === SCANNED_AS[job.service],
    detail: `scan ${scanned.status}, :${job.publicPort} ${open?.service ?? 'closed'}`,
  };
};

/** Nothing, the wrong inside port, the router's own address, then the right forward: three
 *  misses, then paid once and closed. */
const workTheMainJob = async () => {
  const job = MAIN;
  await stage(job);
  const pay = missionTerms(job.missionNumber).pay;

  const shown = runHireme(['show', job.address]);
  check(
    'show names the machine, the forward asked for, the router route and a sealed target',
    shown.includes(
      `Kind:     portforward, ${job.noun}, :${job.publicPort} -> :${job.insidePort}`,
    ) &&
      shown.includes('Router:   hydra') &&
      shown.includes('Route:    none (sealed)'),
    shown
      .split('\n')
      .filter((line) => /Kind:|Router:|Route:/.test(line))
      .join(' | '),
  );

  const before = await scan(contractor, job);
  const beforePorts = portsOf(before.body).map(({ port }) => port);
  const decoyPorts = missionShape(job.missionNumber).forwards.map(({ publicPort }) => publicPort);
  check(
    "a public scan shows the router's :22 and the decoys, never the port named",
    before.status === 200 &&
      beforePorts.includes(ROUTER_SSH_PORT) &&
      decoyPorts.every((port) => beforePorts.includes(port)) &&
      !beforePorts.includes(job.publicPort),
    `ports [${beforePorts.join(',')}], decoys [${decoyPorts.join(',')}]`,
  );

  const early = await mailClient(job, `it is open\n${job.wallet}\n`);
  check(
    "a mail before anything is done is told the port named doesn't reach the machine",
    early.status === 200 && (await lastReply(job)).startsWith(noWayIn(job)),
    `status ${early.status}`,
  );
  check(
    'the job stays accepted and pays nothing',
    (await stateOf(job)) === 'accepted' && (await balanceOf(job.wallet)) <= 0,
    `${await stateOf(job)}`,
  );

  const rooted = await rootTheRouter(contractor, job, 'main');
  check(
    "hydra cracks the router's admin on its own :22, and ssh lands root on the router",
    rooted.landedOn === job.gateway,
    rooted.detail,
  );

  const wrongPort = await saveForward(contractor, job, {
    internalIp: job.machineIp,
    internalPort: job.insidePort + 1,
  });
  const wrongPortMail = await mailClient(job, `it is open\n${job.wallet}\n`);
  check(
    'the port named sent to the machine on another port is the same miss',
    wrongPort.status === 200 &&
      wrongPortMail.status === 200 &&
      (await lastReply(job)).startsWith(noWayIn(job)) &&
      (await stateOf(job)) === 'accepted',
    `save ${wrongPort.status}, mail ${wrongPortMail.status}`,
  );

  const toRouter = await saveForward(contractor, job, {
    internalIp: `${job.subnet}.1`,
    internalPort: job.insidePort,
  });
  const toRouterMail = await mailClient(job, `it is open\n${job.wallet}\n`);
  check(
    "the port named sent to the router's own address is the same miss",
    toRouter.status === 200 &&
      toRouterMail.status === 200 &&
      (await lastReply(job)).startsWith(noWayIn(job)) &&
      (await stateOf(job)) === 'accepted',
    `save ${toRouter.status}, mail ${toRouterMail.status}`,
  );

  const right = await saveForward(contractor, job, TO_THE_MACHINE(job));
  const reached = await scanReaches(contractor, job);
  check(
    "the right forward shows on a public scan as the machine's service",
    right.status === 200 && reached.reaches,
    `save ${right.status}, ${reached.detail}`,
  );

  const paid = await mailClient(job, `it is open\n${job.wallet}\n`);
  check(
    'the right forward completes the job and pays the quoted pay',
    paid.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) === pay,
    `mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
  );
  check(
    "the client says it's through and names the wallet",
    (await lastReply(job)).startsWith(
      `We're through. §${pay.toLocaleString('en-US')} sent to ${job.wallet}.`,
    ),
    'reply read',
  );

  const again = await mailClient(job, `once more\n${job.wallet}\n`);
  check(
    'a second mail is told the job is closed and pays nothing more',
    again.status === 200 &&
      (await lastReply(job)).startsWith(CLOSED) &&
      (await balanceOf(job.wallet)) === pay,
    `mail ${again.status}, balance ${await balanceOf(job.wallet)}`,
  );
};

/** Another player roots the router and writes the forward; the contractor is paid. */
const workTheRivalJob = async () => {
  const job = RIVAL;
  await stage(job);
  const pay = missionTerms(job.missionNumber).pay;

  const rooted = await rootTheRouter(rival, job, 'rival');
  const saved = await saveForward(rival, job, TO_THE_MACHINE(job));
  const reached = await scanReaches(rival, job);
  check(
    `a second player roots the router and forwards the port named to the ${job.noun}, which a scan reaches`,
    rooted.landedOn === job.gateway && saved.status === 200 && reached.reaches,
    `${rooted.detail}, save ${saved.status}, ${reached.detail}`,
  );

  const paid = await mailClient(job, `looks open to me\n${job.wallet}\n`);
  check(
    "the contractor's mail is paid for a forward somebody else wrote",
    paid.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) === pay,
    `mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
  );
};

/** The forward written, then taken out before the mail: a miss. */
const workTheRemovedJob = async () => {
  const job = REMOVED;
  await stage(job);

  const rooted = await rootTheRouter(contractor, job, 'removed');
  const saved = await saveForward(contractor, job, TO_THE_MACHINE(job));
  const reached = await scanReaches(contractor, job);
  const taken = await saveForward(contractor, job, null);
  const mailed = await mailClient(job, `it is open\n${job.wallet}\n`);
  check(
    `a forward to the ${job.noun} that a scan reached, taken out before the mail, is a miss`,
    rooted.landedOn === job.gateway &&
      saved.status === 200 &&
      reached.reaches &&
      taken.status === 200 &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith(noWayIn(job)) &&
      (await stateOf(job)) === 'accepted',
    `${rooted.detail}, save ${saved.status}, ${reached.detail}, remove ${taken.status}, mail ${mailed.status}`,
  );
};

/** The right forward, then the router bricked: a router that does not boot routes nothing. */
const workTheBrickJob = async () => {
  const job = BRICK;
  await stage(job);

  const rooted = await rootTheRouter(contractor, job, 'brick');
  const saved = await saveForward(contractor, job, TO_THE_MACHINE(job));
  const reached = await scanReaches(contractor, job);
  const bricked = await removeOnRouter(contractor, job, '/boot/vmlinuz');
  const mailed = await mailClient(job, `it is open\n${job.wallet}\n`);
  check(
    `the right forward to the ${job.noun}, which a scan reached, on a router bricked before the mail, is a miss`,
    rooted.landedOn === job.gateway &&
      saved.status === 200 &&
      reached.reaches &&
      bricked.status === 200 &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith(noWayIn(job)) &&
      (await stateOf(job)) === 'accepted' &&
      (await balanceOf(job.wallet)) <= 0,
    `${rooted.detail}, save ${saved.status}, ${reached.detail}, rm ${bricked.status}, mail ${mailed.status}`,
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

  await workTheMainJob();
  await workTheRivalJob();
  await workTheRemovedJob();
  await workTheBrickJob();

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
