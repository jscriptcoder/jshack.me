import { describe, expect, it } from 'vitest';
import {
  arrivedPage,
  NOWHERE_PAGE,
  RIDEIT_FRONT_PAGE,
  ticketPage,
  unpaidPage,
  USED_TICKET_PAGE,
} from './pages.js';
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
    expect(parsed(RIDEIT_FRONT_PAGE).querySelector('h1 + p')?.textContent).toBe(
      'Travel by coach and rail to every town in Harrow Valley.\nOne fare to anywhere: 25 JSC.',
    );
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
    expect(page.querySelector('ul + p')?.textContent).toBe('Book a ticket');
  });

  it('links to the ticket page, and books nothing itself', () => {
    const page = parsed(RIDEIT_FRONT_PAGE);
    const link = page.querySelector('ul + p > a');
    expect(link?.getAttribute('href')).toBe('/ticket');
    expect(link?.textContent).toBe('Book a ticket');
    expect(page.querySelector('form')).toBeNull();
  });
});

/**
 * The ticket page is the booking form, written for the reader: the fare, the address their
 * next trip is paid to, and how much has arrived there. lynx draws no drop-down list, so
 * every town is its own table row: the town's name, then a small form holding the town
 * sent as a field nobody types and one button that boards for it. It never says where
 * the reader stands.
 */
describe("rideit.io's ticket page", () => {
  const ADDRESS = 'jsc0612820023d341ff3ace924e0e4cafda09b51a98';
  const TICKET_PAGE = ticketPage({ address: ADDRESS, paid: 10 });
  const forms = () => [...parsed(TICKET_PAGE).querySelectorAll('form')];

  it('is a whole rideit.io page, its head holding only its title', () => {
    const page = parsed(TICKET_PAGE);
    expect(page.title).toBe('rideit.io - book a ticket');
    expect(page.querySelector('h1')?.textContent).toBe('rideit.io');
    expect(page.querySelector('h2')?.textContent).toBe('Book a ticket');
    expect(
      TICKET_PAGE.startsWith(
        '<html>\n<head>\n<title>rideit.io - book a ticket</title>\n</head>\n<body>\n<h1>rideit.io</h1>\n',
      ),
    ).toBe(true);
  });

  it('quotes the fare, the address it is paid to and how much has arrived, before the towns', () => {
    expect(TICKET_PAGE).toContain(
      `<h2>Book a ticket</h2>\n<p>One fare to anywhere: 25 JSC, paid to this ticket's own address:</p>\n<p>${ADDRESS}</p>\n<p>Paid so far: 10 of 25 JSC.</p>\n<table>`,
    );
  });

  it('says nothing has arrived at an address nobody paid', () => {
    expect(parsed(ticketPage({ address: ADDRESS, paid: 0 })).body.textContent).toContain(
      'Paid so far: 0 of 25 JSC.',
    );
  });

  it('writes each town as a table row on lines of its own, as curl prints it', () => {
    expect(TICKET_PAGE).toContain(
      `<table>\n<tr>\n<td>* ${TOWNS[0]!.name}</td>\n<td><form action="/board" method="post">\n<input type="hidden" name="town" value="${TOWNS[0]!.name}">\n<input type="submit" value="Board">\n</form></td>\n</tr>\n<tr>`,
    );
  });

  it('offers one row per town, its form beside its name, in the order the world declares them', () => {
    const rows = [...parsed(TICKET_PAGE).querySelectorAll('tr')];
    expect(rows.map((row) => row.querySelector('td')?.textContent)).toEqual(
      TOWNS.map((town) => `* ${town.name}`),
    );
    expect(rows.map((row) => row.querySelector('td + td > form') !== null)).toEqual(
      TOWNS.map(() => true),
    );
  });

  it('boards each form for its own town, posted to /board', () => {
    expect(
      forms().map((form) => ({
        action: form.getAttribute('action'),
        method: form.getAttribute('method'),
        fields: [...form.querySelectorAll('input')].map((input) => ({
          type: input.getAttribute('type'),
          name: input.getAttribute('name'),
          value: input.getAttribute('value'),
        })),
      })),
    ).toEqual(
      TOWNS.map((town) => ({
        action: '/board',
        method: 'post',
        fields: [
          { type: 'hidden', name: 'town', value: town.name },
          { type: 'submit', name: null, value: 'Board' },
        ],
      })),
    );
  });

  it('shows how to pay and board from a terminal, for the first town', () => {
    expect(TICKET_PAGE).toContain(
      `</table>\n<p>Or from a terminal:</p>\n<pre>\n$ wallet send ${ADDRESS} 25\n$ curl -d "town=${TOWNS[0]!.name}" http://rideit.io/board\n</pre>\n</body>`,
    );
  });
});

/** What a boarding answers: an arrival, a refusal, or a ticket another boarding used. */
describe("rideit.io's answers to a boarding", () => {
  it('says the traveller arrived in the town they boarded for, and thanks them', () => {
    const page = parsed(arrivedPage('Millbrook'));
    expect(page.title).toBe('rideit.io - arrived');
    expect(page.querySelector('h1')?.textContent).toBe('rideit.io');
    expect([...page.querySelectorAll('p')].map((line) => line.textContent)).toEqual([
      'You have arrived in Millbrook.',
      'Thank you for travelling with rideit.io.',
    ]);
    expect(page.querySelector('meta')).toBeNull();
  });

  it('writes the town as text, never as markup', () => {
    expect(arrivedPage('<b>Ely</b>')).toContain('You have arrived in &lt;b&gt;Ely&lt;/b&gt;.');
  });

  it('refuses a town it does not go to, and links back to the ticket page', () => {
    const page = parsed(NOWHERE_PAGE);
    expect(page.title).toBe('rideit.io - no such town');
    expect(page.body.textContent).toContain('We do not go there.');
    expect(page.querySelector('a')?.getAttribute('href')).toBe('/ticket');
  });

  it('refuses a boarding before the whole fare has arrived, says how much has, and links back', () => {
    const page = parsed(unpaidPage(10));
    expect(page.title).toBe('rideit.io - fare not paid');
    expect(page.querySelector('h1')?.textContent).toBe('rideit.io');
    expect(page.querySelector('h1 + p')?.textContent).toBe(
      'The fare has not arrived: 10 of 25 JSC.',
    );
    expect(page.querySelector('a')?.getAttribute('href')).toBe('/ticket');
  });

  it('says a ticket already used was used', () => {
    expect(parsed(USED_TICKET_PAGE).title).toBe('rideit.io - ticket used');
    expect(parsed(USED_TICKET_PAGE).body.textContent).toContain(
      'This ticket has already been used.',
    );
  });
});
