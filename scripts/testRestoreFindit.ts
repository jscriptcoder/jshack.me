// Wire-payload smoke for FINDIT FALLS AND COMES BACK — findit.io rooted through the REAL
// /api/sessions endpoint, read and defaced through the REAL /api/network and /api/patches
// endpoints, then put back by the operator's `scripts/restoreFindit.ts`, run as a child
// process exactly as the operator runs it. Against a running `vercel dev` + supabase.
//
// Net-new under test:
//   - THE LOG IS THE PRIZE. A player holding root on findit reads its `access.log`, and
//     another player's search is there as `/?q=<term>` under that player's own address.
//   - THE FRONT DOOR IS FINDIT'S OWN FILE. Rewriting `/var/www/html/index.html` changes
//     what every other player's `curl findit.io` gets, while a search is still answered.
//   - THE RESTORE IS A REBOOT. After the script, findit serves its generated front page
//     again, its journal holds one fresh boot marker and nothing else, every session on it
//     is closed as `rebooted`, and the intruder's next write is refused.
//   - THE SCRIPT IS SAFE TO REPEAT, and will not run without its env.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testRestoreFindit.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { crackableEssidPool } from '../src/core/generation/generateWifi';
import { siteAddress } from '../src/core/generation/publisher';
import { buildFinditFs, FINDIT_DOMAIN, FINDIT_NETWORK } from '../src/core/generation/findit';
import { FINDIT_FRONT_PAGE } from '../src/core/findit/page';
import { WEB_PAGE_FILE } from '../src/core/generation/baseFs';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter';
import { BOOT_ID_PATH } from '../src/core/boot/bootId';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import {
  DPKG_STATUS_PATH,
  DPKG_STATUS_PERMISSIONS,
  readDpkgStatus,
  withPackageVersion,
} from '../src/core/packages/dpkgStatus';
import { exploitOutcome } from '../src/core/cve/exploitEffect';
import { packageTimeline } from '../src/core/cve/packageTimeline';
import { gameDayAt } from '../src/core/cve/worldClock';
import { md5 } from '../src/core/generation/md5';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec';
import type { Directory, FileNode } from '../src/core/filesystem/types';
import { asEpochMs } from '../src/core/types';

const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
const RESTORE_SCRIPT = 'scripts/restoreFindit.ts';
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

const post = async (endpoint: string, envelope: unknown): Promise<{ status: number; body: unknown }> => {
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

const treeOf = (body: unknown): Directory | null => {
  const tree = (body as { tree?: SerializedDirectory } | null)?.tree;
  return tree ? deserializeTree(tree) : null;
};

const fileAt = (tree: Directory | null, ...segments: readonly string[]): string | null => {
  let node: FileNode | undefined = tree ?? undefined;
  for (const segment of segments) {
    if (node === undefined || node.kind !== 'directory') return null;
    node = node.entries.get(segment);
  }
  return node?.kind === 'file' ? node.content : null;
};

/** The day the SERVER is standing on — the one clock a wire-check cannot move, so the
 *  release findit is walked onto is chosen against it. */
const today = gameDayAt(asEpochMs(Date.now()));

const FINDIT_IP = siteAddress(FINDIT_DOMAIN);
if (FINDIT_IP === undefined) {
  console.error('findit publishes nothing — the world is unusable.');
  process.exit(2);
}
const finditMachineId = computeApGatewayId(FINDIT_NETWORK);
const finditFs = buildFinditFs();

/** A door findit keeps whose daemon, walked onto a release live TODAY, opens a full shell.
 *  Any granted tier does: findit holds only root, so the shell stands on root whatever the
 *  tier, and its `access.log` is world-readable — reading the prize needs a shell, not a
 *  privilege. (A ROOT-tier hole, which the defacement write would need, is on the world's
 *  schedule and not open at this day, so the defaced state is seeded below rather than
 *  written live — decision 122.) */
const door = [SERVICE_CATALOG.http, SERVICE_CATALOG.ssh]
  .flatMap((spec) =>
    packageTimeline(spec.package, today).map((release) => ({
      spec,
      version: release.version,
      outcome: exploitOutcome(spec.package, release.version, today),
    })),
  )
  .find(({ outcome }) => outcome?.effect === 'shell_full');
if (door === undefined) {
  console.error(`Nothing findit runs has a release on game day ${today} that opens a shell.`);
  process.exit(2);
}

/** The intruder and the searcher, each on a network of their own so the log has an
 *  address to name them by. */
const attacker = generateIdentity();
const searcher = generateIdentity();
const [attackerEssid, searcherEssid] = crackableEssidPool;
const TERM = `quokka${Date.now().toString(36)}`;
const DEFACED = '<html><head><title>owned</title></head><body>findit was here</body></html>\n';
const FRONT_PAGE = '/var/www/html/index.html';

const registerHome = async (
  player: ReturnType<typeof generateIdentity>,
  essid: string,
  name: string,
): Promise<string | null> => {
  await post(
    NETWORK,
    signRequest(player, 'registerNetwork', {
      essid,
      workstation_machine_id: computeWorkstationId(name, player.publicKeyHex),
      workstation_username: name,
      workstation_machine_name: name,
      workstation_root_hash: md5(`${name}-root-secret`),
    }),
  );
  const { data } = await sr
    .from('network_public_ips')
    .select('public_ip')
    .eq('essid', essid)
    .maybeSingle();
  return (data as { public_ip: string } | null)?.public_ip ?? null;
};

const fetchFindit = (player: ReturnType<typeof generateIdentity>, path: string) =>
  post(NETWORK, signRequest(player, 'resolveHttpFetch', { target: FINDIT_IP, port: 80, path }));

const writeFrontPage = (content: string) =>
  post(
    PATCHES,
    signRequest(attacker, 'upsertPatch', {
      machine_id: finditMachineId,
      path: FRONT_PAGE,
      content,
      owner: 'root',
      permissions: WEB_PAGE_FILE,
      node_type: 'file',
    }),
  );

/** The rooted attacker's write, seeded via service_role — the world will produce it once a
 *  root-granting window opens on findit's schedule (decision 122). Attributed to the
 *  attacker, the writer a real rooted write would carry, so restore deleting it proves the
 *  delete reaches every writer's rows. */
const seedDefacement = async (content: string) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: finditMachineId,
      path: FRONT_PAGE,
      content,
      owner: 'root',
      permissions: WEB_PAGE_FILE,
      node_type: 'file',
      writer_key: attacker.publicKeyHex,
      is_new: false,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (error) throw new Error(`defacement seed failed: ${error.message}`);
};

