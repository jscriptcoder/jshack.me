// Wire-check for `put` — and for the claim the whole ftp door rests on: a session
// opened through a SECOND protocol authorizes a write through exactly the gate an
// `ssh` session's write goes through, with nothing anywhere beneath asking which
// door the caller came in by. Drives the REAL /api/sessions + /api/patches endpoints
// against a running `vercel dev` + supabase.
//
// This is the one claim `tsc` and vitest cannot see any of. Every unit test stubs the
// far side's answer, so the tier they prove is a tier the test chose; only the live
// endpoint can show `authorizeMachineAccess` accepting a `kind:'ftp'` row it was never
// taught about, and `remoteWritePermission` refusing the same write one tier down.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `upsertPatch` on a box the caller holds nothing on is refused, and lands nothing.
//   - An `ftp` row satisfies L1 — the first live assertion that it does. The row is
//     schema-legal by DDL (no CHECK on `sessions.kind`), but legal is not the same as
//     accepted, and this is where that difference would show.
//   - The TIER decides, not the protocol: the same destination refuses a `guest`
//     credential and accepts a `root` one, both over ftp. Two credentials, one path —
//     a single-credential check could not tell "the tier decided" from "ftp is denied".
//   - What the box holds afterwards is read back off its journal, so the check reads
//     the machine's own state rather than trusting the handler's answer. And the
//     session that left a file reads it back off the tree the server serves it, which
//     is the only way a player reads a box that is not their own.
//   - The grant dies with the session: after `endSession` the write is refused again.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testFtpPut.ts
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
import type { UserType } from '../src/core/types.js';
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

// The same lab network the other ftp wire-checks use: most ESSIDs generate no host
// running the door at all, so the target is picked rather than left to chance.
const ESSID = 'VSFTPD-LAB';
// Root's own directory — root-only read, write and execute on every generated box.
// The destination has to be one a guest genuinely cannot reach, or the refusal
// under test would be the endpoint being broken rather than the tier being enforced.
const SEALED = '/root/dropped.sh';
const OPEN = '/tmp/dropped.sh';
const PAYLOAD = '#!/bin/sh\necho pwned\n';

const player = generateIdentity();

const serves = (host: LanHost, spec: (typeof SERVICE_CATALOG)[keyof typeof SERVICE_CATALOG]) =>
  hostServices(ESSID, host).some((service) => service.spec === spec);

const lan = generateHomeLan(ESSID);
const target = lan.hosts.find((host) => host.kind === 'machine' && serves(host, SERVICE_CATALOG.ftp));

if (target === undefined) {
  console.error(`ESSID ${ESSID} has no ftp-serving host.`);
  process.exit(2);
}

const targetMachine = machineIdForLanHost(target, ESSID);

/** Every account on the target whose seeded hash a generated password matches — the
 *  set a player could actually reach with `hydra`. */
const credentials = (
  host: LanHost,
): readonly { readonly username: string; readonly password: string; readonly userType: UserType }[] =>
  accountsIn(resolveLanHostIdentity(host, ESSID).baseFs).flatMap((account) => {
    const password = ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === account.hash);
    return password === undefined
      ? []
      : [{ username: account.username, password, userType: account.userType }];
  });

const accounts = credentials(target);
const asGuest = accounts.find((account) => account.userType === 'guest');
const asRoot = accounts.find((account) => account.userType === 'root');

if (asGuest === undefined || asRoot === undefined) {
  console.error(`${target.ip} has no crackable guest AND root account to contrast.`);
  process.exit(2);
}

const login = (sessionId: string, account: { username: string; password: string }) =>
  post(
    SESSIONS,
    signRequest(player, 'authCreateSession', {
      session_id: sessionId,
      essid: ESSID,
      target_ip: target.ip,
      username: account.username,
      password: account.password,
      parent_session_id: null,
      source_ip: '192.168.1.50',
      kind: 'ftp',
    }),
  );

const quit = (sessionId: string) =>
  post(SESSIONS, signRequest(player, 'endSession', { session_id: sessionId }));

/** The upload itself: the SHIPPED `upsertPatch` the shell's own writes use, pointed at
 *  someone else's machine. Nothing about it says ftp. */
const put = (path: string, owner: string) =>
  post(
    PATCHES,
    signRequest(player, 'upsertPatch', {
      machine_id: targetMachine,
      path,
      content: PAYLOAD,
      owner,
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
      node_type: 'file',
      is_new: true,
    }),
  );

