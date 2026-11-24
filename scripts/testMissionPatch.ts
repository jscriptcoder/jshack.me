// Wire-check for A PATCH-IT JOB: white-hat work, a client hiring on behalf of its customer, one
// of whose machines runs a release with a hole that lets anyone in as root. The client hands over
// root in the briefing and reads the target's package manifest when the contractor mails in.
// Driven end to end against a running `vercel dev` + supabase, accepting through a board's REAL
// door and staging the rest through the REAL `scripts/hireme.ts`, and working each job through
// the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE BRIEFING HANDS OVER ROOT and names the machine, never the package, port, release or
//     tool; `show` names the hole and tags its row among the target's packages.
//   - THE SERVER LAYS THE HOLE: root logs in over :2222 and reads the holed release in the
//     target's /var/lib/dpkg/status.
//   - THE HOLE MOVED FORWARD through a real manifest write, as `apt upgrade <package>` makes it,
//     pays once, with thanks, and a later mail is told the job is closed.
//   - A DOWNGRADE IS STILL OPEN.
//   - A BARE `apt upgrade` IS THE COLLATERAL MISS: everything else the customer runs moved too.
//     Putting the rest back on the versions they ran then pays.
//   - NO WALLET STILL COMPLETES.
//   - A BRICKED TARGET NEVER PAYS, nor a bricked edge machine on two hops.
//   - THE HOLE IS ON THE INSIDE MACHINE on two hops: the edge word logs in over :2222, the inside
//     word from the edge machine, and patching the inside machine pays.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionPatch.ts
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
import {
  MISSION_ROUTE_DAY,
  missionShape,
  patchHole,
  type MissionShape,
} from '../src/core/missions/missionShape.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';
import { patchJob } from '../src/core/missions/targetRoles.js';
import {
  isMissionNumber,
  missionAddressForNumber,
  missionEssid,
} from '../src/core/missions/missionNetwork.js';
import {
  DPKG_STATUS_OWNER,
  DPKG_STATUS_PATH,
  DPKG_STATUS_PERMISSIONS,
  parseDpkgVersions,
  withPackageVersion,
} from '../src/core/packages/dpkgStatus.js';
import { planUpgrade } from '../src/core/cve/planUpgrade.js';
import { packageTimeline } from '../src/core/cve/packageTimeline.js';
import { gameDayAt } from '../src/core/cve/worldClock.js';
import { asEpochMs } from '../src/core/types.js';

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
// The day `apt` plays on, as the terminal's clock reads it.
const TODAY = gameDayAt(asEpochMs(Date.now()));

/** The first patch-it jobs from `from` that `wanted` accepts. */
const patchNumbers = (
  from: number,
  count: number,
  wanted: (shape: MissionShape) => boolean,
): readonly number[] => {
  const found: number[] = [];
  for (let candidate = from; candidate < from + 80000 && found.length < count; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.kind === 'patch' && wanted(shape)) found.push(candidate);
  }
  if (found.length < count) throw new Error(`only ${found.length} patch-it jobs from ${from}`);
  return found;
};

const singleHop = ({ frontBox }: MissionShape): boolean => frontBox === null;
const twoHop = ({ frontBox }: MissionShape): boolean => frontBox !== null;

const [BOARD_JOB, COLLATERAL_JOB, NO_WALLET_JOB, BRICK_JOB] = patchNumbers(
  400000,
  4,
  singleHop,
) as [number, number, number, number];
const [INSIDE_JOB, EDGE_BRICK_JOB] = patchNumbers(400000, 2, twoHop) as [number, number];
const JOBS = [
  BOARD_JOB,
  COLLATERAL_JOB,
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
  readonly holePackage: string;
  readonly holeVersion: string;
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
  const hole = patchHole(missionNumber);
  return {
    missionNumber,
    label,
    handle: `pch${index}${RUN}`,
    address: missionAddressForNumber(missionNumber) ?? '',
    essid,
    target: machineIdForLanHost(hostAt(shape.keyBox.octet), essid),
    targetIp: `${lan.subnet}.${shape.keyBox.octet}`,
    front:
      shape.frontBox === null ? null : machineIdForLanHost(hostAt(shape.frontBox.octet), essid),
    gateway: computeApGatewayId(essid),
    wallet: `jsc${md5(`${RUN}:${missionNumber}`)}${md5(String(missionNumber)).slice(0, 8)}`,
    holePackage: hole.package,
    holeVersion: hole.version,
  };
};

