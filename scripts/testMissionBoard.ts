// Wire-payload smoke for A CONTRACTOR BOARD THAT HIRES — offers on the board, accepting one,
// the briefing, the current contract and dropping it, through the REAL /api/network endpoint
// against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime and the three store functions):
//   - A READ POSTS THREE OFFERS. `hireme_post_offers` tops an empty board up to three, a second
//     read posts nothing, and two reads at once still leave three.
//   - AN OFFER TURNS OVER AFTER A DAY. An offer posted 25 hours ago is burned on the next read
//     and replaced, and its address answers as an empty one.
//   - ACCEPTING HIRES. `POST /accept` with an offer's ref accepts it, mails the briefing from
//     the client's handle with the mission address in it, and the address starts answering.
//   - ONE JOB AT A TIME. A second accept is refused busy, a made-up ref is gone, and two accepts
//     at once take one job and mail one briefing.
//   - DROPPING. `POST /drop` abandons the job, mails the client's line, leaves the address
//     answering, and the next read fills the board to three offers again.
//   - THE DOORS AND THE LOG. A GET of /accept or /drop answers the board and changes nothing,
//     a form anywhere else on the boards' server is 405, and every POST is an access.log line
//     naming the board, never with the form.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionBoard.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentityIn } from '../src/test/factories/identityIn.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { wifiPoolOf } from '../src/core/generation/generateWifi.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { BOARD_SERVER_NETWORK, HIREME_DOMAIN } from '../src/core/generation/fixedSites.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { ACCESS_LOG_PATH } from '../src/core/logging/accessLog.js';
import { md5 } from '../src/core/generation/md5.js';
import { missionAddressForNumber } from '../src/core/missions/missionNetwork.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';

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

