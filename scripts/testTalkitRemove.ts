// Wire-payload smoke for THE OPERATOR REMOVES FROM TALKIT.IO — the operator's
// `scripts/talkitRemove.ts`, run as a child process exactly as the operator runs it,
// against threads and comments written through the REAL /api/network endpoint, then read
// back through it. Against a running `vercel dev` + supabase.
//
// Net-new under test:
//   - A REMOVED COMMENT KEEPS ITS PLACE. `comment <id> <n>` leaves the row with its number
//     and time, its author and body gone, and the thread's page shows `#n [removed]` and
//     nothing more of it. The count and the thread's place on the list stay, and the next
//     comment takes the next number.
//   - A REMOVED THREAD IS GONE. `thread <id>` deletes it and, through the foreign key's
//     cascade, every comment on it: the list no longer has it, its link is a 404, and a
//     comment sent to it answers "No such thread.". The thread beside it is untouched.
//   - NOTHING TO REMOVE CHANGES NOTHING. A comment already removed, a number nobody used
//     and a thread that is not there each exit 1 and leave every row as it was.
//   - A NEAR MISS TOUCHES NOTHING. Words that are not an order, and missing env, exit 2.
//   - THE BOX NEVER HEARS OF IT. A removal adds no line to talkit's access.log or
//     talkit.log.
//
// The threads and comments it writes are signed `wireremove`, and it deletes them, that
// account and its traces before and after.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testTalkitRemove.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentityIn } from '../src/test/factories/identityIn.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { wifiPoolOf } from '../src/core/generation/generateWifi.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { TALKIT_NETWORK, fixedSite } from '../src/core/generation/fixedSites.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { md5 } from '../src/core/generation/md5.js';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const REMOVE_SCRIPT = 'scripts/talkitRemove.ts';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });
/** The database the script names in every line it prints. */
const HOST = new URL(url).host;

const site = fixedSite(TALKIT_NETWORK);
const SITE_IP = siteAddress('talkit.io');
if (site === undefined || SITE_IP === undefined) {
  console.error('talkit.io answers nowhere — the world is unusable.');
  process.exit(2);
}
const machineId = computeApGatewayId(site.key);
const logKey = apGatewayLogWriterKey(site.key);

/** The emailit.io account this check writes as, and its password. */
const WRITER = 'wireremove';
const WRITER_PASSWORD = 'wire-remove-123';

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

/** The script as the operator runs it, its output kept. */
const remove = (words: readonly string[], env: NodeJS.ProcessEnv = process.env) => {
  const run = spawnSync(process.execPath, ['--import', 'tsx', REMOVE_SCRIPT, ...words], {
    env,
    encoding: 'utf8',
  });
  return { status: run.status, out: run.stdout.trim(), err: run.stderr.trim() };
};

const visitor = generateIdentityIn(RIDGEMONT);
const [visitorEssid] = wifiPoolOf(RIDGEMONT);

/** Every thread the writer started, by id. */
const writerThreadIds = async (): Promise<readonly number[]> => {
  const { data } = await sr.from('talkit_threads').select('id').eq('author', WRITER);
  return ((data ?? []) as readonly { id: number }[]).map((row) => row.id);
};

const cleanup = async () => {
  // A removed comment names no author, so the writer's comments are found by their threads.
  const ids = await writerThreadIds();
  await sr.from('talkit_comments').delete().in('thread_id', ids);
  await sr.from('talkit_threads').delete().in('id', ids);
  await sr.from('talkit_writes').delete().eq('player_key', visitor.publicKeyHex);
  await sr.from('email_login_failures').delete().eq('player_key', visitor.publicKeyHex);
  await sr.from('email_accounts').delete().eq('handle', WRITER);
  await sr.from('sessions').delete().eq('player_key', visitor.publicKeyHex);
  await sr.from('home_network_occupants').delete().eq('owner_key', visitor.publicKeyHex);
  await sr.from('patches').delete().eq('machine_id', machineId);
};

/** One of talkit's logs, as the system writes it: under the network's own key. */
const logOf = async (path: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', path)
    .eq('writer_key', logKey)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};
const logs = async () => [await logOf('/var/log/access.log'), await logOf('/var/log/talkit.log')];

type CommentRow = {
  readonly number: number;
  readonly author: string | null;
  readonly body: string | null;
  readonly created_at: string;
};

const commentRows = async (threadId: number): Promise<readonly CommentRow[]> => {
  const { data } = await sr
    .from('talkit_comments')
    .select('number, author, body, created_at')
    .eq('thread_id', threadId)
    .order('number', { ascending: true });
  return (data ?? []) as CommentRow[];
};

const threadRow = async (threadId: number) => {
  const { data } = await sr
    .from('talkit_threads')
    .select('comment_count, last_activity_at')
    .eq('id', threadId)
    .maybeSingle();
  return data as { comment_count: number; last_activity_at: string } | null;
};

