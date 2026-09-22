/**
 * The site a web server publishes — pages that link each other, belonging to the place
 * the network is and written by the people who live on it.
 *
 * Only a box whose name says it serves the web (`www-04`, `portal-12`) gets one; any
 * other box that happens to run a web server keeps the single page it always had. What
 * kind of site follows the name: a `portal-` is the network's intranet, an `api-`
 * documents the endpoints it answers, and the rest publish the place's public site.
 *
 * Every link is written here, from the pages this box was drawn and the machines its
 * network really holds, so none can name a page nothing serves. An intranet links its
 * neighbours by the names the network gives them; a deep box names no neighbour at
 * all, because nothing on its layer has one to give. People appear by their full
 * names, never their logins: a web tree is readable with no session at all.
 *
 * Its stream is its OWN (`web-site-…`), never a continuation of the host's: appending a
 * draw to another stream would move every value picked after it.
 */

import { createPrng, type Prng } from './prng';
import { generateHomeLan, isOnHomeLan, type LanHost } from './generateHomeLan';
import { inhabitant, networkPersona, type NetworkPersona } from './persona';
import { fillSlots } from './npcHome';
import { hostServices, npcUsername } from './remoteHostFs';
import { roleOfHostname } from './pools/hostnames';
import { lanZoneName } from '../network/resolveName';
import {
  API_COMMON_ENDPOINTS,
  API_ENDPOINTS,
  API_FRONT_PAGES,
  API_PAGES,
  FRONT_PAGES,
  PEOPLE_ROLES,
  PORTAL_FRONT_PAGES,
  PORTAL_PAGES,
  SHARED_PAGES,
  SITE_PAGES,
  DRAFT_NOTICES,
  INTERNAL_PAGES,
  NOTE_HEADINGS,
  NOTE_LINES,
  OLD_SITE_PAGES,
  PATH_COMMENTS,
  ROBOTS_ONLY_DIRECTORIES,
  ROBOTS_ONLY_PAGES,
  type ApiEndpoint,
  type SitePage,
} from './pools/webSites';
import type { MysqlColumn, MysqlDatabase } from '../mysql/types';

export type WebSite = {
  /** Every file the site publishes, keyed by its path beneath the document root. */
  readonly files: ReadonlyMap<string, string>;
  /** The request paths a reader reaches by following links from `/`, `/` first. */
  readonly publicPaths: readonly string[];
};

/** The fewest and the most things a reader reaches from `/`, the front page included. */
const MIN_PAGES = 4;
const MAX_PAGES = 12;

/** The most neighbours a team page lists beside the webmaster. */
const MAX_LISTED = 4;

type Page = { readonly file: string; readonly title: string; readonly body: string };

/** What a site is made of before any of it is written out. */
type Plan = {
  readonly front: string;
  /** Pages every site of this kind carries. */
  readonly fixed: readonly Page[];
  /** Pages a site of this kind draws some of. */
  readonly pool: readonly SitePage[];
  /** Documents an API answers with, linked from its front page. */
  readonly documents: readonly ApiEndpoint[];
};

/** How a place names itself at the top of its own page: `the Midnight Diner` heads its
 *  site as `The Midnight Diner`. */
const headed = (place: string): string => place.charAt(0).toUpperCase() + place.slice(1);

const pathOf = (file: string): string => (file === 'index.html' ? '/' : `/${file}`);

const sharedPages = (...files: readonly string[]): readonly SitePage[] =>
  SHARED_PAGES.filter((page) => files.includes(page.file));

/** The people a team page lists: the box's own, as the one who keeps the site, then some
 *  of the neighbours, each with a role their kind of place has. */
const teamPage = (options: {
  readonly prng: Prng;
  readonly file: string;
  readonly title: string;
  readonly persona: NetworkPersona;
  readonly author: string;
  readonly people: readonly string[];
}): Page => {
  const { prng, persona, author, people } = options;
  const listed = prng.pickN(people, prng.nextInt(1, MAX_LISTED));
  const rows = [
    `<tr><td>${author}</td><td>Webmaster</td></tr>`,
    ...listed.map(
      (name) => `<tr><td>${name}</td><td>${prng.pick(PEOPLE_ROLES[persona.category])}</td></tr>`,
    ),
  ];
  return {
    file: options.file,
    title: options.title,
    body: `<table>\n<tr><th>Name</th><th>Role</th></tr>\n${rows.join('\n')}\n</table>`,
  };
};

