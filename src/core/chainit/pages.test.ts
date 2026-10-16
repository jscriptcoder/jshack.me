import { describe, expect, it } from 'vitest';
import type { TransferRecord } from '../wallet/handleWalletHistory.js';
import {
  CHAINIT_FRONT_PAGE,
  addressPage,
  notAnAddressPage,
  recentPage,
  richPage,
  type Holding,
} from './pages.js';

/**
 * What chainit.io answers with. Every page opens with the lookup form, and the form is
 * its documentation: a reader of the markup learns that an address is looked up at
 * `/address?a=`, which is how the explorer is used from `curl`.
 */

const OURS = `jsc${'a'.repeat(40)}`;
const THEIRS = `jsc${'b'.repeat(40)}`;

/** A distinct address for each place on a list. */
const nthAddress = (place: number): string => `jsc${place.toString(16).padStart(40, '0')}`;

const transfer = (overrides: Partial<TransferRecord> = {}): TransferRecord => ({
  from: null,
  to: OURS,
  amount: 500,
  at: '2026-10-16T09:12:44.000Z',
  ...overrides,
});

const holding = (overrides: Partial<Holding> = {}): Holding => ({
  address: OURS,
  balance: 12000,
  ...overrides,
});

const parsed = (page: string): Document => new DOMParser().parseFromString(page, 'text/html');

/** The ledger's part of a page, as a reader sees it: the text of its one `<pre>`. */
const ledgerText = (page: string): readonly string[] =>
  (parsed(page).querySelector('pre')?.textContent ?? '').split('\n');

const links = (page: string): readonly (string | null)[] =>
  [...parsed(page).querySelectorAll('a')].map((link) => link.getAttribute('href'));

const lookupForm = (page: string) => {
  const form = parsed(page).querySelector('form');
  return {
    action: form?.getAttribute('action'),
    method: form?.getAttribute('method'),
    input: form?.querySelector('input[name="a"]')?.getAttribute('value'),
  };
};

describe('every page', () => {
  it.each([
    ['the front page', CHAINIT_FRONT_PAGE],
    ['an address page', addressPage(OURS, 0, [])],
    ['a refusal', notAnAddressPage('hello')],
    ['the latest transfers', recentPage([])],
    ['the richest addresses', richPage([])],
  ])('%s opens with its name, then a form a reader can submit, then a rule', (_page, page) => {
    const body = parsed(page).body;
    expect(body.textContent?.trimStart().startsWith('chainit.io')).toBe(true);
    expect(body.querySelector('form button[type="submit"]')?.textContent).toBe('Look up');
    expect(body.querySelector('form + hr')).not.toBeNull();
  });
});

describe('the front page', () => {
  it('says what the site is, for a reader who has never heard of it', () => {
    expect(parsed(CHAINIT_FRONT_PAGE).querySelector('hr + p')?.textContent).toBe(
      'The public ledger of JSC. Type an address to see what it holds, and what it has sent and received.',
    );
  });

  it('documents itself with the form an address is looked up by', () => {
    expect(lookupForm(CHAINIT_FRONT_PAGE)).toEqual({
      action: '/address',
      method: 'GET',
      input: '',
    });
  });

  it('names itself for a browser tab and for findit, which lists it by its description', () => {
    const head = parsed(CHAINIT_FRONT_PAGE);
    expect(head.title).toBe('chainit.io - the JSC block explorer');
    expect(head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'Look up any JSC address: its balance and its transfers. The latest transfers on the chain, and the richest addresses.',
    );
    expect(head.querySelector('h1')?.textContent).toBe('chainit.io');
  });

  it('links to the latest transfers and the richest addresses', () => {
    const anchors = [...parsed(CHAINIT_FRONT_PAGE).querySelectorAll('a')];
    expect(anchors.map((link) => [link.getAttribute('href'), link.textContent])).toEqual([
      ['/recent', 'Latest transfers'],
      ['/rich', 'Richest addresses'],
    ]);
  });

  it('shows no ledger before an address has been asked about', () => {
    expect(parsed(CHAINIT_FRONT_PAGE).querySelector('pre')).toBeNull();
  });
});

