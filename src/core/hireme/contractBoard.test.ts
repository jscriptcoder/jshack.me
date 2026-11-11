import { describe, expect, it } from 'vitest';
import { contractBoardPage, type BoardOffer, type ContractBoard } from './contractBoard.js';
import type { MissionTerms } from '../missions/missionTerms.js';

/**
 * A handle's contractor board, answered by the boards' server at the board's address: the
 * current contract if one is held, the offers, and what a form just did.
 */

const getTerms = (
  overrides?: Partial<Extract<MissionTerms, { readonly job: 'key' }>>,
): MissionTerms => ({
  job: 'key',
  client: { company: 'Copper Systems', handle: 'copper-ops' },
  targetCompany: 'Halden Logistics',
  kind: 'retrieve an access key',
  pitch: 'A rival is sitting on something of ours. We want the key to it.',
  keyOpens: 'the billing API',
  pay: 1350,
  ...overrides,
});

const getOffer = (overrides?: Partial<BoardOffer>): BoardOffer => ({
  ref: 'k7q2',
  terms: getTerms(),
  ...overrides,
});

const getBoard = (overrides?: Partial<ContractBoard>): ContractBoard => ({
  handle: 'neo',
  address: '194.12.34.56',
  current: null,
  offers: [
    getOffer({ ref: 'k7q2' }),
    getOffer({ ref: 'p3vx', terms: getTerms({ pay: 500 }) }),
    getOffer({ ref: 'zz90', terms: getTerms({ pay: 2000 }) }),
  ],
  ...overrides,
});

const render = (board: ContractBoard) =>
  new DOMParser().parseFromString(contractBoardPage(board), 'text/html');

const textOf = (page: Document): string => page.body.textContent ?? '';

/** The text of the page from `start` up to (not including) `end`, in document order. */
const textBetween = (page: Document, start: Element, end: Element | null): string => {
  const range = page.createRange();
  range.setStartAfter(start);
  if (end === null) range.setEndAfter(page.body.lastChild ?? start);
  else range.setEndBefore(end);
  return range.toString();
};

const acceptForms = (page: Document) => [...page.querySelectorAll('form[action="/accept"]')];

describe("a handle's contractor board", () => {
  it('is titled as the board', () => {
    expect(render(getBoard()).title).toBe('hireme.io - contractor board');
  });

  // Whoever has the address reads the board, so it says whose it is.
  it('welcomes back the handle it belongs to', () => {
    expect(render(getBoard({ handle: 'trinity' })).querySelector('h1')?.textContent).toBe(
      'Welcome back, trinity.',
    );
  });

  it('carries no description, since no search engine lists it', () => {
    expect(render(getBoard()).querySelector('meta[name="description"]')).toBeNull();
  });

  it('shows a handle as text, never as markup', () => {
    expect(render(getBoard({ handle: '<b>neo</b>' })).querySelector('b')).toBeNull();
  });

  it('no longer says there is no work', () => {
    expect(textOf(render(getBoard()))).not.toContain('no contracts available');
  });
});

describe('the offers on a board', () => {
  it('shows each offer as its client, the kind of job and the pay, then the pitch', () => {
    const text = textOf(render(getBoard({ offers: [getOffer()] })));

    expect(text).toContain('Copper Systems — retrieve an access key — §1,350');
    expect(text).toContain('A rival is sitting on something of ours. We want the key to it.');
  });

  it('quotes pay with a thousands separator only where there are thousands', () => {
    const text = textOf(render(getBoard()));

    expect(text).toContain('— §500');
    expect(text).toContain('— §2,000');
  });

  it('gives every offer its own Accept form, posting the offer by its ref', () => {
    const forms = acceptForms(render(getBoard()));

    expect(forms).toHaveLength(3);
    expect(
      forms.map((form) =>
        form.querySelector('input[type="hidden"][name="offer"]')?.getAttribute('value'),
      ),
    ).toEqual(['k7q2', 'p3vx', 'zz90']);
    for (const form of forms) {
      expect(form.getAttribute('method')).toBe('post');
      expect(form.querySelector('input[type="submit"]')?.getAttribute('value')).toBe('Accept');
    }
  });

  // A hidden field does not show in a terminal browser, so a contractor using curl reads
  // the ref off the page and the command beside it.
  it('shows each ref, and how to accept it from a terminal at this board', () => {
    const text = textOf(render(getBoard()));

    expect(text).toContain('Ref: p3vx');
    expect(text).toContain('$ curl -d "offer=<ref>" http://194.12.34.56/accept');
  });

  it('never names who the job is against before it is accepted', () => {
    expect(textOf(render(getBoard({ current: null })))).not.toContain('Halden Logistics');
  });
});

