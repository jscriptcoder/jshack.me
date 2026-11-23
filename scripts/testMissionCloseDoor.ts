// Wire-check for A CLOSE-THE-DOOR JOB: a contract whose client wants a way into one machine
// shut, one someone laid among the router's forwards, and hands over root on that router to do
// it. The client reads the router when the contractor mails in. Driven end to end against a
// running `vercel dev` + supabase, taking one job through the hireme.io board and staging the rest
// through the REAL `scripts/hireme.ts`, and working each through the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE BRIEFING, THROUGH THE BOARD: accepted at /accept, the client's briefing names the
//     machine, hands over root on the router's own address, and names no port; `show` names the
//     machine, the rogue forward and the router handed over.
//   - THE ROGUE PORT ANSWERS: a public scan shows it as the machine's service, for each machine:
//     database, cache, intranet and development server, one job each.
//   - THE WORD LOGS IN: ssh as root on the router's :22 with the word handed over lands on it.
//   - THE CLIENT READS THE ROUTER ON ANY MAIL: before anything is done the reply is that the
//     machine still answers from outside, and the job stays accepted.
//   - A DENY STOPS NO FORWARD, and A FRESH FORWARD ONTO THE MACHINE is still open.
//   - A KEPT FORWARD TAKEN WITH IT is the collateral miss, and putting it back pays once; a
//     second mail is told the job is closed.
//   - ANYONE'S CLOSING COUNTS: a second player logs in with the word and takes the rogue forward
//     out; the contractor, who did nothing, mails and is paid.
//   - NO WALLET completes and pays nothing, and A BRICKED ROUTER is the took-it-down miss.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionCloseDoor.ts
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
import { buildApGatewayBaseFs } from '../src/core/generation/routerFs.js';
import { wifiPoolOf } from '../src/core/generation/generateWifi.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { HIREME_DOMAIN } from '../src/core/generation/fixedSites.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { md5 } from '../src/core/generation/md5.js';
import { missionShape } from '../src/core/missions/missionShape.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';
import { closeDoorJob } from '../src/core/missions/closeDoorJob.js';
import type { PortforwardService } from '../src/core/missions/portforwardJob.js';
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
  withInputDeny,
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
const HIREME_IP = siteAddress(HIREME_DOMAIN) ?? '';

/** The service a public scan names behind each machine's forward. */
const SCANNED_AS: Readonly<Record<PortforwardService, string>> = {
  mysql: 'mysql',
  redis: 'redis',
  web: 'http',
  ssh: 'ssh',
};

/** The first close-the-door job from `from` on the machine running `service`. */
const closeDoorNumber = (from: number, service: PortforwardService): number => {
  for (let candidate = from; candidate < from + 60000; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    if (missionShape(candidate).kind !== 'closedoor') continue;
    if (closeDoorJob(candidate).machine.service === service) return candidate;
  }
  throw new Error(`no ${service} close-the-door job from ${from}`);
};

const JOBS = [
  closeDoorNumber(600000, 'mysql'),
  closeDoorNumber(600000, 'redis'),
  closeDoorNumber(600000, 'web'),
  closeDoorNumber(600000, 'ssh'),
] as const;

type Job = {
  readonly missionNumber: number;
  readonly label: string;
  readonly handle: string;
  readonly address: string;
  readonly gateway: string;
  readonly machineIp: string;
  readonly wallet: string;
  readonly roguePort: number;
  readonly insidePort: number;
  readonly noun: string;
  readonly service: PortforwardService;
  /** The first forward the customer wants kept. */
  readonly keptPort: number;
  /** The router's forwards as it generates: the rogue one among the kept. */
  readonly seedRules: string;
};

const jobOf = (missionNumber: number, label: string, index: number): Job => {
  const essid = missionEssid(missionNumber);
  const { subnet } = generateHomeLan(essid);
  const { machine, publicPort } = closeDoorJob(missionNumber);
  const kept = missionShape(missionNumber).forwards.find(
    (forward) => forward.publicPort !== publicPort,
  );
  return {
    missionNumber,
    label,
    handle: `cdr${index}${RUN}`,
    address: missionAddressForNumber(missionNumber) ?? '',
    gateway: computeApGatewayId(essid),
    machineIp: `${subnet}.${missionShape(missionNumber).keyBox.octet}`,
    wallet: `jsc${md5(`${RUN}:${missionNumber}`)}${md5(String(missionNumber)).slice(0, 8)}`,
    roguePort: publicPort,
    insidePort: machine.insidePort,
    noun: machine.noun,
    service: machine.service,
    keptPort: kept?.publicPort ?? 0,
    seedRules: readRulesV4(buildApGatewayBaseFs(essid)),
  };
};

