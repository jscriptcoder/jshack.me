// Wire-payload smoke for TALKIT.IO — the valley's forum answered by the REAL /api/network
// endpoint against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE SITE IS AT ITS ADDRESS. `resolveHttpFetch` at talkit's derived address serves
//     the front page it was generated with, and findit lists it for a forum.
//   - THE LIST READS THE TABLE. `/threads` is answered from `talkit_threads` through
//     api/network.ts's own select: the latest activity first, equal times by the newer
//     thread, 20 a page, `older` and `newer` between pages, the welcome thread last.
//   - A THREAD READS ITS ROW. `/thread?id=<n>` shows its title, author, time and body, and
//     an id that names no thread is a 404.
//   - NO PLAYER TEXT BECOMES MARKUP. Threads whose titles and bodies are markup show as
//     the text they are, on the list and on the thread; only an http:// address links.
//   - THE TABLE REFUSES what a forum must never store: a CR, an ESC or a NUL in a body,
//     a line break in a title.
//   - EVERY LOOK IS LOGGED in talkit's own access.log, a 404 included.
//   - THE FORUM IS NOT A FILE. A root's `/var/www/html/threads` or `thread` changes no
//     view; a stopped or bricked talkit answers none; the operator's real
//     `scripts/guardian.ts restore talkit.io` brings them back with every thread untouched.
//   - A PLAYER STARTS A THREAD. A form POSTed to `/post` with an emailit.io login beside
//     it goes up through api/network.ts's `talkit_post` call, signed with the handle, its
//     line breaks kept; the list shows it first, talkit.log names who posted from where,
//     and access.log has the POST but never the form. No login, a wrong password, a bad
//     title or body, or a 21st post in the hour stores nothing; five wrong passwords in a
//     minute throttle every post; the store itself refuses a control character.
//   - A PLAYER COMMENTS. A form POSTed to `/comment` naming a thread goes up through
//     api/network.ts's `talkit_comment` call as the next number on that thread, and the
//     thread's page shows it, read by api/network.ts's own select. The thread goes to the
//     top of the list with its count; talkit.log names the comment, its thread, who wrote
//     it and from where. Comments sent together are numbered one after another. No login,
//     a wrong password, an id naming no thread, or a bad body stores nothing and moves no
//     thread; posts and comments share the 20 an hour; the store refuses a control
//     character; five wrong passwords in a minute throttle every comment.
//
// It needs the forum to hold only its welcome thread, as a fresh database does: the
// threads it seeds are signed `wirecheck`, the ones it posts and the comments it writes
// `wirepost` and `wirepost2`, and it deletes them, and those two accounts, before and
// after.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testTalkit.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { wifiPoolOf } from '../src/core/generation/generateWifi.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { FINDIT_DOMAIN, TALKIT_NETWORK, fixedSite } from '../src/core/generation/fixedSites.js';
import { WEB_PAGE_FILE } from '../src/core/generation/baseFs.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { TALKIT_FRONT_PAGE } from '../src/core/talkit/pages.js';
import { escapeHtml } from '../src/core/findit/page.js';
import { ledgerTime } from '../src/core/wallet/historyLine.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { md5 } from '../src/core/generation/md5.js';
import { publicAddressOf } from './publicAddressOf.js';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

const site = fixedSite(TALKIT_NETWORK);
const SITE_IP = siteAddress('talkit.io');
if (site === undefined || SITE_IP === undefined) {
  console.error('talkit.io answers nowhere — the world is unusable.');
  process.exit(2);
}
const machineId = computeApGatewayId(site.key);
const logKey = apGatewayLogWriterKey(site.key);

/** Who signs the threads this check seeds, so it can find and delete them. */
const SEEDER = 'wirecheck';
const SEEDED = 44;

/** The emailit.io accounts this check posts as, and the password both hold. */
const POSTER = 'wirepost';
const OTHER_POSTER = 'wirepost2';
const POSTER_PASSWORD = 'wire-pass-123';

const PAYLOADS = [
  '<script>alert(1)</script>',
  '"><form action=/comment method=post><input type=submit>',
  '</textarea>',
  '&lt;b&gt;',
  'javascript:alert(1)',
  'http://x.io/a"onmouseover="1',
] as const;
const LINKED_BODY = 'Ask findit: http://findit.io/?q=router. Not https://x.io though.';

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

/** A thread's page before the comment form it ends with: everything players wrote, and
 *  the only part a raw payload must never appear in, since the form holds the page's own
 *  `<textarea>`. */
const beforeCommentForm = (page: string): string => page.split('<h2>Comment</h2>')[0] ?? page;

const errorOf = (body: unknown): string =>
  String((body as { error?: unknown } | null)?.error ?? '');

/** talkit's access log, as the system writes it: under the network's own key. */
const accessLog = async (): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', '/var/log/access.log')
    .eq('writer_key', logKey)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};

/** The address of the first result on a findit results page, as a reader would follow it. */
const firstResultHost = (resultsPage: string): string =>
  /<li>\s*<h2><a href="http:\/\/([^/"]+)\//.exec(resultsPage)?.[1] ?? '';

/** The thread ids a list page links to, in the order it lists them. */
const listedIds = (page: string): readonly number[] =>
  [...page.matchAll(/<a href="\/thread\?id=(\d+)">/g)].map((match) => Number(match[1]));