const contractor = generateIdentityIn(RIDGEMONT);
const [homeEssid] = wifiPoolOf(RIDGEMONT);
const workstationOf = (player: Identity): string =>
  computeWorkstationId('newbie', player.publicKeyHex);

const BOARD = jobOf(BOARD_JOB, 'taken through the board', 0);
const COLLATERAL = jobOf(COLLATERAL_JOB, 'everything upgraded', 1);
const NO_WALLET = jobOf(NO_WALLET_JOB, 'no wallet', 2);
const BRICK = jobOf(BRICK_JOB, 'target bricked', 3);
const INSIDE = jobOf(INSIDE_JOB, 'the hole on the inside machine', 4);
const EDGE_BRICK = jobOf(EDGE_BRICK_JOB, 'edge machine bricked', 5);
const ALL_JOBS = [BOARD, COLLATERAL, NO_WALLET, BRICK, INSIDE, EDGE_BRICK] as const;

const stillOpen = (job: Job): string =>
  `Their ${patchJob(job.missionNumber).role.noun} still runs the release with that hole. Still open, no money.`;
const notAllMoved = (job: Job): string =>
  `That's not all you moved. Something else on their ${patchJob(job.missionNumber).role.noun} is no longer on the version they run. No money.`;
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

/** The target's package manifest as the contractor's root session on it reads it. */
const manifestOn = async (job: Job): Promise<string | null> => {
  const viewed = await post(
    NETWORK,
    signRequest(contractor, 'resolveCrossPlayerFs', { machine_id: job.target }),
  );
  if (viewed.status !== 200) return null;
  const tree = deserializeTree((viewed.body as { tree: SerializedDirectory }).tree);
  const node = nodeAt(tree, DPKG_STATUS_PATH);
  return node?.kind === 'file' ? node.content : null;
};

/** The target's manifest rewritten by `edit` over its content as it stands, saved as `apt`
 *  saves it: a root's write of the whole file. */
const editManifest = async (job: Job, edit: (content: string) => string): Promise<number> => {
  const content = await manifestOn(job);
  if (content === null) return 0;
  const written = await post(
    PATCHES,
    signRequest(contractor, 'upsertPatch', {
      machine_id: job.target,
      path: DPKG_STATUS_PATH,
      content: edit(content),
      owner: DPKG_STATUS_OWNER,
      is_new: false,
      node_type: 'file',
      permissions: DPKG_STATUS_PERMISSIONS,
    }),
  );
  return written.status;
};

/** `apt upgrade <package>` today, or a bare `apt upgrade` with no package. */
const upgraded =
  (pkg?: string) =>
  (content: string): string =>
    planUpgrade(content, TODAY, pkg).manifest;

/** The hole's package moved back to the release before the holed one. */
const downgraded = (job: Job) => (content: string) => {
  const timeline = packageTimeline(job.holePackage, MISSION_ROUTE_DAY);
  const index = timeline.findIndex(({ version }) => version === job.holeVersion);
  return withPackageVersion(content, job.holePackage, timeline[index - 1]?.version ?? '0.0.1');
};

/** The hole's row as the manifest reads it. */
const holeVersionIn = (job: Job, content: string | null): string | undefined =>
  parseDpkgVersions(content ?? '').get(job.holePackage);

/** The contractor's mail to the job's client. */
const mailClient = (job: Job, body: string) =>
  post(
    NETWORK,
    signRequest(contractor, 'resolveMail', {
      op: 'send',
      password: 's3cret',
      handle: job.handle,
      to: missionTerms(job.missionNumber).client.handle,
      subject: 'patched',
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
  console.log(`\n${job.label} job ${job.missionNumber} at ${job.address}`);
  const briefingNumber = ((data ?? []) as readonly { number: number }[])[0]?.number ?? 0;
  return (await readMessage(job, briefingNumber))?.body ?? '';
};

/** The job accepted by the operator script; the words read from `show`, as the briefing holds
 *  them, edge machine first. */
const stage = async (job: Job): Promise<readonly string[]> => {
  await openMailbox(job);
  runHireme(['accept', job.handle, '--number', String(job.missionNumber)]);
  console.log(`\n${job.label} job ${job.missionNumber} at ${job.address}`);
  return [...runHireme(['show', job.address]).matchAll(/Login: {4}root \/ (\S+)/g)].map(
    (match) => match[1] ?? '',
  );
};

/** Staged and logged in as root on the single-hop target. */
const stageAndLogin = async (job: Job, name: string) => {
  const [word = ''] = await stage(job);
  return loginOver2222(job, word, name);
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
      `It's patched. §${pay.toLocaleString('en-US')} sent to ${job.wallet}. Thank you for the help.`,
    ) &&
    (await stateOf(job)) === 'completed' &&
    (await balanceOf(job.wallet)) === pay
  );
};

