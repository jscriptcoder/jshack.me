// Wire-payload smoke for THE ACTIVE CONTRACTS a root finds on hireme.io's boards' server —
// `resolveCrossPlayerFs` on the boards' server, with jobs taken, dropped and completed through
// the REAL /api/network doors, against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - A ROOT SESSION on the boards' server is served `/etc/hireme/contracts`, one `<handle>
//     <client handle> <mission address> <pay>` line per accepted job, in the order they were
//     accepted, root-only, beside an unchanged `/etc/hireme/boards`; each address answers a
//     scan.
//   - A USER SESSION is served no `/etc/hireme`, and no client handle or mission address
//     reaches the wire.
//   - A JOURNAL ROW SITS OVER THE LIST: a root's rewrite is what the next root reads, while
//     the job is untouched: its board still shows it and its key still pays.
//   - THE LIST FOLLOWS THE TABLE: a completed job and a dropped job leave it, a newly
//     accepted one joins it, and the boards' list still holds every handle.
//
// The key is derived here as `scripts/hireme.ts show` derives it, from MISSION_KEY_SECRET in
// the env; it is never printed.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionContracts.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { randomBytes, randomInt } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentityIn } from '../src/test/factories/identityIn.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { wifiPoolOf } from '../src/core/generation/generateWifi.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { BOARD_SERVER_NETWORK, HIREME_DOMAIN } from '../src/core/generation/fixedSites.js';
import { ROOT_FILE } from '../src/core/generation/baseFs.js';
import { md5 } from '../src/core/generation/md5.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import type { Directory, FileNode } from '../src/core/filesystem/types.js';
import { missionAddressForNumber } from '../src/core/missions/missionNetwork.js';
import { missionKey } from '../src/core/missions/missionSecret.js';
import { missionKind } from '../src/core/missions/missionShape.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
const WALLET = process.env.WALLET_ENDPOINT ?? 'http://localhost:3100/api/wallet';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const secret = process.env.MISSION_KEY_SECRET;

if (!url || !serviceKey || !secret) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MISSION_KEY_SECRET');
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

type Identity = ReturnType<typeof generateIdentityIn>;

const results: { readonly pass: boolean }[] = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
};

