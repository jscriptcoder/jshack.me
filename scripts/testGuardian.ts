// Wire-payload smoke for THE GUARDIAN REPORTS, PATCHES AND RESTORES — the operator's
// `scripts/guardian.ts report`, `patch` and `restore`, run as a child process exactly as the
// operator
// runs them, against a running `vercel dev` + supabase. A player breaks into a town's site
// through a live hole on its web server; the guardian's round closes that hole for
// everybody, and a restore brings the site back, through the REAL /api/sessions and
// /api/network endpoints the exploit and the visitor's fetch go to.
//
// Net-new under test:
//   - A PATCH IS AN APT UPGRADE. The site's manifest — as the intruder left it — moves onto
//     every fix that has shipped today, in one row written as the box itself, root's and
//     world-readable; whatever is still waiting for its fix is held.
//   - THE DOOR SHUTS. The CVE that opened a shell before the round is refused after it, and
//     the intruder already inside is left standing: a patch evicts nobody.
//   - A ROUND CHANGES THE PASSWORDS. On findit.io, the root word the bundle gives away and
//     the one a rooted player set with `passwd` both opened `ssh` before the round and are
//     refused after it; the word the guardian drew opens it, from the same pool the account
//     was born in. The file is root's as generated, and auth.log names every account changed.
//   - A SECOND ROUND THE SAME DAY MOVES NO PACKAGE, and changes the passwords again.
//   - A BRICKED BOX IS LEFT ALONE and named as needing a restore.
//   - ANY PUBLIC WEBSITE CAN BE NAMED: a shop's site and the boards' server both patch.
//   - A REFUSED ORDER TOUCHES NOTHING: an unknown name, or missing env.
//   - A RESTORE IS A REBOOT ONTO TODAY'S FIXES. The defaced, rolled-back site serves its
//     generated page again, its journal holds the patched manifest, fresh passwords with
//     their auth.log lines and a fresh boot marker, and nothing else, the intruder's shell on it is closed as `rebooted` and the hop they
//     stacked on it as `upstream_lost`, and the CVE that opened it is refused. Their foothold
//     on the network's gateway is not the site's, and stays.
//   - A BRICKED SITE COMES BACK, booting and patched; A SECOND RESTORE RUNS CLEAN; and a
//     restore that names no box, or no public website, touches nothing.
//   - A REPORT TELLS A VISIT FROM A BREAK-IN, AND WRITES NOTHING. The intruder's open
//     session, every path they wrote (the log they wiped included) and a brick each read as
//     tampered; a box visited and logged into and out of since its restore reads up to date;
//     the count behind is what the patch then moves; with no name it covers the patrol.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testGuardian.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentityIn } from '../src/test/factories/identityIn.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { wifiPoolOf } from '../src/core/generation/generateWifi.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { publisherIp } from '../src/core/generation/publisher.js';
import { PATROL, publicBox, type PublicBox } from '../src/core/guardian/publicBoxes.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { BOOT_ID_PATH } from '../src/core/boot/bootId.js';
import type { Directory, FileNode } from '../src/core/filesystem/types.js';
import {
  DPKG_STATUS_PATH,
  DPKG_STATUS_PERMISSIONS,
  parseDpkgVersions,
  readDpkgStatus,
  withPackageVersion,
} from '../src/core/packages/dpkgStatus.js';
import { exploitOutcome } from '../src/core/cve/exploitEffect.js';
import { packageTimeline, upgradeStatusFor } from '../src/core/cve/packageTimeline.js';
import { gameDayAt } from '../src/core/cve/worldClock.js';
import {
  accountAtOrAbove,
  accountsIn,
  PASSWD_PATH,
  withAccountHash,
} from '../src/core/sessions/passwdAccount.js';
import { PASSWD_FILE } from '../src/core/generation/baseFs.js';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog.js';
import { CRACKABLE_PASSWORDS, plaintextFor, UNCRACKABLE_PASSWORDS } from '../src/test/passwords.js';
import { md5 } from '../src/core/generation/md5.js';
import { asEpochMs } from '../src/core/types.js';
import { publicAddressOf } from './publicAddressOf.js';

const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const GUARDIAN_SCRIPT = 'scripts/guardian.ts';
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

const errorOf = (body: unknown): string | undefined =>
  (body as { error?: string } | null)?.error ?? undefined;

const contentOf = (body: unknown): string => {
  const content = (body as { content?: unknown } | null)?.content;
  return typeof content === 'string' ? content : '';
};

const fileAt = (tree: Directory, ...segments: readonly string[]): string | null => {
  let node: FileNode | undefined = tree;
  for (const segment of segments) {
    if (node === undefined || node.kind !== 'directory') return null;
    node = node.entries.get(segment);
  }
  return node?.kind === 'file' ? node.content : null;
};

