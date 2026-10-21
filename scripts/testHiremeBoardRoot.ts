// Wire-payload smoke for the ROOT VIEW of hireme.io's boards' server — `resolveCrossPlayerFs`
// on the boards' server, and the operator's `scripts/restoreSite.ts boards.hireme.io`, against a
// running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - A ROOT SESSION on the boards' server is served `/etc/hireme/boards`, one `<handle>
//     <address>` line per board, in the order they were applied for, built from the table.
//   - A LOWER TIER, AND NO SESSION, are served none of it: no address reaches the wire.
//   - A JOURNAL ROW SITS OVER THE VIEW: a root's rewrite is what the next root reads, while
//     the table is untouched and every board still answers at its address.
//   - THE RESTORE NAMES THE BOX BY ITS KEY: the script closes every session there, empties
//     its journal down to one boot marker, and the list comes back from the table.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testHiremeBoardRoot.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { crackableEssidPool } from '../src/core/generation/generateWifi.js';
import { BOARD_SERVER_NETWORK } from '../src/core/generation/fixedSites.js';
import { BOARD_FIRST_OCTET } from '../src/core/generation/world.js';
import { ROOT_FILE } from '../src/core/generation/baseFs.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { BOOT_ID_PATH } from '../src/core/boot/bootId.js';
import { md5 } from '../src/core/generation/md5.js';
import { boardPage } from '../src/core/hireme/pages.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import type { Directory, FileNode } from '../src/core/filesystem/types.js';

type Identity = ReturnType<typeof generateIdentity>;

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
const RESTORE_SCRIPT = 'scripts/restoreSite.ts';
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

const contentOf = (body: unknown): string => {
  const content = (body as { content?: unknown } | null)?.content;
  return typeof content === 'string' ? content : '';
};

const nodeAt = (tree: Directory, ...segments: readonly string[]): FileNode | undefined =>
  segments.reduce<FileNode | undefined>(
    (node, name) => (node?.kind === 'directory' ? node.entries.get(name) : undefined),
    tree,
  );

const contentAt = (tree: Directory | null, ...segments: readonly string[]): string | null => {
  const node = tree === null ? undefined : nodeAt(tree, ...segments);
  return node?.kind === 'file' ? node.content : null;
};

const BOARDS_MACHINE = computeApGatewayId(BOARD_SERVER_NETWORK);

/** A suffix no earlier run used, so every handle here is fresh. */
const RUN = Date.now().toString(36).slice(-6);

/** An address in the boards' block, as the server draws one. */
const drawnAddress = (): string =>
  `${BOARD_FIRST_OCTET}.${randomInt(256)}.${randomInt(256)}.${2 + randomInt(253)}`;

/** The player every account here is signed up by, so they can all be removed afterwards. */
const owner = generateIdentity();
const visitor = generateIdentity();
const [visitorEssid] = crackableEssidPool;
const players: Identity[] = [];
const newPlayer = (): Identity => {
  const player = generateIdentity();
  players.push(player);
  return player;
};

/** An account holding a board at `address`, made at `appliedAt`. */
const seedBoard = async (handle: string, address: string, appliedAt: string) => {
  const account = await sr.from('email_accounts').insert({
    handle,
    password_md5: md5('s3cret'),
    signed_up_by: owner.publicKeyHex,
  });
  if (account.error) throw new Error(`account insert failed: ${account.error.message}`);
  const board = await sr
    .from('hireme_boards')
    .insert({ handle, address, applied_at: appliedAt, mailed_at: appliedAt });
  if (board.error) throw new Error(`board insert failed: ${board.error.message}`);
};

const boardsTable = async (handles: readonly string[]): Promise<string> => {
  const { data, error } = await sr
    .from('hireme_boards')
    .select('handle, address')
    .in('handle', handles)
    .order('handle');
  if (error) throw new Error(`boards read failed: ${error.message}`);
  return JSON.stringify(data);
};

/** Put the caller on a session of the boards' server at `userType`, the row an ssh hop
 *  would leave. Deleted first so no stale row survives. */
const seedSession = async (player: Identity, userType: 'root' | 'user' | 'guest') => {
  await sr.from('sessions').delete().eq('player_key', player.publicKeyHex);
  const { error } = await sr.from('sessions').insert({
    session_id: `ssh-boards-${userType}-${RUN}-${randomInt(1_000_000)}`,
    player_key: player.publicKeyHex,
    machine_id: BOARDS_MACHINE,
    credentials: { username: userType, userType },
    kind: 'ssh',
    essid: BOARD_SERVER_NETWORK,
  });
  if (error) throw new Error(`session seed failed: ${error.message}`);
};

