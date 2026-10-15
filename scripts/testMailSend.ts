// Wire-payload smoke for SENDING MAIL — `resolveMail` with `op: 'send'` through the REAL
// /api/network endpoint against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - A MESSAGE ARRIVES IN ANOTHER INBOX. One player's send lands in the other's inbox at
//     its next number, unread, from the sender's address, with its subject and body; the
//     next one takes the number after.
//   - A BOUNCE SAYS WHY. A handle nobody holds and a system sender (`noreply`) answer
//     `no_mailbox`; an inbox holding 100 messages answers `mailbox_full`.
//   - THE SENDER PROVES THE ADDRESS. A wrong password answers `login_failed`, delivers
//     nothing and is counted against the guesser's key.
//   - SIZES ARE COUNTED AS A READER COUNTS THEM. An 81-character subject is turned away
//     before the store; 80 emoji are one subject of 80 characters, and delivered.
//   - SENDS ARE HELD TO 20 AN HOUR PER SENDER. Bounces count; a failed login and a send
//     turned away before the store do not. The 21st is refused and delivers nothing, while
//     another player is not held back, and once the oldest send is an hour old the next
//     goes. Parallel sends queue on the lock: 25 at once go 20 and are refused 5.
//   - A DARK EMAILIT.IO DELIVERS NOTHING.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMailSend.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { EMAILIT_DOMAIN, EMAILIT_NETWORK } from '../src/core/generation/fixedSites.js';
import { WEB_PAGE_FILE } from '../src/core/generation/baseFs.js';

type Identity = ReturnType<typeof generateIdentity>;

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

const errorOf = (body: unknown): unknown => (body as { error?: unknown } | null)?.error;

const EMAILIT_IP = siteAddress(EMAILIT_DOMAIN) ?? '';
const EMAILIT_MACHINE = computeApGatewayId(EMAILIT_NETWORK);

/** A suffix no earlier run used, so every handle here is fresh. */
const RUN = Date.now().toString(36).slice(-6);

/** Every player this run made, so their accounts and failures can be removed afterwards. */
const players: Identity[] = [];
const newPlayer = (): Identity => {
  const player = generateIdentity();
  players.push(player);
  return player;
};

const signUp = async (player: Identity, handle: string) => {
  const signedUp = await post(
    signRequest(player, 'resolveHttpFetch', {
      target: EMAILIT_IP,
      port: 80,
      path: '/signup',
      body: `handle=${handle}&password=s3cret`,
    }),
  );
  if (signedUp.status !== 200) throw new Error(`sign-up of ${handle} failed: ${signedUp.status}`);
};

const send = (
  player: Identity,
  fields: { handle: string; password?: string; to: string; subject?: string; body?: string },
) =>
  post(
    signRequest(player, 'resolveMail', {
      op: 'send',
      password: 's3cret',
      subject: 'hello there',
      body: 'hi\n',
      ...fields,
    }),
  );

type Listed = { number: number; sender: string; subject: string; read: boolean };

const inboxOf = async (player: Identity, handle: string): Promise<readonly Listed[]> => {
  const listed = await post(
    signRequest(player, 'resolveMail', { op: 'list', handle, password: 's3cret' }),
  );
  return (listed.body as { messages?: readonly Listed[] } | null)?.messages ?? [];
};

const failuresOf = async (player: Identity): Promise<number> => {
  const { count, error } = await sr
    .from('email_login_failures')
    .select('*', { count: 'exact', head: true })
    .eq('player_key', player.publicKeyHex);
  if (error) throw new Error(`failure count failed: ${error.message}`);
  return count ?? 0;
};

const sendsOf = async (player: Identity): Promise<readonly string[]> => {
  const { data, error } = await sr
    .from('email_sends')
    .select('sent_at')
    .eq('player_key', player.publicKeyHex)
    .order('sent_at');
  if (error) throw new Error(`send count failed: ${error.message}`);
  return ((data ?? []) as readonly { sent_at: string }[]).map((row) => row.sent_at);
};