const pagingLinks = (page: string): readonly string[] =>
  [...page.matchAll(/<a href="(\/threads\?page=\d+)">(newer|older)<\/a>/g)].map(
    (match) => `${match[2]} ${match[1]}`,
  );

const visitor = generateIdentity();
const [visitorEssid] = wifiPoolOf(RIDGEMONT);

const threadCount = async (): Promise<number | null> => {
  const { count } = await sr.from('talkit_threads').select('id', { count: 'exact', head: true });
  return count;
};

const cleanup = async () => {
  // Comments first: a comment names its thread, so the thread cannot go while it stands.
  await sr.from('talkit_comments').delete().in('author', [POSTER, OTHER_POSTER]);
  await sr.from('talkit_threads').delete().in('author', [SEEDER, POSTER, OTHER_POSTER]);
  await sr.from('talkit_writes').delete().eq('player_key', visitor.publicKeyHex);
  await sr.from('email_login_failures').delete().eq('player_key', visitor.publicKeyHex);
  await sr.from('email_accounts').delete().in('handle', [POSTER, OTHER_POSTER]);
  await sr.from('sessions').delete().eq('player_key', visitor.publicKeyHex);
  await sr.from('home_network_occupants').delete().eq('owner_key', visitor.publicKeyHex);
  await sr.from('patches').delete().eq('machine_id', machineId);
};

/** A row a root's write would leave in talkit's journal, seeded via service_role: no
 *  root-tier hole is open on the site's schedule today. A null content is an `rm`. */
const seedRootWrite = async (path: string, content: string | null) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: machineId,
      path,
      content,
      owner: 'root',
      permissions: WEB_PAGE_FILE,
      node_type: 'file',
      writer_key: visitor.publicKeyHex,
      is_new: false,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (error) throw new Error(`seed of ${path} failed: ${error.message}`);
};

/** What seeded thread `index` says: the payloads first, then a body with links, then
 *  plain threads. */
const seededThread = (index: number): { readonly title: string; readonly body: string } => {
  const payload = PAYLOADS[index - 1];
  if (payload !== undefined) return { title: payload, body: payload };
  if (index === PAYLOADS.length + 1) return { title: 'Links', body: LINKED_BODY };
  return { title: `Thread ${index}`, body: `Body ${index}\nsecond line` };
};

/**
 * When seeded thread `index` was last active. Each is a second after the one before,
 * except the last two, which share a second (the newer thread must come first), and the
 * very first, which is the latest of all, as a comment would leave it.
 */
const activityOf = (base: number, index: number): string => {
  const seconds = index === 0 ? SEEDED + 100 : Math.min(index, SEEDED - 2);
  return new Date(base + seconds * 1000).toISOString();
};

