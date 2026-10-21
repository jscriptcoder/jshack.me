// Wire-payload smoke for HIREME.IO'S CONTRACTOR BOARDS — the address a player was mailed,
// fetched, scanned and logged into through the REAL /api/network and /api/sessions
// endpoints against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE MAILED ADDRESS ANSWERS. `resolveHttpFetch` at a held 194 address finds the boards'
//     server through `hireme_boards` and answers that handle's board at `/`, query or not;
//     two handles' addresses answer their own boards.
//   - AN UNHELD ADDRESS IS NOTHING. A 194 address nobody holds answers a fetch, a scan and a
//     login exactly as an empty 193 address does.
//   - ONE BOX, TWO DOORS. A scan of a held address finds 22 and 80; a wrong root password is
//     refused and lands in the boards server's auth.log.
//   - THE LOG NAMES THE BOARD. Every hit on the server is an access.log line naming the
//     address asked: the board, a 404 elsewhere, a refused form.
//   - A ROOT'S PAGE NEVER REPLACES A BOARD. A planted index.html is served at /index.html
//     while `/` still answers the board.
//   - THE TWO BOXES FALL APART. A dark hireme.io leaves boards answering; a dark boards
//     server leaves hireme.io taking applications.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testHiremeBoard.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { crackableEssidPool } from '../src/core/generation/generateWifi.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { networkAt } from '../src/core/generation/world.js';
import {
  BOARD_SERVER_NETWORK,
  HIREME_DOMAIN,
  HIREME_NETWORK,
} from '../src/core/generation/fixedSites.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { ACCESS_LOG_PATH } from '../src/core/logging/accessLog.js';
import { WEB_PAGE_FILE } from '../src/core/generation/baseFs.js';
import { md5 } from '../src/core/generation/md5.js';
import { boardPage } from '../src/core/hireme/pages.js';
import { publicAddressOf } from './publicAddressOf.js';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
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

const portsOf = (body: unknown): readonly number[] =>
  ((body as { ports?: readonly { port: number }[] } | null)?.ports ?? []).map(({ port }) => port);

const HIREME_IP = siteAddress(HIREME_DOMAIN) ?? '';
const HIREME_MACHINE = computeApGatewayId(HIREME_NETWORK);
const BOARDS_MACHINE = computeApGatewayId(BOARD_SERVER_NETWORK);

/** An address in the placeless block no network answers at: a host octet of 1 is never
 *  handed out. What an empty address answers is what an unheld board's must. */
const EMPTY_PLACELESS = '193.0.0.1';

/** A suffix no earlier run used, so every handle here is fresh. */
const RUN = Date.now().toString(36).slice(-6);
const handleFor = (name: string): string => `${name}${RUN}`;

/** The player every account here is signed up by, so they can all be removed afterwards. */
const owner = generateIdentity();
const visitor = generateIdentity();
const [visitorEssid] = crackableEssidPool;

const openAccount = async (handle: string) => {
  const { error } = await sr.from('email_accounts').insert({
    handle,
    password_md5: md5('s3cret'),
    signed_up_by: owner.publicKeyHex,
  });
  if (error) throw new Error(`account insert failed: ${error.message}`);
};

const applyFor = (handle: string) =>
  post(
    NETWORK,
    signRequest(visitor, 'resolveHttpFetch', {
      target: HIREME_IP,
      port: 80,
      path: '/apply',
      body: `email=${handle}`,
    }),
  );

const fetchAt = (target: string, path: string, form?: string) =>
  post(
    NETWORK,
    signRequest(visitor, 'resolveHttpFetch', {
      target,
      port: 80,
      path,
      ...(form === undefined ? {} : { body: form }),
    }),
  );

const scanOf = (target: string) =>
  post(NETWORK, signRequest(visitor, 'resolvePublicScan', { target }));