/** What the box itself holds at `path` — read off its journal rather than trusted from
 *  the handler's answer. The rows go to no player on a box nobody owns, so this asks as
 *  the operator. */
const contentAt = async (path: string): Promise<string | null> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', targetMachine)
    .eq('path', path);
  return (data as readonly { content: string | null }[] | null)?.[0]?.content ?? null;
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

/** What the player is served at `path` on the box, at the tier their session holds. */
const servedAt = async (path: string): Promise<string | null> => {
  const response = await post(
    NETWORK,
    signRequest(player, 'resolveCrossPlayerFs', { machine_id: targetMachine }),
  );
  if (response.status !== 200) return null;
  const tree = deserializeTree((response.body as { tree: SerializedDirectory }).tree);
  const node = get(tree, ...segmentsOf(path));
  return node?.kind === 'file' ? node.content : null;
};

const clear = async () => {
  await leaveNetwork(sr, ESSID);
  await sr.from('sessions').delete().eq('player_key', player.publicKeyHex);
  await sr.from('patches').delete().eq('machine_id', targetMachine);
};

const main = async (): Promise<void> => {
  await clear();
  // Seat the player on the lab network so the server can place their login.
  await standOnNetwork(sr, ESSID, player, 50);

  // --- the baseline: no session, nothing lands ---
  const uninvited = await put(OPEN, asGuest.username);
  check(
    'a player holding nothing on the box cannot write to it',
    uninvited.status === 403,
    `status ${uninvited.status} ${JSON.stringify(uninvited.body)}`,
  );
  check(
    'and nothing was written on the way to being refused',
    (await contentAt(OPEN)) === null,
    `${OPEN} on ${target.ip}: ${JSON.stringify(await contentAt(OPEN))}`,
  );

  // --- an ftp row satisfies L1: the claim the door rests on ---
  const guestLogin = await login('ftp-put-guest', asGuest);
  check(
    `an ftp login as ${asGuest.username} is accepted`,
    guestLogin.status === 200,
    `status ${guestLogin.status} ${JSON.stringify(guestLogin.body)}`,
  );

  const landed = await put(OPEN, asGuest.username);
  check(
    'an ftp row authorizes a write through the SAME endpoint an ssh row uses',
    landed.status === 200,
    `status ${landed.status} ${JSON.stringify(landed.body)}`,
  );
  check(
    'and the box itself holds the file afterwards, which the session reads back',
    (await contentAt(OPEN)) === PAYLOAD && (await servedAt(OPEN)) === PAYLOAD,
    `${OPEN}: held ${JSON.stringify(await contentAt(OPEN))}, served ${JSON.stringify(await servedAt(OPEN))}`,
  );

  // --- the tier decides, not the protocol ---
  const overreach = await put(SEALED, asGuest.username);
  check(
    'the same session cannot write where its tier may not',
    overreach.status === 403,
    `status ${overreach.status} ${JSON.stringify(overreach.body)}`,
  );
  check(
    'and that refusal left nothing behind',
    (await contentAt(SEALED)) === null,
    `${SEALED}: ${JSON.stringify(await contentAt(SEALED))}`,
  );

  await quit('ftp-put-guest');

  const rootLogin = await login('ftp-put-root', asRoot);
  check(
    `an ftp login as ${asRoot.username} is accepted`,
    rootLogin.status === 200,
    `status ${rootLogin.status} ${JSON.stringify(rootLogin.body)}`,
  );

  const elevated = await put(SEALED, asRoot.username);
  check(
    'the SAME destination accepts the credential whose tier reaches it',
    elevated.status === 200,
    `status ${elevated.status} ${JSON.stringify(elevated.body)}`,
  );
  // The pair is the point: one path, two credentials, two answers. Either half alone
  // would be satisfied by an endpoint that always refuses, or always allows.
  check(
    'and the box holds what the root session left, which that session reads back',
    (await contentAt(SEALED)) === PAYLOAD && (await servedAt(SEALED)) === PAYLOAD,
    `${SEALED}: held ${JSON.stringify(await contentAt(SEALED))}, served ${JSON.stringify(await servedAt(SEALED))}`,
  );

  // --- and the grant dies when the player quits ---
  const ended = await quit('ftp-put-root');
  check('the session ends', ended.status === 200, `status ${ended.status}`);

  const afterQuit = await put('/root/second-drop.sh', asRoot.username);
  check(
    'a player who quit can no longer write to the box they left',
    afterQuit.status === 403 && (await contentAt('/root/second-drop.sh')) === null,
    `status ${afterQuit.status} ${JSON.stringify(afterQuit.body)}`,
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