describe('the current contract on a board', () => {
  it('is not shown while no job is held, and nothing can be dropped', () => {
    const page = render(getBoard({ current: null }));

    expect(textOf(page)).not.toContain('Current contract');
    expect(page.querySelector('form[action="/drop"]')).toBeNull();
  });

  it('shows the client, the target company and the pay, above the offers', () => {
    const page = render(
      getBoard({
        current: getTerms({
          client: { company: 'Orchard Labs', handle: 'orchard-sec' },
          pay: 1800,
        }),
      }),
    );
    const text = textOf(page);

    expect(text).toContain('Current contract');
    expect(text).toContain('Orchard Labs — Halden Logistics — §1,800');
    expect(text.indexOf('Current contract')).toBeLessThan(text.indexOf('Offers'));
  });

  it('can be dropped with a form, or from a terminal at this board', () => {
    const page = render(getBoard({ current: getTerms() }));
    const drop = page.querySelector('form[action="/drop"]');

    expect(drop?.getAttribute('method')).toBe('post');
    expect(drop?.querySelector('input[type="submit"]')?.getAttribute('value')).toBe(
      'Drop contract',
    );
    expect(textOf(page)).toContain('$ curl -d "confirm=yes" http://194.12.34.56/drop');
  });
});

describe('what a form just did, said on the board', () => {
  it('is said under the Accept button of the offer it is about', () => {
    const page = render(
      getBoard({
        notice: { message: 'Finish or drop your current contract first', under: { offer: 'p3vx' } },
      }),
    );
    const [, second, third] = acceptForms(page);

    expect(page.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(textBetween(page, second!, third!)).toContain(
      'Finish or drop your current contract first',
    );
  });

  it('is said under the Drop button when it is about the current contract', () => {
    const page = render(
      getBoard({
        current: getTerms(),
        notice: {
          message: 'Contract accepted. Copper Systems has sent you a briefing.',
          under: 'contract',
        },
      }),
    );
    const drop = page.querySelector('form[action="/drop"]');

    expect(textBetween(page, drop!, page.querySelector('h2:last-of-type'))).toContain(
      'Contract accepted. Copper Systems has sent you a briefing.',
    );
  });

  it.each([
    ['an offer no longer on the board', { offer: 'gone1' }],
    ['a contract no longer held', 'contract'],
  ] as const)('is said at the top of the board when it is about %s', (_about, under) => {
    const page = render(
      getBoard({ current: null, notice: { message: 'That offer is no longer available.', under } }),
    );
    const heading = page.querySelector('h1');

    expect(heading?.nextElementSibling?.getAttribute('role')).toBe('alert');
    expect(heading?.nextElementSibling?.textContent).toBe('That offer is no longer available.');
  });

  it('shows a message as text, never as markup', () => {
    const page = render(getBoard({ notice: { message: '<b>x</b>', under: 'contract' } }));

    expect(page.querySelector('[role="alert"] b')).toBeNull();
  });

  it('says nothing when no form was sent', () => {
    expect(render(getBoard()).querySelector('[role="alert"]')).toBeNull();
  });
});

describe('how a board reads, top to bottom', () => {
  const readingOf = (page: Document): string => textOf(page).replace(/\s+/g, ' ').trim();
  const offerReading = [
    'Copper Systems — retrieve an access key — §1,350',
    'A rival is sitting on something of ours. We want the key to it.',
    'Ref: k7q2',
  ];
  const acceptReading = [
    'Or from a terminal:',
    '$ curl -d "offer=<ref>" http://194.12.34.56/accept',
  ];

  it('reads as the welcome, then the offers and how to accept one from a terminal', () => {
    const page = render(getBoard({ offers: [getOffer()] }));

    expect(readingOf(page)).toBe(
      ['Welcome back, neo.', 'Offers', ...offerReading, ...acceptReading].join(' '),
    );
  });

  it('reads the current contract, and how to drop it from a terminal, before the offers', () => {
    const page = render(getBoard({ current: getTerms(), offers: [getOffer()] }));

    expect(readingOf(page)).toBe(
      [
        'Welcome back, neo.',
        'Current contract',
        'Copper Systems — Halden Logistics — §1,350',
        'Or from a terminal:',
        '$ curl -d "confirm=yes" http://194.12.34.56/drop',
        'Offers',
        ...offerReading,
        ...acceptReading,
      ].join(' '),
    );
  });

  it('sets each terminal line apart, as it would be typed', () => {
    const page = render(getBoard({ current: getTerms() }));

    expect([...page.querySelectorAll('pre')].map((pre) => pre.textContent?.trim())).toEqual([
      '$ curl -d "confirm=yes" http://194.12.34.56/drop',
      '$ curl -d "offer=<ref>" http://194.12.34.56/accept',
    ]);
  });

  it('has the Drop form post the same confirmation its terminal line does', () => {
    const page = render(getBoard({ current: getTerms() }));
    const confirm = page.querySelector('form[action="/drop"] input[name="confirm"]');

    expect(confirm?.getAttribute('type')).toBe('hidden');
    expect(confirm?.getAttribute('value')).toBe('yes');
  });
});
