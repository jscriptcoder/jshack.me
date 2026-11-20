// Wire-payload smoke for what a `msfconsole --local` read hole finds on the two boxes whose
// files the server keeps in its tables.
//
// emailit.io's accounts and the contractor boards live in tables, not in files, and a root
// shell on either box is shown them as files. A hole that lands root there has to find the
// same, so `/api/sessions` must hand the local fire the same three table reads
// `/api/network` hands a shell's view. This fires a root `cat` on emailit.io's box and on the
// boards' server and expects a seeded account and board back, then a user-tier one and
// expects them withheld.
//
// The server decides the game day from ITS clock, so the fixture walks each box's manifest to
// a library release whose CVE is live TODAY at the tier a check needs.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testLocalHoleReadsTheTables.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / un-stageable fixture.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { networkBaseFsForMachineId } from '../src/core/generation/lanHostIdentity.js';
import { BOARD_SERVER_NETWORK, EMAILIT_NETWORK } from '../src/core/generation/fixedSites.js';
import { md5 } from '../src/core/generation/md5.js';
import { packageTimeline } from '../src/core/cve/packageTimeline.js';
import { localExploitOutcome } from '../src/core/cve/localExploit.js';
import { gameDayAt } from '../src/core/cve/worldClock.js';
import { binaryStub } from '../src/core/generation/binaries.js';
import {
  DPKG_STATUS_OWNER,
  DPKG_STATUS_PATH,
  DPKG_STATUS_PERMISSIONS,
  parseDpkgVersions,
  readDpkgStatus,
  withPackageVersion,
} from '../src/core/packages/dpkgStatus.js';
import { asEpochMs, type UserType } from '../src/core/types.js';
import type { FilePermissions } from '../src/core/filesystem/types.js';

const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
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

const intruder = generateIdentity();
const MSF_PATH = '/tmp/msfconsole';
const WORLD_EXECUTABLE: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root', 'user', 'guest'],
  execute: ['root', 'user', 'guest'],
};

// A handle and a board nobody else seeds, so the lines this looks for are its own.
const HANDLE = `wire${Math.floor(Math.random() * 1e6)}`;
const HASH = md5(`${HANDLE}-password`);
const BOARD_ADDRESS = `194.77.${Math.floor(Math.random() * 250)}.${2 + Math.floor(Math.random() * 250)}`;

const gameDay = gameDayAt(asEpochMs(Date.now()));

/** The `cat` fire staged on a fixed site's box: its machine, and its manifest walked so the
 *  hole is live today at `tier`. `cat`'s only library is libpcre and its pool only reads. */
const stage = (essid: string, tier: UserType) => {
  const machineId = computeApGatewayId(essid);
  const base = networkBaseFsForMachineId(essid, machineId);
  if (base === null) {
    console.error(`${essid} does not make its gateway`);
    process.exit(2);
  }
  const manifest = readDpkgStatus(base);
  const release = packageTimeline('libpcre', gameDay).find(
    (candidate) =>
      localExploitOutcome(
        'cat',
        parseDpkgVersions(withPackageVersion(manifest, 'libpcre', candidate.version)),
        gameDay,
      )?.tier === tier,
  );
  if (release === undefined) {
    console.error(`No libpcre release reads at ${tier} on ${essid} at game day ${gameDay}`);
    process.exit(2);
  }
  return { essid, machineId, manifest: withPackageVersion(manifest, 'libpcre', release.version) };
};

type Staged = ReturnType<typeof stage>;

const cleanup = async (machineIds: readonly string[]) => {
  await sr
    .from('patches')
    .delete()
    .in('machine_id', machineIds)
    .eq('writer_key', intruder.publicKeyHex);
  await sr.from('sessions').delete().eq('player_key', intruder.publicKeyHex);
  // The board goes with the account it hangs off.
  await sr.from('email_accounts').delete().eq('handle', HANDLE);
};

/** A guest shell on the box, the box's manifest walked to the staged release, and the tool
 *  carried in, all under the intruder's key. Replaces whatever a previous stage seeded. */