const contractor = generateIdentityIn(RIDGEMONT);
const rival = generateIdentityIn(RIDGEMONT);
const [homeEssid] = wifiPoolOf(RIDGEMONT);
const workstationOf = (player: Identity): string =>
  computeWorkstationId('newbie', player.publicKeyHex);

const [BOARD_JOB, RIVAL_JOB, BRICK_JOB, NO_WALLET_JOB] = JOBS;
const BOARD = jobOf(BOARD_JOB, 'through the board, customer database', 0);
const RIVAL = jobOf(RIVAL_JOB, 'closed by a rival, cache server', 1);
const BRICK = jobOf(BRICK_JOB, 'router bricked, staff intranet', 2);
const NO_WALLET = jobOf(NO_WALLET_JOB, 'no wallet, development server', 3);
const ALL_JOBS = [BOARD, RIVAL, BRICK, NO_WALLET] as const;

const stillOpen = (job: Job): string =>
  `Their ${job.noun} still answers from outside. Still open, no money.`;
const NOT_ALL_CLOSED =
  "That's not all you closed. Something they use no longer answers from outside. No money.";
const TOOK_IT_DOWN = 'You took our machine down. No money.';
const CLOSED = 'That job is already closed.';

/** The words a briefing hands over. */
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

const scan = (player: Identity, job: Job) =>
  post(NETWORK, signRequest(player, 'resolvePublicScan', { target: job.address }));

/** `player` logs in as root on the router's own :22 with `password`. */
const loginToRouter = async (player: Identity, job: Job, password: string, name: string) => {
  const shell = await post(
    SESSIONS,
    signRequest(player, 'authCreateSessionPublic', {
      session_id: `ssh-${name}-${RUN}`,
      target: job.address,
      port: ROUTER_SSH_PORT,
      username: 'root',
      password,
      parent_session_id: null,
      source_ip: null,
      kind: 'ssh',
    }),
  );
  return { landedOn: field(shell.body, 'machine_id'), status: shell.status };
};

/** A root's save of the router's rules, as `nano` writes it: the rules as they generate, with
 *  `edit` made to them. */
const saveRules = (player: Identity, job: Job, edit: (rules: string) => string) =>
  post(
    PATCHES,
    signRequest(player, 'upsertPatch', {
      machine_id: job.gateway,
      path: RULES_V4_PATH,
      content: edit(job.seedRules),
      owner: 'root',
      is_new: false,
      node_type: 'file',
      permissions: RULES_V4_PERMISSIONS,
    }),
  );

const withoutRogue =
  (job: Job) =>
  (rules: string): string =>
    withForward(rules, job.roguePort, null);

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
      subject: 'shut',
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

const announce = (job: Job) =>
  console.log(
    `\n${job.label} job ${job.missionNumber} at ${job.address}, :${job.roguePort} -> ${job.machineIp}:${job.insidePort}`,
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
  announce(job);
  const briefingNumber = ((data ?? []) as readonly { number: number }[])[0]?.number ?? 0;
  return (await readMessage(job, briefingNumber))?.body ?? '';
};

/** The job accepted by the operator script; the router's word read from `show`. */
const stage = async (job: Job): Promise<string> => {
  await openMailbox(job);
  runHireme(['accept', job.handle, '--number', String(job.missionNumber)]);
  announce(job);
  return /Login: {4}root \/ (\S+)/.exec(runHireme(['show', job.address]))?.[1] ?? '';
};

