import { describe, expect, it } from 'vitest';
import { materializeApGatewayFs } from '../network/materializeRouterFs.js';
import { createFsView } from '../filesystem/fsView.js';
import { resolveWebPath } from '../network/http.js';
import { MAPIT_NETWORK } from '../generation/fixedSites.js';
import { HARROW_VALLEY, TOWNS } from '../generation/world.js';
import type { Directory } from '../filesystem/types.js';

/**
 * mapit.io is the world drawn: a map of the region, every town on it. Everything here is
 * read off the box the way a visitor's browser gets it: the pages its web server serves.
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

/** What the page at `urlPath` lists beneath its drawing: a row per entry, its cells
 *  a space apart. */
const legendOn = (urlPath: string): readonly string[] =>
  [...parsed(served(urlPath) ?? '').querySelectorAll('tr')].map((row) =>
    [...row.cells].map((cell) => (cell.textContent ?? '').trim()).join(' '),
  );

/** The mark a town of each size is drawn with, as the drawing's own key gives them. */
const MARKERS = { city: '#', town: '*', village: 'o' } as const;

const valleyTowns = () => TOWNS.filter((town) => town.region === HARROW_VALLEY);

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

  it('lists every town beneath the drawing with its size: cities, then towns, then villages', () => {
    expect(legendOn('/')).toEqual([
      'Ridgemont city',
      'Kingsford city',
      'Oakhurst town',
      'Wexcombe town',
      'Stonebury town',
      'Millbrook village',
      'Ashby village',
      'Fenwick village',
      'Thornbury village',
      'Hollowmere village',
      'Ely village',
    ]);
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
