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
//     `scripts/restoreSite.ts talkit.io` brings them back with every thread untouched.
//
// It needs the forum to hold only its welcome thread, as a fresh database does: the
// threads it seeds are signed `wirecheck`, and it deletes them before and after.
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
import { crackableEssidPool } from '../src/core/generation/generateWifi.js';
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
const [visitorEssid] = crackableEssidPool;

const threadCount = async (): Promise<number | null> => {
  const { count } = await sr.from('talkit_threads').select('id', { count: 'exact', head: true });
  return count;
};

const cleanup = async () => {
  await sr.from('talkit_threads').delete().eq('author', SEEDER);
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
  const pages = await Promise.all(
    ['/threads', '/threads?page=2', '/threads?page=3'].map(async (path) =>
      contentOf((await fetchPath(path)).body),
    ),
  );
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
    const threadText = contentOf(shown.body);
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
    ['--import', 'tsx', 'scripts/restoreSite.ts', 'talkit.io'],
    { env: process.env, encoding: 'utf8' },
  );
  const frontAfterRestore = await fetchPath('/');
  const viewsAfterRestore = await dark();
  const { count: seededAfterRestore } = await sr
    .from('talkit_threads')
    .select('id', { count: 'exact', head: true })
    .eq('author', SEEDER);
  check(
    'restoreSite.ts talkit.io brings back the front page and the views, every thread kept',
    restored.status === 0 &&
      contentOf(frontAfterRestore.body) === TALKIT_FRONT_PAGE &&
      viewsAfterRestore.every((view) => view.status === 200) &&
      seededAfterRestore === SEEDED,
    `restore exit ${restored.status}; views ${viewsAfterRestore
      .map((view) => view.status)
      .join(', ')}; ${seededAfterRestore} seeded thread(s)`,
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
