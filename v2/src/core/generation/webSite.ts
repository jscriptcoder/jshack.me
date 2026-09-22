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
  type ApiEndpoint,
  type SitePage,
} from './pools/webSites';

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
}): string => {
  const { site, nav, page, author } = options;
  return [
    '<html>',
    `<head><title>${page.title === site ? site : `${page.title} — ${site}`}</title></head>`,
    '<body>',
    nav,
    `<h1>${page.title}</h1>`,
    page.body,
    '<hr>',
    `<p>Page maintained by ${author}.</p>`,
    '</body>',
    '</html>',
  ].join('\n');
};

export const buildWebSite = ({
  essid,
  host,
}: {
  readonly essid: string;
  readonly host: LanHost;
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

  return {
    files: new Map([
      ...pages.map((page): readonly [string, string] => [
        page.file,
        fillSlots(htmlDocument({ site, nav, page, author }), slots),
      ]),
      ...plan.documents.map((document): readonly [string, string] => [
        document.file,
        fillSlots(document.body, slots),
      ]),
    ]),
    publicPaths: [
      ...pages.map((page) => pathOf(page.file)),
      ...plan.documents.map(({ file }) => `/${file}`),
    ],
  };
};