const main = async () => {
  console.log(`talkit.io answers at ${SITE_IP} (machine ${machineId})`);
  await cleanup();
  if ((await threadCount()) !== 1) {
    console.error('The forum holds threads besides its welcome; this check needs a fresh one.');
    process.exit(2);
  }

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
  const visitorIp = publicAddressOf(visitorEssid);
  console.log(`Visitor on ${visitorEssid} at ${visitorIp}\n`);

  const fetchFrom = (target: string, path: string) =>
    post(NETWORK, signRequest(visitor, 'resolveHttpFetch', { target, port: 80, path }));
  const fetchPath = (path: string) => fetchFrom(SITE_IP, path);
  const FINDIT_IP = siteAddress(FINDIT_DOMAIN) ?? '';

  // 1. THE FRONT PAGE IS SERVED AS GENERATED, AND FINDIT LISTS THE SITE FOR A FORUM.
  const front = await fetchPath('/');
  check(
    'the front page is served as generated',
    front.status === 200 && contentOf(front.body) === TALKIT_FRONT_PAGE,
    contentOf(front.body).slice(0, 80) || `status ${front.status}`,
  );
  const forum = firstResultHost(contentOf((await fetchFrom(FINDIT_IP, '/?q=forum')).body));
  check('a search for a forum answers with talkit.io first', forum === 'talkit.io', forum);

  // 2. A FRESH FORUM LISTS ITS WELCOME THREAD.
  const { data: welcomeRow } = await sr
    .from('talkit_threads')
    .select('created_at')
    .eq('id', 1)
    .maybeSingle();
  const welcomeAt = ledgerTime(
    new Date((welcomeRow as { created_at?: string } | null)?.created_at ?? 0).toISOString(),
  );
  const fresh = contentOf((await fetchPath('/threads')).body);
  check(
    'a fresh forum lists the welcome thread, by talkit, with no comments',
    fresh.includes(
      `<a href="/thread?id=1">Welcome to talkit.io</a><br>by talkit, 0 comments, last ${welcomeAt}`,
    ) && pagingLinks(fresh).length === 0,
    fresh.slice(fresh.indexOf('<hr>'), fresh.indexOf('<hr>') + 120),
  );
  const welcome = await fetchPath('/thread?id=1');
  check(
    'the welcome thread shows its title, its author and time, and its rules',
    welcome.status === 200 &&
      contentOf(welcome.body).includes('<h2>Welcome to talkit.io</h2>') &&
      contentOf(welcome.body).includes(`<p>by talkit, ${welcomeAt}</p>`) &&
      contentOf(welcome.body).includes('Posts are permanent: nobody can edit or delete') &&
      contentOf(welcome.body).includes('<p>No comments yet.</p>'),
    `status ${welcome.status}`,
  );

  // 3. 44 MORE THREADS: THE LIST PAGES BY LATEST ACTIVITY, EQUAL TIMES BY THE NEWER.
  const base = Date.now() + 60_000;
  const { data: inserted, error: seedError } = await sr
    .from('talkit_threads')
    .insert(
      Array.from({ length: SEEDED }, (_unused, index) => ({
        author: SEEDER,
        ...seededThread(index),
        last_activity_at: activityOf(base, index),
      })),
    )
    .select('id');
  const ids = ((inserted ?? []) as readonly { id: number }[]).map((row) => row.id);
  if (seedError || ids.length !== SEEDED) {
    console.error(`Could not seed the threads: ${seedError?.message ?? `${ids.length} rows`}`);
    process.exit(2);
  }
  const idOf = (index: number): number => ids[index] ?? 0;
  // The first thread is the latest active; the rest go newest first, which also puts the
  // later of the two that share a second ahead of the earlier.
  const expected = [idOf(0), ...ids.slice(1).reverse(), 1];
  // One after another: each look appends to talkit's access.log by reading it and writing
  // it back, so looks in parallel can drop each other's line, which check 7 reads.
  const pages: string[] = [];
  for (const path of ['/threads', '/threads?page=2', '/threads?page=3']) {
    pages.push(contentOf((await fetchPath(path)).body));
  }
  const [page1 = '', page2 = '', page3 = ''] = pages;
  check(
    'page 1 lists the 20 latest active, with only an older link',
    JSON.stringify(listedIds(page1)) === JSON.stringify(expected.slice(0, 20)) &&
      JSON.stringify(pagingLinks(page1)) === JSON.stringify(['older /threads?page=2']),
    `${JSON.stringify(listedIds(page1).slice(0, 4))}…; ${JSON.stringify(pagingLinks(page1))}`,
  );
  check(
    'page 2 lists the next 20, newer and older both linked',
    JSON.stringify(listedIds(page2)) === JSON.stringify(expected.slice(20, 40)) &&
      JSON.stringify(pagingLinks(page2)) ===
        JSON.stringify(['newer /threads?page=1', 'older /threads?page=3']),
    `${JSON.stringify(listedIds(page2).slice(0, 4))}…; ${JSON.stringify(pagingLinks(page2))}`,
  );
  check(
    'page 3 lists the last 5, the welcome thread last, with only a newer link',
    JSON.stringify(listedIds(page3)) === JSON.stringify(expected.slice(40)) &&
      JSON.stringify(pagingLinks(page3)) === JSON.stringify(['newer /threads?page=2']),
    `${JSON.stringify(listedIds(page3))}; ${JSON.stringify(pagingLinks(page3))}`,
  );
  const tied = listedIds(page1).slice(1, 3);
  check(
    'of two threads active in the same second, the newer is listed first',
    JSON.stringify(tied) === JSON.stringify([idOf(SEEDED - 1), idOf(SEEDED - 2)]),
    JSON.stringify(tied),
  );
  const past = contentOf((await fetchPath('/threads?page=9')).body);
  check('page 9 holds no threads', past.includes('<p>No threads here.</p>'), 'No threads here.');
  for (const asked of ['0', 'x', '-1']) {
    const refused = await fetchPath(`/threads?page=${asked}`);
    check(
      `page ${asked} is no page`,
      refused.status === 200 && contentOf(refused.body).includes('<p>No such page.</p>'),
      `status ${refused.status}`,
    );
  }

  // 4. A THREAD READS ITS ROW; AN ID THAT NAMES NONE IS A 404.
  const plainId = idOf(PAYLOADS.length + 2);
  const plain = await fetchPath(`/thread?id=${plainId}`);
  check(
    'a thread shows its body with each line break a <br>',
    plain.status === 200 &&
      contentOf(plain.body).includes(`<h2>Thread ${PAYLOADS.length + 2}</h2>`) &&
      contentOf(plain.body).includes(`<p>by ${SEEDER}, `) &&
      contentOf(plain.body).includes(`<p>Body ${PAYLOADS.length + 2}<br>second line</p>`),
    `status ${plain.status}`,
  );
  for (const path of ['/thread?id=999999', '/thread?id=abc', '/thread?id=', '/thread']) {
    const missing = await fetchPath(path);
    check(
      `${path} is a page that is not there`,
      missing.status === 404 && errorOf(missing.body) === 'not_found',
      `status ${missing.status} ${errorOf(missing.body)}`,
    );
  }

  // 5. NO PLAYER TEXT BECOMES MARKUP, ON THE LIST OR ON A THREAD.
  const listed = pages.join('\n');
  for (const [index, payload] of PAYLOADS.entries()) {
    const shown = await fetchPath(`/thread?id=${idOf(index + 1)}`);
    const threadText = beforeCommentForm(contentOf(shown.body));
    const escaped = escapeHtml(payload);
    check(
      `${payload.slice(0, 40)} shows as text on the list and on its thread`,
      listed.includes(`">${escaped}</a><br>by ${SEEDER}`) &&
        threadText.includes(`<h2>${escaped}</h2>`) &&
        (escaped === payload || (!threadText.includes(payload) && !listed.includes(payload))),
      `status ${shown.status}`,
    );
  }
  const quoted = contentOf((await fetchPath(`/thread?id=${idOf(PAYLOADS.length)}`)).body);
  check(
    'an address ends at a quote, so the quote cannot become an attribute',
    quoted.includes('<a href="http://x.io/a">http://x.io/a</a>&quot;onmouseover=&quot;1</p>'),
    'http://x.io/a',
  );
  const links = contentOf((await fetchPath(`/thread?id=${idOf(PAYLOADS.length + 1)}`)).body);
  check(
    'an http address links, its full stop outside it, and https stays text',
    links.includes(
      'Ask findit: <a href="http://findit.io/?q=router">http://findit.io/?q=router</a>. Not https://x.io though.',
    ),
    'findit link',
  );

  // 6. THE TABLE REFUSES WHAT A FORUM MUST NEVER STORE.
  const countBefore = await threadCount();
  for (const [what, row] of [
    ['a CR in a body', { title: 'cr', body: 'one\rtwo' }],
    ['an ESC in a body', { title: 'esc', body: 'one\u001b[31mtwo' }],
    ['a NUL in a body', { title: 'nul', body: 'one\u0000two' }],
    ['a line break in a title', { title: 'one\ntwo', body: 'body' }],
  ] as const) {
    const { error } = await sr.from('talkit_threads').insert({ author: SEEDER, ...row });
    check(`the table refuses ${what}`, error !== null, error?.message ?? 'stored');
  }
  check(
    'nothing refused was stored',
    (await threadCount()) === countBefore,
    `${countBefore} → ${await threadCount()}`,
  );

  // 7. EVERY LOOK IS LOGGED ON TALKIT, VISITOR AND ALL, A 404 INCLUDED.
  const lines = (await accessLog()).split('\n');
  for (const [path, status] of [
    ['/threads', 200],
    ['/threads?page=2', 200],
    ['/thread?id=1', 200],
    ['/thread?id=999999', 404],
  ] as const) {
    const line = lines.find((logged) => logged.includes(`"GET ${path} HTTP/1.1" ${status} `)) ?? '';
    check(
      `a look at ${path} lands in talkit’s access.log as a ${status}, with the visitor’s address`,
      line.includes(visitorIp),
      line || '(no line)',
    );
  }

  // 8. A ROOT'S FILE AT A VIEW'S PATH CHANGES NO VIEW; THE FRONT PAGE IS THEIRS TO DEFACE.
  await seedRootWrite('/var/www/html/threads', '<html>FORGED</html>\n');
  await seedRootWrite('/var/www/html/thread', '<html>FORGED</html>\n');
  await seedRootWrite('/var/www/html/index.html', '<html>DEFACED</html>\n');
  const listAfterForgery = contentOf((await fetchPath('/threads')).body);
  const threadAfterForgery = contentOf((await fetchPath('/thread?id=1')).body);
  check(
    'planted /var/www/html/threads and thread change neither view',
    listedIds(listAfterForgery).length === 20 &&
      threadAfterForgery.includes('<h2>Welcome to talkit.io</h2>') &&
      !listAfterForgery.includes('FORGED') &&
      !threadAfterForgery.includes('FORGED'),
    `${listAfterForgery.slice(0, 40)} / ${threadAfterForgery.slice(0, 40)}`,
  );
  check(
    'a rewritten front page is served at /',
    contentOf((await fetchPath('/')).body) === '<html>DEFACED</html>\n',
    contentOf((await fetchPath('/')).body).slice(0, 40),
  );

  // 9. A STOPPED OR BRICKED TALKIT ANSWERS NO VIEW; THE RESTORE BRINGS THEM BACK.
  const dark = async (): Promise<readonly { status: number; body: unknown }[]> => [
    await fetchPath('/threads'),
    await fetchPath('/thread?id=1'),
  ];
  const isDark = (answers: readonly { status: number; body: unknown }[]) =>
    answers.every((answer) => answer.status === 404 && errorOf(answer.body) === 'host_unreachable');
  await seedRootWrite(`/var/run/${SERVICE_CATALOG.http.pidfile}`, null);
  const stopped = await dark();
  check(
    'a talkit whose web server was stopped answers no view',
    isDark(stopped),
    stopped.map((answer) => answer.status).join(', '),
  );
  await seedRootWrite('/boot/vmlinuz', null);
  const bricked = await dark();
  check(
    'a bricked talkit answers no view',
    isDark(bricked),
    bricked.map((answer) => answer.status).join(', '),
  );
  const restored = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/guardian.ts', 'restore', 'talkit.io'],
    { env: process.env, encoding: 'utf8' },
  );
  const frontAfterRestore = await fetchPath('/');
  const viewsAfterRestore = await dark();
  const { count: seededAfterRestore } = await sr
    .from('talkit_threads')
    .select('id', { count: 'exact', head: true })
    .eq('author', SEEDER);
  check(
    'guardian.ts restore talkit.io brings back the front page and the views, every thread kept',
    restored.status === 0 &&
      contentOf(frontAfterRestore.body) === TALKIT_FRONT_PAGE &&
      viewsAfterRestore.every((view) => view.status === 200) &&
      seededAfterRestore === SEEDED,
    `restore exit ${restored.status}; views ${viewsAfterRestore
      .map((view) => view.status)
      .join(', ')}; ${seededAfterRestore} seeded thread(s)`,
  );

  // 10. A PLAYER STARTS A THREAD. The seeded threads are dated ahead of now, so they go
  //     first, and a new post leads the list.
  await sr.from('talkit_threads').delete().eq('author', SEEDER);
  const { error: accountError } = await sr.from('email_accounts').insert(
    [POSTER, OTHER_POSTER].map((handle) => ({
      handle,
      password_md5: md5(POSTER_PASSWORD),
      signed_up_by: visitor.publicKeyHex,
    })),
  );
  if (accountError) {
    console.error(`Could not open the posting accounts: ${accountError.message}`);
    process.exit(2);
  }
  type Login = { readonly handle: string; readonly password: string };
  const loginAs = (handle: string, password: string = POSTER_PASSWORD): Login => ({
    handle,
    password,
  });
  const postForm = (
    fields: Readonly<Record<string, string>>,
    login: Login | null = loginAs(POSTER),
    path: string = '/post',
  ) =>
    post(
      NETWORK,
      signRequest(visitor, 'resolveHttpFetch', {
        target: SITE_IP,
        port: 80,
        path,
        body: new URLSearchParams(Object.entries(fields)).toString(),
        ...(login === null ? {} : { login }),
      }),
    );
  /** The thread a "Posted" page links to, or 0 when the page is no such answer. */
  const postedId = (body: unknown): number =>
    Number(/<a href="\/thread\?id=(\d+)">Read your thread<\/a>/.exec(contentOf(body))?.[1] ?? 0);
  /** The reason a "Not posted" page gives. */
  const refusalOf = (body: unknown): string =>
    /<hr>\s*<p>([^<]*)<\/p>/.exec(contentOf(body))?.[1] ?? contentOf(body).slice(0, 80);
  const threadRow = async (id: number) => {
    const { data } = await sr
      .from('talkit_threads')
      .select('author, title, body')
      .eq('id', id)
      .maybeSingle();
    return data as { author: string; title: string; body: string } | null;
  };
  const talkitLog = async (): Promise<string> => {
    const { data } = await sr
      .from('patches')
      .select('content')
      .eq('machine_id', machineId)
      .eq('path', '/var/log/talkit.log')
      .eq('writer_key', logKey)
      .maybeSingle();
    return (data as { content?: string } | null)?.content ?? '';
  };

  const first = await postForm({ title: 'My new router', body: 'It blinks.\r\nAll night.' });
  const firstId = postedId(first.body);
  const firstRow = await threadRow(firstId);
  check(
    'a form posted with a login goes up, signed with its handle, its CRLF a line break',
    first.status === 200 &&
      contentOf(first.body).includes(`<p>Posted as ${POSTER}.</p>`) &&
      firstRow?.author === POSTER &&
      firstRow.title === 'My new router' &&
      firstRow.body === 'It blinks.\nAll night.',
    `status ${first.status}; ${JSON.stringify(firstRow)}`,
  );
  const listWithPost = contentOf((await fetchPath('/threads')).body);
  check(
    'the new thread leads the list, by its poster, with no comments',
    listedIds(listWithPost)[0] === firstId &&
      listWithPost.includes(`>My new router</a><br>by ${POSTER}, 0 comments, last `),
    JSON.stringify(listedIds(listWithPost).slice(0, 3)),
  );
  check(
    'its page shows the body with the line break where it was typed',
    contentOf((await fetchPath(`/thread?id=${firstId}`)).body).includes(
      '<p>It blinks.<br>All night.</p>',
    ),
    `/thread?id=${firstId}`,
  );
  const postLine = (await talkitLog()).split('\n')[0] ?? '';
  check(
    'talkit.log names the thread, its poster and the address it came from',
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /.test(postLine) &&
      postLine.endsWith(` post #${firstId} by ${POSTER} from ${visitorIp}`),
    postLine || '(no line)',
  );
  const logAfterPost = await accessLog();
  check(
    'access.log has the POST from the visitor, and never the form or the password',
    logAfterPost
      .split('\n')
      .some((line) => line.includes(visitorIp) && line.includes('"POST /post HTTP/1.1" 200 ')) &&
      !logAfterPost.includes(POSTER_PASSWORD) &&
      !logAfterPost.includes('blinks'),
    logAfterPost.split('\n').find((line) => line.includes('POST')) ?? '(no line)',
  );

  const storedBefore = await threadCount();
  for (const [what, fields, login, said] of [
    ['with no login', { title: 'Hi', body: 'there' }, null, 'Not logged in to emailit.io.'],
    [
      'with a wrong password',
      { title: 'Hi', body: 'there' },
      loginAs(POSTER, 'not-the-password'),
      `Login failed for ${POSTER}@emailit.io.`,
    ],
    ['with a blank title', { title: '  ', body: 'b' }, loginAs(POSTER), 'A title is 1 to 80'],
    [
      'with an 81-character title',
      { title: 'x'.repeat(81), body: 'b' },
      loginAs(POSTER),
      'A title is 1 to 80',
    ],
    [
      'with a title of two lines',
      { title: 'one\ntwo', body: 'b' },
      loginAs(POSTER),
      'A title is 1 to 80',
    ],
    [
      'with a 4,001-character body',
      { title: 'Hi', body: 'x'.repeat(4001) },
      loginAs(POSTER),
      'A post is 1 to 4,000',
    ],
    ['with a NUL in the body', { title: 'Hi', body: 'a\u0000b' }, loginAs(POSTER), 'control'],
    ['with an ESC in the body', { title: 'Hi', body: 'a\u001b[31mb' }, loginAs(POSTER), 'control'],
    ['with a DEL in the title', { title: 'a\u007fb', body: 'b' }, loginAs(POSTER), 'control'],
  ] as const) {
    const refused = await postForm(fields, login);
    check(
      `a post ${what} is refused`,
      refused.status === 200 &&
        contentOf(refused.body).includes('<title>Not posted - talkit.io</title>') &&
        refusalOf(refused.body).includes(said),
      refusalOf(refused.body),
    );
  }
  check(
    'nothing refused was stored',
    (await threadCount()) === storedBefore,
    `${storedBefore} → ${await threadCount()}`,
  );

  for (const payload of PAYLOADS) {
    const id = postedId((await postForm({ title: payload, body: payload })).body);
    const row = await threadRow(id);
    const shown = beforeCommentForm(contentOf((await fetchPath(`/thread?id=${id}`)).body));
    const escaped = escapeHtml(payload);
    check(
      `${payload.slice(0, 40)} is stored as typed and shown as text`,
      row?.title === payload &&
        row.body === payload &&
        shown.includes(`<h2>${escaped}</h2>`) &&
        (escaped === payload || !shown.includes(payload)),
      `thread ${id}; ${JSON.stringify(row?.title)}`,
    );
  }

  const wideBody = '📡'.repeat(4000);
  const wideForm = new URLSearchParams({ title: 'Wide', body: wideBody }).toString();
  const wideRow = await threadRow(
    postedId((await postForm({ title: 'Wide', body: wideBody })).body),
  );
  check(
    'a 4,000-character body of four-byte characters posts, its form far past 4,096',
    wideForm.length > 4096 && wideRow?.body === wideBody,
    `form ${wideForm.length} characters; stored ${[...(wideRow?.body ?? '')].length}`,
  );

  // Eight posts went up this hour; twelve more under the other handle make twenty.
  const filling = await Promise.all(
    Array.from({ length: 12 }, (_unused, index) =>
      postForm({ title: `Filler ${index}`, body: 'b' }, loginAs(OTHER_POSTER)),
    ),
  );
  check(
    'twenty posts in the hour all go up, under either handle',
    filling.every((answer) => postedId(answer.body) > 0),
    `${filling.filter((answer) => postedId(answer.body) > 0).length}/12`,
  );
  const cappedBefore = await threadCount();
  const capped = await Promise.all(
    [POSTER, OTHER_POSTER].map((handle) =>
      postForm({ title: 'One more', body: 'b' }, loginAs(handle)),
    ),
  );
  check(
    'the 21st post in the hour is refused, whichever handle it is signed with',
    capped.every(
      (answer) =>
        refusalOf(answer.body) === 'You have posted 20 times in the last hour. Wait a while.',
    ) && (await threadCount()) === cappedBefore,
    capped.map((answer) => refusalOf(answer.body)).join(' / '),
  );

  // The table's CHECKs hold whatever calls the store. A fresh player key, so neither the
  // cap nor the throttle answers first.
  const { error: guarded } = await sr.rpc('talkit_post', {
    post_handle: POSTER,
    post_password_md5: md5(POSTER_PASSWORD),
    post_player_key: 'c'.repeat(64),
    post_title: 'esc',
    post_body: 'a\u001bb',
  });
  check(
    'the store refuses a control character the handler would have caught',
    guarded !== null && (await threadCount()) === cappedBefore,
    guarded?.message ?? 'stored',
  );

  // Five wrong passwords in the minute, whatever the earlier one left.
  for (let i = 0; i < 5; i += 1) {
    await postForm({ title: 'Hi', body: 'b' }, loginAs(POSTER, 'nope'));
  }
  const throttled = await postForm({ title: 'Hi', body: 'b' }, loginAs(POSTER));
  check(
    'five wrong passwords in a minute throttle even the right one',
    refusalOf(throttled.body) === 'Too many failed logins. Wait a minute.',
    refusalOf(throttled.body),
  );

  // 11. A PLAYER COMMENTS. A fresh hour for the visitor: the posts above filled the cap,
  //     and the wrong passwords throttled the login.
  await sr.from('talkit_writes').delete().eq('player_key', visitor.publicKeyHex);
  await sr.from('email_login_failures').delete().eq('player_key', visitor.publicKeyHex);
  const commentForm = (
    threadId: number | string,
    body: string,
    login: Login | null = loginAs(POSTER),
  ) => postForm({ id: String(threadId), body }, login, '/comment');
  const commentRows = async (threadId: number) => {
    const { data } = await sr
      .from('talkit_comments')
      .select('number, author, body')
      .eq('thread_id', threadId)
      .order('number', { ascending: true });
    return (data ?? []) as { number: number; author: string; body: string }[];
  };
  const activityOfThread = async (threadId: number) => {
    const { data } = await sr
      .from('talkit_threads')
      .select('comment_count, last_activity_at')
      .eq('id', threadId)
      .maybeSingle();
    return data as { comment_count: number; last_activity_at: string } | null;
  };
  const writtenThisHour = async (): Promise<number> => {
    const { count } = await sr
      .from('talkit_writes')
      .select('player_key', { count: 'exact', head: true })
      .eq('player_key', visitor.publicKeyHex);
    return count ?? -1;
  };
  const isCommented = (answer: { status: number; body: unknown }) =>
    answer.status === 200 &&
    contentOf(answer.body).includes('<title>Commented - talkit.io</title>');

  const commented = await commentForm(firstId, 'Mine too.\r\nSince Tuesday.');
  const firstComments = await commentRows(firstId);
  check(
    'a comment posted with a login goes up as #1, signed with its handle, its CRLF a line break',
    isCommented(commented) &&
      contentOf(commented.body).includes(`<p>Commented as ${POSTER}.</p>`) &&
      contentOf(commented.body).includes(
        `<a href="/thread?id=${firstId}">Back to the thread</a>`,
      ) &&
      JSON.stringify(firstComments) ===
        JSON.stringify([{ number: 1, author: POSTER, body: 'Mine too.\nSince Tuesday.' }]),
    `status ${commented.status}; ${JSON.stringify(firstComments)}`,
  );
  const listWithComment = contentOf((await fetchPath('/threads')).body);
  check(
    'the commented thread goes back to the top of the list, with 1 comment',
    listedIds(listWithComment)[0] === firstId &&
      listWithComment.includes(`>My new router</a><br>by ${POSTER}, 1 comment, last `),
    JSON.stringify(listedIds(listWithComment).slice(0, 3)),
  );
  const pageWithComment = contentOf((await fetchPath(`/thread?id=${firstId}`)).body);
  check(
    "the thread's page shows the comment under the body, numbered, and the form to add one",
    new RegExp(
      `<p>#1 by ${POSTER}, \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}</p>\n<p>Mine too\\.<br>Since Tuesday\\.</p>`,
    ).test(pageWithComment) &&
      !pageWithComment.includes('No comments yet.') &&
      pageWithComment.includes(`<input type="hidden" name="id" value="${firstId}">`),
    `/thread?id=${firstId}`,
  );
  const commentLine = (await talkitLog()).split('\n').filter(Boolean).at(-1) ?? '';
  check(
    'talkit.log names the comment, its thread, its writer and the address it came from',
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /.test(commentLine) &&
      commentLine.endsWith(` comment #1 on #${firstId} by ${POSTER} from ${visitorIp}`),
    commentLine || '(no line)',
  );
  const logAfterComment = await accessLog();
  check(
    "access.log has the comment's POST from the visitor, and never the form or the password",
    logAfterComment
      .split('\n')
      .some((line) => line.includes(visitorIp) && line.includes('"POST /comment HTTP/1.1" 200 ')) &&
      !logAfterComment.includes(POSTER_PASSWORD) &&
      !logAfterComment.includes('Tuesday'),
    logAfterComment.split('\n').find((line) => line.includes('POST /comment')) ?? '(no line)',
  );

  const byOther = await commentForm(firstId, 'Same here.', loginAs(OTHER_POSTER));
  const together = await Promise.all(
    Array.from({ length: 4 }, (_unused, index) => commentForm(firstId, `Together ${index}`)),
  );
  const numbered = await commentRows(firstId);
  check(
    'comments sent together on one thread are numbered one after another, none the same',
    isCommented(byOther) &&
      together.every(isCommented) &&
      JSON.stringify(numbered.map((row) => row.number)) === JSON.stringify([1, 2, 3, 4, 5, 6]) &&
      numbered[1]?.author === OTHER_POSTER &&
      (await activityOfThread(firstId))?.comment_count === 6,
    JSON.stringify(numbered.map((row) => `${row.number} ${row.author}`)),
  );

  const activityBefore = JSON.stringify(await activityOfThread(firstId));
  const writtenBefore = await writtenThisHour();
  for (const [what, fields, login, said] of [
    ['with no login', { id: String(firstId), body: 'Hi' }, null, 'Not logged in to emailit.io.'],
    [
      'with a wrong password',
      { id: String(firstId), body: 'Hi' },
      loginAs(POSTER, 'not-the-password'),
      `Login failed for ${POSTER}@emailit.io.`,
    ],
    ['naming no thread', { body: 'Hi' }, loginAs(POSTER), 'No such thread.'],
    ['naming a word', { id: 'abc', body: 'Hi' }, loginAs(POSTER), 'No such thread.'],
    [
      'naming a thread nobody started',
      { id: '999999999999999', body: 'Hi' },
      loginAs(POSTER),
      'No such thread.',
    ],
    [
      'with a blank body',
      { id: String(firstId), body: ' \n ' },
      loginAs(POSTER),
      'A comment is 1 to 4,000',
    ],
    [
      'with a 4,001-character body',
      { id: String(firstId), body: 'x'.repeat(4001) },
      loginAs(POSTER),
      'A comment is 1 to 4,000',
    ],
    ['with a NUL', { id: String(firstId), body: 'a\u0000b' }, loginAs(POSTER), 'control'],
    ['with an ESC', { id: String(firstId), body: 'a\u001b[31mb' }, loginAs(POSTER), 'control'],
  ] as const) {
    const refused = await postForm(fields, login, '/comment');
    check(
      `a comment ${what} is refused`,
      refused.status === 200 &&
        contentOf(refused.body).includes('<title>Not posted - talkit.io</title>') &&
        refusalOf(refused.body).includes(said),
      refusalOf(refused.body),
    );
  }
  check(
    'nothing refused was stored, moved its thread, or counted toward the cap',
    (await commentRows(firstId)).length === 6 &&
      JSON.stringify(await activityOfThread(firstId)) === activityBefore &&
      (await writtenThisHour()) === writtenBefore,
    `${activityBefore} → ${JSON.stringify(await activityOfThread(firstId))}; writes ${writtenBefore}`,
  );

  for (const payload of PAYLOADS) {
    await commentForm(firstId, payload);
  }
  const payloadRows = (await commentRows(firstId)).slice(6);
  const pageWithPayloads = contentOf((await fetchPath(`/thread?id=${firstId}`)).body);
  check(
    'every payload, as a comment, is stored as typed and shown as text, the page keeping one form',
    JSON.stringify(payloadRows.map((row) => row.body)) === JSON.stringify(PAYLOADS) &&
      PAYLOADS.every(
        (payload) =>
          escapeHtml(payload) === payload || !beforeCommentForm(pageWithPayloads).includes(payload),
      ) &&
      (pageWithPayloads.match(/<form/g) ?? []).length === 1 &&
      (pageWithPayloads.match(/<textarea/g) ?? []).length === 1 &&
      (pageWithPayloads.match(/<input/g) ?? []).length === 2,
    `${payloadRows.length} rows`,
  );

  const wideComment = '📡'.repeat(4000);
  await commentForm(firstId, wideComment);
  check(
    'a 4,000-character comment of four-byte characters goes up',
    (await commentRows(firstId)).at(-1)?.body === wideComment,
    `${(await commentRows(firstId)).length} comments`,
  );

  // Thirteen written this hour, all comments; posts under the other handle make twenty.
  const toFill = 20 - (await writtenThisHour());
  const fillingPosts = await Promise.all(
    Array.from({ length: toFill }, (_unused, index) =>
      postForm({ title: `Mixed ${index}`, body: 'b' }, loginAs(OTHER_POSTER)),
    ),
  );
  check(
    'posts and comments together go up to twenty in the hour',
    toFill === 7 && fillingPosts.every((answer) => postedId(answer.body) > 0),
    `${fillingPosts.filter((answer) => postedId(answer.body) > 0).length}/${toFill}`,
  );
  const commentsBeforeCap = (await commentRows(firstId)).length;
  const overCap = await Promise.all([
    commentForm(firstId, 'One more', loginAs(POSTER)),
    commentForm(firstId, 'One more', loginAs(OTHER_POSTER)),
    postForm({ title: 'One more', body: 'b' }, loginAs(POSTER)),
  ]);
  check(
    'the 21st writing in the hour is refused, comment or post, whichever handle signs it',
    overCap.every(
      (answer) =>
        refusalOf(answer.body) === 'You have posted 20 times in the last hour. Wait a while.',
    ) && (await commentRows(firstId)).length === commentsBeforeCap,
    overCap.map((answer) => refusalOf(answer.body)).join(' / '),
  );

  // The table's CHECKs hold whatever calls the store, and a refused insert takes the
  // thread's count back with it. A fresh player key, so neither the cap nor the throttle
  // answers first.
  const countBeforeGuard = (await activityOfThread(firstId))?.comment_count;
  const { error: commentGuarded } = await sr.rpc('talkit_comment', {
    comment_handle: POSTER,
    comment_password_md5: md5(POSTER_PASSWORD),
    comment_player_key: 'd'.repeat(64),
    comment_thread_id: firstId,
    comment_body: 'a\u001bb',
  });
  check(
    'the store refuses a control character in a comment, and counts nothing',
    commentGuarded !== null &&
      (await commentRows(firstId)).length === commentsBeforeCap &&
      (await activityOfThread(firstId))?.comment_count === countBeforeGuard,
    commentGuarded?.message ?? 'stored',
  );
  await sr.from('email_login_failures').delete().eq('player_key', 'd'.repeat(64));

  // A fresh hour once more, so the throttle and not the cap is what answers.
  await sr.from('talkit_writes').delete().eq('player_key', visitor.publicKeyHex);
  for (let i = 0; i < 5; i += 1) {
    await commentForm(firstId, 'Hi', loginAs(POSTER, 'nope'));
  }
  const commentThrottled = await commentForm(firstId, 'Hi', loginAs(POSTER));
  check(
    'five wrong passwords in a minute throttle even the right one, for a comment',
    refusalOf(commentThrottled.body) === 'Too many failed logins. Wait a minute.',
    refusalOf(commentThrottled.body),
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
