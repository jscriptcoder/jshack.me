// Wire-payload smoke for EMAILIT.IO SIGN-UP — a form POSTed through the REAL /api/network
// endpoint against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - A FORM IS A FETCH WITH A BODY. `resolveHttpFetch` at emailit.io's address, path
//     `/signup`, with a `body`, opens an account through the `email_signup` function and
//     answers with the welcome page. The account row holds the md5 of the password, never
//     the password, and the welcome waits as message 1 from noreply@emailit.io, unread.
//   - THE STORE DECIDES WHAT ONLY IT CAN. A handle taken in any case, the 3-a-day cap,
//     and the race for one handle are decided inside the function: five parallel sign-ups
//     by one player open exactly 3 accounts, and two players claiming one handle at once
//     leave exactly one owner. A refused sign-up costs nothing toward the cap.
//   - EVERY OTHER SERVER REFUSES A FORM. findit.io answers a POST with 405, and both boxes
//     log the request as the POST it was, never with the form.
//   - GOING BACK NEVER SIGNS UP. A fetch of `/signup` with no body, which is how a browser
//     goes back to a page it reached by signing up, serves the form, logs a GET, and
//     opens no account.
//   - A DARK BOX SIGNS NOBODY UP. With emailit.io bricked, a sign-up is refused like any
//     fetch of a dark box, and nothing is stored.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testEmailitSignup.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import {
  EMAILIT_DOMAIN,
  EMAILIT_NETWORK,
  FINDIT_DOMAIN,
  FINDIT_NETWORK,
} from '../src/core/generation/fixedSites.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { ACCESS_LOG_PATH } from '../src/core/logging/accessLog.js';
import { WEB_PAGE_FILE } from '../src/core/generation/baseFs.js';
import { md5 } from '../src/core/generation/md5.js';

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

const contentOf = (body: unknown): string => {
  const content = (body as { content?: unknown } | null)?.content;
  return typeof content === 'string' ? content : '';
};

const EMAILIT_IP = siteAddress(EMAILIT_DOMAIN) ?? '';
const FINDIT_IP = siteAddress(FINDIT_DOMAIN) ?? '';
const EMAILIT_MACHINE = computeApGatewayId(EMAILIT_NETWORK);
const FINDIT_MACHINE = computeApGatewayId(FINDIT_NETWORK);

/** A suffix no earlier run used, so every handle here is fresh. */
const RUN = Date.now().toString(36).slice(-6);
const handleFor = (name: string): string => `${name}${RUN}`;

/** Every player this run made, so their accounts can be removed afterwards. */
const players: Identity[] = [];
const newPlayer = (): Identity => {
  const player = generateIdentity();
  players.push(player);
  return player;
};

const signUp = (player: Identity, form: string, path = '/signup') =>
  post(signRequest(player, 'resolveHttpFetch', { target: EMAILIT_IP, port: 80, path, body: form }));

const accountsOf = async (player: Identity) => {
  const { data, error } = await sr
    .from('email_accounts')
    .select('handle, password_md5, signed_up_by')
    .eq('signed_up_by', player.publicKeyHex);
  if (error) throw new Error(`account read failed: ${error.message}`);
  return (data ?? []) as readonly { handle: string; password_md5: string; signed_up_by: string }[];
};

const account = async (handle: string) => {
  const { data, error } = await sr
    .from('email_accounts')
    .select('handle, password_md5, signed_up_by')
    .eq('handle', handle);
  if (error) throw new Error(`account read failed: ${error.message}`);
  return (data ?? []) as readonly { handle: string; password_md5: string; signed_up_by: string }[];
};

const inbox = async (handle: string) => {
  const { data, error } = await sr
    .from('email_messages')
    .select('number, sender, subject, body, read')
    .eq('handle', handle)
    .order('number');
  if (error) throw new Error(`inbox read failed: ${error.message}`);
  return (data ?? []) as readonly {
    number: number;
    sender: string;
    subject: string;
    body: string;
    read: boolean;
  }[];
};

const logOf = async (machineId: string, network: string): Promise<string> => {
  const { data, error } = await sr
    .from('patches')
    .select('writer_key, content')
    .eq('machine_id', machineId)
    .eq('path', ACCESS_LOG_PATH);
  if (error) throw new Error(`log read failed: ${error.message}`);
  const rows = (data ?? []) as readonly { writer_key: string; content: string | null }[];
  return rows
    .filter((row) => row.writer_key === apGatewayLogWriterKey(network))
    .map((row) => row.content ?? '')
    .join('\n');
};