const finditJournal = async (): Promise<readonly { path: string; writer_key: string }[]> => {
  const { data, error } = await sr
    .from('patches')
    .select('path, writer_key')
    .eq('machine_id', finditMachineId);
  if (error) throw new Error(`journal read failed: ${error.message}`);
  return (data ?? []) as readonly { path: string; writer_key: string }[];
};

const attackerSessions = async (): Promise<readonly { ended_at: string | null; end_reason: string | null }[]> => {
  const { data, error } = await sr
    .from('sessions')
    .select('ended_at, end_reason')
    .eq('player_key', attacker.publicKeyHex)
    .eq('machine_id', finditMachineId);
  if (error) throw new Error(`session read failed: ${error.message}`);
  return (data ?? []) as readonly { ended_at: string | null; end_reason: string | null }[];
};

const restore = (env: NodeJS.ProcessEnv = process.env) =>
  spawnSync(process.execPath, ['--import', 'tsx', RESTORE_SCRIPT], { env, encoding: 'utf8' });

const cleanup = async () => {
  for (const player of [attacker, searcher]) {
    await sr.from('sessions').delete().eq('player_key', player.publicKeyHex);
    await sr.from('home_network_occupants').delete().eq('owner_key', player.publicKeyHex);
  }
  await sr.from('patches').delete().eq('machine_id', finditMachineId);
};

