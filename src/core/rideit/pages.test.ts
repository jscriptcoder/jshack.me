import { describe, expect, it } from 'vitest';
import { RIDEIT_FRONT_PAGE } from './pages.js';
import { TOWNS } from '../generation/world.js';

/**
 * rideit.io's front page: the one page on the box's disk, and so the one a root can rewrite.
 * It names the service, says what it sells for findit to list, quotes the one fare, and
 * lists every town it goes to. It never says where the reader stands: the page is the same
 * file for everybody.
 */

const parsed = (page: string): Document => new DOMParser().parseFromString(page, 'text/html');

describe("rideit.io's front page", () => {
  it('names the service and says what it sells', () => {
    const page = parsed(RIDEIT_FRONT_PAGE);
    expect(page.title).toBe('rideit.io - coach and rail tickets across the valley');
    expect(page.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'Coach and rail tickets to every town in Harrow Valley. One fare, any town.',
    );
    expect(page.querySelector('h1')?.textContent).toBe('rideit.io');
  });

  it('is a whole document as curl prints it, its head holding its title and description', () => {
    expect(
      RIDEIT_FRONT_PAGE.startsWith(
        '<html>\n<head>\n<title>rideit.io - coach and rail tickets across the valley</title>\n<meta name="description" content="',
      ),
    ).toBe(true);
    expect(RIDEIT_FRONT_PAGE).toContain('.">\n</head>\n<body>\n<h1>rideit.io</h1>\n');
    expect(RIDEIT_FRONT_PAGE.endsWith('</body>\n</html>\n')).toBe(true);
  });

  it('quotes one fare to anywhere, 25 JSC', () => {
    expect(parsed(RIDEIT_FRONT_PAGE).body.textContent).toContain('One fare to anywhere: 25 JSC.');
  });

  it('lists every town in the world, in the order the world declares them', () => {
    const listed = [...parsed(RIDEIT_FRONT_PAGE).querySelectorAll('li')].map(
      (item) => item.textContent,
    );
    expect(listed).toEqual(TOWNS.map((town) => town.name));
    expect(listed).toHaveLength(11);
  });

  it('draws the towns as one list under its own heading, closed before the line after it', () => {
    const page = parsed(RIDEIT_FRONT_PAGE);
    expect(page.querySelector('h2')?.textContent).toBe('Where we go');
    expect(page.querySelectorAll('h2 + ul > li')).toHaveLength(TOWNS.length);
    expect(page.querySelector('ul + p')?.textContent).toBe('Booking opens soon.');
  });

  it('says booking is not open yet, and offers nothing to book with', () => {
    const page = parsed(RIDEIT_FRONT_PAGE);
    expect(page.body.textContent).toContain('Booking opens soon.');
    expect(page.querySelector('form')).toBeNull();
  });
});