const postTo = async (
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

const post = (envelope: unknown) => postTo(NETWORK, envelope);

const contentOf = (body: unknown): string => {
  const content = (body as { content?: unknown } | null)?.content;
  return typeof content === 'string' ? content : '';
};

const portsOf = (body: unknown): readonly number[] =>
  ((body as { ports?: readonly { port: number }[] } | null)?.ports ?? []).map(({ port }) => port);

const nodeAt = (tree: Directory, ...segments: readonly string[]): FileNode | undefined =>
  segments.reduce<FileNode | undefined>(
    (node, name) => (node?.kind === 'directory' ? node.entries.get(name) : undefined),
    tree,
  );

const contentAt = (tree: Directory | null, ...segments: readonly string[]): string => {
  const node = tree === null ? undefined : nodeAt(tree, ...segments);
  return node?.kind === 'file' ? node.content : '';
};

const HIREME_IP = siteAddress(HIREME_DOMAIN) ?? '';
const BOARDS_MACHINE = computeApGatewayId(BOARD_SERVER_NETWORK);

/** A suffix no earlier run used, so every handle here is fresh. */
const RUN = Date.now().toString(36).slice(-6);
const handleFor = (name: string): string => `${name}${RUN}`;

/** The player every account here is signed up by, so they can all be removed afterwards. */
const owner = generateIdentityIn(RIDGEMONT);
/** Who fetches every board, accepts every job and mails every key. */
const visitor = generateIdentityIn(RIDGEMONT);
const [visitorEssid] = wifiPoolOf(RIDGEMONT);
/** The callers holding a session on the boards' server. */
const players: Identity[] = [];
const newPlayer = (): Identity => {
  const player = generateIdentityIn(RIDGEMONT);
  players.push(player);
  return player;
};

const WALLET_ADDRESS = `jsc${randomBytes(20).toString('hex')}`;

const openAccount = async (handle: string) => {
  const { error } = await sr.from('email_accounts').insert({
    handle,
    password_md5: md5('s3cret'),
    signed_up_by: owner.publicKeyHex,
  });
  if (error) throw new Error(`account insert failed: ${error.message}`);
};

const fetchAt = (target: string, path: string, form?: string) =>
  post(
    signRequest(visitor, 'resolveHttpFetch', {
      target,
      port: 80,
      path,
      ...(form === undefined ? {} : { body: form }),
    }),
  );

const scanOf = (target: string) => post(signRequest(visitor, 'resolvePublicScan', { target }));

const boardFor = async (handle: string): Promise<string> => {
  await openAccount(handle);
  await fetchAt(HIREME_IP, '/apply', `email=${handle}`);
  const { data, error } = await sr
    .from('hireme_boards')
    .select('address')
    .eq('handle', handle)
    .maybeSingle();
  if (error || data === null) throw new Error(`no board for ${handle}`);
  return (data as { address: string }).address;
};

const acceptedOf = async (handle: string): Promise<number> => {
  const { data, error } = await sr
    .from('hireme_missions')
    .select('number')
    .eq('handle', handle)
    .eq('state', 'accepted')
    .maybeSingle();
  if (error || data === null) throw new Error(`${handle} holds no job`);
  return (data as { number: number }).number;
};

/** The ref of a key job on the handle's board. Two offers in three ask for a record changed
 *  or a machine taken down, which no key pays, so a board offering none is burned and read
 *  again to top up. */
const keyOfferRef = async (handle: string, board: string): Promise<string> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await fetchAt(board, '/');
    const { data, error } = await sr
      .from('hireme_missions')
      .select('number, ref')
      .eq('handle', handle)
      .eq('state', 'offered');
    if (error || data === null) throw new Error(`no offers for ${handle}`);
    const offers = data as readonly { readonly number: number; readonly ref: string }[];
    const keyOffer = offers.find(({ number }) => missionKind(number) === 'key');
    if (keyOffer !== undefined) return keyOffer.ref;
    await sr
      .from('hireme_missions')
      .update({ state: 'burned' })
      .eq('handle', handle)
      .eq('state', 'offered');
  }
  throw new Error(`no key job offered to ${handle}`);
};

/** Accept a key job on a board through its real form; the job it took. */
const acceptOn = async (handle: string, board: string): Promise<number> => {
  const ref = await keyOfferRef(handle, board);
  await fetchAt(board, '/accept', `offer=${ref}`);
  return acceptedOf(handle);
};

/** How many jobs the table holds accepted, by anyone: the list's length. */
const acceptedCount = async (): Promise<number> => {
  const { count, error } = await sr
    .from('hireme_missions')
    .select('*', { count: 'exact', head: true })
    .eq('state', 'accepted');
  if (error) throw new Error(`missions count failed: ${error.message}`);
  return count ?? 0;
};

const balanceOf = async (address: string): Promise<number> => {
  const answer = await postTo(WALLET, { action: 'balance', address });
  return (answer.body as { balance?: number } | null)?.balance ?? -1;
};

/** Put the caller on a session of the boards' server at `userType`, the row an ssh hop
 *  would leave. */
const seedSession = async (player: Identity, userType: 'root' | 'user') => {
  await sr.from('sessions').delete().eq('player_key', player.publicKeyHex);
  const { error } = await sr.from('sessions').insert({
    session_id: `ssh-contracts-${userType}-${RUN}-${randomInt(1_000_000)}`,
    player_key: player.publicKeyHex,
    machine_id: BOARDS_MACHINE,
    credentials: { username: userType, userType },
    kind: 'ssh',
    essid: BOARD_SERVER_NETWORK,
  });
  if (error) throw new Error(`session seed failed: ${error.message}`);
};