const loginTo = (target: string) =>
  post(
    SESSIONS,
    signRequest(visitor, 'authCreateSessionPublic', {
      session_id: `ssh-boards-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      target,
      username: 'root',
      password: 'not-the-password',
    }),
  );

/** The address `handle` was mailed, read from the board the application made. */
const boardAddressOf = async (handle: string): Promise<string | null> => {
  const { data, error } = await sr
    .from('hireme_boards')
    .select('address')
    .eq('handle', handle)
    .maybeSingle();
  if (error) throw new Error(`board read failed: ${error.message}`);
  return (data as { address: string } | null)?.address ?? null;
};

const isHeld = async (address: string): Promise<boolean> => {
  const { data, error } = await sr
    .from('hireme_boards')
    .select('handle')
    .eq('address', address)
    .maybeSingle();
  if (error) throw new Error(`board read failed: ${error.message}`);
  return data !== null;
};

/** A log on the boards' server, as the system writes it: under the network's own key. */
const boardsLog = async (path: string): Promise<string> => {
  const { data, error } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', BOARDS_MACHINE)
    .eq('path', path)
    .eq('writer_key', apGatewayLogWriterKey(BOARD_SERVER_NETWORK))
    .maybeSingle();
  if (error) throw new Error(`log read failed: ${error.message}`);
  return (data as { content?: string | null } | null)?.content ?? '';
};

/** A file written onto a box's disk, as a root's write lands: a row in its journal. */
const writeOnto = async (machineId: string, path: string, content: string | null) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: machineId,
      path,
      content,
      owner: 'root',
      permissions: WEB_PAGE_FILE,
      node_type: 'file',
      writer_key: visitor.publicKeyHex,
      is_new: true,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (error) throw new Error(`journal write failed: ${error.message}`);
};

const unwrite = async (machineId: string, path: string) => {
  const { error } = await sr
    .from('patches')
    .delete()
    .eq('machine_id', machineId)
    .eq('path', path)
    .eq('writer_key', visitor.publicKeyHex);
  if (error) throw new Error(`journal delete failed: ${error.message}`);
};

const cleanup = async () => {
  // Boards and messages go with their accounts.
  await sr.from('email_accounts').delete().eq('signed_up_by', owner.publicKeyHex);
  await sr.from('sessions').delete().eq('player_key', visitor.publicKeyHex);
  await sr.from('home_network_occupants').delete().eq('owner_key', visitor.publicKeyHex);
  await sr.from('network_lan_leases').delete().eq('owner_key', visitor.publicKeyHex);
  // The boards' server's journal is this run's alone: its logs, the planted page, a brick.
  await sr.from('patches').delete().eq('machine_id', BOARDS_MACHINE);
  await sr
    .from('patches')
    .delete()
    .eq('machine_id', HIREME_MACHINE)
    .eq('writer_key', visitor.publicKeyHex);
};

type Answer = { status: number; body: unknown };

/** An answer as one line: its status and its body. */
const answerOf = (answer: Answer): string => `${answer.status} ${JSON.stringify(answer.body)}`;

const sameAnswer = (left: Answer, right: Answer): boolean => answerOf(left) === answerOf(right);

const main = async () => {
  if (HIREME_IP === '' || networkAt(EMPTY_PLACELESS) !== undefined || visitorEssid === undefined) {
    console.error('the world does not hold what this check assumes');
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
  const visitorIp = publicAddressOf(visitorEssid);
  console.log(`Visitor on ${visitorEssid} at ${visitorIp}; boards server ${BOARDS_MACHINE}\n`);

  // 1. THE MAILED ADDRESS ANSWERS THE HANDLE'S BOARD.
  const neo = handleFor('neo');
  const trin = handleFor('trin');
  await openAccount(neo);
  await openAccount(trin);
  await applyFor(neo);
  await applyFor(trin);
  const neoAddress = (await boardAddressOf(neo)) ?? '';
  const trinAddress = (await boardAddressOf(trin)) ?? '';
  console.log(`${neo} holds ${neoAddress}; ${trin} holds ${trinAddress}\n`);
  const neoBoard = await fetchAt(neoAddress, '/');
  check(
    "the mailed address answers the handle's board",
    neoBoard.status === 200 && contentOf(neoBoard.body) === boardPage(neo),
    `status ${neoBoard.status}, ${contentOf(neoBoard.body).slice(0, 80)}`,
  );
  const queried = await fetchAt(neoAddress, '/?from=mail');
  check(
    'a query string on / answers the same board',
    contentOf(queried.body) === boardPage(neo),
    `status ${queried.status}`,
  );
  const trinBoard = await fetchAt(trinAddress, '/');
  check(
    "another handle's address answers that handle's board",
    trinBoard.status === 200 && contentOf(trinBoard.body) === boardPage(trin),
    `status ${trinBoard.status}`,
  );

  // 2. AN UNHELD ADDRESS IS NOTHING, AS AN EMPTY ONE ANYWHERE IS.
  const unheld =
    ['194.0.0.2', '194.0.0.3', '194.0.0.4'].find(
      (candidate) => candidate !== neoAddress && candidate !== trinAddress,
    ) ?? '';
  if (await isHeld(unheld)) throw new Error(`${unheld} is held; pick another`);
  const unheldFetch = await fetchAt(unheld, '/');
  const emptyFetch = await fetchAt(EMPTY_PLACELESS, '/');
  check(
    'a fetch of an unheld board address answers as an empty 193 address',
    unheldFetch.status === 404 && sameAnswer(unheldFetch, emptyFetch),
    `${answerOf(unheldFetch)} vs ${answerOf(emptyFetch)}`,
  );
  const unheldScan = await scanOf(unheld);
  const emptyScan = await scanOf(EMPTY_PLACELESS);
  check(
    'a scan of it answers as a scan of an empty 193 address',
    sameAnswer(unheldScan, emptyScan),
    `${answerOf(unheldScan)} vs ${answerOf(emptyScan)}`,
  );
  const unheldLogin = await loginTo(unheld);
  const emptyLogin = await loginTo(EMPTY_PLACELESS);
  check(
    'a login to it answers as a login to an empty 193 address',
    sameAnswer(unheldLogin, emptyLogin),
    `${answerOf(unheldLogin)} vs ${answerOf(emptyLogin)}`,
  );

  // 3. ONE BOX, TWO DOORS, AT EVERY HELD ADDRESS.
  const scans = await Promise.all([scanOf(neoAddress), scanOf(trinAddress)]);
  const portLists = scans.map((scan) =>
    JSON.stringify([...portsOf(scan.body)].sort((left, right) => left - right)),
  );
  check(
    'a scan of either held address finds 22 and 80',
    scans.every((scan) => scan.status === 200) && portLists.every((ports) => ports === '[22,80]'),
    portLists.join(' / '),
  );
  const login = await loginTo(neoAddress);
  const authLog = await boardsLog('/var/log/auth.log');
  check(
    "a wrong root password is refused and lands in the boards server's auth.log",
    login.status === 401 && authLog.includes(`Failed password for root from ${visitorIp}`),
    `status ${login.status}; ${authLog.trim().split('\n').slice(-1)[0] ?? '(empty log)'}`,
  );

  // 4. THE LOG NAMES THE BOARD THAT WAS READ.
  const missed = await fetchAt(neoAddress, '/index.html');
  const refused = await fetchAt(neoAddress, '/', 'contract=1');
  const accessLog = await boardsLog(ACCESS_LOG_PATH);
  check(
    'a board read is logged with the reader and the address asked',
    accessLog.includes(`${visitorIp} - - [`) &&
      accessLog.includes(`"GET http://${neoAddress}/ HTTP/1.1" 200`) &&
      accessLog.includes(`"GET http://${trinAddress}/ HTTP/1.1" 200`),
    accessLog.trim().split('\n')[0] ?? '(empty log)',
  );
  check(
    'another path is a logged 404, and a form a logged 405, in the same form',
    missed.status === 404 &&
      refused.status === 405 &&
      accessLog.includes(`"GET http://${neoAddress}/index.html HTTP/1.1" 404`) &&
      accessLog.includes(`"POST http://${neoAddress}/ HTTP/1.1" 405`),
    `${missed.status} / ${refused.status}`,
  );
  check(
    'an unheld address left no line',
    !accessLog.includes(unheld),
    `searched for ${unheld}`,
  );

  // 5. A ROOT'S PAGE NEVER REPLACES A BOARD.
  await writeOnto(BOARDS_MACHINE, '/var/www/html/index.html', '<h1>OWNED</h1>');
  const planted = await fetchAt(neoAddress, '/index.html');
  const stillBoard = await fetchAt(neoAddress, '/');
  check(
    "a root's index.html is served at /index.html, and / still answers the board",
    contentOf(planted.body) === '<h1>OWNED</h1>' && contentOf(stillBoard.body) === boardPage(neo),
    `${contentOf(planted.body)} / ${contentOf(stillBoard.body).slice(0, 60)}`,
  );
  await unwrite(BOARDS_MACHINE, '/var/www/html/index.html');

  // 6. THE TWO BOXES FALL APART.
  await writeOnto(HIREME_MACHINE, '/boot/vmlinuz', null);
  const withHiremeDark = await fetchAt(neoAddress, '/');
  check(
    'with hireme.io bricked, a board still answers',
    contentOf(withHiremeDark.body) === boardPage(neo),
    `status ${withHiremeDark.status}`,
  );
  await unwrite(HIREME_MACHINE, '/boot/vmlinuz');

  await writeOnto(BOARDS_MACHINE, '/boot/vmlinuz', null);
  const darkBoards = await Promise.all([fetchAt(neoAddress, '/'), fetchAt(trinAddress, '/')]);
  check(
    'with the boards server bricked, every board is unreachable',
    darkBoards.every((dark) => answerOf(dark) === '404 {"error":"host_unreachable"}'),
    darkBoards.map(answerOf).join(' / '),
  );
  const tank = handleFor('tank');
  await openAccount(tank);
  const stillApplying = await applyFor(tank);
  check(
    'and hireme.io still takes applications',
    stillApplying.status === 200 &&
      contentOf(stillApplying.body).includes(`Thanks, ${tank}.`) &&
      (await boardAddressOf(tank)) !== null,
    `status ${stillApplying.status}`,
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
