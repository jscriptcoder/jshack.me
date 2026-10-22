// Wire-payload smoke for THE GUARDIAN PATCHES — the operator's `scripts/guardian.ts patch`,
// run as a child process exactly as the operator runs it, against a running `vercel dev` +
// supabase. A player breaks into a town's site through a live hole on its web server; the
// guardian's round closes that hole for everybody, through the REAL /api/sessions endpoint
// the exploit fires at.
//
// Net-new under test:
//   - A PATCH IS AN APT UPGRADE. The site's manifest — as the intruder left it — moves onto
//     every fix that has shipped today, in one row written as the box itself, root's and
//     world-readable; whatever is still waiting for its fix is held.
//   - THE DOOR SHUTS. The CVE that opened a shell before the round is refused after it, and
//     the intruder already inside is left standing: a patch evicts nobody.
//   - A SECOND ROUND THE SAME DAY WRITES NOTHING, and says so.
//   - A BRICKED BOX IS LEFT ALONE and named as needing a restore.
//   - ANY PUBLIC WEBSITE CAN BE NAMED: a shop's site and the boards' server both patch.
//   - A REFUSED ORDER TOUCHES NOTHING: an unknown name, or missing env.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testGuardian.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { crackableEssidPool } from '../src/core/generation/generateWifi.js';
import { publisherIp } from '../src/core/generation/publisher.js';
import { PATROL, publicBox, type PublicBox } from '../src/core/guardian/publicBoxes.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
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
import { accountAtOrAbove } from '../src/core/sessions/passwdAccount.js';
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
const OTHERS = [boxNamed('findit.io'), boxNamed('kwikemart.com'), boxNamed('boards.hireme.io')];
const WEB_PORT = 80;
const SITE_IP = publisherIp(SITE.networkKey);
if (SITE_IP === undefined) {
  console.error(`${SITE.name} publishes at no address.`);
  process.exit(2);
}
const siteBase = SITE.baseFs();
const webPackage = webPackageOf(SITE);
const shellRelease = shellReleaseOn(SITE)!;
const outcome = exploitOutcome(webPackage, shellRelease.version, today)!;

const attackerEssid = crackableEssidPool.find((essid) => essid !== SITE.networkKey)!;
const attacker = generateIdentity();

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
const fire = async () => {
  fired += 1;
  return post(
    SESSIONS,
    signRequest(attacker, 'exploitCreateSession', {
      session_id: `guardian-${fired}-${Date.now()}`,
      essid: attackerEssid,
      target_ip: SITE_IP,
      port: WEB_PORT,
      caller_machine_id: computeWorkstationId('probe', attacker.publicKeyHex),
      parent_session_id: null,
    }),
  );
};

const openSessions = async (): Promise<number> => {
  const { data, error } = await sr
    .from('sessions')
    .select('session_id')
    .eq('player_key', attacker.publicKeyHex)
    .is('ended_at', null);
  if (error) throw new Error(`session read failed: ${error.message}`);
  return data?.length ?? 0;
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
      .eq('path', DPKG_STATUS_PATH)
      .eq('writer_key', apGatewayLogWriterKey(box.networkKey));
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

  // 4. A SECOND ROUND THE SAME DAY WRITES NOTHING.
  const again = runGuardian(['patch', SITE.name]);
  const after = await guardianRow(SITE);
  check(
    'a second round the same day says up to date and writes nothing',
    again.status === 0 &&
      again.stdout.includes(`${SITE.name}: up to date`) &&
      after?.updated_at === written?.updated_at,
    `exit ${again.status}; ${again.stdout.trim().split('\n')[1] ?? ''}; ` +
      `updated_at ${written?.updated_at} → ${after?.updated_at}`,
  );

  // 5. A BRICKED BOX IS LEFT ALONE.
  await writeAsAttacker(BRICKED, '/boot/vmlinuz', null);
  const bricked = runGuardian(['patch', BRICKED.name]);
  check(
    'a bricked site is named as needing a restore, and nothing is written to it',
    bricked.status === 0 &&
      bricked.stdout.includes(`${BRICKED.name}: bricked — restore it to bring it back`) &&
      (await guardianRow(BRICKED)) === undefined,
    `exit ${bricked.status}; ${bricked.stdout.trim()}`,
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

  await cleanup();

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
