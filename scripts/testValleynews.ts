// Wire-payload smoke for VALLEYNEWS.IO — the Harrow Valley paper answered by the REAL
// /api/network endpoint against a running `vercel dev` + supabase, its stories posted by the
// operator's REAL `scripts/valleynews.ts`.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE PAPER IS AT ITS ADDRESS. `resolveHttpFetch` at valleynews's derived address serves
//     the masthead it was generated with, and findit lists it for the news.
//   - THE OPERATOR POSTS. `scripts/valleynews.ts post <file>` reads a story file, CRLF and
//     all, prints what it will post and where, inserts it into `news_stories`, and prints
//     its id and address. A file that is not a story, or no file, posts nothing.
//   - A SECTION READS THE TABLE. `/valley`, `/dev` and `/wire` are answered from
//     `news_stories` through api/network.ts's own select: that section alone, the newest
//     first; an empty one says so.
//   - A STORY READS ITS ROW. `/story?id=<n>` shows its section and voice, title, byline,
//     day and paragraphs; an id that names no story is a 404.
//   - NOTHING IN A STORY BECOMES MARKUP OR A LINK. A title and body holding markup show as
//     the text they are, and a real source is text, never a link.
//   - THE TABLE REFUSES what the paper must never store: an unknown section, a control
//     character, a title over its limit.
//   - EVERY LOOK IS LOGGED in valleynews's own access.log, a 404 included.
//   - THE PAPER IS NOT A FILE. A root's `/var/www/html/wire` or `story` changes no view; a
//     rewritten masthead is served; a stopped or bricked paper answers none; the operator's
//     real `scripts/restoreSite.ts valleynews.io` brings them back with every story kept.
//
// It needs the paper to be empty, as a fresh database is: the stories it posts and seeds are
// bylined `wirecheck`, and it deletes them before and after.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testValleynews.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { crackableEssidPool } from '../src/core/generation/generateWifi.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { FINDIT_DOMAIN, VALLEYNEWS_NETWORK, fixedSite } from '../src/core/generation/fixedSites.js';
import { WEB_PAGE_FILE } from '../src/core/generation/baseFs.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { VALLEYNEWS_FRONT_PAGE } from '../src/core/valleynews/pages.js';
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

const site = fixedSite(VALLEYNEWS_NETWORK);
const SITE_IP = siteAddress('valleynews.io');
if (site === undefined || SITE_IP === undefined) {
  console.error('valleynews.io answers nowhere — the world is unusable.');
  process.exit(2);
}
const machineId = computeApGatewayId(site.key);
const logKey = apGatewayLogWriterKey(site.key);

/** The byline of every story this check posts or seeds, so it can find and delete them. */
const BYLINE = 'wirecheck';

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

/** valleynews's access log, as the system writes it: under the network's own key. */
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

/** The story ids a section page links to, in the order it lists them. */
const listedIds = (page: string): readonly number[] =>
  [...page.matchAll(/<a href="\/story\?id=(\d+)">/g)].map((match) => Number(match[1]));

const storyCount = async (): Promise<number | null> => {
  const { count } = await sr.from('news_stories').select('id', { count: 'exact', head: true });
  return count;
};

/** The day a story was posted, as the paper prints it. */
const postedDay = async (id: number): Promise<string> => {
  const { data } = await sr.from('news_stories').select('posted_at').eq('id', id).maybeSingle();
  const at = (data as { posted_at?: string } | null)?.posted_at;
  return at === undefined ? '' : new Date(at).toISOString().slice(0, 10);
};

const visitor = generateIdentity();
const [visitorEssid] = crackableEssidPool;

const cleanup = async () => {
  await sr.from('news_stories').delete().eq('byline', BYLINE);
  await sr.from('sessions').delete().eq('player_key', visitor.publicKeyHex);
  await sr.from('home_network_occupants').delete().eq('owner_key', visitor.publicKeyHex);
  await sr.from('patches').delete().eq('machine_id', machineId);
};

/** A row a root's write would leave in valleynews's journal, seeded via service_role: no
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

const storyDir = mkdtempSync(join(tmpdir(), 'valleynews-'));

/** The operator's script, run as the operator runs it, on a story file holding `text`. */
const runPost = (name: string, text: string | null) => {
  const file = join(storyDir, name);
  if (text !== null) writeFileSync(file, text);
  const run = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/valleynews.ts', 'post', file],
    {
      env: process.env,
      encoding: 'utf8',
    },
  );
  const id = Number(/Posted story (\d+):/.exec(run.stdout)?.[1] ?? 0);
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, id };
};