const post = async (envelope: unknown): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(NETWORK, {
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

const foundOf = (body: unknown): unknown => (body as { found?: unknown } | null)?.found;
const portsOf = (body: unknown): readonly number[] =>
  ((body as { ports?: readonly { port: number }[] } | null)?.ports ?? []).map(({ port }) => port);

const HIREME_IP = siteAddress(HIREME_DOMAIN) ?? '';
const BOARDS_MACHINE = computeApGatewayId(BOARD_SERVER_NETWORK);

/** An address nothing in the world answers at: what an unreachable contract must answer. */
const EMPTY_PUBLIC_IP = '87.1.0.1';

/** A suffix no earlier run used, so every handle here is fresh. */
const RUN = Date.now().toString(36).slice(-6);
const handleFor = (name: string): string => `${name}${RUN}`;

/** The player every account here is signed up by, so they can all be removed afterwards. */
const owner = generateIdentityIn(RIDGEMONT);
const visitor = generateIdentityIn(RIDGEMONT);
const [visitorEssid] = wifiPoolOf(RIDGEMONT);

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

/** A handle with a mailbox and a board, applied for through hireme.io's real door; its
 *  board's address. */
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

type ContractRow = { number: number; state: string; ref: string | null };

const contractsOf = async (handle: string): Promise<readonly ContractRow[]> => {
  const { data, error } = await sr
    .from('hireme_missions')
    .select('number, state, ref')
    .eq('handle', handle)
    .order('posted_at', { ascending: true });
  if (error) throw new Error(`contracts read failed: ${error.message}`);
  return (data ?? []) as ContractRow[];
};

const inState = (rows: readonly ContractRow[], state: string): readonly ContractRow[] =>
  rows.filter((row) => row.state === state);

type Message = { sender: string; subject: string; body: string };

const inboxOf = async (handle: string): Promise<readonly Message[]> => {
  const { data, error } = await sr
    .from('email_messages')
    .select('sender, subject, body')
    .eq('handle', handle)
    .order('number', { ascending: true });
  if (error) throw new Error(`inbox read failed: ${error.message}`);
  return (data ?? []) as Message[];
};

/** The refs a board page shows, in the order it shows them. */
const refsOn = (content: string): readonly string[] =>
  [...content.matchAll(/Ref: ([0-9a-f]{6})/g)].map((match) => match[1]!);

const boardsLog = async (): Promise<string> => {
  const { data, error } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', BOARDS_MACHINE)
    .eq('path', ACCESS_LOG_PATH)
    .eq('writer_key', apGatewayLogWriterKey(BOARD_SERVER_NETWORK))
    .maybeSingle();
  if (error) throw new Error(`log read failed: ${error.message}`);
  return (data as { content?: string | null } | null)?.content ?? '';
};

const cleanup = async () => {
  // Boards, contracts and messages go with their accounts.
  await sr.from('email_accounts').delete().eq('signed_up_by', owner.publicKeyHex);
  await sr.from('sessions').delete().eq('player_key', visitor.publicKeyHex);
  await sr.from('home_network_occupants').delete().eq('owner_key', visitor.publicKeyHex);
  await sr.from('network_lan_leases').delete().eq('owner_key', visitor.publicKeyHex);
  await sr.from('patches').delete().eq('machine_id', BOARDS_MACHINE);
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
  const neoBoard = await boardFor(neo);
  console.log(`${neo} holds the board at ${neoBoard}\n`);

  // === 1. A READ POSTS THREE OFFERS, AND NO ADDRESS. ===
  const firstRead = await fetchAt(neoBoard, '/');
  const firstContent = contentOf(firstRead.body);
  const firstRows = await contractsOf(neo);
  const firstRefs = refsOn(firstContent);
  check(
    'a first read posts three offers and shows each with its ref, kind and pay',
    firstRead.status === 200 &&
      inState(firstRows, 'offered').length === 3 &&
      firstRefs.length === 3 &&
      firstRows.every(
        (row) =>
          firstRefs.includes(row.ref ?? '') &&
          firstContent.includes(
            `${missionTerms(row.number).client.company} — retrieve an access key — §${missionTerms(
              row.number,
            ).pay.toLocaleString('en-US')}`,
          ),
      ),
    `status ${firstRead.status}, ${firstRows.length} rows, refs [${firstRefs.join(',')}]`,
  );
  check(
    'the board names no mission address',
    !/195\.\d/.test(firstContent),
    firstContent.match(/195\.[\d.]+/)?.[0] ?? 'none',
  );

  // === 2. A SECOND READ POSTS NOTHING; TWO READS AT ONCE LEAVE THREE. ===
  const secondRead = await fetchAt(neoBoard, '/');
  check(
    'a second read shows the same three offers and posts none',
    refsOn(contentOf(secondRead.body)).join() === firstRefs.join() &&
      (await contractsOf(neo)).length === 3,
    `refs [${refsOn(contentOf(secondRead.body)).join(',')}]`,
  );
  const racer = handleFor('race');
  const racerBoard = await boardFor(racer);
  await Promise.all([fetchAt(racerBoard, '/'), fetchAt(racerBoard, '/')]);
  const racedRows = await contractsOf(racer);
  check(
    'two reads at once leave three offers, not six',
    inState(racedRows, 'offered').length === 3 && racedRows.length === 3,
    `${racedRows.length} rows`,
  );

  // === 3. AN OFFER POSTED A DAY AGO TURNS OVER, AND NEVER ANSWERS. ===
  const stale = firstRows[0]!;
  const backdated = await sr
    .from('hireme_missions')
    .update({ posted_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() })
    .eq('number', stale.number);
  if (backdated.error) throw new Error(`backdate failed: ${backdated.error.message}`);
  const turned = await fetchAt(neoBoard, '/');
  const turnedRows = await contractsOf(neo);
  const turnedRefs = refsOn(contentOf(turned.body));
  const staleAddress = missionAddressForNumber(stale.number)!;
  const [staleScan, emptyScan] = await Promise.all([scanOf(staleAddress), scanOf(EMPTY_PUBLIC_IP)]);
  check(
    'an offer posted 25 hours ago is burned on the next read and replaced',
    turnedRows.find((row) => row.number === stale.number)?.state === 'burned' &&
      inState(turnedRows, 'offered').length === 3 &&
      !turnedRefs.includes(stale.ref ?? '') &&
      turnedRefs.length === 3,
    `refs [${turnedRefs.join(',')}], stale ${stale.ref}`,
  );
  check(
    "a burned offer's address answers a scan as an empty address does",
    staleScan.status === emptyScan.status &&
      foundOf(staleScan.body) === false &&
      foundOf(emptyScan.body) === false,
    `burned ${staleScan.status} found ${String(foundOf(staleScan.body))}`,
  );

  // === 4. ACCEPTING HIRES: THE BRIEFING, AND THE ADDRESS ANSWERS. ===
  const offered = inState(turnedRows, 'offered');
  const taken = offered[1]!;
  const takenTerms = missionTerms(taken.number);
  const takenAddress = missionAddressForNumber(taken.number)!;
  const scanBeforeAccept = await scanOf(takenAddress);
  const inboxBefore = await inboxOf(neo);
  const accepted = await fetchAt(neoBoard, '/accept', `offer=${taken.ref}`);
  const acceptedContent = contentOf(accepted.body);
  const inboxAfter = await inboxOf(neo);
  const briefing = inboxAfter.at(-1);
  check(
    'accepting answers that the client has sent a briefing, under the current contract',
    accepted.status === 200 &&
      acceptedContent.includes(
        `Contract accepted. ${takenTerms.client.company} has sent you a briefing.`,
      ) &&
      acceptedContent.includes('Current contract'),
    `status ${accepted.status}`,
  );
  check(
    'the briefing comes from the client handle, naming the target, the address and the rules',
    inboxAfter.length === inboxBefore.length + 1 &&
      briefing?.sender === `${takenTerms.client.handle}@emailit.io` &&
      briefing.subject === `Contract: ${takenTerms.targetCompany}` &&
      briefing.body.includes(takenAddress) &&
      briefing.body.includes(takenTerms.keyOpens) &&
      briefing.body.includes('ACCESS-XXXX-XXXX-XXXX') &&
      briefing.body.includes('No key, no money. No wallet, no money.'),
    `${briefing?.sender ?? 'no mail'} / ${briefing?.subject ?? ''}`,
  );
  const scanAfterAccept = await scanOf(takenAddress);
  check(
    'the accepted address was not answering before, and answers a scan now',
    foundOf(scanBeforeAccept.body) === false &&
      scanAfterAccept.status === 200 &&
      portsOf(scanAfterAccept.body).length > 0,
    `before found ${String(foundOf(scanBeforeAccept.body))}, after ports [${portsOf(
      scanAfterAccept.body,
    ).join(',')}]`,
  );
  check(
    'the board shows the current contract, its target and pay, two offers and no address',
    acceptedContent.includes(
      `${takenTerms.client.company} — ${takenTerms.targetCompany} — §${takenTerms.pay.toLocaleString('en-US')}`,
    ) &&
      refsOn(acceptedContent).length === 2 &&
      !/195\.\d/.test(acceptedContent),
    `refs [${refsOn(acceptedContent).join(',')}]`,
  );

  // === 5. ONE JOB AT A TIME. ===
  const other = refsOn(acceptedContent)[0]!;
  const busy = await fetchAt(neoBoard, '/accept', `offer=${other}`);
  const madeUp = await fetchAt(neoBoard, '/accept', 'offer=000000');
  check(
    'a second accept while a job is held is refused, and mails nothing',
    contentOf(busy.body).includes('Finish or drop your current contract first') &&
      inState(await contractsOf(neo), 'accepted').length === 1 &&
      (await inboxOf(neo)).length === inboxAfter.length,
    `status ${busy.status}`,
  );
  check(
    'a ref the board does not hold is gone, and mails nothing',
    contentOf(madeUp.body).includes('That offer is no longer available.') &&
      (await inboxOf(neo)).length === inboxAfter.length,
    `status ${madeUp.status}`,
  );
  const racedRefs = refsOn(contentOf((await fetchAt(racerBoard, '/')).body));
  const racerInboxBefore = (await inboxOf(racer)).length;
  await Promise.all([
    fetchAt(racerBoard, '/accept', `offer=${racedRefs[0]}`),
    fetchAt(racerBoard, '/accept', `offer=${racedRefs[1]}`),
  ]);
  check(
    'two accepts at once take one job and mail one briefing',
    inState(await contractsOf(racer), 'accepted').length === 1 &&
      (await inboxOf(racer)).length === racerInboxBefore + 1,
    `${inState(await contractsOf(racer), 'accepted').length} accepted`,
  );

  // === 6. THE DOORS WITHOUT A FORM, AND A FORM ELSEWHERE. ===
  const rowsBeforeGets = JSON.stringify(await contractsOf(neo));
  const getAccept = await fetchAt(neoBoard, '/accept');
  const getDrop = await fetchAt(neoBoard, '/drop');
  check(
    'a GET of /accept or /drop answers the board and changes nothing',
    contentOf(getAccept.body).includes(`Welcome back, ${neo}.`) &&
      contentOf(getDrop.body).includes(`Welcome back, ${neo}.`) &&
      JSON.stringify(await contractsOf(neo)) === rowsBeforeGets,
    `statuses ${getAccept.status} ${getDrop.status}`,
  );
  const elsewhere = await fetchAt(neoBoard, '/contracts', 'offer=abc');
  check(
    'a form anywhere else on the boards server is 405',
    elsewhere.status === 405,
    `status ${elsewhere.status}`,
  );

  // === 7. DROPPING. ===
  const inboxBeforeDrop = (await inboxOf(neo)).length;
  const dropped = await fetchAt(neoBoard, '/drop', 'confirm=yes');
  const droppedContent = contentOf(dropped.body);
  const dropLine = (await inboxOf(neo)).at(-1);
  check(
    'dropping says the client will not be in touch, and the client mails one line',
    droppedContent.includes(
      `Contract dropped. ${takenTerms.client.company} will not be in touch again.`,
    ) &&
      (await inboxOf(neo)).length === inboxBeforeDrop + 1 &&
      dropLine?.sender === `${takenTerms.client.handle}@emailit.io`,
    `${dropLine?.sender ?? 'no mail'}`,
  );
  const scanAfterDrop = await scanOf(takenAddress);
  const afterDropRows = await contractsOf(neo);
  check(
    'the dropped address still answers, and the board fills to three offers with no contract',
    portsOf(scanAfterDrop.body).length > 0 &&
      afterDropRows.find((row) => row.number === taken.number)?.state === 'abandoned' &&
      refsOn(droppedContent).length === 3 &&
      !droppedContent.includes('Current contract'),
    `ports [${portsOf(scanAfterDrop.body).join(',')}], refs ${refsOn(droppedContent).length}`,
  );
  const dropAgain = await fetchAt(neoBoard, '/drop', 'confirm=yes');
  check(
    'dropping with no job held says so',
    contentOf(dropAgain.body).includes('You have no current contract.'),
    `status ${dropAgain.status}`,
  );

  // === 8. THE LOG NAMES THE BOARD AND NEVER THE FORM. ===
  const log = await boardsLog();
  check(
    'every accept and drop is a POST line naming the board, never with the form',
    log.includes(`"POST http://${neoBoard}/accept HTTP/1.1" 200`) &&
      log.includes(`"POST http://${neoBoard}/drop HTTP/1.1" 200`) &&
      !log.includes('offer=') &&
      !log.includes('confirm=yes'),
    `${log.split('\n').filter((line) => line.includes('POST')).length} POST lines`,
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