const readBox = async (userType: 'root' | 'user') => {
  const player = newPlayer();
  await seedSession(player, userType);
  const result = await post(
    signRequest(player, 'resolveCrossPlayerFs', { machine_id: BOARDS_MACHINE }),
  );
  const tree =
    result.status === 200
      ? deserializeTree((result.body as { tree: SerializedDirectory }).tree)
      : null;
  return { player, status: result.status, body: result.body, tree };
};

/** The line a job's briefing implies: its handle, client, address and pay. */
const lineFor = (handle: string, missionNumber: number): string => {
  const terms = missionTerms(missionNumber);
  return `${handle} ${terms.client.handle} ${missionAddressForNumber(missionNumber)} ${terms.pay}\n`;
};

const cleanup = async () => {
  // Boards, contracts and messages go with their accounts.
  await sr.from('email_accounts').delete().eq('signed_up_by', owner.publicKeyHex);
  const keys = [visitor, ...players].map((player) => player.publicKeyHex);
  await sr.from('sessions').delete().in('player_key', keys);
  await sr.from('email_sends').delete().eq('player_key', visitor.publicKeyHex);
  await sr.from('home_network_occupants').delete().eq('owner_key', visitor.publicKeyHex);
  await sr.from('network_lan_leases').delete().eq('owner_key', visitor.publicKeyHex);
  await sr.from('patches').delete().eq('machine_id', BOARDS_MACHINE);
  await sr.from('wallet_transfers').delete().eq('to_address', WALLET_ADDRESS);
  await sr.from('wallet_balances').delete().eq('address', WALLET_ADDRESS);
};

