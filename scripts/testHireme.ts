// Wire-payload smoke for HIREME.IO APPLICATIONS — a form POSTed through the REAL
// /api/network endpoint against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - AN APPLICATION MAILS A BOARD. `resolveHttpFetch` at hireme.io's address, path
//     `/apply`, with a `body`, makes the handle's board through `hireme_apply` and mails its
//     address from jobs@hireme.io as the inbox's next message. The page thanks the reader
//     and never shows the address.
//   - THE ADDRESS IS DRAWN ONCE. A repeat inside 24 hours sends nothing; after 24 hours the
//     mail names the SAME address. Two handles hold two addresses, and an address another
//     handle holds is refused as `collision` with nothing written.
//   - SYSTEM MAIL IGNORES THE CAP. A full inbox (100 messages) still receives it.
//   - REFUSALS WRITE NOTHING. An empty address, another domain, an impossible handle and a
//     handle with no account are each refused, and no board is made.
//   - THE LOG HOLDS A POST, NEVER THE FORM. And a fetch of `/apply` with no form serves the
//     form and mails nobody.
//   - A DARK BOX TAKES NO APPLICATION. With hireme.io bricked, nothing is stored.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testHireme.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { HIREME_DOMAIN, HIREME_NETWORK } from '../src/core/generation/fixedSites.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { ACCESS_LOG_PATH } from '../src/core/logging/accessLog.js';
import { WEB_PAGE_FILE } from '../src/core/generation/baseFs.js';
import { md5 } from '../src/core/generation/md5.js';

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

const HIREME_IP = siteAddress(HIREME_DOMAIN) ?? '';
const HIREME_MACHINE = computeApGatewayId(HIREME_NETWORK);

/** A board's address, as the table's CHECK holds it. */
const BOARD_ADDRESS = /^194\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** A suffix no earlier run used, so every handle here is fresh. */
const RUN = Date.now().toString(36).slice(-6);
const handleFor = (name: string): string => `${name}${RUN}`;

/** The player every account here is signed up by, so they can all be removed afterwards. */
const owner = generateIdentity();
const visitor = generateIdentity();

/** An emailit account for `handle`, opened straight in the store with an empty inbox. */
const openAccount = async (handle: string) => {
  const { error } = await sr.from('email_accounts').insert({
    handle,
    password_md5: md5('s3cret'),
    signed_up_by: owner.publicKeyHex,
  });
  if (error) throw new Error(`account insert failed: ${error.message}`);
};

const applyWith = (form: string, path = '/apply') =>
  post(signRequest(visitor, 'resolveHttpFetch', { target: HIREME_IP, port: 80, path, body: form }));

type Message = { number: number; sender: string; subject: string; body: string };

const inbox = async (handle: string): Promise<readonly Message[]> => {
  const { data, error } = await sr
    .from('email_messages')
    .select('number, sender, subject, body')
    .eq('handle', handle)
    .order('number');
  if (error) throw new Error(`inbox read failed: ${error.message}`);
  return (data ?? []) as readonly Message[];
};

type Board = { handle: string; address: string; applied_at: string; mailed_at: string };

const boardOf = async (handle: string): Promise<Board | null> => {
  const { data, error } = await sr
    .from('hireme_boards')
    .select('handle, address, applied_at, mailed_at')
    .eq('handle', handle);
  if (error) throw new Error(`board read failed: ${error.message}`);
  return ((data ?? []) as readonly Board[])[0] ?? null;
};

const logOf = async (): Promise<string> => {
  const { data, error } = await sr
    .from('patches')
    .select('writer_key, content')
    .eq('machine_id', HIREME_MACHINE)
    .eq('path', ACCESS_LOG_PATH);
  if (error) throw new Error(`log read failed: ${error.message}`);
  const rows = (data ?? []) as readonly { writer_key: string; content: string | null }[];
  return rows
    .filter((row) => row.writer_key === apGatewayLogWriterKey(HIREME_NETWORK))
    .map((row) => row.content ?? '')
    .join('\n');
};

const cleanup = async () => {
  // Boards and messages go with their accounts.
  await sr.from('email_accounts').delete().eq('signed_up_by', owner.publicKeyHex);
  // The brick, if a failed run left it behind.
  await sr.from('patches').delete().eq('machine_id', HIREME_MACHINE).eq('path', '/boot/vmlinuz');
};

