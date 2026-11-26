// Wire-check for A FORENSICS JOB: white-hat work, a client hiring on behalf of its customer, into
// one of whose machines someone broke. The trail lies in the rotated auth.log among internet
// scanners and the customer's own staff, and the intruder left a calling card naming the handle
// they go by. The client hands over root and pays for the handle and the address they came in
// from. Driven end to end against a running `vercel dev` + supabase, accepting through a board's
// REAL door and staging the rest through the REAL `scripts/hireme.ts`, and working each job
// through the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE DOORS READ WHEN THE OFFER WAS POSTED: the rotated log a root reads is the one the server
//     lays from the row's posted_at, every line dated before it, and `show` dates the break-in
//     from the same row.
//   - THE BRIEFING HANDS OVER ROOT AND THE TWO LINES TO SEND, and names no time, log, path, tool,
//     handle or address.
//   - THE CARD AND THE TRAIL ARE ON THE BOX: root reads the root-only card naming the handle, and
//     exactly one outside address in the log failed and then got in, at night.
//   - THE CONTRACTOR'S OWN LOGIN LANDS IN auth.log and leaves auth.log.1 as the server laid it.
//   - EVERY WRONG ANSWER IS ONE MISS: no lines, a wrong handle, a scanner's address, the card's
//     drop host, and on two hops the edge machine's inside address.
//   - THE ANSWER IS THE DRAW: the card removed by a root, the right lines still pay once, with
//     thanks, and a later mail is told the job is closed.
//   - NO WALLET STILL COMPLETES.
//   - A BRICKED TARGET NEVER PAYS, nor a bricked edge machine on two hops.
//   - ON TWO HOPS the inside machine's log shows only the edge machine, its one night login
//     minutes after the intruder's on the edge.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionForensics.ts
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
import { md5 } from '../src/core/generation/md5.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import type { Directory, FileNode } from '../src/core/filesystem/types.js';
import { missionShape } from '../src/core/missions/missionShape.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';
import { forensicsIntruder } from '../src/core/missions/forensicsTrail.js';
import { missionFiles } from '../src/core/missions/missionLeak.js';
import { requireMissionSecret } from '../src/core/missions/missionSecret.js';
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

if (!url || !serviceKey || !process.env.MISSION_KEY_SECRET) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MISSION_KEY_SECRET');
  process.exit(2);
}

// Read only to pick contracts whose card names a drop host; every answer the checks hold the
// server to is read back from `show`, the operator's own report.
const SECRET = requireMissionSecret(process.env.MISSION_KEY_SECRET);

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
const ROTATED_LOG = '/var/log/auth.log.1';
const LIVE_LOG = '/var/log/auth.log';
const RUN = Date.now().toString(36).slice(-6);
const HIREME_IP = siteAddress(HIREME_DOMAIN) ?? '';

/** The first forensics jobs from `from` on one hop or two, the first of them with a card naming
 *  a drop host when `dropHostFirst` asks for one. */
const forensicsNumbers = (
  from: number,
  count: number,
  { twoHop, dropHostFirst }: { readonly twoHop: boolean; readonly dropHostFirst: boolean },
): readonly number[] => {
  const found: number[] = [];
  for (let candidate = from; candidate < from + 80000 && found.length < count; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.kind !== 'forensics' || (shape.frontBox !== null) !== twoHop) continue;
    const namesDropHost = forensicsIntruder(candidate, SECRET).card.dropHost !== null;
    if (found.length === 0 && dropHostFirst && !namesDropHost) continue;
    found.push(candidate);
  }
  if (found.length < count) throw new Error(`only ${found.length} forensics jobs from ${from}`);
  return found;
};

const [BOARD_JOB, NO_WALLET_JOB, BRICK_JOB] = forensicsNumbers(400000, 3, {
  twoHop: false,
  dropHostFirst: true,
}) as [number, number, number];
const [INSIDE_JOB, EDGE_BRICK_JOB] = forensicsNumbers(400000, 2, {
  twoHop: true,
  dropHostFirst: false,
}) as [number, number];
const JOBS = [BOARD_JOB, NO_WALLET_JOB, BRICK_JOB, INSIDE_JOB, EDGE_BRICK_JOB] as const;

