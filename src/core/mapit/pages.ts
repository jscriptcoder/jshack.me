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

import { HARROW_VALLEY, TOWNS, type SizeClass, type WorldTown } from '../generation/world.js';

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

const townRow = (town: WorldTown): string => `<tr><td>${town.name}</td><td>${town.size}</td></tr>`;

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

/** Every file the site serves, by its path under the document root. */
export const MAPIT_PAGES: Readonly<Record<string, string>> = {
  'index.html': REGION_PAGE,
};