const storyFile = (headers: readonly string[], body: string): string =>
  `${headers.join('\n')}\n\n${body}\n`;

const MARKUP_TITLE = '<b>Routers</b> & the "patch" gap';
const SOURCE = 'Source: The Record - https://therecord.media/a-router-flaw';
const WIRE_BODY = `A <script>alert(1)</script> flaw sat\nunpatched for a year.\n\n${SOURCE}`;

const main = async () => {
  console.log(`valleynews.io answers at ${SITE_IP} (machine ${machineId})`);
  await cleanup();
  if ((await storyCount()) !== 0) {
    console.error('The paper holds stories; this check needs an empty one.');
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

  // 1. THE MASTHEAD IS SERVED AS GENERATED, AND FINDIT LISTS THE PAPER FOR THE NEWS.
  const front = await fetchPath('/');
  check(
    'the masthead is served as generated',
    front.status === 200 && contentOf(front.body) === VALLEYNEWS_FRONT_PAGE,
    contentOf(front.body).slice(0, 80) || `status ${front.status}`,
  );
  const news = firstResultHost(contentOf((await fetchFrom(FINDIT_IP, '/?q=news')).body));
  check('a search for the news answers with valleynews.io first', news === 'valleynews.io', news);

  // 2. AN EMPTY PAPER SAYS SO IN EVERY SECTION.
  for (const path of ['/valley', '/dev', '/wire']) {
    const empty = await fetchPath(path);
    check(
      `an empty ${path} says it holds no story`,
      empty.status === 200 && contentOf(empty.body).includes('<p>No stories yet.</p>'),
      `status ${empty.status}`,
    );
  }

  // 3. THE OPERATOR POSTS, FROM A FILE SAVED WITH CRLF LINE ENDS.
  const first = runPost(
    'first.txt',
    storyFile(['section: wire', `title: ${MARKUP_TITLE}`, `byline: ${BYLINE}`], WIRE_BODY).replace(
      /\n/g,
      '\r\n',
    ),
  );
  const host = new URL(url).host;
  check(
    'post prints what it posts and where, then the story it made',
    first.status === 0 &&
      first.stdout.includes(`Posting "${MARKUP_TITLE}" to /wire as ${BYLINE} on ${host}`) &&
      first.stdout.includes(`Posted story ${first.id}: http://valleynews.io/story?id=${first.id}`),
    `exit ${first.status}; ${first.stdout.trim() || first.stderr.trim()}`,
  );
  const second = runPost(
    'second.txt',
    storyFile(['section: wire', 'title: Second on the wire', `byline: ${BYLINE}`], 'Later.'),
  );
  const valley = runPost(
    'valley.txt',
    storyFile(['byline: wirecheck', 'title: Fog over Ridgemont', 'section: valley'], 'Fog.'),
  );
  check(
    'two more stories post, each with an id of its own',
    second.status === 0 &&
      valley.status === 0 &&
      new Set([first.id, second.id, valley.id]).size === 3 &&
      (await storyCount()) === 3,
    `exits ${second.status}, ${valley.status}; ids ${first.id}, ${second.id}, ${valley.id}`,
  );

  // 4. EACH SECTION READS ITS OWN STORIES, NEWEST FIRST. One look after another: each
  //    appends to the access log by reading it and writing it back.
  const wire = contentOf((await fetchPath('/wire')).body);
  const valleyPage = contentOf((await fetchPath('/valley')).body);
  const dev = contentOf((await fetchPath('/dev')).body);
  check(
    '/wire lists its two stories, the newer first',
    JSON.stringify(listedIds(wire)) === JSON.stringify([second.id, first.id]),
    JSON.stringify(listedIds(wire)),
  );
  check(
    '/valley lists its one story and /dev still none',
    JSON.stringify(listedIds(valleyPage)) === JSON.stringify([valley.id]) &&
      dev.includes('<p>No stories yet.</p>'),
    `${JSON.stringify(listedIds(valleyPage))}; dev empty: ${dev.includes('No stories yet.')}`,
  );
  const day = await postedDay(first.id);
  check(
    'a section lists a title holding markup as text, with its byline and day',
    wire.includes(
      `<a href="/story?id=${first.id}">&lt;b&gt;Routers&lt;/b&gt; &amp; the &quot;patch&quot; gap</a>` +
        `<br>by ${BYLINE}, ${day}</p>`,
    ),
    wire.slice(wire.indexOf('<hr>'), wire.indexOf('<hr>') + 200),
  );

  // 5. A STORY SHOWS ITS SECTION, ITS WORDS AS TEXT, AND ITS SOURCE UNLINKED.
  const story = await fetchPath(`/story?id=${first.id}`);
  const storyPage = contentOf(story.body);
  check(
    'a story shows its section and voice, title, byline, day and paragraphs',
    story.status === 200 &&
      storyPage.includes(
        '<p><a href="/wire">The wire</a>: Security news from the real world</p>\n' +
          '<h2>&lt;b&gt;Routers&lt;/b&gt; &amp; the &quot;patch&quot; gap</h2>\n' +
          `<p>by ${BYLINE}, ${day}</p>\n` +
          '<p>A &lt;script&gt;alert(1)&lt;/script&gt; flaw sat unpatched for a year.</p>\n' +
          `<p>${SOURCE}</p>`,
      ),
    storyPage.slice(storyPage.indexOf('<hr>'), storyPage.indexOf('<hr>') + 300),
  );
  check(
    'a story links nothing but its section',
    [...storyPage.slice(storyPage.indexOf('<hr>')).matchAll(/<a /g)].length === 1 &&
      !storyPage.includes('<script>'),
    storyPage.includes('href="https') ? 'the source is a link' : 'no source link',
  );
  const missing = await fetchPath('/story?id=999999999');
  const malformed = await fetchPath('/story?id=abc');
  check(
    'a story nobody posted, or an id that is not one, is not there',
    missing.status === 404 && malformed.status === 404 && errorOf(missing.body) === 'not_found',
    `${missing.status} ${errorOf(missing.body)}; ${malformed.status}`,
  );

  // 6. THE SCRIPT POSTS NOTHING FROM A FILE THAT IS NOT A STORY, OR FROM NO FILE.
  const countBefore = await storyCount();
  for (const [what, name, text, said] of [
    [
      'an unknown section',
      'sports.txt',
      storyFile(['section: sports', 'title: A title', `byline: ${BYLINE}`], 'Body.'),
      'Unknown section "sports": it is valley, dev or wire',
    ],
    [
      'no byline',
      'nobyline.txt',
      storyFile(['section: dev', 'title: A title'], 'Body.'),
      'Missing header "byline"',
    ],
    ['a file that is not there', 'absent.txt', null, 'Cannot read'],
  ] as const) {
    const refused = runPost(name, text);
    check(
      `post refuses ${what}, exits 2, and says why`,
      refused.status === 2 && refused.stderr.includes(said) && refused.stdout === '',
      `exit ${refused.status}; ${refused.stderr.trim()}`,
    );
  }
  for (const words of [[], ['publish', 'story.txt'], ['post'], ['post', 'a.txt', 'b.txt']]) {
    const misused = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/valleynews.ts', ...words],
      {
        env: process.env,
        encoding: 'utf8',
      },
    );
    check(
      `the script refuses "${words.join(' ')}" with its usage, and exits 2`,
      misused.status === 2 && misused.stderr.includes('Usage: valleynews.ts post <file>'),
      `exit ${misused.status}; ${misused.stderr.trim()}`,
    );
  }
  check(
    'nothing refused was posted',
    (await storyCount()) === countBefore,
    `${countBefore} → ${await storyCount()}`,
  );

  // 7. THE TABLE REFUSES WHAT THE PAPER MUST NEVER STORE.
  for (const [what, row] of [
    ['an unknown section', { section: 'sports', title: 't', body: 'b' }],
    ['a tab in a body', { section: 'wire', title: 't', body: 'one\ttwo' }],
    ['an ESC in a body', { section: 'wire', title: 't', body: 'one\u001b[31mtwo' }],
    ['a line break in a title', { section: 'wire', title: 'one\ntwo', body: 'b' }],
    ['a title of 121 characters', { section: 'wire', title: 'x'.repeat(121), body: 'b' }],
    ['an empty body', { section: 'wire', title: 't', body: '' }],
  ] as const) {
    const { error } = await sr.from('news_stories').insert({ byline: BYLINE, ...row });
    check(`the table refuses ${what}`, error !== null, error?.message ?? 'stored');
  }
  const { error: longest } = await sr
    .from('news_stories')
    .insert({ byline: BYLINE, section: 'dev', title: 'x'.repeat(120), body: 'b' });
  check(
    'the table takes a title of exactly 120 characters',
    longest === null,
    longest?.message ?? 'stored',
  );

  // 8. EVERY LOOK IS LOGGED ON VALLEYNEWS, VISITOR AND ALL, A 404 INCLUDED.
  const lines = (await accessLog()).split('\n');
  for (const [path, status] of [
    ['/wire', 200],
    ['/valley', 200],
    [`/story?id=${first.id}`, 200],
    ['/story?id=999999999', 404],
  ] as const) {
    const line = lines.find((logged) => logged.includes(`"GET ${path} HTTP/1.1" ${status} `)) ?? '';
    check(
      `a look at ${path} lands in valleynews's access.log as a ${status}, with the visitor's address`,
      line.includes(visitorIp),
      line || '(no line)',
    );
  }

  // 9. A ROOT'S FILE AT A VIEW'S PATH CHANGES NO VIEW; THE MASTHEAD IS THEIRS TO DEFACE.
  await seedRootWrite('/var/www/html/wire', '<html>FORGED</html>\n');
  await seedRootWrite('/var/www/html/story', '<html>FORGED</html>\n');
  await seedRootWrite('/var/www/html/index.html', '<html>EXTRA EXTRA</html>\n');
  const wireAfterForgery = contentOf((await fetchPath('/wire')).body);
  const storyAfterForgery = contentOf((await fetchPath(`/story?id=${first.id}`)).body);
  check(
    'planted /var/www/html/wire and story change neither view',
    listedIds(wireAfterForgery).length === 2 &&
      storyAfterForgery.includes('Routers') &&
      !wireAfterForgery.includes('FORGED') &&
      !storyAfterForgery.includes('FORGED'),
    `${wireAfterForgery.slice(0, 40)} / ${storyAfterForgery.slice(0, 40)}`,
  );
  const defaced = contentOf((await fetchPath('/')).body);
  check(
    'a rewritten masthead is served at /',
    defaced === '<html>EXTRA EXTRA</html>\n',
    defaced.slice(0, 40),
  );

  // 10. A STOPPED OR BRICKED PAPER ANSWERS NO VIEW; THE RESTORE BRINGS THEM BACK.
  const views = async (): Promise<readonly { status: number; body: unknown }[]> => [
    await fetchPath('/wire'),
    await fetchPath(`/story?id=${first.id}`),
  ];
  const isDark = (answers: readonly { status: number; body: unknown }[]) =>
    answers.every((answer) => answer.status === 404 && errorOf(answer.body) === 'host_unreachable');
  await seedRootWrite(`/var/run/${SERVICE_CATALOG.http.pidfile}`, null);
  const stopped = await views();
  check(
    'a paper whose web server was stopped answers no view',
    isDark(stopped),
    stopped.map((answer) => answer.status).join(', '),
  );
  await seedRootWrite('/boot/vmlinuz', null);
  const bricked = await views();
  check(
    'a bricked paper answers no view',
    isDark(bricked),
    bricked.map((answer) => answer.status).join(', '),
  );
  const restored = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/restoreSite.ts', 'valleynews.io'],
    { env: process.env, encoding: 'utf8' },
  );
  const frontAfterRestore = await fetchPath('/');
  const viewsAfterRestore = await views();
  check(
    'restoreSite.ts valleynews.io brings back the masthead and the views, every story kept',
    restored.status === 0 &&
      contentOf(frontAfterRestore.body) === VALLEYNEWS_FRONT_PAGE &&
      viewsAfterRestore.every((view) => view.status === 200) &&
      (await storyCount()) === 4,
    `restore exit ${restored.status}; views ${viewsAfterRestore
      .map((view) => view.status)
      .join(', ')}; ${await storyCount()} stories`,
  );

  await cleanup();
  rmSync(storyDir, { recursive: true, force: true });

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error);
  rmSync(storyDir, { recursive: true, force: true });
  process.exit(1);
});