const boxNamed = (name: string): PublicBox => {
  const box = publicBox(name);
  if (box === undefined) {
    console.error(`${name} is no public website.`);
    process.exit(2);
  }
  return box;
};

/** The day the SERVER is standing on — the one clock a wire-check cannot move. */
const today = gameDayAt(asEpochMs(Date.now()));

/** The program a box's web server runs — apache2 or nginx, whichever its manifest
 *  carries — since the hole an exploit fires through is that program's. */
const webPackageOf = (box: PublicBox): string =>
  parseDpkgVersions(readDpkgStatus(box.baseFs())).has('apache2') ? 'apache2' : 'nginx';

/** A release of `box`'s web server live TODAY whose hole stands the player in a full shell
 *  on an account the box holds, and whose fix has shipped — so today's round can close it. */
const shellReleaseOn = (box: PublicBox) => {
  const pkg = webPackageOf(box);
  const base = box.baseFs();
  return packageTimeline(pkg, today).find((release) => {
    const opened = exploitOutcome(pkg, release.version, today);
    return (
      opened?.effect === 'shell_full' &&
      accountAtOrAbove(base, opened.tier) !== undefined &&
      upgradeStatusFor(pkg, release.version, today).kind === 'upgradable'
    );
  });
};

/** The town site the intruder breaks into: the first on the patrol a shell can be opened
 *  on today and closed by today's round. Chosen against the clock, because which programs
 *  carry such a hole moves with the day. */
const SITE = PATROL.find(
  (box) =>
    box.machineId !== computeApGatewayId(box.networkKey) && shellReleaseOn(box) !== undefined,
);
if (SITE === undefined) {
  console.error(
    `No patrol site on game day ${today} has a web hole that opens a shell and has a fix.`,
  );
  process.exit(2);
}
/** Another town site, bricked by hand. */
const BRICKED = PATROL.find(
  (box) => box !== SITE && box.machineId !== computeApGatewayId(box.networkKey),
)!;
const FINDIT = boxNamed('findit.io');
const OTHERS = [FINDIT, boxNamed('kwikemart.com'), boxNamed('boards.hireme.io')];
/** The word a rooted player set on findit.io's root with `passwd`, before the round. */
const INTRUDERS_WORD = 'the-intruders-own-word';
const WEB_PORT = 80;
const SITE_IP = publisherIp(SITE.networkKey);
if (SITE_IP === undefined) {
  console.error(`${SITE.name} publishes at no address.`);
  process.exit(2);
}
const siteBase = SITE.baseFs();
const webPackage = webPackageOf(SITE);
const shellRelease = shellReleaseOn(SITE)!;
/** The page the site was generated with — what a restore must bring back. */
const generatedFrontPage = fileAt(siteBase, 'var', 'www', 'html', 'index.html');
const FRONT_PAGE = '/var/www/html/index.html';
const DEFACED = '<html><body>the guardian sleeps</body></html>\n';
const outcome = exploitOutcome(webPackage, shellRelease.version, today)!;

const attackerEssid = wifiPoolOf(RIDGEMONT).find((essid) => essid !== SITE.networkKey)!;
const attacker = generateIdentityIn(RIDGEMONT);

const runGuardian = (args: readonly string[], env: NodeJS.ProcessEnv = process.env) =>
  spawnSync(process.execPath, ['--import', 'tsx', GUARDIAN_SCRIPT, ...args], {
    env,
    encoding: 'utf8',
  });

type ManifestRow = {
  readonly writer_key: string;
  readonly content: string | null;
  readonly owner: string;
  readonly permissions: unknown;
  readonly updated_at: string;
};

const manifestRows = async (box: PublicBox): Promise<readonly ManifestRow[]> => {
  const { data, error } = await sr
    .from('patches')
    .select('writer_key, content, owner, permissions, updated_at')
    .eq('machine_id', box.machineId)
    .eq('path', DPKG_STATUS_PATH);
  if (error) throw new Error(`manifest read failed: ${error.message}`);
  return (data ?? []) as readonly ManifestRow[];
};

const guardianRow = async (box: PublicBox): Promise<ManifestRow | undefined> =>
  (await manifestRows(box)).find((row) => row.writer_key === apGatewayLogWriterKey(box.networkKey));

const rowCount = async (box: PublicBox): Promise<number> => {
  const { count, error } = await sr
    .from('patches')
    .select('path', { count: 'exact', head: true })
    .eq('machine_id', box.machineId);
  if (error) throw new Error(`row count failed: ${error.message}`);
  return count ?? 0;
};

/** Whether every package a manifest names sits where today's round leaves it: on the
 *  newest release that fixes it, or held for a fix that has not shipped. */
const fullyPatched = (content: string): boolean =>
  Array.from(parseDpkgVersions(content)).every(
    ([pkg, version]) => upgradeStatusFor(pkg, version, today).kind !== 'upgradable',
  );