const main = async () => {
  if (HIREME_IP === '' || visitorEssid === undefined) {
    console.error('the world does not hold what this check assumes');
    process.exit(2);
  }
  await cleanup();
  const joined = await post(
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

  const neo = handleFor('neo');
  const trin = handleFor('trin');
  const morph = handleFor('morph');
  const neoBoard = await boardFor(neo);
  const trinBoard = await boardFor(trin);
  const morphBoard = await boardFor(morph);
  const neoJob = await acceptOn(neo, neoBoard);
  const trinJob = await acceptOn(trin, trinBoard);
  const neoLine = lineFor(neo, neoJob);
  const trinLine = lineFor(trin, trinJob);
  console.log(`${neo} holds contract ${neoJob}; ${trin} holds ${trinJob}\n`);

  // === 1. A ROOT SESSION SEES EVERY ACTIVE JOB. ===
  const asRoot = await readBox('root');
  const list = contentAt(asRoot.tree, 'etc', 'hireme', 'contracts');
  check(
    'root is served /etc/hireme/contracts with the line each briefing implies',
    asRoot.status === 200 && list.includes(neoLine) && list.includes(trinLine),
    `status ${asRoot.status}; ${list.split('\n').filter(Boolean).length} line(s)`,
  );
  check(
    'the lines are in the order the jobs were accepted',
    list.indexOf(neoLine) >= 0 && list.indexOf(neoLine) < list.indexOf(trinLine),
    `neo at ${list.indexOf(neoLine)}, trin at ${list.indexOf(trinLine)}`,
  );
  check(
    'the list is root-only',
    JSON.stringify(asRoot.tree && nodeAt(asRoot.tree, 'etc', 'hireme', 'contracts')?.perms) ===
      JSON.stringify(ROOT_FILE),
    'perms read',
  );
  const neoAddress = missionAddressForNumber(neoJob)!;
  const scan = await scanOf(neoAddress);
  check(
    "a line's address answers a scan",
    portsOf(scan.body).length > 0,
    `ports [${portsOf(scan.body).join(',')}]`,
  );
  const boards = contentAt(asRoot.tree, 'etc', 'hireme', 'boards');
  check(
    'the boards list beside it still holds every board',
    boards.includes(`${neo} ${neoBoard}\n`) && boards.includes(`${trin} ${trinBoard}\n`),
    `${boards.split('\n').filter(Boolean).length} board line(s)`,
  );

  // === 2. A USER SESSION SEES NONE OF IT. ===
  const asUser = await readBox('user');
  const wire = JSON.stringify(asUser.body);
  check(
    'a user session is served no /etc/hireme, no client handle and no mission address',
    asUser.status === 200 &&
      asUser.tree !== null &&
      nodeAt(asUser.tree, 'etc', 'hireme') === undefined &&
      !wire.includes(neoAddress) &&
      !wire.includes(` ${missionTerms(neoJob).client.handle} `),
    `status ${asUser.status}`,
  );

  // === 3. A ROOT'S REWRITE SITS OVER THE LIST, AND MOVES NOBODY'S JOB. ===
  const FORGED = `${neo} copper-ops 195.0.0.2 2000\n`;
  const forged = await postTo(
    PATCHES,
    signRequest(asRoot.player, 'upsertPatch', {
      machine_id: BOARDS_MACHINE,
      path: '/etc/hireme/contracts',
      content: FORGED,
      owner: 'root',
      permissions: ROOT_FILE,
      node_type: 'file',
      is_new: false,
    }),
  );
  const afterWrite = await readBox('root');
  check(
    "a root's rewrite is what the next root reads",
    forged.status === 200 && contentAt(afterWrite.tree, 'etc', 'hireme', 'contracts') === FORGED,
    `write status ${forged.status}`,
  );
  const neoPage = contentOf((await fetchAt(neoBoard, '/')).body);
  const terms = missionTerms(neoJob);
  const paid = await post(
    signRequest(visitor, 'resolveMail', {
      op: 'send',
      handle: neo,
      password: 's3cret',
      to: terms.client.handle,
      subject: 'the job',
      body: `${missionKey(neoJob, secret)} ${WALLET_ADDRESS}\n`,
    }),
  );
  check(
    "the job is untouched: neo's board still shows it, and its key still pays",
    neoPage.includes('Current contract') &&
      paid.status === 200 &&
      (await balanceOf(WALLET_ADDRESS)) === terms.pay,
    `mail status ${paid.status}, balance ${await balanceOf(WALLET_ADDRESS)} of ${terms.pay}`,
  );
  // The forgery goes, so the list below is the table's again.
  await sr.from('patches').delete().eq('machine_id', BOARDS_MACHINE);

  // === 4. THE LIST FOLLOWS THE TABLE. ===
  await fetchAt(trinBoard, '/drop', 'confirm=yes');
  const morphJob = await acceptOn(morph, morphBoard);
  const morphLine = lineFor(morph, morphJob);
  const afterChanges = await readBox('root');
  const relisted = contentAt(afterChanges.tree, 'etc', 'hireme', 'contracts');
  check(
    'a completed job and a dropped job leave the list, and a newly accepted one joins it',
    !relisted.includes(`${neo} `) && !relisted.includes(`${trin} `) && relisted.includes(morphLine),
    `${relisted.split('\n').filter(Boolean).length} line(s)`,
  );
  check(
    'the list holds one line per accepted job in the table',
    relisted.split('\n').filter(Boolean).length === (await acceptedCount()),
    `${relisted.split('\n').filter(Boolean).length} line(s), ${await acceptedCount()} accepted`,
  );
  const boardsAfter = contentAt(afterChanges.tree, 'etc', 'hireme', 'boards');
  check(
    'the boards list still holds the handles whose jobs closed',
    boardsAfter.includes(`${neo} ${neoBoard}\n`) && boardsAfter.includes(`${trin} ${trinBoard}\n`),
    `${boardsAfter.split('\n').filter(Boolean).length} board line(s)`,
  );

  await cleanup();
  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch(async (error: unknown) => {
  console.error(error);
  await cleanup();
  process.exit(1);
});