const cleanup = async () => {
  const keys = players.map((player) => player.publicKeyHex);
  if (keys.length > 0) {
    await sr.from('email_accounts').delete().in('signed_up_by', keys);
    await sr.from('email_login_failures').delete().in('player_key', keys);
    await sr.from('email_sends').delete().in('player_key', keys);
  }
  // The brick, if a failed run left it behind.
  await sr.from('patches').delete().eq('machine_id', EMAILIT_MACHINE).eq('path', '/boot/vmlinuz');
};

const main = async () => {
  if (EMAILIT_IP === '') {
    console.error('emailit.io has no address');
    process.exit(2);
  }

  const neo = newPlayer();
  const trin = newPlayer();
  const from = `neo${RUN}`;
  const to = `trin${RUN}`;
  await signUp(neo, from);
  await signUp(trin, to);

  // 1. A MESSAGE ARRIVES IN ANOTHER INBOX.
  const sent = await send(neo, { handle: from, to, body: 'meet me at the docks\n' });
  check(
    'a send answers that the message went',
    sent.status === 200 && JSON.stringify(sent.body) === '{"ok":true}',
    `status ${sent.status} ${JSON.stringify(sent.body)}`,
  );
  const [, arrived] = await inboxOf(trin, to);
  check(
    "it lists in the recipient's inbox as message 2, unread, from the sender",
    arrived?.number === 2 &&
      arrived.sender === `${from}@emailit.io` &&
      arrived.subject === 'hello there' &&
      arrived.read === false,
    JSON.stringify(arrived),
  );
  const opened = await post(
    signRequest(trin, 'resolveMail', { op: 'read', handle: to, password: 's3cret', number: 2 }),
  );
  const body = (opened.body as { message?: { body?: string } } | null)?.message?.body;
  check('its body arrives as written', body === 'meet me at the docks\n', JSON.stringify(body));
  await send(neo, { handle: from, to, subject: 'again' });
  const numbers = (await inboxOf(trin, to)).map((message) => message.number);
  check('the next message takes the next number', numbers.join() === '1,2,3', numbers.join());
  const own = (await inboxOf(neo, from)).map((message) => message.number);
  check('the sender keeps no copy', own.join() === '1', own.join());

  // 2. A BOUNCE SAYS WHY.
  const ghost = await send(neo, { handle: from, to: `ghost${RUN}` });
  check(
    'a handle nobody holds bounces as no_mailbox',
    ghost.status === 404 && errorOf(ghost.body) === 'no_mailbox',
    `status ${ghost.status} ${JSON.stringify(ghost.body)}`,
  );
  const system = await send(neo, { handle: from, to: 'noreply' });
  check(
    'a system sender bounces as no_mailbox',
    system.status === 404 && errorOf(system.body) === 'no_mailbox',
    `status ${system.status} ${JSON.stringify(system.body)}`,
  );
  const filler = Array.from({ length: 97 }, (_unused, index) => ({
    handle: to,
    number: index + 4,
    sender: 'noreply@emailit.io',
    subject: 'filler',
    body: '',
  }));
  const { error: fillError } = await sr.from('email_messages').insert(filler);
  if (fillError) throw new Error(`fill failed: ${fillError.message}`);
  await sr.from('email_accounts').update({ next_number: 101 }).eq('handle', to);
  const full = await send(neo, { handle: from, to });
  const held = (await inboxOf(trin, to)).length;
  check(
    'an inbox holding 100 bounces as mailbox_full, and stays at 100',
    full.status === 409 && errorOf(full.body) === 'mailbox_full' && held === 100,
    `status ${full.status} ${JSON.stringify(full.body)}, ${held} held`,
  );

  // 3. THE SENDER PROVES THE ADDRESS.
  const stranger = newPlayer();
  const forged = await send(stranger, { handle: from, password: 'nope', to: from });
  const forgedArrived = (await inboxOf(neo, from)).length;
  check(
    'a wrong password answers login_failed, delivers nothing and counts a failure',
    forged.status === 401 &&
      errorOf(forged.body) === 'login_failed' &&
      forgedArrived === 1 &&
      (await failuresOf(stranger)) === 1,
    `status ${forged.status} ${JSON.stringify(forged.body)}, ${forgedArrived} in the inbox`,
  );

  // 4. SIZES ARE COUNTED AS A READER COUNTS THEM.
  const long = await send(neo, { handle: from, to: from, subject: 'x'.repeat(81) });
  check(
    'an 81-character subject is turned away',
    long.status === 400 && errorOf(long.body) === 'payload_invalid',
    `status ${long.status} ${JSON.stringify(long.body)}`,
  );
  const emoji = String.fromCodePoint(0x1f600).repeat(80);
  const wide = await send(neo, { handle: from, to: from, subject: emoji });
  const [, wideArrived] = await inboxOf(neo, from);
  check(
    'a subject of 80 emoji is delivered whole',
    wide.status === 200 && wideArrived?.subject === emoji,
    `status ${wide.status} ${JSON.stringify(wide.body)}`,
  );

  // 5. SENDS ARE HELD TO 20 AN HOUR PER SENDER.
  const neoSends = (await sendsOf(neo)).length;
  check(
    'bounces count as sends, and sends turned away before the store do not',
    neoSends === 6,
    `${neoSends} counted for 3 delivered, 3 bounced and 1 turned away`,
  );
  const strangerSends = (await sendsOf(stranger)).length;
  check('a failed login counts as no send', strangerSends === 0, `${strangerSends} counted`);

  const spammer = newPlayer();
  const spam = `spam${RUN}`;
  await signUp(spammer, spam);
  for (let i = 0; i < 19; i++) {
    await send(spammer, { handle: spam, to: spam, subject: `spam ${i}` });
  }
  await send(spammer, { handle: spam, to: `ghost${RUN}` });
  const limited = await send(spammer, { handle: spam, to: spam, subject: 'one too many' });
  const spamHeld = (await inboxOf(spammer, spam)).length;
  check(
    'the 21st send in an hour is refused as send_limited and delivers nothing',
    limited.status === 429 && errorOf(limited.body) === 'send_limited' && spamHeld === 20,
    `status ${limited.status} ${JSON.stringify(limited.body)}, ${spamHeld} in the inbox`,
  );
  const other = await send(neo, { handle: from, to: from, subject: 'not held' });
  check('another player is not held back', other.status === 200, `status ${other.status}`);

  const [oldest] = await sendsOf(spammer);
  const { error: ageError } = await sr
    .from('email_sends')
    .update({ sent_at: new Date(Date.now() - 61 * 60 * 1000).toISOString() })
    .eq('player_key', spammer.publicKeyHex)
    .eq('sent_at', oldest ?? '');
  if (ageError) throw new Error(`ageing failed: ${ageError.message}`);
  const later = await send(spammer, { handle: spam, to: spam, subject: 'an hour on' });
  check(
    'once the oldest send is an hour old, the next goes',
    later.status === 200 && (await sendsOf(spammer)).length === 20,
    `status ${later.status} ${JSON.stringify(later.body)}`,
  );

  const swarm = newPlayer();
  const swarmHandle = `swarm${RUN}`;
  await signUp(swarm, swarmHandle);
  const burst = await Promise.all(
    Array.from({ length: 25 }, (_unused, index) =>
      send(swarm, { handle: swarmHandle, to: swarmHandle, subject: `burst ${index}` }),
    ),
  );
  const went = burst.filter((sent) => sent.status === 200).length;
  const refused = burst.filter((sent) => errorOf(sent.body) === 'send_limited').length;
  check(
    '25 sends at once go 20 and are refused 5',
    went === 20 && refused === 5 && (await sendsOf(swarm)).length === 20,
    `${went} went, ${refused} refused`,
  );

  // 6. A DARK EMAILIT.IO DELIVERS NOTHING.
  const { error: brickError } = await sr.from('patches').upsert(
    {
      machine_id: EMAILIT_MACHINE,
      path: '/boot/vmlinuz',
      content: null,
      owner: 'root',
      permissions: WEB_PAGE_FILE,
      node_type: 'file',
      writer_key: neo.publicKeyHex,
      is_new: true,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (brickError) throw new Error(`brick failed: ${brickError.message}`);
  const dark = await send(neo, { handle: from, to: from });
  check(
    'with emailit.io bricked, a send is not delivered',
    dark.status === 404 && errorOf(dark.body) === 'host_unreachable',
    `status ${dark.status} ${JSON.stringify(dark.body)}`,
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
