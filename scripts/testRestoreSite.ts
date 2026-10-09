// Wire-payload smoke for A FIXED SITE FALLS AND COMES BACK — findit.io or hackademy.io
// rooted through the REAL /api/sessions endpoint, read and defaced through the REAL
// /api/network and /api/patches endpoints, then put back by the operator's
// `scripts/restoreSite.ts <domain>`, run as a child process exactly as the operator runs
// it. Against a running `vercel dev` + supabase. Run it once per fixed site.
//
// Net-new under test:
//   - THE LOG IS THE PRIZE. A player holding root on the site reads its `access.log`, and
//     another player's visit is there, query and all, under that player's own address.
//   - THE FRONT DOOR IS THE SITE'S OWN FILE. Rewriting `/var/www/html/index.html` changes
//     what every other player's `curl` gets — and on findit a search is still answered.
//   - THE RESTORE IS A REBOOT. After the script, the site serves its generated front page
//     again, its journal holds one fresh boot marker and nothing else, every session on it
//     is closed as `rebooted`, and the intruder's next write is refused.
//   - THE SCRIPT IS SAFE TO REPEAT, will not run without its env, and touches nothing when
//     the domain names no fixed site.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testRestoreSite.ts findit.io
//   npx dotenv -e .env.development.local -- npx tsx scripts/testRestoreSite.ts hackademy.io
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env, an unknown domain or an
// unusable world.

import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { crackableEssidPool } from '../src/core/generation/generateWifi.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { buildFixedSiteFs } from '../src/core/generation/fixedSiteFs.js';
import { FINDIT_NETWORK, FIXED_SITES } from '../src/core/generation/fixedSites.js';
import { WEB_PAGE_FILE } from '../src/core/generation/baseFs.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { BOOT_ID_PATH } from '../src/core/boot/bootId.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import {
  DPKG_STATUS_PATH,
  DPKG_STATUS_PERMISSIONS,
  readDpkgStatus,
  withPackageVersion,
} from '../src/core/packages/dpkgStatus.js';
import { exploitOutcome } from '../src/core/cve/exploitEffect.js';
import { packageTimeline } from '../src/core/cve/packageTimeline.js';
import { gameDayAt } from '../src/core/cve/worldClock.js';
import { md5 } from '../src/core/generation/md5.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import type { Directory, FileNode } from '../src/core/filesystem/types.js';
import { asEpochMs } from '../src/core/types.js';
import { publicAddressOf } from './publicAddressOf.js';

const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
const RESTORE_SCRIPT = 'scripts/restoreSite.ts';
const site = FIXED_SITES.find((candidate) => candidate.domain === process.argv[2]);
if (site === undefined) {
  console.error(`Usage: testRestoreSite.ts <${FIXED_SITES.map(({ domain }) => domain).join('|')}>`);
  process.exit(2);
}
/** Only findit answers a query with a search; any other site serves its page. */
const searches = site.key === FINDIT_NETWORK;

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
 *  release the site is walked onto is chosen against it. */
const today = gameDayAt(asEpochMs(Date.now()));

const SITE_IP = siteAddress(site.domain);
if (SITE_IP === undefined) {
  console.error(`${site.domain} answers nowhere — the world is unusable.`);
  process.exit(2);
}
const siteMachineId = computeApGatewayId(site.key);
const siteFs = buildFixedSiteFs(site);

/** The front page the site was generated with — what a restore must bring back. */
const generatedFrontPage = fileAt(siteFs, 'var', 'www', 'html', 'index.html');

/** A door the site keeps whose daemon, walked onto a release live TODAY, opens a full
 *  shell. Any granted tier does: a fixed site holds only root, so the shell stands on root
 *  whatever the tier, and its `access.log` is world-readable — reading the prize needs a shell, not a
 *  privilege. (A ROOT-tier hole, which the defacement write would need, is on the world's
 *  schedule and not open at this day, so the defaced state is seeded below rather than
 *  written live.) */
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
  console.error(`Nothing ${site.domain} runs has a release on game day ${today} that opens a shell.`);
  process.exit(2);
}

/** The intruder and the searcher, each on a network of their own so the log has an
 *  address to name them by. */