const seed = async (box: Staged) => {
  await sr
    .from('patches')
    .delete()
    .eq('machine_id', box.machineId)
    .eq('writer_key', intruder.publicKeyHex);
  await sr.from('sessions').delete().eq('player_key', intruder.publicKeyHex);
  await sr.from('sessions').insert({
    session_id: `local-hole-guest-${box.machineId}`,
    player_key: intruder.publicKeyHex,
    machine_id: box.machineId,
    credentials: { username: 'guest', userType: 'guest' },
    kind: 'ssh',
    essid: box.essid,
    created_at: '2020-01-01T00:00:00.000Z',
  });
  await sr.from('patches').insert([
    {
      machine_id: box.machineId,
      path: DPKG_STATUS_PATH,
      content: box.manifest,
      owner: DPKG_STATUS_OWNER,
      permissions: DPKG_STATUS_PERMISSIONS,
      node_type: 'file',
      writer_key: intruder.publicKeyHex,
    },
    {
      machine_id: box.machineId,
      path: MSF_PATH,
      content: binaryStub('msfconsole'),
      owner: 'guest',
      permissions: WORLD_EXECUTABLE,
      node_type: 'file',
      writer_key: intruder.publicKeyHex,
    },
  ]);
};

type ReadAnswer = {
  readonly status: number;
  readonly tier: string | undefined;
  readonly content: string | undefined;
  readonly error: string | undefined;
};

const fireCat = async (box: Staged, path: string): Promise<ReadAnswer> => {
  const response = await fetch(SESSIONS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      signRequest(intruder, 'exploitLocalElevate', {
        session_id: `local-hole-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        machine_id: box.machineId,
        command: 'cat',
        command_path: MSF_PATH,
        arg: path,
      }),
    ),
  });
  const body = (await response.json().catch(() => null)) as {
    tier?: string;
    read?: { ok: boolean; content?: string; error?: string };
  } | null;
  return {
    status: response.status,
    tier: body?.tier,
    content: body?.read?.content,
    error: body?.read?.error,
  };
};

const emailitRoot = stage(EMAILIT_NETWORK, 'root');
const boardsRoot = stage(BOARD_SERVER_NETWORK, 'root');
const boardsUser = stage(BOARD_SERVER_NETWORK, 'user');
const MACHINES = [emailitRoot.machineId, boardsRoot.machineId];

await cleanup(MACHINES);
const account = await sr.from('email_accounts').insert({
  handle: HANDLE,
  password_md5: HASH,
  signed_up_by: intruder.publicKeyHex,
});
const board = await sr.from('hireme_boards').insert({ handle: HANDLE, address: BOARD_ADDRESS });
if (account.error || board.error) {
  console.error('Cannot seed the account and board:', account.error ?? board.error);
  await cleanup(MACHINES);
  process.exit(2);
}

// 1. A root hole on emailit.io's box reads every account's hash, as a root shell there does.
await seed(emailitRoot);
const mail = await fireCat(emailitRoot, '/etc/emailit/passwd');
check(
  'root --local cat on emailit.io → the accounts file names the seeded account',
  mail.status === 200 &&
    mail.tier === 'root' &&
    (mail.content ?? '').includes(`${HANDLE}:${HASH}\n`),
  `status=${mail.status} tier=${mail.tier} found=${(mail.content ?? '').includes(HANDLE)} error=${mail.error ?? '-'}`,
);

// 2. A root hole on the boards' server reads the boards list.
await seed(boardsRoot);
const boards = await fireCat(boardsRoot, '/etc/hireme/boards');
check(
  "root --local cat on the boards' server → the boards list names the seeded board",
  boards.status === 200 &&
    boards.tier === 'root' &&
    (boards.content ?? '').includes(`${HANDLE} ${BOARD_ADDRESS}\n`),
  `status=${boards.status} tier=${boards.tier} found=${(boards.content ?? '').includes(HANDLE)} error=${boards.error ?? '-'}`,
);

// 3. A root hole on the boards' server reads the contracts list too, even when it is empty.
const contracts = await fireCat(boardsRoot, '/etc/hireme/contracts');
check(
  "root --local cat on the boards' server → the contracts list is there",
  contracts.status === 200 && contracts.content !== undefined,
  `status=${contracts.status} error=${contracts.error ?? '-'}`,
);

// 4. NEGATIVE — below root no table is read, and nothing of the list comes back. `/etc/hireme`
//    is root-only on the box, so the hole is refused there either way.
await seed(boardsUser);
const below = await fireCat(boardsUser, '/etc/hireme/boards');
check(
  "user --local cat on the boards' server → nothing of the boards list comes back",
  below.status === 200 &&
    below.tier === 'user' &&
    below.content === undefined &&
    below.error !== undefined,
  `status=${below.status} tier=${below.tier} error=${below.error ?? '-'}`,
);

await cleanup(MACHINES);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
