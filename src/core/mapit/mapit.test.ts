import { describe, expect, it } from 'vitest';
import { materializeApGatewayFs } from '../network/materializeRouterFs.js';
import { createFsView } from '../filesystem/fsView.js';
import { resolveWebPath } from '../network/http.js';
import { MAPIT_NETWORK } from '../generation/fixedSites.js';
import { DECLARED_NETWORKS, HARROW_VALLEY, TOWNS } from '../generation/world.js';
import { buildGeneratedWeb } from '../findit/webIndex.js';
import { MAPIT_PAGES } from './pages.js';
import type { Directory } from '../filesystem/types.js';

/**
 * mapit.io is the world drawn: a map of the region with every town on it, and a page for
 * each town listing its public places. Everything here is read off the box the way a
 * visitor's browser gets it: the pages its web server serves.
 */

const mapitBox = (): Directory => materializeApGatewayFs({ essid: MAPIT_NETWORK }, []);

/** What the site serves at `urlPath`, or null when nothing is there. */
const served = (urlPath: string): string | null => {
  const path = resolveWebPath(urlPath);
  if (path === null) return null;
  const read = createFsView(mapitBox(), { userType: 'root' }).read(path);
  return read.ok ? read.content : null;
};

const parsed = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

/** The drawing on the page at `urlPath`, a line of it per entry: everything between the
 *  line its `<pre>` opens on and the line it closes on. */
const drawingOn = (urlPath: string): readonly string[] =>
  (parsed(served(urlPath) ?? '').querySelector('pre')?.textContent ?? '')
    .replace(/\n$/, '')
    .split('\n');

/** What the page at `urlPath` lists in its legend: a row per entry, a cell per column. */
const cellsOn = (urlPath: string): readonly (readonly string[])[] =>
  [...parsed(served(urlPath) ?? '').querySelectorAll('tr')].map((row) =>
    [...row.cells].map((cell) => (cell.textContent ?? '').trim()),
  );

/** The same rows as a reader takes them in, a row's cells a space apart. */
const legendOn = (urlPath: string): readonly string[] =>
  cellsOn(urlPath).map((cells) => cells.join(' '));

/** Every link on the page at `urlPath` in the order a reader meets them, which is the
 *  order `lynx` numbers them in: what each is called, and where it leads. */
const linksOn = (urlPath: string): readonly string[] =>
  [...parsed(served(urlPath) ?? '').querySelectorAll('a')].map(
    (link) => `${link.textContent ?? ''} -> ${link.getAttribute('href') ?? ''}`,
  );

/** The mark a town of each size is drawn with, as the drawing's own key gives them. */
const MARKERS = { city: '#', town: '*', village: 'o' } as const;

const valleyTowns = () => TOWNS.filter((town) => town.region === HARROW_VALLEY);

/** Where a town's own page is served. */
const pageOf = (town: { readonly name: string }): string => `/${town.name.toLowerCase()}.html`;

describe('the front page of mapit.io', () => {
  it('draws every town of Harrow Valley beside the mark of its size', () => {
    const drawing = drawingOn('/');
    expect(valleyTowns().length).toBeGreaterThan(0);
    const missing = valleyTowns().filter(
      (town) => !drawing.some((line) => `${line} `.includes(`${MARKERS[town.size]} ${town.name} `)),
    );
    expect(missing).toEqual([]);
  });

  it('names the valley, and says what each mark on the drawing stands for', () => {
    const drawing = drawingOn('/').join('\n');
    expect(drawing).toContain('H A R R O W   V A L L E Y');
    expect(drawing).toContain('# city   * town   o village');
  });

  it('lists every town beneath the drawing with its size and how many places its page lists: cities, then towns, then villages', () => {
    expect(legendOn('/')).toEqual([
      'Ridgemont city 102 places',
      'Kingsford city 70 places',
      'Oakhurst town 21 places',
      'Wexcombe town 20 places',
      'Stonebury town 23 places',
      'Millbrook village 9 places',
      'Ashby village 8 places',
      'Fenwick village 8 places',
      'Thornbury village 8 places',
      'Hollowmere village 9 places',
      'Ely village 6 places',
    ]);
  });

  it("makes each town's name the link to its own page, which lists as many places as the legend says", () => {
    const towns = cellsOn('/').map(([name = '', , count = '']) => ({ name, count }));
    expect(linksOn('/')).toEqual(towns.map((town) => `${town.name} -> ${pageOf(town)}`));
    expect(towns.map((town) => town.count)).toEqual(
      towns.map((town) => `${cellsOn(pageOf(town)).length} places`),
    );
    expect(towns.reduce((total, town) => total + parseInt(town.count, 10), 0)).toBe(284);
  });

  it('draws a frame 78 columns wide, every line of it flush with the frame', () => {
    // A line a hand left a column short or long would pull the frame's edge out of true.
    const widths = drawingOn('/').map((line) => line.length);
    expect(widths.length).toBeGreaterThan(1);
    expect(widths.filter((width) => width !== 78)).toEqual([]);
  });

  it('draws in plain characters every reader shows alike, with no markup inside', () => {
    const drawing = drawingOn('/').join('\n');
    expect(drawing).not.toBe('');
    expect(drawing).toMatch(/^[\x20-\x7e\n]*$/);
    expect(drawing).not.toMatch(/[<>&]/);
    expect(parsed(served('/') ?? '').querySelector('pre a')).toBeNull();
  });

  it('is called a map of Harrow Valley, which is what a search for it would read', () => {
    const page = parsed(served('/') ?? '');
    expect(page.title).toBe('mapit.io - a map of Harrow Valley');
    expect(page.querySelector('h1')?.textContent).toBe('mapit.io');
    expect(page.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'A map of Harrow Valley: every town in the region, and where it stands.',
    );
  });
});

