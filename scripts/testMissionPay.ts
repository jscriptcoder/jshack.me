// Wire-payload smoke for A CLIENT THAT PAYS — the key mailed to a client's handle, read by its
// shape, answered at once in the sender's inbox, and the quoted pay minted to the wallet named,
// through the REAL /api/network and /api/wallet endpoints against a running `vercel dev` +
// supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime and the store functions):
//   - THE RIGHT KEY PAYS ONCE. A reply quoting the briefing, with the key below the quote in
//     lower case and the wallet in upper case, completes the job; two such mails sent at once
//     mint once, and one of them is told the job is already closed.
//   - THE JOB IS DONE. The board fills to three offers with no current contract, the address
//     still answers, another offer can be taken, and the same key again pays nothing.
//   - NO WALLET, NO MONEY. The right key with no wallet completes the job and mints nothing.
//   - EVERY OTHER MAIL GETS ITS REPLY. A wrong key, a reply only quoting the briefing, a key
//     from someone with no contract with that client, and a key after dropping the job each
//     earn their own reply, and none of them changes a job or mints.
//   - THE HOLE STAYS. Whoever logs in as the contractor and names their own wallet is paid.
//   - A TWO-HOP JOB PAYS ITS OWN RANGE. A two-hop contract accepted from the board pays its
//     quoted 2,000–4,000 once, and the same key again mints nothing more.
//   - A PROOF IS A SEND. A wrong password mails nothing, a player at 20 sends this hour is
//     refused, and each proof mail counts as one send.
//
// The key is derived here as `scripts/hireme.ts show` derives it, from MISSION_KEY_SECRET in
// the env; it is never printed.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionPay.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentityIn } from '../src/test/factories/identityIn.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { wifiPoolOf } from '../src/core/generation/generateWifi.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { HIREME_DOMAIN } from '../src/core/generation/fixedSites.js';
import { md5 } from '../src/core/generation/md5.js';
import { missionAddressForNumber } from '../src/core/missions/missionNetwork.js';
import { missionKey } from '../src/core/missions/missionSecret.js';
import { missionKind, missionTopology } from '../src/core/missions/missionShape.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
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

const errorOf = (body: unknown): unknown => (body as { error?: unknown } | null)?.error;
const portsOf = (body: unknown): readonly number[] =>
  ((body as { ports?: readonly { port: number }[] } | null)?.ports ?? []).map(({ port }) => port);

const HIREME_IP = siteAddress(HIREME_DOMAIN) ?? '';

/** A suffix no earlier run used, so every handle here is fresh. */
const RUN = Date.now().toString(36).slice(-6);
const handleFor = (name: string): string => `${name}${RUN}`;

/** The player every account here is signed up by, so they can all be removed afterwards. */
const owner = generateIdentityIn(RIDGEMONT);
/** Who works neo's jobs, who mails with no contract, who holds neo's login, and who has sent
 *  20 mails this hour. */
const visitor = generateIdentityIn(RIDGEMONT);
const stranger = generateIdentityIn(RIDGEMONT);
const thief = generateIdentityIn(RIDGEMONT);
const busy = generateIdentityIn(RIDGEMONT);
const SENDERS = [visitor, stranger, thief, busy];
const [visitorEssid] = wifiPoolOf(RIDGEMONT);

const freshWallet = (): string => `jsc${randomBytes(20).toString('hex')}`;
const CONTRACTOR_WALLET = freshWallet();
const THIEF_WALLET = freshWallet();
const NO_WALLET_PROBE = freshWallet();
const TWO_HOP_WALLET = freshWallet();

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

type ContractRow = { number: number; state: string };

const contractsOf = async (handle: string): Promise<readonly ContractRow[]> => {
  const { data, error } = await sr
    .from('hireme_missions')
    .select('number, state')
    .eq('handle', handle)
    .order('posted_at', { ascending: true });
  if (error) throw new Error(`contracts read failed: ${error.message}`);
  return (data ?? []) as ContractRow[];
};

const stateOf = async (handle: string, missionNumber: number): Promise<string | undefined> =>
  (await contractsOf(handle)).find((row) => row.number === missionNumber)?.state;

