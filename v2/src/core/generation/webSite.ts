/**
 * The site a web server publishes — pages that link each other, belonging to the place
 * the network is.
 *
 * Only a box whose name says it serves the web (`www-04`, `portal-12`) gets one; any
 * other box that happens to run a web server keeps the single page it always had. A
 * reader who opens `/` in a browser sees the site's navigation, and every entry in it
 * opens a page this box really serves: the links are written here, from the pages this
 * box was drawn, so they cannot name one it was not.
 *
 * Its stream is its OWN (`web-site-…`), never a continuation of the host's: appending a
 * draw to another stream would move every value picked after it.
 */

import { createPrng, type Prng } from './prng';
import type { LanHost } from './generateHomeLan';
import { networkPersona } from './persona';
import { fillSlots } from './npcHome';
import { FRONT_PAGES, SHARED_PAGES, SITE_PAGES, type SitePage } from './pools/webSites';

export type WebSite = {
  /** Every file the site publishes, keyed by its path beneath the document root. */
  readonly files: ReadonlyMap<string, string>;
  /** The request paths a reader reaches by following links from `/`, `/` first. */
  readonly publicPaths: readonly string[];
};

/** The fewest and the most pages a site holds, its front page included. */
const MIN_PAGES = 4;
const MAX_PAGES = 12;

/** How a place names itself at the top of its own page: `the Midnight Diner` heads its
 *  site as `The Midnight Diner`. */
const headed = (place: string): string => place.charAt(0).toUpperCase() + place.slice(1);

type Drawn = { readonly file: string; readonly title: string; readonly body: string };

const drawPages = (prng: Prng, pool: readonly SitePage[]): readonly Drawn[] => {
  const count = prng.nextInt(MIN_PAGES - 1, Math.min(MAX_PAGES - 1, pool.length));
  return prng
    .pickN(pool, count)
    .map((page) => ({ file: page.file, title: page.title, body: prng.pick(page.bodies) }));
};

const pathOf = (file: string): string => (file === 'index.html' ? '/' : `/${file}`);

const navigation = (pages: readonly Drawn[]): string =>
  `<p>${pages
    .map((page) => `<a href="${pathOf(page.file)}">${page.file === 'index.html' ? 'Home' : page.title}</a>`)
    .join(' | ')}</p>`;

const document = (options: {
  readonly site: string;
  readonly nav: string;
  readonly title: string;
  readonly body: string;
}): string =>
  [
    '<html>',
    `<head><title>${options.title === options.site ? options.site : `${options.title} — ${options.site}`}</title></head>`,
    '<body>',
    options.nav,
    `<h1>${options.title}</h1>`,
    options.body,
    '</body>',
    '</html>',
  ].join('\n');

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

  const front: Drawn = { file: 'index.html', title: site, body: prng.pick(FRONT_PAGES[persona.category]) };
  const pages = [front, ...drawPages(prng, [...SITE_PAGES[persona.category], ...SHARED_PAGES])];
  const nav = navigation(pages);

  return {
    files: new Map(
      pages.map((page) => [
        page.file,
        fillSlots(document({ site, nav, title: page.title, body: page.body }), slots),
      ]),
    ),
    publicPaths: pages.map((page) => pathOf(page.file)),
  };
};