const writeAsAttacker = async (box: PublicBox, path: string, content: string | null) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: box.machineId,
      path,
      content,
      owner: 'root',
      permissions: path === DPKG_STATUS_PATH ? DPKG_STATUS_PERMISSIONS : null,
      node_type: 'file',
      writer_key: attacker.publicKeyHex,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (error) throw new Error(`seed failed (${path}): ${error.message}`);
};

let fired = 0;
/** Fire the exploit, answering with the session id the client minted for it, as
 *  `msfconsole` does — the row the shell stands on. */
const fire = async () => {
  fired += 1;
  const sessionId = `guardian-${fired}-${Date.now()}`;
  const response = await post(
    SESSIONS,
    signRequest(attacker, 'exploitCreateSession', {
      session_id: sessionId,
      essid: attackerEssid,
      target_ip: SITE_IP,
      port: WEB_PORT,
      caller_machine_id: computeWorkstationId('probe', attacker.publicKeyHex),
      parent_session_id: null,
    }),
  );
  return { ...response, sessionId };
};

/** The intruder's foothold beside the site — a session seeded via service_role, standing
 *  on `machineId` and, when `parent` names one, stacked on that session. */
const seedSession = async (machineId: string, parent: string | null): Promise<string> => {
  fired += 1;
  const sessionId = `guardian-seeded-${fired}-${Date.now()}`;
  const { error } = await sr.from('sessions').insert({
    session_id: sessionId,
    player_key: attacker.publicKeyHex,
    machine_id: machineId,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid: SITE.networkKey,
    parent_session_id: parent,
  });
  if (error) throw new Error(`session seed failed: ${error.message}`);
  return sessionId;
};

/** How a session stands: `null` while open, its end reason once closed. */
const endOf = async (sessionId: string): Promise<string | null | undefined> => {
  const { data, error } = await sr
    .from('sessions')
    .select('ended_at, end_reason')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (error) throw new Error(`session read failed: ${error.message}`);
  if (data === null) return undefined;
  return data.ended_at === null ? null : (data.end_reason as string);
};

type JournalRow = {
  readonly path: string;
  readonly writer_key: string;
  readonly content: string | null;
};

const journalOf = async (box: PublicBox): Promise<readonly JournalRow[]> => {
  const { data, error } = await sr
    .from('patches')
    .select('path, writer_key, content')
    .eq('machine_id', box.machineId);
  if (error) throw new Error(`journal read failed: ${error.message}`);
  return (data ?? []) as readonly JournalRow[];
};

const CRACKABLE_HASHES: ReadonlySet<string> = new Set(CRACKABLE_PASSWORDS.map(md5));
const UNCRACKABLE_HASHES: ReadonlySet<string> = new Set(UNCRACKABLE_PASSWORDS.map(md5));

/** Whether `passwd` holds `box`'s generated accounts, in order, each on a word from the pool
 *  the account was born in. Not necessarily a different word: a redraw may land on it. */
const freshPasswords = (box: PublicBox, passwd: string): boolean => {
  const generated = accountsIn(box.baseFs());
  const rows = passwd
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split(':'));
  return (
    rows.length === generated.length &&
    generated.every(({ username, hash }, index) => {
      const [name, drawn = ''] = rows[index] ?? [];
      const pool = CRACKABLE_HASHES.has(hash) ? CRACKABLE_HASHES : UNCRACKABLE_HASHES;
      return name === username && pool.has(drawn);
    })
  );
};

type PasswdRow = {
  readonly content: string | null;
  readonly owner: string;
  readonly permissions: unknown;
  readonly updated_at: string;
};

/** The `/etc/passwd` the guardian wrote to `box`, as the box itself. */
const guardianPasswd = async (box: PublicBox): Promise<PasswdRow | undefined> => {
  const { data, error } = await sr
    .from('patches')
    .select('content, owner, permissions, updated_at')
    .eq('machine_id', box.machineId)
    .eq('path', PASSWD_PATH)
    .eq('writer_key', apGatewayLogWriterKey(box.networkKey))
    .maybeSingle();
  if (error) throw new Error(`passwd read failed: ${error.message}`);
  return (data ?? undefined) as PasswdRow | undefined;
};

/** The hash `passwd` holds for `username`. */
const hashIn = (passwd: string, username: string): string | undefined =>
  passwd
    .split('\n')
    .map((line) => line.split(':'))
    .find(([name]) => name === username)?.[1];

/** The box's auth.log as the system wrote it, under the network's key. */
const boxAuthLog = async (box: PublicBox): Promise<string> => {
  const { data, error } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', box.machineId)
    .eq('path', AUTH_LOG_PATH)
    .eq('writer_key', apGatewayLogWriterKey(box.networkKey))
    .maybeSingle();
  if (error) throw new Error(`auth.log read failed: ${error.message}`);
  return (data as { content: string | null } | null)?.content ?? '';
};