describe('an address page', () => {
  it('shows the balance as `wallet balance` prints it, then the history as `wallet history` does', () => {
    const page = addressPage(OURS, 460, [
      transfer({ from: OURS, to: THEIRS, amount: 40, at: '2026-10-16T10:01:00.000Z' }),
      transfer(),
    ]);
    expect(ledgerText(page)).toEqual([
      `${OURS}  460 JSC`,
      '',
      `2026-10-16 10:01  -40 JSC  to ${THEIRS}`,
      '2026-10-16 09:12  +500 JSC  from coinbase',
    ]);
  });

  it('makes every address at the other end a link to its own page, and coinbase none', () => {
    const page = addressPage(OURS, 540, [transfer({ from: THEIRS, amount: 40 }), transfer()]);
    expect(links(page)).toEqual([`/address?a=${THEIRS}`]);
  });

  it('says so plainly when the address has done nothing', () => {
    expect(ledgerText(addressPage(OURS, 0, []))).toEqual([`${OURS}  0 JSC`, '', 'No transfers.']);
  });

  it('keeps the address in the form, so the next lookup starts from the last one', () => {
    expect(lookupForm(addressPage(OURS, 0, [])).input).toBe(OURS);
  });

  it('is titled by the address it shows', () => {
    expect(parsed(addressPage(OURS, 0, [])).title).toBe(`${OURS} - chainit.io`);
  });
});

describe('a lookup of something that is not an address', () => {
  it('says what was typed is not an address, and offers the form again with it', () => {
    const page = notAnAddressPage('hello');
    expect(parsed(page).body.textContent).toContain('Not a JSC address: "hello"');
    expect(lookupForm(page).input).toBe('hello');
    expect(parsed(page).title).toBe('Not a JSC address - chainit.io');
    expect(parsed(page).querySelector('pre')).toBeNull();
  });

  it('escapes what was typed, because a visitor wrote it', () => {
    const page = notAnAddressPage('<script>"x"</script>');
    expect(page).toContain('&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
    expect(page).not.toContain('<script>');
    expect(lookupForm(page).input).toBe('<script>"x"</script>');
  });
});

describe('the latest transfers', () => {
  it('shows each transfer with both ends, newest first as the ledger handed them over', () => {
    const page = recentPage([
      transfer({ from: OURS, to: THEIRS, amount: 40, at: '2026-10-16T10:01:00.000Z' }),
      transfer(),
    ]);
    expect(ledgerText(page)).toEqual([
      `2026-10-16 10:01  40 JSC  ${OURS} -> ${THEIRS}`,
      `2026-10-16 09:12  500 JSC  coinbase -> ${OURS}`,
    ]);
  });

  it('makes both ends a link to their own page, and coinbase none', () => {
    const page = recentPage([transfer({ from: OURS, to: THEIRS }), transfer({ to: THEIRS })]);
    expect(links(page)).toEqual([
      `/address?a=${OURS}`,
      `/address?a=${THEIRS}`,
      `/address?a=${THEIRS}`,
    ]);
  });

  it('says so plainly when the chain has moved nothing', () => {
    expect(ledgerText(recentPage([]))).toEqual(['No transfers.']);
  });

  it('says what the list is, and leaves the form empty', () => {
    const page = recentPage([transfer()]);
    expect(parsed(page).title).toBe('Latest transfers - chainit.io');
    expect(parsed(page).querySelector('hr + p')?.textContent).toBe(
      'The latest 20 transfers on the chain, newest first.',
    );
    expect(lookupForm(page).input).toBe('');
  });
});

describe('the richest addresses', () => {
  it('ranks each address with what it holds, in the order the ledger handed them over', () => {
    const page = richPage([holding({ address: THEIRS }), holding({ balance: 460 })]);
    expect(ledgerText(page)).toEqual([` 1  ${THEIRS}  12000 JSC`, ` 2  ${OURS}  460 JSC`]);
  });

  it('pads the rank to two places, so the addresses line up past the ninth', () => {
    const page = richPage(
      Array.from({ length: 10 }, (_slot, place) => holding({ address: nthAddress(place) })),
    );
    expect(ledgerText(page).slice(8)).toEqual([
      ` 9  ${nthAddress(8)}  12000 JSC`,
      `10  ${nthAddress(9)}  12000 JSC`,
    ]);
  });

  it('makes every address a link to its own page', () => {
    expect(links(richPage([holding({ address: THEIRS }), holding()]))).toEqual([
      `/address?a=${THEIRS}`,
      `/address?a=${OURS}`,
    ]);
  });

  it('says so plainly when nobody holds anything', () => {
    expect(ledgerText(richPage([]))).toEqual(['Nobody holds any JSC.']);
  });

  it('says what the list is, and leaves the form empty', () => {
    const page = richPage([holding()]);
    expect(parsed(page).title).toBe('Richest addresses - chainit.io');
    expect(parsed(page).querySelector('hr + p')?.textContent).toBe(
      'The 20 richest addresses, largest first.',
    );
    expect(lookupForm(page).input).toBe('');
  });
});
