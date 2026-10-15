// Wire-payload smoke for READING MAIL — `resolveMail` through the REAL /api/network endpoint
// against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - AN INBOX OPENS TO ITS PASSWORD. `resolveMail` with a handle and its password answers
//     the inbox through `email_inbox`: the welcome a sign-up left, number 1, unread.
//   - A MESSAGE OPENS, AND IS MARKED READ. With a `number`, `email_read` answers the message
//     and its body and marks it read in the same step; a number the inbox does not hold
//     answers `no_message`, and one that is no message number is turned away.
//   - A FAILED LOGIN SAYS NOTHING ABOUT WHICH HALF WAS WRONG. A wrong password and a handle
//     nobody holds answer the same, and each is counted against the guesser's key.
//   - GUESSES ARE HELD BACK PER GUESSER. After 5 failures in a minute every check from that
//     key is refused, the right password included, and a refused check counts nothing.
//     Another player is not held back, and once the failures are a minute old the right
//     password works again. Parallel guesses queue on the lock: 8 at once fail 5 and are
//     refused 3.
//   - A DARK EMAILIT.IO HAS NO MAIL, and mail leaves no line in emailit.io's access log.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMailRead.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { EMAILIT_DOMAIN, EMAILIT_NETWORK } from '../src/core/generation/fixedSites.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { ACCESS_LOG_PATH } from '../src/core/logging/accessLog.js';
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

const signUp = (player: Identity, handle: string, password: string) =>
  post(
    signRequest(player, 'resolveHttpFetch', {
      target: EMAILIT_IP,
      port: 80,
      path: '/signup',
      body: `handle=${handle}&password=${password}`,
    }),
  );

/** The list, or with a `number` that one message, marked read as `mail read` asks. */
const mail = (player: Identity, fields: Record<string, unknown>) =>
  post(
    signRequest(
      player,
      'resolveMail',
      'number' in fields ? { op: 'read', mark: true, ...fields } : { op: 'list', ...fields },
    ),
  );

const failuresOf = async (player: Identity): Promise<number> => {
  const { count, error } = await sr
    .from('email_login_failures')
    .select('*', { count: 'exact', head: true })
    .eq('player_key', player.publicKeyHex);
  if (error) throw new Error(`failure count failed: ${error.message}`);
  return count ?? 0;
};

const emailitLog = async (): Promise<string> => {
  const { data, error } = await sr
    .from('patches')
    .select('writer_key, content')
    .eq('machine_id', EMAILIT_MACHINE)
    .eq('path', ACCESS_LOG_PATH);
  if (error) throw new Error(`log read failed: ${error.message}`);
  const rows = (data ?? []) as readonly { writer_key: string; content: string | null }[];
  return rows
    .filter((row) => row.writer_key === apGatewayLogWriterKey(EMAILIT_NETWORK))
    .map((row) => row.content ?? '')
    .join('\n');
};