/** `ssh root@findit.io` with `password`, from the intruder's home. A login that opens is
 *  closed again at once, so it never counts as a foothold the checks below look for. */
const sshFindit = async (password: string): Promise<number> => {
  fired += 1;
  const sessionId = `guardian-ssh-${fired}-${Date.now()}`;
  const login = await post(
    SESSIONS,
    signRequest(attacker, 'authCreateSessionPublic', {
      session_id: sessionId,
      target: publicAddressOf(FINDIT.networkKey),
      username: 'root',
      password,
    }),
  );
  await sr
    .from('sessions')
    .update({ ended_at: new Date().toISOString(), end_reason: 'user_exit' })
    .eq('session_id', sessionId);
  return login.status;
};

/** Whether a box's journal is exactly what a restore leaves: today's manifest, fresh
 *  passwords with their auth.log lines, and a boot marker, all written as the box itself. */
const restoredJournal = (box: PublicBox, rows: readonly JournalRow[]): boolean =>
  rows.length === 4 &&
  rows.every((row) => row.writer_key === apGatewayLogWriterKey(box.networkKey)) &&
  rows.some((row) => row.path === BOOT_ID_PATH) &&
  rows.some((row) => row.path === PASSWD_PATH && freshPasswords(box, row.content ?? '')) &&
  rows.some((row) => row.path === AUTH_LOG_PATH) &&
  rows.some((row) => row.path === DPKG_STATUS_PATH && fullyPatched(row.content ?? ''));

/** The line a guardian run gave `box`. */
const lineFor = (run: ReturnType<typeof runGuardian>, box: PublicBox): string =>
  run.stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith(`${box.name}: `)) ?? '';

/** The account each open session on `box` was opened as, oldest first — whoever's, as a
 *  report reads them. */