/** An intranet's map of the network: what else runs on it, named as the network names
 *  it, each row saying only what that machine really does. */
const servicesPage = (essid: string, neighbours: readonly LanHost[]): Page => {
  const zone = lanZoneName(essid);
  const portOf = (host: LanHost, service: string): number | undefined =>
    hostServices(essid, host).find(({ spec }) => spec.service === service)?.port;
  const at = (port: number, standard: number): string => (port === standard ? '' : `:${port}`);
  const nameOf = (host: LanHost): string => `${host.hostname}.${zone}`;
  const rows = [
    ...neighbours.flatMap((host) => {
      const web = portOf(host, 'http');
      return web === undefined
        ? []
        : [`<tr><td>Web</td><td><a href="http://${nameOf(host)}${at(web, 80)}/">${nameOf(host)}</a></td></tr>`];
    }),
    ...neighbours.flatMap((host) => {
      const ftp = portOf(host, 'ftp');
      return ftp === undefined
        ? []
        : [`<tr><td>File server</td><td>ftp://${nameOf(host)}${at(ftp, 21)}/</td></tr>`];
    }),
    ...neighbours
      .filter((host) => roleOfHostname(host.hostname) === 'mailserver')
      .map((host) => `<tr><td>Mail</td><td>${nameOf(host)}</td></tr>`),
  ];
  return {
    file: 'services.html',
    title: 'Services',
    body:
      rows.length === 0
        ? '<p>Nothing else on the network is listed yet.</p>'
        : `<table>\n<tr><th>Service</th><th>Host</th></tr>\n${rows.join('\n')}\n</table>`,
  };
};

const apiReference = (intro: string, documents: readonly ApiEndpoint[]): string => {
  const [example] = documents.filter((document) => document.file.startsWith('api/'));
  return [
    intro,
    '<h2>Endpoints</h2>',
    '<ul>',
    ...documents.map(
      (document) =>
        `<li><a href="/${document.file}">GET /${document.file}</a> — ${document.summary}</li>`,
    ),
    '</ul>',
    ...(example === undefined
      ? []
      : ['<h2>Example</h2>', `<pre>\nGET /${example.file}\n${example.body}\n</pre>`]),
  ].join('\n');
};

const planFor = (options: {
  readonly prng: Prng;
  readonly essid: string;
  readonly host: LanHost;
  readonly persona: NetworkPersona;
  readonly author: string;
  readonly neighbours: readonly LanHost[];
}): Plan => {
  const { prng, essid, host, persona, author, neighbours } = options;
  const people = neighbours.map(
    (neighbour) =>
      inhabitant({ essid, host: neighbour, username: npcUsername(essid, neighbour) }).fullName,
  );
  const team = (file: string, title: string): Page =>
    teamPage({ prng, file, title, persona, author, people });

  if (host.hostname.startsWith('portal-')) {
    return {
      front: prng.pick(PORTAL_FRONT_PAGES),
      fixed: [servicesPage(essid, neighbours), team('team.html', 'Team')],
      pool: [...PORTAL_PAGES, ...sharedPages('news.html', 'faq.html', 'contact.html')],
      documents: [],
    };
  }
  if (host.hostname.startsWith('api-')) {
    const own = API_ENDPOINTS[persona.category];
    const documents = [...API_COMMON_ENDPOINTS, ...prng.pickN(own, prng.nextInt(1, own.length))];
    return {
      front: apiReference(prng.pick(API_FRONT_PAGES), documents),
      fixed: [],
      pool: [...API_PAGES, ...sharedPages('about.html', 'contact.html')],
      documents,
    };
  }
  const fixed =
    persona.category === 'corporate'
      ? [team('team.html', 'Team')]
      : persona.category === 'university'
        ? [team('people.html', 'People')]
        : [];
  return {
    front: prng.pick(FRONT_PAGES[persona.category]),
    fixed,
    pool: [...SITE_PAGES[persona.category], ...SHARED_PAGES],
    documents: [],
  };
};

const navigation = (pages: readonly Page[]): string =>
  `<p>${pages
    .map(
      (page) =>
        `<a href="${pathOf(page.file)}">${page.file === 'index.html' ? 'Home' : page.title}</a>`,
    )
    .join(' | ')}</p>`;