/** Taken through the board: the briefing and the report, root over :2222 reading the holed
 *  release, a mail before anything still open, a downgrade still open, then the hole moved
 *  forward, paid once and closed. */
const workTheBoardJob = async () => {
  const job = BOARD;
  const briefing = await acceptThroughBoard(job);
  const terms = missionTerms(job.missionNumber);
  const { role } = patchJob(job.missionNumber);
  const { port, program } = patchHole(job.missionNumber);
  const [word = ''] = wordsIn(briefing);

  check(
    'the briefing names the customer and the machine, hands over root, and names no package, port, release or tool',
    briefing.includes(`Our customer is ${terms.targetCompany}.`) &&
      briefing.includes(`Something on their ${role.noun} lets anyone in as root.`) &&
      briefing.includes(`  ssh root@${job.address} -p 2222\n`) &&
      wordsIn(briefing).length === 1 &&
      briefing.includes('Still open, no money. No wallet, no money.') &&
      !briefing.includes(job.holePackage) &&
      !briefing.includes(program) &&
      !briefing.includes(job.holeVersion) &&
      !new RegExp(`\\b${port}\\b`).test(briefing) &&
      !/\b(CVE|apt|upgrade)\b/i.test(briefing),
    `${briefing.length} chars, ${wordsIn(briefing).length} word(s)`,
  );

  const shown = runHireme(['show', job.address]);
  check(
    'show names the kind and the hole, the login handed over and the holed row tagged',
    shown.includes(`Kind:     patch, ${role.noun}, ${job.holePackage} ${job.holeVersion}`) &&
      shown.includes(`Login:    root / ${word}`) &&
      shown.includes(`    ${job.holePackage} ${job.holeVersion} (hole)`),
    shown
      .split('\n')
      .filter((line) => /Kind:|\(hole\)/.test(line))
      .join(' | '),
  );

  const early = await mailClient(job, `patched\n${job.wallet}\n`);
  check(
    'a mail about an untouched target says it is still open, and pays nothing',
    early.status === 200 && (await missed(job, stillOpen(job))),
    `status ${early.status}, state ${await stateOf(job)}`,
  );

  const login = await loginOver2222(job, word, 'board');
  const laid = await manifestOn(job);
  check(
    "root logs in over :2222 and reads the holed release in the target's manifest",
    login.landedOn === job.target &&
      login.userType === 'root' &&
      holeVersionIn(job, laid) === job.holeVersion,
    `ssh ${login.status}/${String(login.userType)}, ${job.holePackage} ${holeVersionIn(job, laid)}`,
  );

  const down = await editManifest(job, downgraded(job));
  const downMail = await mailClient(job, `patched\n${job.wallet}\n`);
  check(
    'the hole moved to an earlier release is still open',
    down === 200 && downMail.status === 200 && (await missed(job, stillOpen(job))),
    `write ${down}, now ${holeVersionIn(job, await manifestOn(job))}, mail ${downMail.status}`,
  );

  const moved = await editManifest(job, () => upgraded(job.holePackage)(laid ?? ''));
  const now = holeVersionIn(job, await manifestOn(job));
  const paid = await mailClient(job, `patched\n${job.wallet}\n`);
  check(
    'the hole moved forward through a write of the manifest completes the job and pays, with thanks',
    moved === 200 &&
      now !== job.holeVersion &&
      paid.status === 200 &&
      (await paidInFull(job)),
    `write ${moved}, ${job.holePackage} ${job.holeVersion} -> ${now}, mail ${paid.status}, balance ${await balanceOf(job.wallet)} (want ${terms.pay})`,
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

/** A bare `apt upgrade`: the hole closed, and everything else moved with it, the collateral
 *  miss; then the rest put back on the versions they ran, and paid. */
const workTheCollateralJob = async () => {
  const job = COLLATERAL;
  const login = await stageAndLogin(job, 'collateral');
  const laid = (await manifestOn(job)) ?? '';
  const moving = planUpgrade(laid, TODAY).upgrades.map(({ pkg }) => pkg);

  const everything = await editManifest(job, upgraded());
  const spoiled = await mailClient(job, `patched\n${job.wallet}\n`);
  check(
    'a bare apt upgrade, moving more than the hole, is the collateral miss',
    login.landedOn === job.target &&
      moving.includes(job.holePackage) &&
      moving.length > 1 &&
      everything === 200 &&
      spoiled.status === 200 &&
      (await missed(job, notAllMoved(job))),
    `${moving.length} upgraded (${moving.join(' ')}), write ${everything}, mail ${spoiled.status}`,
  );

  const restored = await editManifest(job, () => upgraded(job.holePackage)(laid));
  const paid = await mailClient(job, `patched\n${job.wallet}\n`);
  check(
    'the rest put back on the versions they ran, it pays',
    restored === 200 && paid.status === 200 && (await paidInFull(job)),
    `write ${restored}, mail ${paid.status}`,
  );
};

/** Patched and no wallet named: the job closes and nothing is paid. */
const workTheNoWalletJob = async () => {
  const job = NO_WALLET;
  const login = await stageAndLogin(job, 'no-wallet');

  const moved = await editManifest(job, upgraded(job.holePackage));
  const mailed = await mailClient(job, 'patched\n');
  check(
    'with no wallet the job completes, the client says so, and nothing is paid',
    login.landedOn === job.target &&
      moved === 200 &&
      mailed.status === 200 &&
      (await lastReply(job)).startsWith("It's patched. You sent no wallet") &&
      (await stateOf(job)) === 'completed' &&
      (await balanceOf(job.wallet)) <= 0,
    `write ${moved}, mail ${mailed.status}, state ${await stateOf(job)}`,
  );
};

/** Patched, then the target bricked: no money, and the job stays open. */
const workTheBrickJob = async () => {
  const job = BRICK;
  const login = await stageAndLogin(job, 'brick');

  const moved = await editManifest(job, upgraded(job.holePackage));
  const bricked = await removeAsRoot(job.target, '/boot/vmlinuz');
  const mailed = await mailClient(job, `patched\n${job.wallet}\n`);
  check(
    'a target that no longer boots is told it was taken down, even patched first, and stays open',
    login.landedOn === job.target &&
      moved === 200 &&
      bricked.status === 200 &&
      mailed.status === 200 &&
      (await missed(job, TOOK_IT_DOWN)),
    `write ${moved}, brick ${bricked.status}, mail ${mailed.status}`,
  );
};

/** Two hops: the edge word over :2222, the inside word from the edge machine, the inside
 *  machine patched, and paid. */
const workTheInsideJob = async () => {
  const job = INSIDE;
  const briefing = await acceptThroughBoard(job);
  const [edgeWord = '', insideWord = ''] = wordsIn(briefing);

  const edge = await loginOver2222(job, edgeWord, 'inside-edge');
  const early = await mailClient(job, `patched\n${job.wallet}\n`);
  check(
    'on two hops the briefing hands over both logins, the edge one lands on the edge machine, and the untouched target is still open',
    wordsIn(briefing).length === 2 &&
      briefing.includes(`at ${job.targetIp}. From the edge machine:`) &&
      edge.landedOn === job.front &&
      early.status === 200 &&
      (await missed(job, stillOpen(job))),
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
  const moved = await editManifest(job, upgraded(job.holePackage));
  const paid = await mailClient(job, `patched\n${job.wallet}\n`);
  check(
    'the inside word logs in from the edge machine, and the inside machine patched pays',
    inside.status === 200 &&
      landedOn === job.target &&
      moved === 200 &&
      paid.status === 200 &&
      (await paidInFull(job)),
    `ssh ${inside.status} on the target ${landedOn === job.target}, write ${moved}, mail ${paid.status}`,
  );
};

/** Two hops: the target patched, the edge machine bricked: no money. */
const workTheEdgeBrickJob = async () => {
  const job = EDGE_BRICK;
  const [edgeWord = '', insideWord = ''] = await stage(job);

  const edge = await loginOver2222(job, edgeWord, 'edge-brick');
  const inside = await loginInside(job, edge.sessionId, insideWord);
  const moved = await editManifest(job, upgraded(job.holePackage));
  const bricked = await removeAsRoot(job.front ?? '', '/boot/vmlinuz');
  const mailed = await mailClient(job, `patched\n${job.wallet}\n`);
  check(
    'a bricked edge machine on two hops is told it was taken down, the target patched or not',
    edge.landedOn === job.front &&
      inside.status === 200 &&
      moved === 200 &&
      bricked.status === 200 &&
      mailed.status === 200 &&
      (await missed(job, TOOK_IT_DOWN)),
    `ssh ${edge.status}/${inside.status}, write ${moved}, brick ${bricked.status}, mail ${mailed.status}`,
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
  await workTheCollateralJob();
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