const attacker = generateIdentity();
const searcher = generateIdentity();
const [attackerEssid, searcherEssid] = crackableEssidPool;
const TERM = `quokka${Date.now().toString(36)}`;
const DEFACED = '<html><head><title>owned</title></head><body>we were here</body></html>\n';
const FRONT_PAGE = '/var/www/html/index.html';

const registerHome = async (
  player: ReturnType<typeof generateIdentity>,
  essid: string,
  name: string,
): Promise<string | null> => {
  const joined = await post(
    NETWORK,
    signRequest(player, 'registerNetwork', {
      essid,
      workstation_machine_id: computeWorkstationId(name, player.publicKeyHex),
      workstation_username: name,
      workstation_machine_name: name,
      workstation_root_hash: md5(`${name}-root-secret`),
    }),
  );
  return joined.status === 200 ? publicAddressOf(essid) : null;
};

const fetchSite = (player: ReturnType<typeof generateIdentity>, path: string) =>
  post(NETWORK, signRequest(player, 'resolveHttpFetch', { target: SITE_IP, port: 80, path }));

const writeFrontPage = (content: string) =>
  post(
    PATCHES,
    signRequest(attacker, 'upsertPatch', {
      machine_id: siteMachineId,
      path: FRONT_PAGE,
      content,
      owner: 'root',
      permissions: WEB_PAGE_FILE,
      node_type: 'file',
    }),
  );

/** The rooted attacker's write, seeded via service_role — the world will produce it once a
 *  root-granting window opens on the site's schedule. Attributed to the
 *  attacker, the writer a real rooted write would carry, so restore deleting it proves the
 *  delete reaches every writer's rows. */
const seedDefacement = async (content: string) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: siteMachineId,
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

const siteJournal = async (): Promise<readonly { path: string; writer_key: string }[]> => {
  const { data, error } = await sr
    .from('patches')
    .select('path, writer_key')
    .eq('machine_id', siteMachineId);
  if (error) throw new Error(`journal read failed: ${error.message}`);
  return (data ?? []) as readonly { path: string; writer_key: string }[];
};

const attackerSessions = async (): Promise<readonly { ended_at: string | null; end_reason: string | null }[]> => {
  const { data, error } = await sr
    .from('sessions')
    .select('ended_at, end_reason')
    .eq('player_key', attacker.publicKeyHex)
    .eq('machine_id', siteMachineId);
  if (error) throw new Error(`session read failed: ${error.message}`);
  return (data ?? []) as readonly { ended_at: string | null; end_reason: string | null }[];
};

const restore = (env: NodeJS.ProcessEnv = process.env, domain: string = site.domain) =>
  spawnSync(process.execPath, ['--import', 'tsx', RESTORE_SCRIPT, domain], { env, encoding: 'utf8' });

const cleanup = async () => {
  for (const player of [attacker, searcher]) {
    await sr.from('sessions').delete().eq('player_key', player.publicKeyHex);
    await sr.from('home_network_occupants').delete().eq('owner_key', player.publicKeyHex);
  }
  await sr.from('patches').delete().eq('machine_id', siteMachineId);
};