const openAccountsOn = async (box: PublicBox): Promise<readonly string[]> => {
  const { data, error } = await sr
    .from('sessions')
    .select('credentials')
    .eq('machine_id', box.machineId)
    .is('ended_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`session read failed: ${error.message}`);
  return ((data ?? []) as readonly { credentials: { username: string } }[]).map(
    (row) => row.credentials.username,
  );
};

const sessionsPart = (accounts: readonly string[]): string =>
  `${accounts.length} open session${accounts.length === 1 ? '' : 's'}: ${accounts.join(', ')}`;

const fetchFrontPage = () =>
  post(
    NETWORK,
    signRequest(attacker, 'resolveHttpFetch', { target: SITE_IP, port: WEB_PORT, path: '/' }),
  );

const openSessions = async (): Promise<number> => {
  const { data, error } = await sr
    .from('sessions')
    .select('session_id')
    .eq('player_key', attacker.publicKeyHex)
    .is('ended_at', null);
  if (error) throw new Error(`session read failed: ${error.message}`);
  return data?.length ?? 0;
};

/** Every open session standing on `box`, whoever's — a local database can carry a stray
 *  one from an earlier run, and a restore closes that too. */
const openSessionsOn = async (box: PublicBox): Promise<number> => {
  const { count, error } = await sr
    .from('sessions')
    .select('session_id', { count: 'exact', head: true })
    .eq('machine_id', box.machineId)
    .is('ended_at', null);
  if (error) throw new Error(`session count failed: ${error.message}`);
  return count ?? 0;
};

const registerAttackerHome = async (): Promise<boolean> => {
  const joined = await post(
    NETWORK,
    signRequest(attacker, 'registerNetwork', {
      essid: attackerEssid,
      workstation_machine_id: computeWorkstationId('probe', attacker.publicKeyHex),
      workstation_username: 'probe',
      workstation_machine_name: 'probe',
      workstation_root_hash: md5('probe-root-secret'),
    }),
  );
  return joined.status === 200 && publicAddressOf(attackerEssid) !== null;
};

const cleanup = async () => {
  // The two boxes this check breaks into are emptied whole, as a restore would; the others
  // lose only the manifest a round wrote to them.
  for (const box of [SITE, BRICKED]) {
    await sr.from('patches').delete().eq('machine_id', box.machineId);
  }
  for (const box of OTHERS) {
    await sr
      .from('patches')
      .delete()
      .eq('machine_id', box.machineId)
      .in('path', [DPKG_STATUS_PATH, PASSWD_PATH, AUTH_LOG_PATH])
      .eq('writer_key', apGatewayLogWriterKey(box.networkKey));
    await sr
      .from('patches')
      .delete()
      .eq('machine_id', box.machineId)
      .eq('writer_key', attacker.publicKeyHex);
  }
  await sr.from('sessions').delete().eq('player_key', attacker.publicKeyHex);
  await sr.from('home_network_occupants').delete().eq('owner_key', attacker.publicKeyHex);
};

const main = async () => {
  console.log(`World day ${today}; ${SITE.name} at ${SITE_IP} (machine ${SITE.machineId})`);
  console.log(
    `Intruder walks ${webPackage} onto ${shellRelease.version}: ${outcome.cve} / ${outcome.severity} / ` +
      `${outcome.tier} / ${outcome.effect}`,
  );

  await cleanup();
  if (!(await registerAttackerHome())) {
    console.error('Could not establish the attacker’s home network.');
    process.exit(2);
  }

  // 1. THE INTRUDER IS IN, through a hole the manifest they rolled back carries.
  await writeAsAttacker(
    SITE,
    DPKG_STATUS_PATH,
    withPackageVersion(readDpkgStatus(siteBase), webPackage, shellRelease.version),
  );
  const opened = await fire();
  check(
    'before the round, the live CVE opens a shell on the site',
    opened.status === 200 && (opened.body as { cve?: string } | null)?.cve === outcome.cve,
    `status ${opened.status}, body ${JSON.stringify(opened.body).slice(0, 140)}`,
  );
  // ...and a report, before the round, names them and writes nothing.
  const rowsBeforeReport = await rowCount(SITE);
  const openBeforeReport = await openSessionsOn(SITE);
  const looked = runGuardian(['report', SITE.name]);
  const lookedLine = lineFor(looked, SITE);
  const intruders = await openAccountsOn(SITE);
  check(
    "report exits 0 and reads the site as behind and tampered: the intruder's session and manifest",
    looked.status === 0 &&
      looked.stdout.startsWith('Looking over 1 box on ') &&
      / packages? behind, tampered \(/.test(lookedLine) &&
      lookedLine.includes(`${sessionsPart(intruders)}; `) &&
      lookedLine.includes(DPKG_STATUS_PATH) &&
      looked.stdout.includes('Looked over 1 box: 1 behind, 1 tampered, 0 bricked.'),
    `exit ${looked.status}; ${looked.stdout.trim()} ${looked.stderr.trim()}`,
  );
  check(
    'a report writes nothing, and closes nothing',
    (await rowCount(SITE)) === rowsBeforeReport &&
      (await openSessionsOn(SITE)) === openBeforeReport,
    `rows ${rowsBeforeReport} → ${await rowCount(SITE)}, ` +
      `open ${openBeforeReport} → ${await openSessionsOn(SITE)}`,
  );
  const behindBefore = /: (\d+) packages? behind/.exec(lookedLine)?.[1];

  // ...and on findit.io, rooted, they set root's password with `passwd`.
  const seededRoot = accountsIn(FINDIT.baseFs()).find(({ username }) => username === 'root');
  if (seededRoot === undefined) throw new Error('findit.io has no root account');
  const seededWord = plaintextFor(seededRoot.hash);
  await writeAsAttacker(
    FINDIT,
    PASSWD_PATH,
    withAccountHash(FINDIT.baseFs(), 'root', md5(INTRUDERS_WORD)),
  );
  const ownWordBefore = await sshFindit(INTRUDERS_WORD);
  check(
    "before the round, the intruder's own root word opens findit.io",
    ownWordBefore === 200,
    `status ${ownWordBefore}`,
  );

  // 2. THE ROUND.
  const round = runGuardian(['patch', SITE.name, 'findit.io']);
  const lines = round.stdout.trim().split('\n');
  check(
    'patch exits 0 and names the round, each box and the total',
    round.status === 0 &&
      lines[0]?.startsWith('Patching 2 boxes on ') === true &&
      lines[1]?.trimStart().startsWith(`${SITE.name}: `) === true &&
      lines[2]?.trimStart().startsWith('findit.io: ') === true &&
      lines[3]?.startsWith('Patched 2 boxes: ') === true,
    `exit ${round.status}; ${JSON.stringify(lines)} ${round.stderr.trim()}`,
  );
  check(
    'the site upgrades the web server from the version the intruder left it on',
    lines[1]?.includes(`${webPackage} ${shellRelease.version} → `) === true,
    lines[1] ?? 'no line',
  );
  check(
    'the report counted behind exactly the packages the patch moved',
    behindBefore !== undefined && lines[1]?.includes(`: ${behindBefore} upgraded (`) === true,
    `report ${behindBefore} behind; ${lines[1] ?? 'no line'}`,
  );

  const written = await guardianRow(SITE);
  check(
    'one manifest row is written as the box itself, root-owned and world-readable',
    written !== undefined &&
      written.owner === 'root' &&
      JSON.stringify(written.permissions) === JSON.stringify(DPKG_STATUS_PERMISSIONS),
    written === undefined
      ? 'no row under the network key'
      : `owner ${written.owner}, permissions ${JSON.stringify(written.permissions)}`,
  );
  check(
    'every package on the site has moved onto its fix, or is held for one',
    written?.content !== null && written !== undefined && fullyPatched(written.content ?? ''),
    written === undefined ? 'no row' : `${parseDpkgVersions(written.content ?? '').size} packages`,
  );
  const finditRow = await guardianRow(boxNamed('findit.io'));
  check(
    'a fixed site named in the same round is patched the same way',
    finditRow === undefined
      ? lines[2]?.includes('up to date') === true
      : fullyPatched(finditRow.content ?? ''),
    lines[2] ?? 'no line',
  );

  // 3. THE DOOR SHUTS, AND NOBODY IS EVICTED.
  check(
    'the intruder already inside is left standing',
    (await openSessions()) === 1,
    `${await openSessions()} open`,
  );
  const refused = await fire();
  check(
    'after the round, the same CVE is refused',
    refused.status === 404 && errorOf(refused.body) === 'not_vulnerable',
    `status ${refused.status}, body ${JSON.stringify(refused.body)}`,
  );

  // 3b. THE PASSWORDS CHANGE.
  const sitePasswd = await guardianPasswd(SITE);
  const finditPasswd = await guardianPasswd(FINDIT);
  const asGenerated = (box: PublicBox, row: PasswdRow | undefined): boolean =>
    row !== undefined &&
    row.owner === 'root' &&
    JSON.stringify(row.permissions) === JSON.stringify(PASSWD_FILE) &&
    freshPasswords(box, row.content ?? '');
  check(
    "both boxes' /etc/passwd is root's as generated, each account on a word from its own pool",
    asGenerated(SITE, sitePasswd) && asGenerated(FINDIT, finditPasswd),
    `site ${sitePasswd === undefined ? 'no row' : `owner ${sitePasswd.owner}`}, ` +
      `findit ${finditPasswd === undefined ? 'no row' : `owner ${finditPasswd.owner}`}`,
  );
  check(
    'the patch line names the passwords it changed, and the total counts them',
    / \d+ passwords? changed$/.test(lines[1] ?? '') &&
      / 1 password changed$/.test(lines[2] ?? '') &&
      / passwords changed\.$/.test(lines[3] ?? ''),
    JSON.stringify(lines),
  );
  const ownWordAfter = await sshFindit(INTRUDERS_WORD);
  check(
    "after the round, the intruder's own word is refused",
    ownWordAfter === 401,
    `status ${ownWordAfter}`,
  );
  const drawnHash = hashIn(finditPasswd?.content ?? '', 'root');
  const redrawn = drawnHash === seededRoot.hash;
  const seededAfter = await sshFindit(seededWord);
  check(
    'the word the bundle gives away is refused (unless the round happened to draw it again)',
    redrawn ? seededAfter === 200 : seededAfter === 401,
    `status ${seededAfter}${redrawn ? ' — the round drew the seeded word again' : ''}`,
  );
  const drawnLogin = drawnHash === undefined ? 0 : await sshFindit(plaintextFor(drawnHash));
  check('the word the guardian drew opens it', drawnLogin === 200, `status ${drawnLogin}`);
  const finditLog = await boxAuthLog(FINDIT);
  check(
    "findit.io's auth.log says, as passwd says it, that root's password changed",
    / passwd\[\d+\]: password changed for root$/m.test(finditLog),
    finditLog.trim().split('\n').slice(-3).join(' | ') || '(empty log)',
  );

  // 4. A SECOND ROUND THE SAME DAY MOVES NO PACKAGE, AND CHANGES THE PASSWORDS AGAIN.
  const again = runGuardian(['patch', SITE.name]);
  const after = await guardianRow(SITE);
  const passwdAgain = await guardianPasswd(SITE);
  check(
    'a second round the same day moves no package and changes the passwords again',
    again.status === 0 &&
      lineFor(again, SITE).startsWith(`${SITE.name}: up to date, `) &&
      / \d+ passwords? changed$/.test(lineFor(again, SITE)) &&
      after?.updated_at === written?.updated_at &&
      passwdAgain !== undefined &&
      passwdAgain.updated_at !== sitePasswd?.updated_at,
    `exit ${again.status}; ${lineFor(again, SITE)}; ` +
      `manifest ${written?.updated_at} → ${after?.updated_at}, ` +
      `passwd ${sitePasswd?.updated_at} → ${passwdAgain?.updated_at}`,
  );

  // 5. A BRICKED BOX IS LEFT ALONE.
  await writeAsAttacker(BRICKED, '/boot/vmlinuz', null);
  const bricked = runGuardian(['patch', BRICKED.name]);
  check(
    'a bricked site is named as needing a restore, and nothing is written to it',
    bricked.status === 0 &&
      bricked.stdout.includes(`${BRICKED.name}: bricked — restore it to bring it back`) &&
      (await guardianRow(BRICKED)) === undefined &&
      (await guardianPasswd(BRICKED)) === undefined,
    `exit ${bricked.status}; ${bricked.stdout.trim()}`,
  );
  const brickedReport = runGuardian(['report', BRICKED.name]);
  check(
    'a report reads the bricked site as bricked and tampered, with the write that killed it',
    brickedReport.status === 0 &&
      lineFor(brickedReport, BRICKED) ===
        `${BRICKED.name}: bricked, tampered (1 path written: /boot/vmlinuz)` &&
      brickedReport.stdout.includes('Looked over 1 box: 0 behind, 1 tampered, 1 bricked.'),
    `exit ${brickedReport.status}; ${brickedReport.stdout.trim()} ${brickedReport.stderr.trim()}`,
  );

  // 6. ANY PUBLIC WEBSITE CAN BE NAMED.
  const shop = runGuardian(['patch', 'kwikemart.com', 'boards.hireme.io']);
  check(
    "a shop's site and the boards' server both resolve and patch",
    shop.status === 0 &&
      shop.stdout.includes('kwikemart.com: ') &&
      shop.stdout.includes('boards.hireme.io: ') &&
      shop.stdout.includes('Patched 2 boxes: '),
    `exit ${shop.status}; ${shop.stdout.trim()} ${shop.stderr.trim()}`,
  );

  // 7. A REFUSED ORDER TOUCHES NOTHING.
  const before = await rowCount(SITE);
  const unknown = runGuardian(['patch', SITE.name, 'nowhere.example']);
  const noEnv = runGuardian(['patch', SITE.name], { ...process.env, SUPABASE_URL: '' });
  check(
    'an unknown name, or missing env, exits 2 having written nothing',
    unknown.status === 2 &&
      unknown.stderr.includes('nowhere.example is no public website') &&
      noEnv.status === 2 &&
      (await rowCount(SITE)) === before,
    `unknown exit ${unknown.status} (${unknown.stderr.trim().split('\n')[0]}), no-env exit ${noEnv.status}`,
  );

  // 8. THE SITE FALLS AGAIN — rolled back, defaced, and held three ways.
  await writeAsAttacker(
    SITE,
    DPKG_STATUS_PATH,
    withPackageVersion(readDpkgStatus(siteBase), webPackage, shellRelease.version),
  );
  await writeAsAttacker(SITE, FRONT_PAGE, DEFACED);
  // ...and wipes their trail out of the box's log.
  await writeAsAttacker(SITE, '/var/log/auth.log', '');
  const reopened = await fire();
  const shellId = reopened.sessionId;
  const hopId = await seedSession(boxNamed('findit.io').machineId, shellId);
  const gatewayId = await seedSession(computeApGatewayId(SITE.networkKey), null);
  const defaced = await fetchFrontPage();
  check(
    'the site falls again: a shell on it, and its front page defaced for every visitor',
    reopened.status === 200 && contentOf(defaced.body) === DEFACED,
    `exploit ${reopened.status}, session ${shellId}, ` +
      `page ${contentOf(defaced.body).slice(0, 60)}`,
  );
  const fallen = runGuardian(['report', SITE.name]);
  const fallenLine = lineFor(fallen, SITE);
  check(
    'a report names every account open on the fallen site and every path written, the log too',
    fallen.status === 0 &&
      fallenLine.includes(
        `tampered (${sessionsPart(await openAccountsOn(SITE))}; 3 paths written: `,
      ) &&
      fallenLine.endsWith(`: ${DPKG_STATUS_PATH}, /var/log/auth.log, ${FRONT_PAGE})`),
    `exit ${fallen.status}; ${fallenLine} ${fallen.stderr.trim()}`,
  );

  // 9. THE RESTORE.
  // Everything on the box, and the one hop stacked on it.
  const closedSessions = (await openSessionsOn(SITE)) + 1;
  const removedRows = await rowCount(SITE);
  const restored = runGuardian(['restore', SITE.name]);
  const restoreLines = restored.stdout.trim().split('\n');
  check(
    'restore exits 0 and names the box, what it threw off and wiped, and the total',
    restored.status === 0 &&
      restoreLines[0]?.startsWith('Restoring 1 box on ') === true &&
      restoreLines[1]
        ?.trimStart()
        .startsWith(
          `${SITE.name}: restored (${closedSessions} sessions closed, ${removedRows} rows removed), `,
        ) === true &&
      restoreLines[2] === 'Restored 1 box.',
    `exit ${restored.status}; ${JSON.stringify(restoreLines)} ${restored.stderr.trim()}`,
  );
  const journal = await journalOf(SITE);
  check(
    "the site's journal holds today's manifest, fresh passwords and a boot marker, as the box itself",
    restoredJournal(SITE, journal),
    JSON.stringify(journal.map(({ path, writer_key }) => ({ path, writer_key }))),
  );
  const back = await fetchFrontPage();
  check(
    'the site serves its generated front page again',
    generatedFrontPage !== null && contentOf(back.body) === generatedFrontPage,
    contentOf(back.body).slice(0, 80) || `status ${back.status}`,
  );
  const ends = [await endOf(shellId), await endOf(hopId), await endOf(gatewayId)];
  check(
    'the shell on the site ends rebooted, the hop on it upstream_lost, and the gateway stays',
    ends[0] === 'rebooted' && ends[1] === 'upstream_lost' && ends[2] === null,
    `shell ${ends[0]}, hop ${ends[1]}, gateway ${ends[2] === null ? 'open' : ends[2]}`,
  );
  const shut = await fire();
  check(
    'after the restore, the CVE that opened the shell is refused',
    shut.status === 404 && errorOf(shut.body) === 'not_vulnerable',
    `status ${shut.status}, body ${JSON.stringify(shut.body)}`,
  );

  // 10. TWICE IS HARMLESS — what the visits since have logged goes with the rest.
  const loggedSince = await rowCount(SITE);
  const twice = runGuardian(['restore', SITE.name]);
  check(
    'a second restore runs clean and leaves the same four rows',
    twice.status === 0 &&
      twice.stdout.includes(
        `${SITE.name}: restored (0 sessions closed, ${loggedSince} rows removed), `,
      ) &&
      restoredJournal(SITE, await journalOf(SITE)),
    `exit ${twice.status}; ${twice.stdout.trim().split('\n')[1] ?? ''} ${twice.stderr.trim()}`,
  );
  // A visitor since: a page fetched, a login and a logout. The box logs them; none of it is
  // a break-in.
  await fetchFrontPage();
  const visit = await seedSession(SITE.machineId, null);
  await sr
    .from('sessions')
    .update({ ended_at: new Date().toISOString(), end_reason: 'user_exit' })
    .eq('session_id', visit);
  const visitedRows = await rowCount(SITE);
  const visited = runGuardian(['report', SITE.name]);
  check(
    'a report reads the restored site, visited since, as up to date and untouched',
    visitedRows > 4 &&
      visited.status === 0 &&
      lineFor(visited, SITE) === `${SITE.name}: up to date` &&
      visited.stdout.includes('Looked over 1 box: 0 behind, 0 tampered, 0 bricked.'),
    `${visitedRows} rows; exit ${visited.status}; ${visited.stdout.trim()} ${visited.stderr.trim()}`,
  );

  // 11. A BRICKED SITE COMES BACK.
  const revived = runGuardian(['restore', BRICKED.name]);
  check(
    'the bricked site comes back booting and patched',
    revived.status === 0 && restoredJournal(BRICKED, await journalOf(BRICKED)),
    `exit ${revived.status}; ${revived.stdout.trim().split('\n')[1] ?? ''} ` +
      revived.stderr.trim(),
  );

  // 12. A RESTORE NAMES ITS BOXES.
  await writeAsAttacker(SITE, FRONT_PAGE, DEFACED);
  const standing = await rowCount(SITE);
  const unnamed = runGuardian(['restore']);
  const nowhere = runGuardian(['restore', SITE.name, 'nowhere.example']);
  const bare = runGuardian(['restore', SITE.name], { ...process.env, SUPABASE_URL: '' });
  check(
    'a restore naming no box or no public website, or without env, exits 2 touching nothing',
    unnamed.status === 2 &&
      unnamed.stderr.includes('restore names the boxes it restores') &&
      nowhere.status === 2 &&
      nowhere.stderr.includes('nowhere.example is no public website') &&
      bare.status === 2 &&
      (await rowCount(SITE)) === standing,
    `no name exit ${unnamed.status}, unknown exit ${nowhere.status}, no-env exit ${bare.status}`,
  );

  // 13. A REPORT COVERS THE PATROL, AND REFUSES AN ORDER AS A PATCH DOES.
  const patrol = runGuardian(['report']);
  const patrolLines = patrol.stdout.trim().split('\n');
  check(
    'a report with no name reads every patrol box, one line each, then the total',
    patrol.status === 0 &&
      patrolLines.length === PATROL.length + 2 &&
      patrolLines[0]?.startsWith(`Looking over ${PATROL.length} boxes on `) === true &&
      PATROL.every((box, index) =>
        patrolLines[index + 1]?.trimStart().startsWith(`${box.name}: `),
      ) &&
      patrolLines.at(-1)?.startsWith(`Looked over ${PATROL.length} boxes: `) === true,
    `exit ${patrol.status}; ${patrolLines.length} lines; ${patrolLines.at(-1)} ` +
      patrol.stderr.trim(),
  );
  const unreadable = runGuardian(['report', SITE.name, 'nowhere.example']);
  const unconfigured = runGuardian(['report', SITE.name], { ...process.env, SUPABASE_URL: '' });
  check(
    'a report naming no public website, or without env, exits 2',
    unreadable.status === 2 &&
      unreadable.stderr.includes('nowhere.example is no public website') &&
      unconfigured.status === 2,
    `unknown exit ${unreadable.status}, no-env exit ${unconfigured.status}`,
  );

  await cleanup();

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