const cleanup = async () => {
  await sr
    .from('hireme_missions')
    .delete()
    .in('number', [...JOBS]);
  // A board goes with its mail account.
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

/** A public scan of the job's address before anyone touches the router: the rogue port answers
 *  as the machine's service. */
const checkTheRoguePortAnswers = async (job: Job) => {
  const scanned = await scan(contractor, job);
  const open = portsOf(scanned.body).find(({ port }) => port === job.roguePort);
  check(
    `a public scan shows the rogue port as the ${job.noun}'s service`,
    scanned.status === 200 && open?.service === SCANNED_AS[job.service],
    `scan ${scanned.status}, :${job.roguePort} ${open?.service ?? 'closed'}`,
  );
};

/** Through the board: the briefing and the report, root on the router with the word handed
 *  over, then a deny, a fresh forward and a kept forward taken with it as misses, then the kept
 *  forward put back: paid once, and closed. */
const workTheBoardJob = async () => {
  const job = BOARD;
  const briefing = await acceptThroughBoard(job);
  const terms = missionTerms(job.missionNumber);
  const pay = terms.pay;
  const [word = ''] = wordsIn(briefing);

  check(
    'the briefing names the machine, hands over root on the router, and names no port',
    briefing.includes(`Our customer is ${terms.targetCompany}.`) &&
      briefing.includes(`Someone opened a way into their ${job.noun} from outside,`) &&
      briefing.includes(`  ssh root@${job.address}\n`) &&
      wordsIn(briefing).length === 1 &&
      briefing.includes('Still open, no money. No wallet, no money.') &&
      !briefing.includes(String(job.roguePort)) &&
      !briefing.includes('/etc'),
    `${briefing.length} chars, ${wordsIn(briefing).length} word(s)`,
  );

  const shown = runHireme(['show', job.address]);
  check(
    'show names the machine, the rogue forward, the router handed over and a sealed target',
    shown.includes(`Kind:     closedoor, ${job.noun}, :${job.roguePort} -> :${job.insidePort}`) &&
      shown.includes('Router:   none (handed over)') &&
      shown.includes(`Forward:  :${job.roguePort} -> target :${job.insidePort} (rogue)`) &&
      shown.includes(`Forward:  :${job.keptPort} -> target`) &&
      shown.includes('Route:    none (sealed)') &&
      /Login: {4}root \/ (\S+)/.exec(shown)?.[1] === word,
    shown
      .split('\n')
      .filter((line) => /Kind:|Router:|Route:|Forward:/.test(line))
      .join(' | '),
  );

  await checkTheRoguePortAnswers(job);

  const early = await mailClient(job, `it is shut\n${job.wallet}\n`);
  check(
    'a mail before anything is done is told the machine still answers from outside',
    early.status === 200 &&
      (await lastReply(job)).startsWith(stillOpen(job)) &&
      (await stateOf(job)) === 'accepted' &&
      (await balanceOf(job.wallet)) <= 0,
    `mail ${early.status}, ${await stateOf(job)}`,
  );

  const login = await loginToRouter(contractor, job, word, 'board');
  check(
    "the word handed over logs in as root on the router's own :22",
    login.status === 200 && login.landedOn === job.gateway,
    `ssh ${login.status}`,
  );

  const denied = await saveRules(contractor, job, (rules) =>
    withInputDeny(rules, job.roguePort, true),
  );
  const deniedMail = await mailClient(job, `it is shut\n${job.wallet}\n`);
  check(
    "a deny of the rogue port on the router's own filter stops no forward: still open",
    denied.status === 200 &&
      deniedMail.status === 200 &&
      (await lastReply(job)).startsWith(stillOpen(job)) &&
      (await stateOf(job)) === 'accepted',
    `save ${denied.status}, mail ${deniedMail.status}`,
  );

  const moved = await saveRules(contractor, job, (rules) =>
    withForward(withoutRogue(job)(rules), job.roguePort + 1, {
      internalIp: job.machineIp,
      internalPort: job.insidePort,
    }),
  );
  const movedMail = await mailClient(job, `it is shut\n${job.wallet}\n`);
  check(
    'the rogue forward moved to a fresh public port onto the machine: still open',
    moved.status === 200 &&
      movedMail.status === 200 &&
      (await lastReply(job)).startsWith(stillOpen(job)) &&
      (await stateOf(job)) === 'accepted',
    `save ${moved.status}, mail ${movedMail.status}`,
  );

  const tooMuch = await saveRules(contractor, job, (rules) =>
    withForward(withoutRogue(job)(rules), job.keptPort, null),
  );
  const tooMuchMail = await mailClient(job, `it is shut\n${job.wallet}\n`);
  check(
    'the rogue forward taken out with a kept one beside it is the collateral miss',
    tooMuch.status === 200 &&
      tooMuchMail.status === 200 &&
      (await lastReply(job)).startsWith(NOT_ALL_CLOSED) &&
      (await stateOf(job)) === 'accepted' &&
      (await balanceOf(job.wallet)) <= 0,
    `save ${tooMuch.status}, mail ${tooMuchMail.status}`,
  );

  const putBack = await saveRules(contractor, job, withoutRogue(job));
  const afterScan = await scan(contractor, job);
  const afterPorts = portsOf(afterScan.body).map(({ port }) => port);
  check(
    'the kept forward put back: a public scan shows it again, and no longer the rogue port',
    putBack.status === 200 &&
      afterScan.status === 200 &&
      afterPorts.includes(job.keptPort) &&
      !afterPorts.includes(job.roguePort),
    `save ${putBack.status}, ports [${afterPorts.join(',')}]`,
  );

  const paid = await mailClient(job, `it is shut\n${job.wallet}\n`);
  check(
    'the mail completes the job and pays the quoted pay',
    paid.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) === pay,
    `mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
  );
  check(
    "the client says it's shut, names the wallet and thanks the contractor",
    (await lastReply(job)).startsWith(
      `It's shut. §${pay.toLocaleString('en-US')} sent to ${job.wallet}. Thank you for the help.`,
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

/** Another player logs in with the word and takes the rogue forward out; the contractor is
 *  paid. */
const workTheRivalJob = async () => {
  const job = RIVAL;
  const word = await stage(job);
  const pay = missionTerms(job.missionNumber).pay;
  await checkTheRoguePortAnswers(job);

  const login = await loginToRouter(rival, job, word, 'rival');
  const closed = await saveRules(rival, job, withoutRogue(job));
  check(
    'a second player logs in with the word and takes the rogue forward out',
    login.landedOn === job.gateway && closed.status === 200,
    `ssh ${login.status}, save ${closed.status}`,
  );

  const paid = await mailClient(job, `looks shut to me\n${job.wallet}\n`);
  check(
    "the contractor's mail is paid for a door somebody else shut",
    paid.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) === pay,
    `mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${pay})`,
  );
};

/** The rogue forward taken out, then the router bricked: no money. */
const workTheBrickJob = async () => {
  const job = BRICK;
  const word = await stage(job);
  await checkTheRoguePortAnswers(job);

  const login = await loginToRouter(contractor, job, word, 'brick');
  const closed = await saveRules(contractor, job, withoutRogue(job));
  const bricked = await removeOnRouter(contractor, job, '/boot/vmlinuz');
  const mailed = await mailClient(job, `it is shut\n${job.wallet}\n`);
  check(
    'the rogue forward taken out on a router bricked before the mail: took it down',
    login.landedOn === job.gateway &&
      closed.status === 200 &&
      bricked.status === 200 &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith(TOOK_IT_DOWN) &&
      (await stateOf(job)) === 'accepted' &&
      (await balanceOf(job.wallet)) <= 0,
    `ssh ${login.status}, save ${closed.status}, rm ${bricked.status}, mail ${mailed.status}`,
  );
};

/** The door shut, and the mail names no wallet: completed, nothing paid. */
const workTheNoWalletJob = async () => {
  const job = NO_WALLET;
  const word = await stage(job);
  await checkTheRoguePortAnswers(job);

  const login = await loginToRouter(contractor, job, word, 'nowallet');
  const closed = await saveRules(contractor, job, withoutRogue(job));
  const mailed = await mailClient(job, 'it is shut\n');
  check(
    'a shut door mailed without a wallet completes the job and pays nothing',
    login.landedOn === job.gateway &&
      closed.status === 200 &&
      mailed.status === 200 &&
      (await stateOf(job)) === 'completed' &&
      (await lastReply(job)).startsWith(
        "It's shut. You sent no wallet, so there is nothing to pay. No wallet, no money.",
      ),
    `ssh ${login.status}, save ${closed.status}, mail ${mailed.status}, ${await stateOf(job)}`,
  );
};

const main = async () => {
  if (
    homeEssid === undefined ||
    HIREME_IP === '' ||
    ALL_JOBS.some((job) => job.address === '' || job.keptPort === 0)
  ) {
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
  await workTheBrickJob();
  await workTheNoWalletJob();

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