const htmlDocument = (options: {
  readonly site: string;
  readonly nav: string;
  readonly page: Page;
  readonly author: string;
  /** A note its author left in the source, which `curl` shows and a browser does not. */
  readonly comment: string | null;
}): string => {
  const { site, nav, page, author, comment } = options;
  return [
    '<html>',
    `<head><title>${page.title === site ? site : `${page.title} — ${site}`}</title></head>`,
    '<body>',
    nav,
    `<h1>${page.title}</h1>`,
    page.body,
    ...(comment === null ? [] : [`<!-- ${comment} -->`]),
    '<hr>',
    `<p>Page maintained by ${author}.</p>`,
    '</body>',
    '</html>',
  ].join('\n');
};

/** The words a site may keep unlinked, each a path the default list tries. */
const HIDDEN_WORDS: readonly string[] = [
  'old',
  'staging',
  'test',
  'admin',
  'dashboard',
  'internal',
  'notes.txt',
  'todo.txt',
  'readme.txt',
  'status',
  'health',
  'server-status',
  'metrics',
  '.env',
  'dump.sql',
];

/** The share of sites that keep a robots.txt, of those the share whose robots.txt names
 *  a directory the default list never tries, the share that keep a sitemap, and the
 *  share with a comment in one page naming an unlinked path. */
const ROBOTS_SHARE = 0.8;
const ROBOTS_ONLY_SHARE = 0.3;
const SITEMAP_SHARE = 0.5;
const COMMENT_SHARE = 0.5;

/** The fewest and the most unlinked paths a site keeps. */
const MIN_HIDDEN = 1;
const MAX_HIDDEN = 4;

/** The unlinked words served as a file rather than as a directory holding a page. */
const STATUS_WORDS: readonly string[] = ['status', 'health', 'server-status', 'metrics'];

const isDirectoryWord = (word: string): boolean =>
  !word.includes('.') && !STATUS_WORDS.includes(word);

/** How a request names an unlinked path — a directory by its trailing slash. */
const requestPathOf = (word: string): string => (isDirectoryWord(word) ? `/${word}/` : `/${word}`);

const hex = (prng: Prng, length: number): string =>
  Array.from({ length }, () => prng.nextInt(0, 15).toString(16)).join('');

const MYSQL_TYPES: Readonly<Record<MysqlColumn['type'], string>> = {
  INT: 'int',
  VARCHAR: 'varchar(255)',
  TEXT: 'text',
  DATETIME: 'datetime',
  BOOLEAN: 'tinyint(1)',
  FLOAT: 'float',
};

/** A `mysqldump --no-data` of the box's own database: every table and column it really
 *  has, in its order, and not one row. */
const schemaDump = (database: MysqlDatabase): string => {
  const tables = Object.entries(database.tables).map(([table, { columns }]) => {
    const lines = [
      ...columns.map(
        (column) =>
          `  \`${column.name}\` ${MYSQL_TYPES[column.type]}${column.nullable ? ' DEFAULT NULL' : ' NOT NULL'}`,
      ),
      ...columns
        .filter((column) => column.key === 'PRI')
        .map((column) => `  PRIMARY KEY (\`${column.name}\`)`),
      ...columns
        .filter((column) => column.key === 'UNI')
        .map((column) => `  UNIQUE KEY \`${column.name}\` (\`${column.name}\`)`),
    ];
    return [
      `DROP TABLE IF EXISTS \`${table}\`;`,
      `CREATE TABLE \`${table}\` (`,
      lines.join(',\n'),
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
    ].join('\n');
  });
  return [
    '-- MySQL dump',
    '--',
    `-- Host: localhost    Database: ${database.name}`,
    '-- ------------------------------------------------------',
    '',
    tables.join('\n\n'),
    '',
    '-- Dump completed on 2026-07-02  3:00:01',
    '',
  ].join('\n');
};

const loginForm = (heading: string): string =>
  [
    `<h1>${heading}</h1>`,
    '<form action="#" method="post">',
    '<p>User <input name="user"></p>',
    '<p>Password <input type="password" name="password"></p>',
    '<p><input type="submit" value="Sign in"></p>',
    '</form>',
  ].join('\n');

const plainPage = (site: string, body: string): string =>
  ['<html>', `<head><title>${site}</title></head>`, '<body>', body, '</body>', '</html>'].join('\n');

