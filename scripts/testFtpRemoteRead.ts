// Wire-check for the REMOTE half of the `ftp>` prompt: an `ftp`-kind session is what
// lets the player read the target box, and it is the ONLY thing that does. The read is
// the tree the server serves, pruned to the tier the credential bought. The rows behind
// it go to nobody but an owner, and no player owns a generated box.
// Drives the REAL /api/sessions + /api/network + /api/patches endpoints against a
// running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - The served tree of a box the caller holds nothing on is 404 `host_unreachable` —
//     the baseline the door has to change.
//   - An `ftp` row authorizes that same read. The lookup asks for an OPEN session
//     and never asks which kind, which is the ftp door's central claim (the door adds no
//     authorization dimension) — but every unit test fakes `findActiveSession`, so
//     only a live row against the live query can show that `kind:'ftp'` counts.
//   - What comes back is the box's REAL state: the tree holds the `vsftpd.log`
//     line the server itself wrote when the player arrived. A client cannot compute
//     that from the generated world, so a listing containing it was genuinely read
//     off the target.
//   - The same row is refused the raw journal (403 `permission_denied`).
//   - The grant is per-BOX: the same session does not open a second machine's tree.
//   - The grant DIES with the session: after `endSession` the caller is served what
//     anybody outside can observe of the box and no more, so a player who quits stops
//     being able to read the box they left.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testFtpRemoteRead.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable host.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan.js';
import { hostServices } from '../src/core/generation/remoteHostFs.js';
import { machineIdForLanHost, resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { accountsIn } from '../src/core/sessions/passwdAccount.js';
import { md5 } from '../src/core/generation/md5.js';
import { leaveNetwork, standOnNetwork } from './standVantage.js';
import { VSFTPD_LOG_PATH } from '../src/core/logging/vsftpdLog.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import type { Directory, FileNode } from '../src/core/filesystem/types.js';
import { ALL_GENERATED_PASSWORDS } from '../src/test/passwords.js';

const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
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

// The same ESSID `testFtpSweepTrace` uses: most generate no host running the ftp
// door at all, so the lab network is picked rather than left to chance.
const ESSID = 'VSFTPD-LAB';

const player = generateIdentity();

const serves = (host: LanHost, spec: (typeof SERVICE_CATALOG)[keyof typeof SERVICE_CATALOG]) =>
  hostServices(ESSID, host).some((service) => service.spec === spec);

const lan = generateHomeLan(ESSID);
const target = lan.hosts.find((host) => host.kind === 'machine' && serves(host, SERVICE_CATALOG.ftp));
// A second box, to prove the grant is per-machine rather than per-player.
const bystander = lan.hosts.find(
  (host) => host.kind === 'machine' && host.ip !== target?.ip,
);

if (target === undefined || bystander === undefined) {
  console.error(
    `ESSID ${ESSID} lacks a pair (ftp host: ${target?.ip ?? 'none'}, second host: ${bystander?.ip ?? 'none'}).`,
  );
  process.exit(2);
}

const targetMachine = machineIdForLanHost(target, ESSID);
const bystanderMachine = machineIdForLanHost(bystander, ESSID);

/** One real account on the target, with the plaintext its hash was seeded from. */
const credential = (host: LanHost): { readonly username: string; readonly password: string } => {
  const { baseFs } = resolveLanHostIdentity(host, ESSID);
  for (const account of accountsIn(baseFs)) {
    const password = ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === account.hash);
    if (password !== undefined) return { username: account.username, password };
  }
  console.error(`no recoverable account on ${host.ip}`);
  process.exit(2);
};

const account = credential(target);

const readJournal = (machineId: string) =>
  post(PATCHES, signRequest(player, 'listPatches', { machine_id: machineId }));

/** The box as the server serves it to the player, or null when it serves nothing. */
const readServedTree = async (machineId: string) => {
  const response = await post(
    NETWORK,
    signRequest(player, 'resolveCrossPlayerFs', { machine_id: machineId }),
  );
  const tree =
    response.status === 200
      ? deserializeTree((response.body as { tree: SerializedDirectory }).tree)
      : null;
  return { ...response, tree };
};

const get = (tree: Directory, ...segments: readonly string[]): FileNode | undefined => {
  let node: FileNode | undefined = tree;
  for (const segment of segments) {
    if (node === undefined || node.kind !== 'directory') return undefined;
    node = node.entries.get(segment);
  }
  return node;
};

/** A path's segments, so a tree can be walked to it. */
const segmentsOf = (path: string): readonly string[] => path.split('/').filter(Boolean);

const logLineIn = (tree: Directory | null): string => {
  const log = tree === null ? undefined : get(tree, ...segmentsOf(VSFTPD_LOG_PATH));
  return log?.kind === 'file' ? log.content : '';
};

const clear = async () => {
  await leaveNetwork(sr, ESSID);
  await sr.from('sessions').delete().eq('player_key', player.publicKeyHex);
  await sr.from('patches').delete().eq('machine_id', targetMachine);
  await sr.from('patches').delete().eq('machine_id', bystanderMachine);
};

const main = async (): Promise<void> => {
  await clear();
  // Seat the player on the lab network so the server can place their login.
  await standOnNetwork(sr, ESSID, player, 50);

  // --- the baseline: no session, no box ---
  const before = await readServedTree(targetMachine);
  check(
    'a box the player holds nothing on is not served to them',
    before.status === 404,
    `status ${before.status} ${JSON.stringify(before.body)}`,
  );

  // --- the door ---
  const login = await post(
    SESSIONS,
    signRequest(player, 'authCreateSession', {
      session_id: 'ftp-read-1',
      essid: ESSID,
      target_ip: target.ip,
      username: account.username,
      password: account.password,
      parent_session_id: null,
      source_ip: '192.168.1.50',
      kind: 'ftp',
    }),
  );
  check(
    'an ftp login is accepted',
    login.status === 200,
    `status ${login.status} ${JSON.stringify(login.body)}`,
  );

  const opened = await readServedTree(targetMachine);
  check(
    'and the ftp row alone authorizes the read — the lookup never asks which door',
    opened.status === 200,
    `status ${opened.status}`,
  );
  check(
    'what comes back is the box as it stands, including the log of the arrival itself',
    logLineIn(opened.tree).includes('OK LOGIN'),
    `log: ${JSON.stringify(logLineIn(opened.tree))}`,
  );

  const rows = await readJournal(targetMachine);
  check(
    'the rows behind that tree are refused to the same session',
    rows.status === 403 && (rows.body as { error?: string } | null)?.error === 'permission_denied',
    `status ${rows.status} ${JSON.stringify(rows.body)}`,
  );

  const other = await readServedTree(bystanderMachine);
  check(
    'the grant is for the box it was bought on, not for the network',
    other.status === 404,
    `status ${other.status} on ${bystander.ip}`,
  );

  // --- and it dies when the player quits ---
  const ended = await post(SESSIONS, signRequest(player, 'endSession', { session_id: 'ftp-read-1' }));
  check('the session ends', ended.status === 200, `status ${ended.status}`);

  const after = await readServedTree(targetMachine);
  check(
    'a quit player is served what anybody outside can observe, and not the log or a home',
    after.tree !== null &&
      logLineIn(after.tree) === '' &&
      get(after.tree, 'home') === undefined &&
      get(after.tree, 'bin') === undefined,
    `status ${after.status} log=${JSON.stringify(logLineIn(after.tree))}`,
  );

  await clear();

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