const cleanup = async () => {
  const keys = players.map((player) => player.publicKeyHex);
  if (keys.length > 0) {
    await sr.from('email_accounts').delete().in('signed_up_by', keys);
  }
  // The brick, if a failed run left it behind.
  await sr.from('patches').delete().eq('machine_id', EMAILIT_MACHINE).eq('path', '/boot/vmlinuz');
};

const main = async () => {
  if (EMAILIT_IP === '' || FINDIT_IP === '') {
    console.error('emailit.io or findit.io has no address');
    process.exit(2);
  }

  // 1. A SIGN-UP OPENS AN ACCOUNT AND DELIVERS ITS WELCOME.
  const neo = newPlayer();
  const neoHandle = handleFor('neo');
  const welcomed = await signUp(neo, `handle=${neoHandle}&password=s3cret`);
  check(
    'a sign-up answers with the welcome page',
    welcomed.status === 200 &&
      contentOf(welcomed.body).includes(`Welcome, ${neoHandle}@emailit.io`),
    `status ${welcomed.status}`,
  );
  const [neoAccount] = await account(neoHandle);
  check(
    'the account holds the md5 of the password, and the key that made it',
    neoAccount?.password_md5 === md5('s3cret') && neoAccount.signed_up_by === neo.publicKeyHex,
    JSON.stringify(neoAccount ?? null),
  );
  const [welcome] = await inbox(neoHandle);
  check(
    'the welcome waits as message 1 from noreply@emailit.io, unread',
    welcome?.number === 1 &&
      welcome.sender === 'noreply@emailit.io' &&
      welcome.subject === 'Welcome to emailit.io' &&
      welcome.body.startsWith(`Welcome to emailit.io, ${neoHandle}.`) &&
      !welcome.read,
    JSON.stringify(welcome ?? null),
  );

  // 2. A HANDLE IN ANY CASE IS ONE ADDRESS, AND IT IS TAKEN.
  const trinity = newPlayer();
  const taken = await signUp(trinity, `handle=${neoHandle.toUpperCase()}&password=other`);
  check(
    'a second sign-up for the handle, in capitals, is told it is taken',
    taken.status === 200 && contentOf(taken.body).includes('That handle is taken'),
    `status ${taken.status}`,
  );
  const neoRows = await account(neoHandle);
  check(
    'the taken handle still has its first owner, and only one row',
    neoRows.length === 1 && neoRows[0]?.signed_up_by === neo.publicKeyHex,
    `${neoRows.length} row(s)`,
  );

  // 3. REFUSALS STORE NOTHING, AND THE FORM IS DECODED.
  const refused = await signUp(trinity, 'handle=postmaster&password=s3cret');
  const short = await signUp(trinity, `handle=${handleFor('short')}&password=abc`);
  check(
    'a reserved handle and a short password are refused before anything is stored',
    contentOf(refused.body).includes('&quot;postmaster&quot; is a reserved system name') &&
      contentOf(short.body).includes('Password must be at least 4 characters') &&
      (await accountsOf(trinity)).length === 0,
    `${(await accountsOf(trinity)).length} account(s)`,
  );
  const encodedHandle = handleFor('encoded');
  await signUp(trinity, `handle=${encodedHandle}&password=a%26b+c`);
  const [encoded] = await account(encodedHandle);
  check(
    'the form is decoded: %26 is &, + is a space',
    encoded?.password_md5 === md5('a&b c'),
    JSON.stringify(encoded ?? null),
  );

  // 4. THE CAP: 3 A DAY, REFUSALS FREE.
  const morpheus = newPlayer();
  await signUp(morpheus, 'handle=1bad&password=s3cret');
  const opened = [];
  for (const name of ['mone', 'mtwo', 'mthree']) {
    opened.push(await signUp(morpheus, `handle=${handleFor(name)}&password=s3cret`));
  }
  const fourth = await signUp(morpheus, `handle=${handleFor('mfour')}&password=s3cret`);
  check(
    'a refused sign-up costs nothing; the 4th success in a day is capped',
    opened.every((response) => contentOf(response.body).includes('Welcome,')) &&
      contentOf(fourth.body).includes('You have signed up 3 addresses today') &&
      (await accountsOf(morpheus)).length === 3,
    `${(await accountsOf(morpheus)).length} account(s)`,
  );

  // 5. THE RACES.
  const smith = newPlayer();
  await Promise.all(
    ['sa', 'sb', 'sc', 'sd', 'se'].map((name) =>
      signUp(smith, `handle=${handleFor(name)}&password=s3cret`),
    ),
  );
  const smithAccounts = await accountsOf(smith);
  check(
    'five parallel sign-ups by one player open exactly 3 accounts',
    smithAccounts.length === 3,
    `${smithAccounts.length} account(s)`,
  );
  const contested = handleFor('oracle');
  const [first, second] = await Promise.all([
    signUp(newPlayer(), `handle=${contested}&password=one1`),
    signUp(newPlayer(), `handle=${contested}&password=two2`),
  ]);
  const contestedRows = await account(contested);
  const answers = [contentOf(first?.body), contentOf(second?.body)];
  check(
    'two players claiming one handle at once leave exactly one owner, and one is told it is taken',
    contestedRows.length === 1 &&
      (await inbox(contested)).length === 1 &&
      answers.filter((page) => page.includes('Welcome,')).length === 1 &&
      answers.filter((page) => page.includes('That handle is taken')).length === 1,
    `${contestedRows.length} row(s)`,
  );

  // 6. THE LOGS: POST, NEVER THE FORM.
  const emailitLog = await logOf(EMAILIT_MACHINE, EMAILIT_NETWORK);
  check(
    "emailit.io's access log records the sign-up as a POST",
    emailitLog.includes('"POST /signup HTTP/1.1" 200'),
    emailitLog.trimEnd().split('\n').slice(-1)[0] ?? '(empty)',
  );
  check(
    'no password from this run appears in the log',
    !['s3cret', 'a%26b', 'one1', 'two2'].some((password) => emailitLog.includes(password)),
    'searched for every password sent',
  );
  const atFindit = await post(
    signRequest(neo, 'resolveHttpFetch', { target: FINDIT_IP, port: 80, path: '/', body: 'q=x' }),
  );
  check(
    'findit.io answers a POST with 405, naming its server',
    atFindit.status === 405 &&
      (atFindit.body as { error?: unknown; server?: unknown } | null)?.error ===
        'method_not_allowed' &&
      typeof (atFindit.body as { server?: unknown } | null)?.server === 'string',
    `status ${atFindit.status} ${JSON.stringify(atFindit.body)}`,
  );
  const atEmailitFront = await signUp(neo, 'handle=x&password=y', '/');
  check(
    'emailit.io refuses a form anywhere but /signup',
    atEmailitFront.status === 405,
    `status ${atEmailitFront.status}`,
  );
  const visitor = newPlayer();
  const backToSignup = await post(
    signRequest(visitor, 'resolveHttpFetch', { target: EMAILIT_IP, port: 80, path: '/signup' }),
  );
  check(
    'a fetch of /signup with no form serves the form and signs nobody up',
    backToSignup.status === 200 &&
      contentOf(backToSignup.body).includes('<form action="/signup" method="post">') &&
      (await accountsOf(visitor)).length === 0,
    `status ${backToSignup.status}`,
  );
  const emailitLogAfterGet = await logOf(EMAILIT_MACHINE, EMAILIT_NETWORK);
  check(
    "emailit.io's access log records that fetch as a GET",
    emailitLogAfterGet.includes('"GET /signup HTTP/1.1" 200'),
    emailitLogAfterGet.trimEnd().split('\n').slice(-1)[0] ?? '(empty)',
  );
  const finditLog = await logOf(FINDIT_MACHINE, FINDIT_NETWORK);
  check(
    "findit.io's access log records the refused POST as a 405",
    finditLog.includes('"POST / HTTP/1.1" 405'),
    finditLog.trimEnd().split('\n').slice(-1)[0] ?? '(empty)',
  );

  // 7. A DARK BOX SIGNS NOBODY UP.
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
  const darkHandle = handleFor('dark');
  const dark = await signUp(newPlayer(), `handle=${darkHandle}&password=s3cret`);
  check(
    'with emailit.io bricked, a sign-up is refused and nothing is stored',
    dark.status === 404 &&
      (dark.body as { error?: unknown } | null)?.error === 'host_unreachable' &&
      (await account(darkHandle)).length === 0,
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