const acceptedOf = async (handle: string): Promise<number> => {
  const job = (await contractsOf(handle)).find((row) => row.state === 'accepted');
  if (job === undefined) throw new Error(`${handle} holds no job`);
  return job.number;
};

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

const sendsBy = async (player: Identity): Promise<number> => {
  const { count, error } = await sr
    .from('email_sends')
    .select('*', { count: 'exact', head: true })
    .eq('player_key', player.publicKeyHex);
  if (error) throw new Error(`sends read failed: ${error.message}`);
  return count ?? 0;
};

const mail = (
  player: Identity,
  fields: { handle: string; to: string; subject?: string; body: string; password?: string },
) =>
  post(
    signRequest(player, 'resolveMail', {
      op: 'send',
      password: 's3cret',
      subject: 'the job',
      ...fields,
    }),
  );

const balanceOf = async (address: string): Promise<number> => {
  const answer = await postTo(WALLET, { action: 'balance', address });
  return (answer.body as { balance?: number } | null)?.balance ?? -1;
};

const mintsTo = async (address: string): Promise<readonly number[]> => {
  const answer = await postTo(WALLET, { action: 'history', address });
  const transfers =
    (answer.body as { transfers?: readonly { from: string | null; amount: number }[] } | null)
      ?.transfers ?? [];
  return transfers.filter((transfer) => transfer.from === null).map(({ amount }) => amount);
};

/** The ref of a key job on the handle's board. Half the offers ask for a record changed
 *  instead, which no key pays, so a board offering none is burned and read again to top up. */
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

/** A contract number nobody holds whose client is not `client`. */
const numberOutside = async (client: string): Promise<number> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate = 0x500000 + attempt * 256 + 7;
    if (missionTerms(candidate).client.handle === client) continue;
    const { data } = await sr
      .from('hireme_missions')
      .select('number')
      .eq('number', candidate)
      .maybeSingle();
    if (data === null) return candidate;
  }
  throw new Error('no free contract number outside the client');
};

/** A two-hop key job's number nobody holds. */
const freeTwoHopNumber = async (): Promise<number> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate = 0x520000 + attempt * 256 + 11;
    if (missionTopology(candidate).frontBoxOctet === null) continue;
    if (missionKind(candidate) !== 'key') continue;
    const { data } = await sr
      .from('hireme_missions')
      .select('number')
      .eq('number', candidate)
      .maybeSingle();
    if (data === null) return candidate;
  }
  throw new Error('no free two-hop contract number');
};