/** The thread ids a list page links to, in the order it lists them. */
const listedIds = (page: string): readonly number[] =>
  [...page.matchAll(/<a href="\/thread\?id=(\d+)">/g)].map((match) => Number(match[1]));

const main = async () => {
  console.log(`talkit.io answers at ${SITE_IP}; the script writes to ${HOST}`);
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
  if (joined.status !== 200 || visitorEssid === undefined) {
    console.error(`Could not put the visitor on a network: status ${joined.status}`);
    process.exit(2);
  }
  const { error: accountError } = await sr.from('email_accounts').insert({
    handle: WRITER,
    password_md5: md5(WRITER_PASSWORD),
    signed_up_by: visitor.publicKeyHex,
  });
  if (accountError) {
    console.error(`Could not open the writing account: ${accountError.message}`);
    process.exit(2);
  }

  const fetchPath = (path: string) =>
    post(NETWORK, signRequest(visitor, 'resolveHttpFetch', { target: SITE_IP, port: 80, path }));
  const postForm = (path: string, fields: Readonly<Record<string, string>>) =>
    post(
      NETWORK,
      signRequest(visitor, 'resolveHttpFetch', {
        target: SITE_IP,
        port: 80,
        path,
        body: new URLSearchParams(Object.entries(fields)).toString(),
        login: { handle: WRITER, password: WRITER_PASSWORD },
      }),
    );
  const startThread = async (title: string): Promise<number> => {
    const posted = await postForm('/post', { title, body: `${title}, said once.` });
    return Number(/<a href="\/thread\?id=(\d+)">/.exec(contentOf(posted.body))?.[1] ?? 0);
  };
  const threadPage = async (threadId: number) => {
    const page = await fetchPath(`/thread?id=${threadId}`);
    return { status: page.status, content: contentOf(page.body) };
  };

  // Two threads, the kept one posted last so it leads the list; three comments on the
  // other, sent one after another so each takes the next number.
  const doomed = await startThread('Free WiFi at the mill');
  const kept = await startThread('Router for sale');
  for (const body of ['First.', 'Second, to go.', 'Third.']) {
    await postForm('/comment', { id: String(doomed), body });
  }
  const before = await commentRows(doomed);
  if (doomed === 0 || kept === 0 || before.length !== 3) {
    console.error(`Could not write the threads: #${doomed}, #${kept}, ${before.length} comments`);
    process.exit(2);
  }
  console.log(`Threads #${doomed} (3 comments) and #${kept}\n`);

  // 1. A NEAR MISS TOUCHES NOTHING.
  for (const words of [
    [],
    ['post', String(doomed)],
    ['thread'],
    ['comment', String(doomed)],
    ['comment', String(doomed), '02'],
    ['thread', String(doomed), '2'],
  ]) {
    const refused = remove(words);
    check(
      `\`${words.join(' ')}\` is no order: exit 2, the usage line, nothing touched`,
      refused.status === 2 &&
        refused.err.startsWith('Usage: talkitRemove.ts thread <id> | comment <id> <n>') &&
        refused.out === '',
      `exit ${refused.status}; ${refused.err.split('\n')[0]}`,
    );
  }
  const noEnv = remove(['thread', String(doomed)], { ...process.env, SUPABASE_URL: '' });
  check(
    'missing env exits 2 before anything is touched',
    noEnv.status === 2 && noEnv.err.startsWith('Missing env'),
    `exit ${noEnv.status}; ${noEnv.err}`,
  );
  check(
    'after the near misses, every comment is as it was written',
    JSON.stringify(await commentRows(doomed)) === JSON.stringify(before),
    JSON.stringify((await commentRows(doomed)).map((row) => row.author)),
  );

  // 2. A REMOVED COMMENT KEEPS ITS PLACE.
  const listBefore = listedIds(contentOf((await fetchPath('/threads')).body));
  const threadBefore = await threadRow(doomed);
  const logsBefore = await logs();
  const removed = remove(['comment', String(doomed), '2']);
  // Read straight away: every page fetched after it adds its own access.log line.
  const logsAfter = await logs();
  check(
    'removing a comment names it, its author and the database, then says it is done',
    removed.status === 0 &&
      removed.out ===
        `Removing comment #2 on #${doomed} by "${WRITER}" on ${HOST}\n` +
          `Removed comment #2 on #${doomed}`,
    `exit ${removed.status}; ${removed.out} ${removed.err}`,
  );
  check(
    'the removal adds no line to access.log or talkit.log',
    JSON.stringify(logsAfter) === JSON.stringify(logsBefore),
    `${logsAfter.map((log) => log.split('\n').length).join(' and ')} lines`,
  );
  const afterComment = await commentRows(doomed);
  check(
    'the row keeps its number and its time; its author and body are gone',
    afterComment.length === 3 &&
      afterComment[1]?.number === 2 &&
      afterComment[1]?.created_at === before[1]?.created_at &&
      afterComment[1]?.author === null &&
      afterComment[1]?.body === null &&
      JSON.stringify([afterComment[0], afterComment[2]]) === JSON.stringify([before[0], before[2]]),
    JSON.stringify(afterComment[1]),
  );
  const pageAfterComment = await threadPage(doomed);
  check(
    "the thread's page shows #2 as removed, alone, between #1 and #3",
    pageAfterComment.status === 200 &&
      /<p>#1 by wireremove, [^<]+<\/p>\n<p>First\.<\/p>\n<p>#2 \[removed\]<\/p>\n<p>#3 by wireremove, [^<]+<\/p>\n<p>Third\.<\/p>/.test(
        pageAfterComment.content,
      ) &&
      !pageAfterComment.content.includes('Second, to go.'),
    `status ${pageAfterComment.status}`,
  );
  const listAfterComment = contentOf((await fetchPath('/threads')).body);
  check(
    'the thread still counts 3 comments, in the same place on the list',
    JSON.stringify(listedIds(listAfterComment)) === JSON.stringify(listBefore) &&
      listAfterComment.includes(`>Free WiFi at the mill</a><br>by ${WRITER}, 3 comments, last `) &&
      JSON.stringify(await threadRow(doomed)) === JSON.stringify(threadBefore),
    JSON.stringify(await threadRow(doomed)),
  );

  // 3. NOTHING TO REMOVE CHANGES NOTHING.
  const settled = await commentRows(doomed);
  const again = remove(['comment', String(doomed), '2']);
  check(
    'a comment already removed exits 1 and says so',
    again.status === 1 && again.err === `Comment #2 on #${doomed} is already removed on ${HOST}`,
    `exit ${again.status}; ${again.out} ${again.err}`,
  );
  const unused = remove(['comment', String(doomed), '9']);
  check(
    'a comment number nobody used exits 1 and says so',
    unused.status === 1 && unused.err === `No comment #9 on #${doomed} on ${HOST}`,
    `exit ${unused.status}; ${unused.out} ${unused.err}`,
  );
  check(
    'neither changed a row',
    JSON.stringify(await commentRows(doomed)) === JSON.stringify(settled),
    JSON.stringify(await commentRows(doomed)),
  );

  // 4. THE NEXT COMMENT TAKES THE NEXT NUMBER.
  await postForm('/comment', { id: String(doomed), body: 'Fourth.' });
  const afterFourth = await commentRows(doomed);
  check(
    'the next comment on the thread is #4',
    afterFourth.length === 4 && afterFourth[3]?.number === 4 && afterFourth[3]?.body === 'Fourth.',
    JSON.stringify(afterFourth.map((row) => row.number)),
  );

  // 5. A REMOVED THREAD IS GONE, ITS COMMENTS WITH IT.
  const logsBeforeThread = await logs();
  const gone = remove(['thread', String(doomed)]);
  const logsAfterThread = await logs();
  check(
    'the removal of the thread adds no line to access.log or talkit.log',
    JSON.stringify(logsAfterThread) === JSON.stringify(logsBeforeThread),
    `${logsAfterThread.map((log) => log.split('\n').length).join(' and ')} lines`,
  );
  check(
    'removing a thread names it, its title, author and comments, and the database',
    gone.status === 0 &&
      gone.out ===
        `Removing thread #${doomed} "Free WiFi at the mill" by "${WRITER}", 4 comments, on ${HOST}\n` +
          `Removed thread #${doomed}`,
    `exit ${gone.status}; ${gone.out} ${gone.err}`,
  );
  check(
    'the thread and every comment on it are gone from the database',
    (await threadRow(doomed)) === null && (await commentRows(doomed)).length === 0,
    `${(await commentRows(doomed)).length} comment(s) left`,
  );
  const listAfterThread = listedIds(contentOf((await fetchPath('/threads')).body));
  check(
    'the list no longer has it, and the thread beside it is still there',
    !listAfterThread.includes(doomed) && listAfterThread.includes(kept),
    JSON.stringify(listAfterThread.slice(0, 3)),
  );
  const link = await fetchPath(`/thread?id=${doomed}`);
  check(
    "the removed thread's link is the 404 an unused id gets",
    link.status === 404 && (link.body as { error?: string } | null)?.error === 'not_found',
    `status ${link.status}`,
  );
  const lateComment = await postForm('/comment', { id: String(doomed), body: 'Too late.' });
  check(
    'a comment sent to the removed thread answers "No such thread." and stores nothing',
    contentOf(lateComment.body).includes('<p>No such thread.</p>') &&
      (await commentRows(doomed)).length === 0,
    contentOf(lateComment.body).slice(0, 120),
  );
  const keptPage = await threadPage(kept);
  check(
    'the thread beside it reads as it did',
    keptPage.status === 200 && keptPage.content.includes('<p>Router for sale, said once.</p>'),
    `status ${keptPage.status}`,
  );
  const twice = remove(['thread', String(doomed)]);
  check(
    'a thread that is not there exits 1 and says so',
    twice.status === 1 && twice.err === `No thread #${doomed} on ${HOST}`,
    `exit ${twice.status}; ${twice.out} ${twice.err}`,
  );

  await cleanup();

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