const cleanup = async () => {
  const keys = players.map((player) => player.publicKeyHex);
  if (keys.length > 0) {
    await sr.from('email_accounts').delete().in('signed_up_by', keys);
    await sr.from('email_login_failures').delete().in('player_key', keys);
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
  const handle = `neo${RUN}`;
  const signedUp = await signUp(neo, handle, 's3cret');
  if (signedUp.status !== 200) throw new Error(`sign-up failed: ${signedUp.status}`);
  const logBefore = await emailitLog();

  // 1. AN INBOX OPENS TO ITS PASSWORD.
  const listed = await mail(neo, { handle, password: 's3cret' });
  const messages = (listed.body as { messages?: readonly Record<string, unknown>[] } | null)
    ?.messages;
  const [welcome] = messages ?? [];
  check(
    'the inbox lists the welcome as message 1 from noreply@emailit.io, unread',
    listed.status === 200 &&
      messages?.length === 1 &&
      welcome?.number === 1 &&
      welcome.sender === 'noreply@emailit.io' &&
      welcome.subject === 'Welcome to emailit.io' &&
      welcome.read === false &&
      !Number.isNaN(Date.parse(String(welcome.delivered_at))),
    `status ${listed.status} ${JSON.stringify(listed.body)}`,
  );

  // 2. A MESSAGE OPENS, AND IS MARKED READ.
  const opened = await mail(neo, { handle, password: 's3cret', number: 1 });
  const message = (opened.body as { message?: Record<string, unknown> } | null)?.message;
  check(
    'read 1 answers the welcome and its body',
    opened.status === 200 &&
      message?.number === 1 &&
      String(message.body).startsWith(`Welcome to emailit.io, ${handle}.`),
    `status ${opened.status}`,
  );
  const relisted = await mail(neo, { handle, password: 's3cret' });
  const [reread] =
    (relisted.body as { messages?: readonly Record<string, unknown>[] } | null)?.messages ?? [];
  check('the welcome lists as read afterwards', reread?.read === true, JSON.stringify(reread));
  const missing = await mail(neo, { handle, password: 's3cret', number: 7 });
  check(
    'a number the inbox does not hold answers no_message',
    missing.status === 404 && errorOf(missing.body) === 'no_message',
    `status ${missing.status} ${JSON.stringify(missing.body)}`,
  );
  const zero = await mail(neo, { handle, password: 's3cret', number: 0 });
  check('a number that is no message number is turned away', zero.status === 400, `${zero.status}`);

  // 3. A FAILED LOGIN SAYS NOTHING ABOUT WHICH HALF WAS WRONG.
  const prober = newPlayer();
  const wrong = await mail(prober, { handle, password: 'nope' });
  const nobody = await mail(prober, { handle: `nobody${RUN}`, password: 's3cret' });
  check(
    'a wrong password and an unknown handle answer the same login_failed',
    wrong.status === 401 &&
      nobody.status === 401 &&
      JSON.stringify(wrong.body) === JSON.stringify(nobody.body) &&
      errorOf(wrong.body) === 'login_failed',
    `${wrong.status} ${JSON.stringify(wrong.body)} / ${nobody.status} ${JSON.stringify(nobody.body)}`,
  );
  check(
    "both failures count against the guesser's key",
    (await failuresOf(prober)) === 2,
    `${await failuresOf(prober)} failures`,
  );
  const wrongRead = await mail(prober, { handle, password: 'nope', number: 1 });
  check(
    'a wrong password opens no message either, and counts too',
    wrongRead.status === 401 && (await failuresOf(prober)) === 3,
    `status ${wrongRead.status}, ${await failuresOf(prober)} failures`,
  );

  // 4. GUESSES ARE HELD BACK PER GUESSER.
  await mail(prober, { handle, password: 'nope' });
  await mail(prober, { handle, password: 'nope' });
  const heldBack = await mail(prober, { handle, password: 's3cret' });
  check(
    'after 5 failures in a minute, even the right password is refused',
    heldBack.status === 429 && errorOf(heldBack.body) === 'throttled',
    `status ${heldBack.status} ${JSON.stringify(heldBack.body)}`,
  );
  check(
    'a refused check counts nothing',
    (await failuresOf(prober)) === 5,
    `${await failuresOf(prober)} failures`,
  );
  const owner = await mail(neo, { handle, password: 's3cret' });
  check(
    'the account is not locked: its owner, another key, still gets in',
    owner.status === 200,
    `status ${owner.status}`,
  );
  const { error: ageError } = await sr
    .from('email_login_failures')
    .update({ failed_at: new Date(Date.now() - 61_000).toISOString() })
    .eq('player_key', prober.publicKeyHex);
  if (ageError) throw new Error(`ageing failed: ${ageError.message}`);
  const later = await mail(prober, { handle, password: 's3cret' });
  check(
    'once the failures are a minute old, the right password works again',
    later.status === 200 && (await failuresOf(prober)) === 0,
    `status ${later.status}, ${await failuresOf(prober)} failures left`,
  );

  const swarm = newPlayer();
  const guesses = await Promise.all(
    Array.from({ length: 8 }, () => mail(swarm, { handle, password: 'nope' })),
  );
  const failedGuesses = guesses.filter((guess) => guess.status === 401).length;
  const refusedGuesses = guesses.filter((guess) => guess.status === 429).length;
  check(
    '8 guesses at once fail 5 and are refused 3',
    failedGuesses === 5 && refusedGuesses === 3 && (await failuresOf(swarm)) === 5,
    `${failedGuesses} failed, ${refusedGuesses} refused`,
  );

  // 5. MAIL LEAVES NO LINE IN EMAILIT.IO'S ACCESS LOG.
  check(
    "reading mail wrote nothing to emailit.io's access log",
    (await emailitLog()) === logBefore,
    `${(await emailitLog()).length - logBefore.length} characters added`,
  );

  // 6. A DARK EMAILIT.IO HAS NO MAIL.
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
  const dark = await mail(neo, { handle, password: 's3cret' });
  check(
    'with emailit.io bricked, the inbox does not answer',
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