/** The paths a site keeps that no page links, by the file each is published as. */
const hiddenFiles = (options: {
  readonly prng: Prng;
  readonly words: readonly string[];
  readonly site: string;
  readonly front: string;
  readonly author: string;
  readonly ownUrl: string;
  readonly pages: readonly string[];
  readonly database: MysqlDatabase | null;
  readonly hostname: string;
}): readonly (readonly [string, string])[] => {
  const { prng, words, site, front, author, ownUrl, pages, database, hostname } = options;
  return words.map((word): readonly [string, string] => {
    const others = words.filter((other) => other !== word).map(requestPathOf);
    switch (word) {
      case 'old':
        return ['old/index.html', plainPage(site, `<h1>${site}</h1>\n${prng.pick(OLD_SITE_PAGES)}`)];
      case 'staging':
      case 'test':
        return [
          `${word}/index.html`,
          plainPage(site, `<h1>${site}</h1>\n${prng.pick(DRAFT_NOTICES)}\n${front}`),
        ];
      case 'admin':
        return ['admin/index.html', plainPage(site, loginForm(`${site} — administration`))];
      case 'dashboard':
        return ['dashboard/index.html', plainPage(site, loginForm('Dashboard — sign in'))];
      case 'internal':
        return ['internal/index.html', plainPage(site, `<h1>Internal</h1>\n${prng.pick(INTERNAL_PAGES)}`)];
      case 'notes.txt':
      case 'todo.txt':
      case 'readme.txt': {
        const lines = NOTE_LINES.filter((line) => others.length > 0 || !line.includes('{hidden}'));
        const notes = prng
          .pickN(lines, prng.nextInt(2, 4))
          .map((line) => `- ${fillSlots(line, { page: prng.pick(pages), hidden: prng.pick(others) })}`);
        return [word, `${prng.pick(NOTE_HEADINGS)} — ${author}\n\n${notes.join('\n')}\n`];
      }
      case 'status':
        return [word, `status: ok\nuptime: ${prng.nextInt(2, 180)} days\n`];
      case 'health':
        return [word, '{"status":"ok"}'];
      case 'server-status':
        return [
          word,
          [
            `Server Status for ${hostname}`,
            `Server uptime: ${prng.nextInt(2, 180)} days ${prng.nextInt(0, 23)} hours`,
            `Total accesses: ${prng.nextInt(10_000, 900_000)}`,
            `${prng.nextInt(1, 12)} requests currently being processed, ${prng.nextInt(2, 20)} idle workers`,
            '',
          ].join('\n'),
        ];
      case 'metrics':
        return [
          word,
          [
            '# HELP http_requests_total Requests served, by status.',
            '# TYPE http_requests_total counter',
            `http_requests_total{code="200"} ${prng.nextInt(10_000, 900_000)}`,
            `http_requests_total{code="404"} ${prng.nextInt(100, 9_000)}`,
            '# HELP process_open_fds Open file descriptors.',
            '# TYPE process_open_fds gauge',
            `process_open_fds ${prng.nextInt(8, 64)}`,
            '',
          ].join('\n'),
        ];
      case '.env':
        return [
          word,
          [
            'APP_ENV=production',
            `APP_URL=${ownUrl}`,
            `MAIL_API_KEY=key-${hex(prng, 32)}`,
            `PAYMENT_PUBLIC_KEY=pk_live_${hex(prng, 24)}`,
            `ANALYTICS_ID=G-${hex(prng, 10).toUpperCase()}`,
            '',
          ].join('\n'),
        ];
      default:
        return [word, database === null ? '' : schemaDump(database)];
    }
  });
};

