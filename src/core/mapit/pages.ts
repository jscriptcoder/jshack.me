/**
 * mapit.io's pages: the world, drawn.
 *
 * The site is a printed atlas. Its pages are files in the box's document root, written
 * from what the world declares, so a rooted mapit can be redrawn like any other site and
 * nothing a page shows is read from a machine that might have gone dark.
 *
 * A drawing is plain ASCII inside a `<pre>`, and holds no link: `lynx` writes a link's
 * number in front of it, which would push the rest of its line out of place. Whatever a
 * reader can follow is listed beneath the drawing instead.
 */

import {
  DECLARED_NETWORKS,
  HARROW_VALLEY,
  TOWNS,
  type DeclaredNetwork,
  type SizeClass,
  type WorldTown,
} from '../generation/world.js';
import { drawTownPlan } from './townPlan.js';

/**
 * Harrow Valley, drawn by hand. Every town the world declares in the region stands on it
 * beside the mark of its size, so a town added to the world is drawn here in the same
 * change: there is room left in the east, the south-west and under the ridge.
 */
const HARROW_VALLEY_DRAWING: readonly string[] = [
  '+----------------------------------------------------------------------------+',
  '|                         H A R R O W   V A L L E Y                          |',
  '|                                                                            |',
  '|       ^    ^     ^    ^    ^      ^    ^        ^    ^    ^     ^     ^    |',
  '|      ^   ^   ^      ^    ^     ^     ^    ^       ^    ~~~    ^    ^       |',
  '|         ^         ^    ^     ^      ^   ^      ^      ~~~   ^   ^      ^   |',
  '|        ^  ^   # Ridgemont   ^     ^   ^              ~~~  * Stonebury      |',
  '|          ^    |     ^               ^            ^ ~~~    |           ^    |',
  '|               |       ^                          ~~~      |         ^      |',
  '|   * Oakhurst  |                 o Thornbury    ~~~        |                |',
  '|   |           |                 |            ~~~          |       o Ashby  |',
  '|   |           |                 |          ~~~            |       |        |',
  '|   +-----------+---+-------------+--------~~~# Kingsford --+-------+        |',
  '|   |               |                    ~~~                |                |',
  '|   |               |                  ~~~                  |                |',
  '|   |               o Millbrook ~ ~  ~~~        +-----------+                |',
  '|   o Hollowmere                  ~~~           |           |                |',
  '|  (~~~~)                      ~~~              |           * Wexcombe       |',
  '|                           ~~~  "   "    "     |                            |',
  '|                        ~~~ "     "    "   "   |                            |',
  '|                     ~~~       +---------------o Fenwick                    |',
  '|                  ~~~  "   "   o Ely   "   "       "                        |',
  '|               ~~~   "   "    "    "     "     "                            |',
  '|   # city   * town   o village   - road   ~ river   ^ hills   " fen         |',
  '+----------------------------------------------------------------------------+',
];

/** The sizes of town, the biggest first: the order a legend lists them in. */
const SIZES_LARGEST_FIRST: readonly SizeClass[] = ['city', 'town', 'village'];

/** The world's towns as the legend lists them: by size, and within a size in the order
 *  the world declared them. */
const townsBySize = (): readonly WorldTown[] =>
  SIZES_LARGEST_FIRST.flatMap((size) => TOWNS.filter((town) => town.size === size));

/** A network the map shows: one that publishes a site. */
type MappedPlace = DeclaredNetwork & { readonly site: NonNullable<DeclaredNetwork['site']> };

/**
 * The places of a town the map shows, in the order the town declares them: every network
 * standing there whose site a search would list. A home publishes nothing, and a site
 * that asks crawlers to stay away is left to be found the way it always was.
 */
const placesIn = (town: WorldTown): readonly MappedPlace[] =>
  DECLARED_NETWORKS.filter(
    (network): network is MappedPlace =>
      network.town === town.name && network.site !== undefined && network.unlisted !== true,
  );

/** What kind of place it is: the kind of shop or practice where it has one, and
 *  otherwise the category every network has. */
const kindOf = (place: MappedPlace): string => place.subtype ?? place.category;

/** Where a town's page is served, under the document root. */
const townPath = (town: WorldTown): string => `${town.name.toLowerCase()}.html`;

/** A town's row in its region's legend: the way to its page, how big it is, and how many
 *  places that page lists. */
const townRow = (town: WorldTown): string =>
  `<tr><td><a href="/${townPath(town)}">${town.name}</a></td><td>${town.size}</td><td>${placesIn(town).length} places</td></tr>`;

/** The front page: the region's drawing, and beneath it every town the drawing names. */
const REGION_PAGE = [
  '<html>',
  '<head>',
  `<title>mapit.io - a map of ${HARROW_VALLEY}</title>`,
  `<meta name="description" content="A map of ${HARROW_VALLEY}: every town in the region, and where it stands.">`,
  '</head>',
  '<body>',
  '<h1>mapit.io</h1>',
  '<pre>',
  ...HARROW_VALLEY_DRAWING,
  '</pre>',
  '<table>',
  ...townsBySize().map(townRow),
  '</table>',
  '</body>',
  '</html>',
  '',
].join('\n');

/** A place's row. Its name is the link, so the number `lynx` writes in front of a link
 *  opens the row; the domain is spelled out beside it for `curl`, which follows nothing. */
const placeRow = (place: MappedPlace): string =>
  `<tr><td><a href="http://${place.site.domain}/">${place.site.name}</a></td><td>${kindOf(place)}</td><td>${place.site.domain}</td></tr>`;

/** A town's page: what it is, its plan, and every place of it the map shows. */
const townPage = (town: WorldTown): string => {
  const places = placesIn(town);
  return [
    '<html>',
    '<head>',
    `<title>${town.name} - mapit.io</title>`,
    '</head>',
    '<body>',
    `<h1>${town.name}</h1>`,
    `<p>A ${town.size} in ${town.region}. ${places.length} places.</p>`,
    '<pre>',
    ...drawTownPlan(town, places.length),
    '</pre>',
    '<table>',
    ...places.map(placeRow),
    '</table>',
    `<p><a href="/">${town.region}</a></p>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
};

/** Every file the site serves, by its path under the document root. */
export const MAPIT_PAGES: Readonly<Record<string, string>> = {
  'index.html': REGION_PAGE,
  ...Object.fromEntries(TOWNS.map((town) => [townPath(town), townPage(town)])),
};