const main = async () => {
  console.log(`World day ${today}; ${site.domain} at ${SITE_IP} (machine ${siteMachineId})`);
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

  // 1. SOMEBODY VISITS, ASKING FOR SOMETHING.
  const searched = await fetchSite(searcher, `/?q=${TERM}`);
  check('the visitor’s request is answered', searched.status === 200, `status ${searched.status}`);

  // 2. THE SITE FALLS.
  const { error: seedError } = await sr.from('patches').upsert(
    {
      machine_id: siteMachineId,
      path: DPKG_STATUS_PATH,
      content: withPackageVersion(readDpkgStatus(siteFs), door.spec.package, door.version),
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
      session_id: `exploit-${site.hostname}-${Date.now()}`,
      essid: attackerEssid,
      target_ip: SITE_IP,
      port: door.spec.defaultPort,
      caller_machine_id: computeWorkstationId('intruder', attacker.publicKeyHex),
      parent_session_id: null,
    }),
  );
  check(
    `a live hole in what ${site.domain} runs opens a root shell on it`,
    opened.status === 200 && (opened.body as { ok?: boolean } | null)?.ok === true,
    `status ${opened.status}, body ${JSON.stringify(opened.body).slice(0, 160)}`,
  );

  // 3. THE PRIZE: WHO SEARCHED FOR WHAT, FROM WHERE.
  const read = await post(NETWORK, signRequest(attacker, 'resolveCrossPlayerFs', { machine_id: siteMachineId }));
  const log = fileAt(treeOf(read.body), 'var', 'log', 'access.log') ?? '';
  const searchLine = log.split('\n').find((line) => line.includes(`/?q=${TERM}`)) ?? '';
  check(
    `the intruder reads ${site.domain}’s own tree`,
    read.status === 200,
    `status ${read.status}, error ${errorOf(read.body) ?? '-'}`,
  );
  check(
    `${site.domain}’s access.log shows the visit, query and all, under the visitor’s address`,
    searchLine.includes(searcherIp),
    searchLine || `no line for ${TERM} in ${log.length} chars of log`,
  );

  // 4. THE FRONT DOOR, DEFACED FOR EVERYONE (seeded).
  await seedDefacement(DEFACED);
  const front = await fetchSite(searcher, '/');
  check(
    `every other player’s fetch of ${site.domain} gets the rewritten page`,
    contentOf(front.body) === DEFACED,
    contentOf(front.body).slice(0, 80) || `status ${front.status}`,
  );
  if (searches) {
    const stillSearching = await fetchSite(searcher, `/?q=${TERM}`);
    check(
      'a search is still answered from the defaced box',
      stillSearching.status === 200 &&
        contentOf(stillSearching.body) !== DEFACED &&
        contentOf(stillSearching.body).includes(TERM),
      contentOf(stillSearching.body).slice(0, 120) || `status ${stillSearching.status}`,
    );
  }

  // 5. THE OPERATOR RESTORES IT — read back BEFORE any fetch writes a fresh log line.
  const restored = restore();
  check(
    'the restore script runs to completion',
    restored.status === 0,
    `exit ${restored.status}; ${(restored.stdout + restored.stderr).trim().split('\n').join(' | ')}`,
  );
  const journal = await siteJournal();
  check(
    `${site.domain}’s journal holds one fresh boot marker and nothing else`,
    journal.length === 1 &&
      journal[0]!.path === BOOT_ID_PATH &&
      journal[0]!.writer_key === apGatewayLogWriterKey(site.key),
    JSON.stringify(journal),
  );
  const sessions = await attackerSessions();
  check(
    `every session on ${site.domain} is closed, as a reboot closes them`,
    sessions.length === 1 && sessions[0]!.ended_at !== null && sessions[0]!.end_reason === 'rebooted',
    JSON.stringify(sessions),
  );

  // 6. THE WORLD SEES IT.
  const back = await fetchSite(searcher, '/');
  check(
    `${site.domain} serves its generated front page again`,
    generatedFrontPage !== null && contentOf(back.body) === generatedFrontPage,
    contentOf(back.body).slice(0, 80) || `status ${back.status}`,
  );
  const refused = await writeFrontPage(DEFACED);
  check(
    'the intruder’s next write is refused',
    refused.status === 403,
    `status ${refused.status}, error ${errorOf(refused.body) ?? '-'}`,
  );

  // 7. TWICE IS HARMLESS.
  const markerBefore = (await siteJournal()).filter((row) => row.path === BOOT_ID_PATH);
  const again = restore();
  const afterAgain = await siteJournal();
  check(
    'a second restore runs clean and leaves one marker',
    again.status === 0 && markerBefore.length === 1 && afterAgain.length === 1,
    `exit ${again.status}; ${JSON.stringify(afterAgain)}`,
  );

  // 8. NO ENV, NO RUN.
  const bare = restore({ ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' });
  check('the script refuses to run without its env', bare.status === 2, `exit ${bare.status}`);

  // 9. A DOMAIN THAT NAMES NO FIXED SITE TOUCHES NOTHING.
  await seedDefacement(DEFACED);
  const beforeUnknown = await siteJournal();
  const unknown = restore(process.env, 'example.com');
  const afterUnknown = await siteJournal();
  check(
    'an unknown domain is refused before anything is touched',
    unknown.status === 2 && JSON.stringify(afterUnknown) === JSON.stringify(beforeUnknown),
    `exit ${unknown.status}; ${beforeUnknown.length} row(s) before and ${afterUnknown.length} after`,
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