const sessionsOf = async (
  player: Identity,
): Promise<readonly { ended_at: string | null; end_reason: string | null }[]> => {
  const { data, error } = await sr
    .from('sessions')
    .select('ended_at, end_reason')
    .eq('player_key', player.publicKeyHex)
    .eq('machine_id', BOARDS_MACHINE);
  if (error) throw new Error(`session read failed: ${error.message}`);
  return (data ?? []) as readonly { ended_at: string | null; end_reason: string | null }[];
};

const readBox = async (player: Identity) => {
  const result = await post(
    NETWORK,
    signRequest(player, 'resolveCrossPlayerFs', { machine_id: BOARDS_MACHINE }),
  );
  const tree =
    result.status === 200
      ? deserializeTree((result.body as { tree: SerializedDirectory }).tree)
      : null;
  return { status: result.status, body: result.body, tree };
};

const journal = async (): Promise<readonly { path: string; writer_key: string }[]> => {
  const { data, error } = await sr
    .from('patches')
    .select('path, writer_key')
    .eq('machine_id', BOARDS_MACHINE);
  if (error) throw new Error(`journal read failed: ${error.message}`);
  return (data ?? []) as readonly { path: string; writer_key: string }[];
};

const fetchBoard = (address: string) =>
  post(
    NETWORK,
    signRequest(visitor, 'resolveHttpFetch', { target: address, port: 80, path: '/' }),
  );

const restore = (name: string) =>
  spawnSync(process.execPath, ['--import', 'tsx', RESTORE_SCRIPT, name], {
    env: process.env,
    encoding: 'utf8',
  });

const cleanup = async () => {
  // Boards go with their accounts.
  await sr.from('email_accounts').delete().eq('signed_up_by', owner.publicKeyHex);
  const keys = [visitor, ...players].map((player) => player.publicKeyHex);
  await sr.from('sessions').delete().in('player_key', keys);
  await sr.from('home_network_occupants').delete().eq('owner_key', visitor.publicKeyHex);
  await sr.from('network_lan_leases').delete().eq('owner_key', visitor.publicKeyHex);
  await sr.from('patches').delete().eq('machine_id', BOARDS_MACHINE);
};