const cleanup = async () => {
  // Boards, contracts and messages go with their accounts.
  await sr.from('email_accounts').delete().eq('signed_up_by', owner.publicKeyHex);
  for (const player of SENDERS) {
    await sr.from('email_sends').delete().eq('player_key', player.publicKeyHex);
    await sr.from('email_login_failures').delete().eq('player_key', player.publicKeyHex);
  }
  await sr.from('sessions').delete().eq('player_key', visitor.publicKeyHex);
  await sr.from('home_network_occupants').delete().eq('owner_key', visitor.publicKeyHex);
  await sr.from('network_lan_leases').delete().eq('owner_key', visitor.publicKeyHex);
  const wallets = [CONTRACTOR_WALLET, THIEF_WALLET, NO_WALLET_PROBE, TWO_HOP_WALLET];
  await sr.from('wallet_transfers').delete().in('to_address', wallets);
  await sr.from('wallet_balances').delete().in('address', wallets);
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
  const job = await acceptOn(neo, neoBoard);
  const terms = missionTerms(job);
  const client = terms.client.handle;
  const key = missionKey(job, secret);
  const briefing = (await inboxOf(neo)).at(-1)!;
  const quotedBriefing = briefing.body
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  const fromClient = (message: Message | undefined, line: string) =>
    message?.sender === `${client}@emailit.io` && message.body.startsWith(line);
  console.log(`${neo} holds contract ${job} for ${client}\n`);

  // === 1. A WRONG KEY, AND A REPLY THAT ONLY QUOTES THE BRIEFING. ===
  const sendsBefore = await sendsBy(visitor);
  const wrong = await mail(visitor, {
    handle: neo,
    to: client,
    body: `ACCESS-0000-0000-0000\n${CONTRACTOR_WALLET}\n`,
  });
  check(
    'a wrong key is answered as sent, the client says it opens nothing, and nothing changes',
    wrong.status === 200 &&
      fromClient((await inboxOf(neo)).at(-1), 'That key opens nothing of ours.') &&
      (await stateOf(neo, job)) === 'accepted' &&
      (await balanceOf(CONTRACTOR_WALLET)) === 0,
    `status ${wrong.status}`,
  );
  check(
    'a proof mail counts as one send',
    (await sendsBy(visitor)) === sendsBefore + 1,
    `${sendsBefore} -> ${await sendsBy(visitor)}`,
  );
  const quoteOnly = await mail(visitor, {
    handle: neo,
    to: client,
    subject: `Re: ${briefing.subject}`,
    body: `done\n\n${quotedBriefing}\n`,
  });
  check(
    'a reply that only quotes the briefing is asked for the key',
    quoteOnly.status === 200 &&
      fromClient((await inboxOf(neo)).at(-1), 'No key, no money. Send the key.') &&
      (await stateOf(neo, job)) === 'accepted',
    `status ${quoteOnly.status}`,
  );

  // === 2. THE RIGHT KEY, TWICE AT ONCE: ONE MINT. ===
  const rightMail = {
    handle: neo,
    to: client,
    subject: `Re: ${briefing.subject}`,
    body: `${quotedBriefing}\n\nhere: ${key.toLowerCase()}\npay ${CONTRACTOR_WALLET.toUpperCase()}\n`,
  };
  const inboxBeforePay = (await inboxOf(neo)).length;
  const [paidOnce, paidTwice] = await Promise.all([
    mail(visitor, rightMail),
    mail(visitor, rightMail),
  ]);
  const payReplies = (await inboxOf(neo)).slice(inboxBeforePay);
  const paidLine = `Key received. §${terms.pay.toLocaleString('en-US')} sent to ${CONTRACTOR_WALLET}.`;
  check(
    'two right mails at once are both answered as sent: one pays, one is told it is closed',
    paidOnce.status === 200 &&
      paidTwice.status === 200 &&
      payReplies.length === 2 &&
      payReplies.filter((reply) => fromClient(reply, paidLine)).length === 1 &&
      payReplies.filter((reply) => fromClient(reply, 'That job is already closed.')).length === 1,
    payReplies.map((reply) => reply.body.split('\n')[0]).join(' | '),
  );
  check(
    'the wallet holds exactly the quoted pay, from one mint',
    (await balanceOf(CONTRACTOR_WALLET)) === terms.pay &&
      JSON.stringify(await mintsTo(CONTRACTOR_WALLET)) === JSON.stringify([terms.pay]),
    `balance ${await balanceOf(CONTRACTOR_WALLET)}, mints [${(await mintsTo(CONTRACTOR_WALLET)).join(',')}]`,
  );
  check(
    'the reply comes from the client handle about the target company',
    payReplies.every(
      (reply) =>
        reply.sender === `${client}@emailit.io` &&
        reply.subject === `Contract: ${terms.targetCompany}`,
    ),
    payReplies.map((reply) => reply.subject).join(' | '),
  );

  // === 3. THE JOB IS DONE. ===
  const afterPay = contentOf((await fetchAt(neoBoard, '/')).body);
  const address = missionAddressForNumber(job)!;
  const scan = await scanOf(address);
  check(
    'the job is completed, and the board fills to three offers with no current contract',
    (await stateOf(neo, job)) === 'completed' &&
      [...afterPay.matchAll(/Ref: [0-9a-f]{6}/g)].length === 3 &&
      !afterPay.includes('Current contract'),
    `state ${await stateOf(neo, job)}`,
  );
  check(
    "the completed contract's address still answers a scan",
    portsOf(scan.body).length > 0,
    `ports [${portsOf(scan.body).join(',')}]`,
  );
  const again = await mail(visitor, { ...rightMail, body: `${key} ${CONTRACTOR_WALLET}\n` });
  check(
    'the same key again is told the job is closed, and pays nothing',
    again.status === 200 &&
      fromClient((await inboxOf(neo)).at(-1), 'That job is already closed.') &&
      (await balanceOf(CONTRACTOR_WALLET)) === terms.pay,
    `balance ${await balanceOf(CONTRACTOR_WALLET)}`,
  );

  // === 4. ANOTHER JOB, PAID WITH NO WALLET. ===
  const second = await acceptOn(neo, neoBoard);
  const secondTerms = missionTerms(second);
  const noWallet = await mail(visitor, {
    handle: neo,
    to: secondTerms.client.handle,
    body: `the key: ${missionKey(second, secret)}\n`,
  });
  const noWalletReply = (await inboxOf(neo)).at(-1);
  check(
    'another offer can be taken, and its key with no wallet completes it and pays nothing',
    second !== job &&
      noWallet.status === 200 &&
      (await stateOf(neo, second)) === 'completed' &&
      noWalletReply?.sender === `${secondTerms.client.handle}@emailit.io` &&
      noWalletReply.body.startsWith(
        'Key received. You sent no wallet, so there is nothing to pay.',
      ) &&
      (await balanceOf(CONTRACTOR_WALLET)) === terms.pay,
    `state ${await stateOf(neo, second)}`,
  );

  // === 5. NO CONTRACT: ANOTHER PLAYER, ANOTHER CLIENT'S CONTRACTOR, AFTER A DROP. ===
  const trin = handleFor('trin');
  await openAccount(trin);
  const elsewhere = await numberOutside(client);
  const placed = await sr.from('hireme_missions').insert({
    number: elsewhere,
    handle: trin,
    state: 'accepted',
    accepted_at: new Date().toISOString(),
  });
  if (placed.error) throw new Error(`contract insert failed: ${placed.error.message}`);
  const strangerMail = await mail(stranger, {
    handle: trin,
    to: client,
    body: `${key} ${NO_WALLET_PROBE}\n`,
  });
  const strangerReply = (await inboxOf(trin)).at(-1);
  check(
    "a contractor of another client mailing this client's right key has no contract",
    strangerMail.status === 200 &&
      strangerReply?.sender === `${client}@emailit.io` &&
      strangerReply.subject === 'No contract' &&
      strangerReply.body.startsWith('We have no contract with you.') &&
      (await stateOf(trin, elsewhere)) === 'accepted' &&
      (await balanceOf(NO_WALLET_PROBE)) === 0,
    `${strangerReply?.subject ?? 'no reply'}`,
  );
  const third = await acceptOn(neo, neoBoard);
  const thirdTerms = missionTerms(third);
  await fetchAt(neoBoard, '/drop', 'confirm=yes');
  const afterDrop = await mail(visitor, {
    handle: neo,
    to: thirdTerms.client.handle,
    body: `${missionKey(third, secret)} ${NO_WALLET_PROBE}\n`,
  });
  const afterDropReply = (await inboxOf(neo)).at(-1);
  check(
    'the right key mailed after dropping the job has no contract, and pays nothing',
    afterDrop.status === 200 &&
      afterDropReply?.subject === 'No contract' &&
      (await stateOf(neo, third)) === 'abandoned' &&
      (await balanceOf(NO_WALLET_PROBE)) === 0,
    `state ${await stateOf(neo, third)}, ${afterDropReply?.subject ?? 'no reply'}`,
  );

  // === 6. WHOEVER HOLDS THE LOGIN IS PAID. ===
  const fourth = await acceptOn(neo, neoBoard);
  const fourthTerms = missionTerms(fourth);
  const stolen = await mail(thief, {
    handle: neo,
    to: fourthTerms.client.handle,
    body: `${missionKey(fourth, secret)}\nsend it to ${THIEF_WALLET}\n`,
  });
  check(
    'another player logged in as the contractor is paid to their own wallet',
    stolen.status === 200 &&
      (await stateOf(neo, fourth)) === 'completed' &&
      (await balanceOf(THIEF_WALLET)) === fourthTerms.pay,
    `balance ${await balanceOf(THIEF_WALLET)} of ${fourthTerms.pay}`,
  );

  // === 7. A PROOF IS A SEND. ===
  const fifth = await acceptOn(neo, neoBoard);
  const fifthTerms = missionTerms(fifth);
  const inboxBeforeRefusals = (await inboxOf(neo)).length;
  const badPassword = await mail(stranger, {
    handle: neo,
    password: 'wrong',
    to: fifthTerms.client.handle,
    body: `${missionKey(fifth, secret)} ${NO_WALLET_PROBE}\n`,
  });
  check(
    'a wrong password is refused as a failed login, and the client mails nothing',
    badPassword.status === 401 &&
      errorOf(badPassword.body) === 'login_failed' &&
      (await inboxOf(neo)).length === inboxBeforeRefusals,
    `status ${badPassword.status}`,
  );
  const seeded = await sr
    .from('email_sends')
    .insert(Array.from({ length: 20 }, () => ({ player_key: busy.publicKeyHex })));
  if (seeded.error) throw new Error(`sends seed failed: ${seeded.error.message}`);
  const limited = await mail(busy, {
    handle: neo,
    to: fifthTerms.client.handle,
    body: `${missionKey(fifth, secret)} ${NO_WALLET_PROBE}\n`,
  });
  check(
    'a player with 20 sends this hour is refused, and the job stays open',
    limited.status === 429 &&
      errorOf(limited.body) === 'send_limited' &&
      (await inboxOf(neo)).length === inboxBeforeRefusals &&
      (await stateOf(neo, fifth)) === 'accepted' &&
      (await balanceOf(NO_WALLET_PROBE)) === 0,
    `status ${limited.status}`,
  );

  // === 8. A TWO-HOP JOB PAYS ITS OWN RANGE, ONCE. ===
  const hopper = handleFor('hop');
  const hopperBoard = await boardFor(hopper);
  const twoHop = await freeTwoHopNumber();
  const twoHopRef = randomBytes(3).toString('hex');
  const offered = await sr
    .from('hireme_missions')
    .insert({ number: twoHop, handle: hopper, state: 'offered', ref: twoHopRef });
  if (offered.error) throw new Error(`offer insert failed: ${offered.error.message}`);
  await fetchAt(hopperBoard, '/accept', `offer=${twoHopRef}`);
  const twoHopTerms = missionTerms(twoHop);
  const twoHopProof = `${missionKey(twoHop, secret)} ${TWO_HOP_WALLET}\n`;
  const twoHopPaid = await mail(stranger, {
    handle: hopper,
    to: twoHopTerms.client.handle,
    body: twoHopProof,
  });
  const twoHopReply = (await inboxOf(hopper)).at(-1);
  check(
    'a two-hop job pays its quoted two-hop pay, and the client says so',
    twoHopPaid.status === 200 &&
      (await stateOf(hopper, twoHop)) === 'completed' &&
      twoHopTerms.pay >= 2000 &&
      twoHopTerms.pay <= 4000 &&
      twoHopReply?.sender === `${twoHopTerms.client.handle}@emailit.io` &&
      twoHopReply.body.startsWith(
        `Key received. §${twoHopTerms.pay.toLocaleString('en-US')} sent to ${TWO_HOP_WALLET}.`,
      ),
    `contract ${twoHop}, §${twoHopTerms.pay}, ${twoHopReply?.body.split('\n')[0] ?? 'no reply'}`,
  );
  await mail(stranger, { handle: hopper, to: twoHopTerms.client.handle, body: twoHopProof });
  check(
    'the same two-hop key again mints nothing more',
    (await balanceOf(TWO_HOP_WALLET)) === twoHopTerms.pay &&
      JSON.stringify(await mintsTo(TWO_HOP_WALLET)) === JSON.stringify([twoHopTerms.pay]),
    `balance ${await balanceOf(TWO_HOP_WALLET)} of ${twoHopTerms.pay}`,
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