describe("a town's page on mapit.io", () => {
  it('lists the places a search would list in Millbrook, in the order the town declares them, and none of its homes', () => {
    expect(legendOn('/millbrook.html')).toEqual([
      'Millbrook Town Council government millbrook.gov',
      'Millbrook Police Department government millbrookpd.gov',
      'Millbrook Public Library public millbrooklibrary.org',
      "Yates's Café cafe yatesscafe.com",
      'Silverbirch Coffee coffee-bar silverbirchcoffee.com',
      "Warrington's Bakery bakery warringtonsbakery.com",
      'Broad Street Haulage logistics broadstreethaulage.com',
      'Millbrook Cottage Hospital hospital millbrookhospital.org',
      'Gateway Dental dentist gatewaydental.com',
    ]);
  });

  it("makes each place's name the link to its site, so a row's number is its link's, and leads back to the valley after them", () => {
    expect(linksOn('/millbrook.html').slice(0, 2)).toEqual([
      'Millbrook Town Council -> http://millbrook.gov/',
      'Millbrook Police Department -> http://millbrookpd.gov/',
    ]);
    for (const town of valleyTowns()) {
      const rows = cellsOn(pageOf(town));
      expect(rows.length).toBeGreaterThan(0);
      expect(linksOn(pageOf(town))).toEqual([
        ...rows.map(([name, , domain]) => `${name} -> http://${domain}/`),
        `${HARROW_VALLEY} -> /`,
      ]);
    }
  });

  it('is headed with the name of the town, then says how big it is, where it stands and how many places it lists', () => {
    const millbrook = parsed(served('/millbrook.html') ?? '');
    expect(millbrook.title).toBe('Millbrook - mapit.io');
    expect(millbrook.querySelector('h1')?.textContent).toBe('Millbrook');
    expect(millbrook.querySelector('p')?.textContent).toBe('A village in Harrow Valley. 9 places.');
    for (const town of valleyTowns()) {
      const page = parsed(served(pageOf(town)) ?? '');
      expect(page.querySelector('h1')?.textContent).toBe(town.name);
      expect(page.querySelector('p')?.textContent).toBe(
        `A ${town.size} in ${HARROW_VALLEY}. ${cellsOn(pageOf(town)).length} places.`,
      );
    }
  });

  it('writes a name as its place writes it, ampersand, apostrophe and accent alike, in the page as served', () => {
    expect(served('/ridgemont.html')).toContain('>Brew & Code</a>');
    expect(served('/millbrook.html')).toContain(">Yates's Café</a>");
    expect(cellsOn('/ridgemont.html').map(([name]) => name)).toContain('Brew & Code');
  });

  it('is served a row to a line, so a reader who takes the page as it is written can still read it', () => {
    expect((served('/millbrook.html') ?? '').split('\n')).toContain(
      '<tr><td><a href="http://millbrook.gov/">Millbrook Town Council</a></td><td>government</td><td>millbrook.gov</td></tr>',
    );
  });

  it('shows a place of a town exactly when a search would list its site', () => {
    const listed = new Set(
      [...buildGeneratedWeb().values()].flat().map((indexed) => indexed.address),
    );
    for (const town of valleyTowns()) {
      const searchable = DECLARED_NETWORKS.flatMap((network) =>
        network.town === town.name && network.site !== undefined && listed.has(network.site.domain)
          ? [network.site.domain]
          : [],
      );
      expect(searchable.length).toBeGreaterThan(0);
      expect(cellsOn(pageOf(town)).map(([, , domain]) => domain)).toEqual(searchable);
    }
  });
});

describe('every page of mapit.io', () => {
  const everyPage = (): string => Object.values(MAPIT_PAGES).join('\n');

  it('prints no address and no part of one: where a place answers is for a lookup to say', () => {
    expect(Object.keys(MAPIT_PAGES)).toHaveLength(1 + valleyTowns().length);
    expect(everyPage().match(/\d+\.\d+/g)).toBeNull();
  });

  it('prints no wifi name: matching one to a place is left to whoever stands outside it', () => {
    const pages = everyPage();
    expect(DECLARED_NETWORKS.length).toBeGreaterThan(0);
    expect(DECLARED_NETWORKS.filter((network) => pages.includes(network.essid))).toEqual([]);
  });
});