const THANKS = (handle: string) =>
  `Thanks, ${handle}. We have sent your contractor board to ${handle}@emailit.io.`;

const ALREADY = 'We already have your application. Check your inbox.';

const main = async () => {
  if (HIREME_IP === '') {
    console.error('hireme.io has no address');
    process.exit(2);
  }

  // 1. AN APPLICATION MAILS A BOARD, AND THE PAGE NEVER SHOWS IT.
  const neo = handleFor('neo');
  await openAccount(neo);
  const applied = await applyWith(`email=${neo}%40emailit.io`);
  const page = contentOf(applied.body);
  check(
    'an application answers with thanks, naming the mailbox',
    applied.status === 200 && page.includes(THANKS(neo)),
    `status ${applied.status}`,
  );
  check('the page holds no board address', !page.includes('194.'), 'searched for 194.');
  const neoBoard = await boardOf(neo);
  check(
    'the handle now holds a board in the 194 block',
    neoBoard !== null && BOARD_ADDRESS.test(neoBoard.address),
    JSON.stringify(neoBoard),
  );
  const neoAddress = neoBoard?.address ?? '(none)';
  const [mailed] = await inbox(neo);
  check(
    "the board's address waits as the inbox's next message, from jobs@hireme.io",
    mailed?.number === 1 &&
      mailed.sender === 'jobs@hireme.io' &&
      mailed.subject === 'Your hireme.io application' &&
      mailed.body.startsWith(`Thanks for applying, ${neo}.`) &&
      mailed.body.includes(`Your contractor board is at http://${neoAddress}/`) &&
      mailed.body.includes(`  lynx http://${neoAddress}/`) &&
      !mailed.body.includes('{address}'),
    JSON.stringify(mailed ?? null),
  );

  // 2. A REPEAT INSIDE 24 HOURS SENDS NOTHING, HOWEVER THE ADDRESS IS TYPED.
  const repeat = await applyWith(`email=+${neo.toUpperCase()}+`);
  const neoAfterRepeat = await boardOf(neo);
  check(
    'a repeat inside 24 hours, padded and in capitals, is told the application is in',
    repeat.status === 200 &&
      contentOf(repeat.body).includes(ALREADY) &&
      !contentOf(repeat.body).includes('194.'),
    `status ${repeat.status}`,
  );
  check(
    'the repeat mailed nothing and moved nothing',
    (await inbox(neo)).length === 1 && neoAfterRepeat?.mailed_at === neoBoard?.mailed_at,
    JSON.stringify(neoAfterRepeat),
  );

  // 3. AFTER 24 HOURS THE MAIL NAMES THE SAME ADDRESS.
  const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const { error: backdateError } = await sr
    .from('hireme_boards')
    .update({ mailed_at: dayAgo })
    .eq('handle', neo);
  if (backdateError) throw new Error(`backdate failed: ${backdateError.message}`);
  const again = await applyWith(`email=${neo}`);
  const neoAfterDay = await boardOf(neo);
  const [, remailed] = await inbox(neo);
  check(
    'after 24 hours a bare handle applies again and is thanked',
    again.status === 200 && contentOf(again.body).includes(THANKS(neo)),
    `status ${again.status}`,
  );
  check(
    'the re-sent mail is message 2 and names the address already held',
    remailed?.number === 2 &&
      remailed.body.includes(`http://${neoAddress}/`) &&
      neoAfterDay?.address === neoAddress &&
      neoAfterDay.mailed_at > dayAgo,
    JSON.stringify({ board: neoAfterDay, body: remailed?.body ?? null }),
  );

  // 4. TWO HANDLES, TWO ADDRESSES; A HELD ADDRESS IS A COLLISION.
  const trin = handleFor('trin');
  await openAccount(trin);
  await applyWith(`email=${trin}`);
  const trinBoard = await boardOf(trin);
  check(
    'a second handle gets a board of its own at another address',
    trinBoard !== null && BOARD_ADDRESS.test(trinBoard.address) && trinBoard.address !== neoAddress,
    JSON.stringify(trinBoard),
  );
  const tank = handleFor('tank');
  await openAccount(tank);
  const { data: collided, error: collideError } = await sr.rpc('hireme_apply', {
    apply_handle: tank,
    candidate_address: neoAddress,
    mail_sender: 'jobs@hireme.io',
    mail_subject: 'Your hireme.io application',
    mail_body: 'http://{address}/',
  });
  check(
    'an address another handle holds is refused as a collision, and nothing is written',
    collideError === null &&
      collided === 'collision' &&
      (await boardOf(tank)) === null &&
      (await inbox(tank)).length === 0,
    `${JSON.stringify(collided)} ${collideError?.message ?? ''}`,
  );

  // 5. A FULL INBOX STILL RECEIVES IT.
  const full = handleFor('full');
  await openAccount(full);
  const { error: fillError } = await sr.from('email_messages').insert(
    Array.from({ length: 100 }, (_unused, index) => ({
      handle: full,
      number: index + 1,
      sender: 'filler@emailit.io',
      subject: 'filler',
      body: 'filler',
    })),
  );
  if (fillError) throw new Error(`fill failed: ${fillError.message}`);
  const { error: numberError } = await sr
    .from('email_accounts')
    .update({ next_number: 101 })
    .eq('handle', full);
  if (numberError) throw new Error(`numbering failed: ${numberError.message}`);
  const intoFull = await applyWith(`email=${full}`);
  const fullInbox = await inbox(full);
  check(
    'a full inbox of 100 messages still receives the application mail, as message 101',
    contentOf(intoFull.body).includes(THANKS(full)) &&
      fullInbox.length === 101 &&
      fullInbox[100]?.sender === 'jobs@hireme.io',
    `${fullInbox.length} message(s)`,
  );

  // 6. REFUSALS WRITE NOTHING.
  const nobody = handleFor('nobody');
  const refusals: readonly (readonly [string, string])[] = [
    ['email=', 'Enter your emailit.io address'],
    [`email=${neo}%40gmail.com`, 'Only emailit.io addresses can apply'],
    ['email=a!b', 'No such mailbox'],
    [`email=${nobody}`, 'No such mailbox'],
  ];
  for (const [form, message] of refusals) {
    const refused = await applyWith(form);
    check(
      `${form} is refused: ${message}`,
      refused.status === 200 && contentOf(refused.body).includes(`<p role="alert">${message}</p>`),
      `status ${refused.status}`,
    );
  }
  check('no refusal made a board', (await boardOf(nobody)) === null, 'checked the unknown handle');

  // 7. THE LOG HOLDS A POST, NEVER THE FORM; GOING BACK MAILS NOBODY.
  const log = await logOf();
  check(
    "hireme.io's access log records the applications as POSTs",
    log.includes('"POST /apply HTTP/1.1" 200'),
    log.trimEnd().split('\n').slice(-1)[0] ?? '(empty)',
  );
  check(
    'no form from this run appears in the log',
    ![neo, trin, full, nobody, 'email='].some((typed) => log.includes(typed)),
    'searched for every handle sent',
  );
  const back = await post(
    signRequest(visitor, 'resolveHttpFetch', { target: HIREME_IP, port: 80, path: '/apply' }),
  );
  check(
    'a fetch of /apply with no form serves the form and mails nobody',
    back.status === 200 &&
      contentOf(back.body).includes('<form action="/apply" method="post">') &&
      (await inbox(trin)).length === 1,
    `status ${back.status}`,
  );
  const atFront = await applyWith(`email=${trin}`, '/');
  check(
    'hireme.io refuses a form anywhere but /apply',
    atFront.status === 405,
    `status ${atFront.status}`,
  );

  // 8. A DARK BOX TAKES NO APPLICATION.
  const { error: brickError } = await sr.from('patches').upsert(
    {
      machine_id: HIREME_MACHINE,
      path: '/boot/vmlinuz',
      content: null,
      owner: 'root',
      permissions: WEB_PAGE_FILE,
      node_type: 'file',
      writer_key: visitor.publicKeyHex,
      is_new: true,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (brickError) throw new Error(`brick failed: ${brickError.message}`);
  const dark = handleFor('dark');
  await openAccount(dark);
  const darkApplied = await applyWith(`email=${dark}`);
  check(
    'with hireme.io bricked, an application is refused and nothing is stored',
    darkApplied.status === 404 &&
      (darkApplied.body as { error?: unknown } | null)?.error === 'host_unreachable' &&
      (await boardOf(dark)) === null &&
      (await inbox(dark)).length === 0,
    `status ${darkApplied.status} ${JSON.stringify(darkApplied.body)}`,
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