const main = async () => {
  console.log(`World day ${today}; findit.io at ${FINDIT_IP} (machine ${finditMachineId})`);
  console.log(
    `Walked onto ${door.spec.package}@${door.version}: ${door.outcome?.cve} / ${door.outcome?.effect} / ` +
      `${door.outcome?.tier}`,
  );

  await cleanup();
  const searcherIp = await registerHome(searcher, searcherEssid!, 'seeker');
  const attackerIp = await registerHome(attacker, attackerEssid!, 'intruder');
  if (searcherIp === null || attackerIp === null) {
    console.error('Could not establish both players’ home networks — nothing to name them by.');
    process.exit(2);
  }
  console.log(`Searcher on ${searcherEssid} at ${searcherIp}; intruder on ${attackerEssid} at ${attackerIp}\n`);

  // 1. SOMEBODY SEARCHES.
  const searched = await fetchFindit(searcher, `/?q=${TERM}`);
  check('the searcher’s search is answered', searched.status === 200, `status ${searched.status}`);

  // 2. FINDIT FALLS.
  const { error: seedError } = await sr.from('patches').upsert(
    {
      machine_id: finditMachineId,
      path: DPKG_STATUS_PATH,
      content: withPackageVersion(readDpkgStatus(finditFs), door.spec.package, door.version),
      owner: 'root',
      permissions: DPKG_STATUS_PERMISSIONS,
      node_type: 'file',
      writer_key: attacker.publicKeyHex,
      is_new: true,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (seedError) throw new Error(`manifest seed failed: ${seedError.message}`);
  const opened = await post(
    SESSIONS,
    signRequest(attacker, 'exploitCreateSession', {
      session_id: `exploit-findit-${Date.now()}`,
      essid: attackerEssid,
      target_ip: FINDIT_IP,
      port: door.spec.defaultPort,
      parent_session_id: null,
    }),
  );
  check(
    'a live hole in what findit runs opens a root shell on it',
    opened.status === 200 && (opened.body as { ok?: boolean } | null)?.ok === true,
    `status ${opened.status}, body ${JSON.stringify(opened.body).slice(0, 160)}`,
  );

  // 3. THE PRIZE: WHO SEARCHED FOR WHAT, FROM WHERE.
  const read = await post(NETWORK, signRequest(attacker, 'resolveCrossPlayerFs', { machine_id: finditMachineId }));
  const log = fileAt(treeOf(read.body), 'var', 'log', 'access.log') ?? '';
  const searchLine = log.split('\n').find((line) => line.includes(`/?q=${TERM}`)) ?? '';
  check(
    'the intruder reads findit’s own tree',
    read.status === 200,
    `status ${read.status}, error ${errorOf(read.body) ?? '-'}`,
  );
  check(
    'findit’s access.log shows the search, query and all, under the searcher’s address',
    searchLine.includes(searcherIp),
    searchLine || `no line for ${TERM} in ${log.length} chars of log`,
  );

  // 4. THE FRONT DOOR, DEFACED FOR EVERYONE (seeded — decision 122).
  await seedDefacement(DEFACED);
  const front = await fetchFindit(searcher, '/');
  check(
    'every other player’s fetch of findit gets the rewritten page',
    contentOf(front.body) === DEFACED,
    contentOf(front.body).slice(0, 80) || `status ${front.status}`,
  );
  const stillSearching = await fetchFindit(searcher, `/?q=${TERM}`);
  check(
    'a search is still answered from the defaced box',
    stillSearching.status === 200 &&
      contentOf(stillSearching.body) !== DEFACED &&
      contentOf(stillSearching.body).includes(TERM),
    contentOf(stillSearching.body).slice(0, 120) || `status ${stillSearching.status}`,
  );

  // 5. THE OPERATOR RESTORES IT — read back BEFORE any fetch writes a fresh log line.
  const restored = restore();
  check(
    'the restore script runs to completion',
    restored.status === 0,
    `exit ${restored.status}; ${(restored.stdout + restored.stderr).trim().split('\n').join(' | ')}`,
  );
  const journal = await finditJournal();
  check(
    'findit’s journal holds one fresh boot marker and nothing else',
    journal.length === 1 &&
      journal[0]!.path === BOOT_ID_PATH &&
      journal[0]!.writer_key === apGatewayLogWriterKey(FINDIT_NETWORK),
    JSON.stringify(journal),
  );
  const sessions = await attackerSessions();
  check(
    'every session on findit is closed, as a reboot closes them',
    sessions.length === 1 && sessions[0]!.ended_at !== null && sessions[0]!.end_reason === 'rebooted',
    JSON.stringify(sessions),
  );

  // 6. THE WORLD SEES IT.
  const back = await fetchFindit(searcher, '/');
  check(
    'findit serves its own front page again',
    contentOf(back.body) === FINDIT_FRONT_PAGE,
    contentOf(back.body).slice(0, 80) || `status ${back.status}`,
  );
  const refused = await writeFrontPage(DEFACED);
  check(
    'the intruder’s next write is refused',
    refused.status === 403,
    `status ${refused.status}, error ${errorOf(refused.body) ?? '-'}`,
  );

  // 7. TWICE IS HARMLESS.
  const markerBefore = (await finditJournal()).filter((row) => row.path === BOOT_ID_PATH);
  const again = restore();
  const afterAgain = await finditJournal();
  check(
    'a second restore runs clean and leaves one marker',
    again.status === 0 && markerBefore.length === 1 && afterAgain.length === 1,
    `exit ${again.status}; ${JSON.stringify(afterAgain)}`,
  );

  // 8. NO ENV, NO RUN.
  const bare = restore({ ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' });
  check('the script refuses to run without its env', bare.status === 2, `exit ${bare.status}`);

  await cleanup();

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