const main = async () => {
  if (visitorEssid === undefined) {
    console.error('the world has no network to put the visitor on');
    process.exit(2);
  }
  await cleanup();
  const joined = await post(
    NETWORK,
    signRequest(visitor, 'registerNetwork', {
      essid: visitorEssid,
      workstation_machine_id: computeWorkstationId('newbie', visitor.publicKeyHex),
      workstation_username: 'newbie',
      workstation_machine_name: 'newbie',
      workstation_root_hash: md5('newbie-root-secret'),
    }),
  );
  if (joined.status !== 200) {
    console.error(`Could not put the visitor on a network: status ${joined.status}`);
    process.exit(2);
  }

  const neo = `neo${RUN}`;
  const trin = `trin${RUN}`;
  const neoAddress = drawnAddress();
  const trinAddress = drawnAddress();
  // trin's row goes in first but applied later, so the order shown is the applying order.
  await seedBoard(trin, trinAddress, '2026-10-20T10:00:00Z');
  await seedBoard(neo, neoAddress, '2026-10-20T09:00:00Z');
  const tableBefore = await boardsTable([neo, trin]);
  console.log(`${neo} holds ${neoAddress}; ${trin} holds ${trinAddress}\n`);

  // 1. A ROOT SESSION SEES THE LIST.
  const root = newPlayer();
  await seedSession(root, 'root');
  const asRoot = await readBox(root);
  const list = contentAt(asRoot.tree, 'etc', 'hireme', 'boards') ?? '';
  const neoLine = `${neo} ${neoAddress}\n`;
  const trinLine = `${trin} ${trinAddress}\n`;
  check(
    'root is served /etc/hireme/boards with a handle and address line per board',
    asRoot.status === 200 && list.includes(neoLine) && list.includes(trinLine),
    `status ${asRoot.status}; ${list.split('\n').filter(Boolean).length} line(s)`,
  );
  check(
    'the lines are in the order the boards were applied for',
    list.indexOf(neoLine) < list.indexOf(trinLine),
    `neo at ${list.indexOf(neoLine)}, trin at ${list.indexOf(trinLine)}`,
  );
  check(
    'the list is root-only',
    JSON.stringify(asRoot.tree && nodeAt(asRoot.tree, 'etc', 'hireme', 'boards')?.perms) ===
      JSON.stringify(ROOT_FILE),
    'perms read',
  );

  // 2. A LOWER TIER, AND NO SESSION, SEE NONE OF IT.
  const peon = newPlayer();
  await seedSession(peon, 'user');
  const asUser = await readBox(peon);
  check(
    'a user session is served no /etc/hireme and no address',
    asUser.status === 200 &&
      asUser.tree !== null &&
      nodeAt(asUser.tree, 'etc', 'hireme') === undefined &&
      !JSON.stringify(asUser.body).includes(neoAddress),
    `status ${asUser.status}`,
  );
  const stranger = newPlayer();
  const asNone = await readBox(stranger);
  check(
    'a caller with no session reads nothing of the box',
    asNone.status === 404 && !JSON.stringify(asNone.body).includes(neoAddress),
    `status ${asNone.status}`,
  );

  // 3. A ROOT'S REWRITE SITS OVER THE VIEW, AND MOVES NOBODY'S BOARD.
  const FORGED = `${neo} 194.0.0.2\n`;
  const forged = await post(
    PATCHES,
    signRequest(root, 'upsertPatch', {
      machine_id: BOARDS_MACHINE,
      path: '/etc/hireme/boards',
      content: FORGED,
      owner: 'root',
      permissions: ROOT_FILE,
      node_type: 'file',
      is_new: false,
    }),
  );
  const nextRoot = newPlayer();
  await seedSession(nextRoot, 'root');
  const afterWrite = await readBox(nextRoot);
  check(
    "a root's rewrite is what the next root reads",
    forged.status === 200 && contentAt(afterWrite.tree, 'etc', 'hireme', 'boards') === FORGED,
    `write status ${forged.status}`,
  );
  const board = await fetchBoard(neoAddress);
  check(
    "the table is untouched, and neo's board still answers at neo's address",
    (await boardsTable([neo, trin])) === tableBefore && contentOf(board.body) === boardPage(neo),
    `fetch status ${board.status}`,
  );

  // 4. THE OPERATOR RESTORES THE BOX BY ITS KEY.
  const restored = restore(BOARD_SERVER_NETWORK);
  check(
    `restoreSite.ts ${BOARD_SERVER_NETWORK} runs to completion`,
    restored.status === 0,
    `exit ${restored.status}; ${(restored.stdout + restored.stderr).trim().split('\n').join(' | ')}`,
  );
  const rows = await journal();
  check(
    "the boards' server's journal holds one fresh boot marker and nothing else",
    rows.length === 1 &&
      rows[0]?.path === BOOT_ID_PATH &&
      rows[0]?.writer_key === apGatewayLogWriterKey(BOARD_SERVER_NETWORK),
    JSON.stringify(rows),
  );
  const closed = [...(await sessionsOf(root)), ...(await sessionsOf(nextRoot))];
  check(
    "every root session on the boards' server is closed, as a reboot closes them",
    closed.length === 2 && closed.every((row) => row.end_reason === 'rebooted'),
    JSON.stringify(closed),
  );
  const freshRoot = newPlayer();
  await seedSession(freshRoot, 'root');
  const afterRestore = contentAt((await readBox(freshRoot)).tree, 'etc', 'hireme', 'boards') ?? '';
  check(
    'the list is built from the table again',
    afterRestore.includes(neoLine) && afterRestore.includes(trinLine),
    `${afterRestore.split('\n').filter(Boolean).length} line(s)`,
  );
  const boardAfter = await fetchBoard(trinAddress);
  check(
    'the table is untouched by the restore, and every board answers',
    (await boardsTable([neo, trin])) === tableBefore &&
      contentOf(boardAfter.body) === boardPage(trin),
    `fetch status ${boardAfter.status}`,
  );

  // 5. THE USAGE LINE NAMES THE BOARDS' SERVER.
  const unknown = restore('example.com');
  check(
    "an unknown name is refused, and the usage names the boards' server",
    unknown.status === 2 && unknown.stderr.includes(BOARD_SERVER_NETWORK),
    `exit ${unknown.status}; ${unknown.stderr.trim()}`,
  );

  await cleanup();

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch(async (error: unknown) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