type Job = {
  readonly missionNumber: number;
  readonly label: string;
  readonly handle: string;
  readonly address: string;
  readonly essid: string;
  readonly target: string;
  readonly targetIp: string;
  readonly front: string | null;
  readonly frontIp: string | null;
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
  return {
    missionNumber,
    label,
    handle: `frn${index}${RUN}`,
    address: missionAddressForNumber(missionNumber) ?? '',
    essid,
    target: machineIdForLanHost(hostAt(shape.keyBox.octet), essid),
    targetIp: `${lan.subnet}.${shape.keyBox.octet}`,
    front:
      shape.frontBox === null ? null : machineIdForLanHost(hostAt(shape.frontBox.octet), essid),
    frontIp: shape.frontBox === null ? null : `${lan.subnet}.${shape.frontBox.octet}`,
    gateway: computeApGatewayId(essid),
    wallet: `jsc${md5(`${RUN}:${missionNumber}`)}${md5(String(missionNumber)).slice(0, 8)}`,
  };
};

const contractor = generateIdentityIn(RIDGEMONT);
const [homeEssid] = wifiPoolOf(RIDGEMONT);
const workstationOf = (player: Identity): string =>
  computeWorkstationId('newbie', player.publicKeyHex);

const BOARD = jobOf(BOARD_JOB, 'taken through the board', 0);
const NO_WALLET = jobOf(NO_WALLET_JOB, 'no wallet', 1);
const BRICK = jobOf(BRICK_JOB, 'target bricked', 2);
const INSIDE = jobOf(INSIDE_JOB, 'the target on the inside machine', 3);
const EDGE_BRICK = jobOf(EDGE_BRICK_JOB, 'edge machine bricked', 4);
const ALL_JOBS = [BOARD, NO_WALLET, BRICK, INSIDE, EDGE_BRICK] as const;

const NOT_THEM = "That's not who broke in. Wrong, no money.";
const TOOK_IT_DOWN = 'You took our machine down. No money.';
const CLOSED = 'That job is already closed.';

/** Who broke in, as the operator's report names them. */
type Intruder = {
  readonly handle: string;
  readonly origin: string;
  readonly cardPath: string;
  readonly dropHost: string | null;
  readonly breakIn: string;
};

const intruderIn = (shown: string): Intruder => {
  const named = /Intruder: (\S+) from (\S+)/.exec(shown);
  const card = /Card: {5}([^,\n]+)(?:, drop (\S+))?$/m.exec(shown);
  return {
    handle: named?.[1] ?? '',
    origin: named?.[2] ?? '',
    cardPath: card?.[1] ?? '',
    dropHost: card?.[2] ?? null,
    breakIn: /Break-in: (.+)$/m.exec(shown)?.[1] ?? '',
  };
};

const report = (named: { readonly handle: string; readonly address: string }, wallet: string) =>
  `handle: ${named.handle}\naddress: ${named.address}\n${wallet}\n`;

/** The words the briefing hands over, edge machine first. */
const wordsIn = (briefing: string): readonly string[] =>
  [...briefing.matchAll(/^ {2}password: (\S+)$/gm)].map((match) => match[1] ?? '');

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

type Login = { readonly time: number; readonly accepted: boolean; readonly from: string };

/** A log's root logins with their times, read back in the year of `postedAt` (a month past the
 *  posting's is the year before). */
const loginsIn = (log: string, postedAt: number): readonly Login[] =>
  log.split('\n').flatMap((line) => {
    const match =
      /^(\w{3}) ([ \d]\d) (\d\d):(\d\d):(\d\d) \S+ sshd\[\d+\]: (Accepted|Failed) password for root from (\S+)$/.exec(
        line,
      );
    if (match === null) return [];
    const [, month = '', day, hours, minutes, seconds, outcome, from = ''] = match;
    const posted = new Date(postedAt);
    const monthIndex = MONTHS.indexOf(month);
    const year =
      monthIndex > posted.getUTCMonth() ? posted.getUTCFullYear() - 1 : posted.getUTCFullYear();
    return [
      {
        time: Date.UTC(
          year,
          monthIndex,
          Number(day),
          Number(hours),
          Number(minutes),
          Number(seconds),
        ),
        accepted: outcome === 'Accepted',
        from,
      },
    ];
  });

/** The syslog stamp of every line, in order, read as times. */
const lineTimes = (log: string, postedAt: number): readonly number[] =>
  log
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [month = '', day = '', clock = ''] = line.split(/ +/);
      const [hours, minutes, seconds] = clock.split(':').map(Number);
      const posted = new Date(postedAt);
      const monthIndex = MONTHS.indexOf(month);
      const year =
        monthIndex > posted.getUTCMonth() ? posted.getUTCFullYear() - 1 : posted.getUTCFullYear();
      return Date.UTC(year, monthIndex, Number(day), hours, minutes, seconds);
    });