export const buildWebSite = ({
  essid,
  host,
  port,
  database,
}: {
  readonly essid: string;
  readonly host: LanHost;
  /** The port the box's web server answers on — part of the address the site calls its own. */
  readonly port: number;
  /** The database the box runs, or null; a site keeps a dump of it only when there is one. */
  readonly database: MysqlDatabase | null;
}): WebSite => {
  const prng = createPrng(`web-site-${essid}-${host.ip}`);
  const persona = networkPersona(essid);
  const site = headed(persona.place);
  const slots = { site, place: persona.place, domain: persona.domain, hostname: host.hostname };
  const author = inhabitant({ essid, host, username: npcUsername(essid, host) }).fullName;
  const neighbours = isOnHomeLan(essid, host)
    ? generateHomeLan(essid).hosts.filter(
        (candidate) => candidate.kind === 'machine' && candidate.ip !== host.ip,
      )
    : [];

  const plan = planFor({ prng, essid, host, persona, author, neighbours });
  const alongside = plan.fixed.length + plan.documents.length;
  const drawnCount = prng.nextInt(
    Math.max(0, MIN_PAGES - 1 - alongside),
    Math.min(MAX_PAGES - 1 - alongside, plan.pool.length),
  );
  const drawn = prng
    .pickN(plan.pool, drawnCount)
    .map((page) => ({ file: page.file, title: page.title, body: prng.pick(page.bodies) }));
  const pages = [{ file: 'index.html', title: site, body: plan.front }, ...plan.fixed, ...drawn];
  const nav = navigation(pages);
  const publicPaths = [
    ...pages.map((page) => pathOf(page.file)),
    ...plan.documents.map(({ file }) => `/${file}`),
  ];

  const served = new Set(publicPaths.map((path) => path.slice(1)));
  // A box that runs a database always leaves its schema dump behind, among the rest:
  // the one leak that points a reader at the next door.
  const candidates = HIDDEN_WORDS.filter((word) => !served.has(word) && word !== 'dump.sql');
  const count = prng.nextInt(MIN_HIDDEN, MAX_HIDDEN);
  const words =
    database === null
      ? prng.pickN(candidates, count)
      : ['dump.sql', ...prng.pickN(candidates, count - 1)];
  const portSuffix = port === 80 ? '' : `:${port}`;
  const ownUrl = isOnHomeLan(essid, host)
    ? `http://${host.hostname}.${lanZoneName(essid)}${portSuffix}/`
    : `http://${host.ip}${portSuffix}/`;
  const hidden = hiddenFiles({
    prng,
    words,
    site,
    front: plan.front,
    author,
    ownUrl,
    pages: pages.map((page) => pathOf(page.file)),
    database,
    hostname: host.hostname,
  });

  // The breadcrumbs: what a site says about the paths it did not link. robots.txt asks
  // crawlers to stay out of some of them — which is how a reader learns they exist —
  // and now and then of a directory no default list would ever try.
  const disallowed = prng.next() < ROBOTS_SHARE ? prng.pickN(words, prng.nextInt(1, words.length)) : null;
  const robotsOnly =
    disallowed !== null && prng.next() < ROBOTS_ONLY_SHARE ? prng.pick(ROBOTS_ONLY_DIRECTORIES) : null;
  const robots =
    disallowed === null
      ? []
      : [
          [
            'robots.txt',
            [
              'User-agent: *',
              ...disallowed.map((word) => `Disallow: ${requestPathOf(word)}`),
              ...(robotsOnly === null ? [] : [`Disallow: /${robotsOnly}/`]),
              '',
            ].join('\n'),
          ] as const,
          ...(robotsOnly === null
            ? []
            : [
                [
                  `${robotsOnly}/index.html`,
                  plainPage(site, `<h1>${site}</h1>\n${prng.pick(ROBOTS_ONLY_PAGES)}`),
                ] as const,
              ]),
        ];
  const origin = ownUrl.slice(0, -1);
  const sitemap =
    prng.next() < SITEMAP_SHARE
      ? [
          [
            'sitemap.xml',
            [
              '<urlset>',
              ...publicPaths.map((path) => `  <url><loc>${origin}${path}</loc></url>`),
              '</urlset>',
              '',
            ].join('\n'),
          ] as const,
        ]
      : [];
  const commentWord = prng.next() < COMMENT_SHARE ? prng.pick(words) : null;
  const commentLines = commentWord === null ? undefined : PATH_COMMENTS[commentWord];
  const comment =
    commentWord === null || commentLines === undefined
      ? null
      : { file: prng.pick(pages).file, text: fillSlots(prng.pick(commentLines), { path: requestPathOf(commentWord) }) };

  return {
    files: new Map([
      ...pages.map((page): readonly [string, string] => [
        page.file,
        fillSlots(
          htmlDocument({
            site,
            nav,
            page,
            author,
            comment: comment !== null && comment.file === page.file ? comment.text : null,
          }),
          slots,
        ),
      ]),
      ...plan.documents.map((document): readonly [string, string] => [
        document.file,
        fillSlots(document.body, slots),
      ]),
      ...[...hidden, ...robots, ...sitemap].map(([file, content]): readonly [string, string] => [
        file,
        fillSlots(content, slots),
      ]),
    ]),
    publicPaths,
  };
};