/** The addresses that failed and then got in, and those that only ever failed. */
const sortedAddresses = (logins: readonly Login[]) => {
  const addresses = [...new Set(logins.map(({ from }) => from))];
  const of = (address: string) => logins.filter(({ from }) => from === address);
  return {
    failedThenIn: addresses.filter(
      (address) =>
        of(address).some(({ accepted }) => !accepted) &&
        of(address).some(({ accepted }) => accepted),
    ),
    scanners: addresses.filter((address) => of(address).every(({ accepted }) => !accepted)),
  };
};

const stamp = (time: number): string =>
  `${new Date(time).toISOString().slice(0, 19).replace('T', ' ')} UTC`;

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

/** The contractor logs in as root over the job's :2222 with `password`. */
const loginOver2222 = async (job: Job, password: string, name: string) => {
  const sessionId = `ssh-${name}-${RUN}`;
  const shell = await post(
    SESSIONS,
    signRequest(contractor, 'authCreateSessionPublic', {
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

/** A file on `machineId` as the contractor's root session on it reads it, or undefined. */
const fileOn = async (machineId: string, path: string): Promise<FileNode | undefined> => {
  const viewed = await post(
    NETWORK,
    signRequest(contractor, 'resolveCrossPlayerFs', { machine_id: machineId }),
  );
  if (viewed.status !== 200) return undefined;
  return nodeAt(deserializeTree((viewed.body as { tree: SerializedDirectory }).tree), path);
};

const textOn = async (machineId: string, path: string): Promise<string> => {
  const node = await fileOn(machineId, path);
  return node?.kind === 'file' ? node.content : '';
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
      subject: 'found them',
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

const rowOf = async (job: Job): Promise<{ state: string | null; postedAt: number }> => {
  const { data } = await sr
    .from('hireme_missions')
    .select('state, posted_at')
    .eq('number', job.missionNumber)
    .maybeSingle();
  const row = data as { state?: string; posted_at?: string } | null;
  return { state: row?.state ?? null, postedAt: Date.parse(row?.posted_at ?? '') };
};

const stateOf = async (job: Job): Promise<string | null> => (await rowOf(job)).state;

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

/** The job accepted by the operator script; the root words and who broke in, read from `show`,
 *  edge machine first. */
const stage = async (job: Job) => {
  await openMailbox(job);
  runHireme(['accept', job.handle, '--number', String(job.missionNumber)]);
  console.log(`\n${job.label} job ${job.missionNumber} at ${job.address}`);
  const shown = runHireme(['show', job.address]);
  return {
    words: [...shown.matchAll(/Login: {4}root \/ (\S+)/g)].map((match) => match[1] ?? ''),
    intruder: intruderIn(shown),
  };
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
      `That's them. §${pay.toLocaleString('en-US')} sent to ${job.wallet}. Thank you for the help.`,
    ) &&
    (await stateOf(job)) === 'completed' &&
    (await balanceOf(job.wallet)) === pay
  );
};

/** Taken through the board: the briefing and the report, root reading the card and the trail,
 *  every miss, then the card removed and the right lines paid once and closed. */
const workTheBoardJob = async () => {
  const job = BOARD;
  const briefing = await acceptThroughBoard(job);
  const terms = missionTerms(job.missionNumber);
  const [rootWord = ''] = wordsIn(briefing);
  const shown = runHireme(['show', job.address]);
  const intruder = intruderIn(shown);
  const { postedAt } = await rowOf(job);

  check(
    'the briefing names the customer, hands over root and the two lines, and names no time, log, path, tool, handle or address',
    briefing.includes(`Our customer is ${terms.targetCompany}.`) &&
      briefing.includes('and they want to know who.') &&
      briefing.includes(`  ssh root@${job.address} -p 2222\n`) &&
      wordsIn(briefing).length === 1 &&
      briefing.includes('  handle: <the name they go by>\n') &&
      briefing.includes('  address: <the address they came in from>\n') &&
      briefing.includes('Wrong, no money. No wallet, no money.') &&
      !briefing.includes(intruder.handle) &&
      !briefing.includes(intruder.origin) &&
      !/\/var|auth\.log|\bgrep\b|\d\d:\d\d/.test(briefing),
    `${briefing.length} chars, ${wordsIn(briefing).length} word(s)`,
  );

  check(
    'show names the kind, the login, the intruder, the card with its drop host and the break-in',
    shown.includes(`Kind:     forensics, `) &&
      shown.includes(`Login:    root / ${rootWord}`) &&
      intruder.handle !== '' &&
      intruder.origin !== '' &&
      intruder.dropHost !== null &&
      /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC$/.test(intruder.breakIn),
    shown
      .split('\n')
      .filter((line) => /Kind:|Card:|Break-in:/.test(line))
      .join(' | '),
  );

  const shell = await loginOver2222(job, rootWord, 'board');
  const card = await fileOn(job.target, intruder.cardPath);
  check(
    'root logs in over :2222 and reads the root-only card naming the handle and never the origin',
    shell.landedOn === job.target &&
      shell.userType === 'root' &&
      card?.kind === 'file' &&
      `${intruder.cardPath}\n${card.content}`.includes(intruder.handle) &&
      !card.content.includes(intruder.origin) &&
      card.perms.read.join(',') === 'root',
    `ssh ${shell.status}/${String(shell.userType)}, card ${card?.kind ?? 'missing'}`,
  );

  const rotated = await textOn(job.target, ROTATED_LOG);
  const live = await textOn(job.target, LIVE_LOG);
  const times = lineTimes(rotated, postedAt);
  const logins = loginsIn(rotated, postedAt);
  const { failedThenIn, scanners } = sortedAddresses(logins);
  const breakIn = logins.find(({ from, accepted }) => from === intruder.origin && accepted);
  const laid =
    missionFiles(
      { missionNumber: job.missionNumber, role: 'key' },
      { keySecret: SECRET, rawSecrets: undefined },
      postedAt,
    ).find(({ path }) => path === ROTATED_LOG)?.content ?? '';
  check(
    'the rotated log is the one laid from the row’s posted_at, every line before it and in order',
    rotated !== '' &&
      rotated === laid &&
      times.length > 0 &&
      times.every((time, index) => time < postedAt && time >= (times[index - 1] ?? 0)),
    `${times.length} line(s), posted ${new Date(postedAt).toISOString()}`,
  );
  check(
    'one outside address failed and then got in, the origin show names, at the break-in show prints',
    failedThenIn.length === 1 &&
      failedThenIn[0] === intruder.origin &&
      breakIn !== undefined &&
      stamp(breakIn.time) === intruder.breakIn &&
      scanners.length >= 3,
    `${failedThenIn.length} got in after failing, ${scanners.length} scanner(s), break-in ${breakIn === undefined ? 'none' : stamp(breakIn.time)}`,
  );
  check(
    'the contractor’s own login landed in the live auth.log, and the rotated one is as laid',
    /Accepted password for root from /.test(live) && !live.includes(intruder.origin),
    `${live.split('\n').filter((line) => line !== '').length} live line(s)`,
  );

  const misses: readonly (readonly [string, string])[] = [
    ['no lines', `found them\n${job.wallet}\n`],
    [
      'a wrong handle',
      report({ handle: `${intruder.handle}x`, address: intruder.origin }, job.wallet),
    ],
    [
      'a scanner’s address',
      report({ handle: intruder.handle, address: scanners[0] ?? '' }, job.wallet),
    ],
    [
      'the card’s drop host',
      report({ handle: intruder.handle, address: intruder.dropHost ?? '' }, job.wallet),
    ],
  ];
  for (const [miss, body] of misses) {
    const mailed = await mailClient(job, body);
    check(
      `${miss} is not who broke in, and pays nothing`,
      mailed.status === 200 && (await missed(job, NOT_THEM)),
      `mail ${mailed.status}, state ${await stateOf(job)}`,
    );
  }

  // The answer is the draw, not the box: the card gone, the right lines still pay.
  const removed = await removeAsRoot(job.target, intruder.cardPath);
  const paid = await mailClient(
    job,
    `  Handle:  ${intruder.handle.toUpperCase()} \naddress:   ${intruder.origin}  \n${job.wallet}\n`,
  );
  check(
    'the card removed by a root, the handle in capitals and padded lines still pay, with thanks',
    removed.status === 200 && paid.status === 200 && (await paidInFull(job)),
    `rm ${removed.status}, mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${terms.pay})`,
  );

  const again = await mailClient(
    job,
    report({ handle: intruder.handle, address: intruder.origin }, job.wallet),
  );
  check(
    'a later mail is told the job is closed, and pays nothing more',
    again.status === 200 &&
      (await lastReply(job)).startsWith(CLOSED) &&
      (await balanceOf(job.wallet)) === terms.pay,
    `mail ${again.status}, balance ${await balanceOf(job.wallet)}`,
  );
};

/** The right lines with no wallet: completed, nothing minted. */
const workTheNoWalletJob = async () => {
  const job = NO_WALLET;
  const { intruder } = await stage(job);
  const mailed = await mailClient(job, `handle: ${intruder.handle}\naddress: ${intruder.origin}\n`);
  check(
    'the right lines with no wallet complete the job and mint nothing',
    mailed.status === 200 &&
      (await lastReply(job)).startsWith(
        "That's them. You sent no wallet, so there is nothing to pay. No wallet, no money.",
      ) &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) <= 0,
    `mail ${mailed.status}, state ${await stateOf(job)}`,
  );
};

/** The target bricked, then the right lines: no money, and the job stays open. */
const workTheBrickJob = async () => {
  const job = BRICK;
  const { words, intruder } = await stage(job);
  const shell = await loginOver2222(job, words[0] ?? '', 'brick');
  const bricked = await removeAsRoot(job.target, '/boot/vmlinuz');
  const mailed = await mailClient(
    job,
    report({ handle: intruder.handle, address: intruder.origin }, job.wallet),
  );
  check(
    'a target that no longer boots is told it was taken down, even with the right lines, and stays open',
    shell.landedOn === job.target &&
      bricked.status === 200 &&
      mailed.status === 200 &&
      (await missed(job, TOOK_IT_DOWN)),
    `ssh ${shell.status}, brick ${bricked.status}, mail ${mailed.status}`,
  );
};

/** Two hops: the edge word over :2222, the inside word from the edge machine, the inside log
 *  showing only the edge machine, the edge's inside address a miss, and the origin paid. */
const workTheInsideJob = async () => {
  const job = INSIDE;
  const briefing = await acceptThroughBoard(job);
  const [edgeWord = '', insideWord = ''] = wordsIn(briefing);
  const intruder = intruderIn(runHireme(['show', job.address]));
  const { postedAt } = await rowOf(job);

  const edge = await loginOver2222(job, edgeWord, 'inside-edge');
  const inside = await loginInside(job, edge.sessionId, insideWord);
  const edgeLogins = loginsIn(await textOn(job.front ?? '', ROTATED_LOG), postedAt);
  const insideLogins = loginsIn(await textOn(job.target, ROTATED_LOG), postedAt);
  const reachedEdge = edgeLogins.find(({ from, accepted }) => from === intruder.origin && accepted);
  const atNight = insideLogins.filter(
    ({ accepted, time }) => accepted && new Date(time).getUTCHours() < 6,
  );
  const hopAfter = (atNight[0]?.time ?? 0) - (reachedEdge?.time ?? 0);
  check(
    'on two hops the inside log shows only the edge machine, its one night login minutes after the intruder reached the edge',
    wordsIn(briefing).length === 2 &&
      briefing.includes(`at ${job.targetIp}. From the edge machine:`) &&
      edge.landedOn === job.front &&
      inside.status === 200 &&
      insideLogins.length > 0 &&
      insideLogins.every(({ from }) => from === job.frontIp) &&
      atNight.length === 1 &&
      hopAfter >= 2 * 60_000 &&
      hopAfter <= 9 * 60_000,
    `ssh ${edge.status}/${inside.status}, ${insideLogins.length} inside login(s), hop ${hopAfter / 1000}s after`,
  );

  const edgeAddress = await mailClient(
    job,
    report({ handle: intruder.handle, address: job.frontIp ?? '' }, job.wallet),
  );
  check(
    'the edge machine’s inside address is not who broke in',
    edgeAddress.status === 200 && (await missed(job, NOT_THEM)),
    `mail ${edgeAddress.status}`,
  );

  const paid = await mailClient(
    job,
    report({ handle: intruder.handle, address: intruder.origin }, job.wallet),
  );
  check(
    'the address the intruder came into the edge from pays',
    paid.status === 200 && (await paidInFull(job)),
    `mail ${paid.status}, balance ${await balanceOf(job.wallet)}`,
  );
};

/** Two hops: the edge machine bricked, then the right lines: no money. */
const workTheEdgeBrickJob = async () => {
  const job = EDGE_BRICK;
  const { words, intruder } = await stage(job);
  const edge = await loginOver2222(job, words[0] ?? '', 'edge-brick');
  const bricked = await removeAsRoot(job.front ?? '', '/boot/vmlinuz');
  const mailed = await mailClient(
    job,
    report({ handle: intruder.handle, address: intruder.origin }, job.wallet),
  );
  check(
    'a bricked edge machine on two hops is told it was taken down, even with the right lines',
    edge.landedOn === job.front &&
      bricked.status === 200 &&
      mailed.status === 200 &&
      (await missed(job, TOOK_IT_DOWN)),
    `ssh ${edge.status}, brick ${bricked.status}, mail ${mailed.status}`,
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
