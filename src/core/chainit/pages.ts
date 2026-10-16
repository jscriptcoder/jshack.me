/**
 * chainit.io's pages: the public JSC ledger, read in a browser.
 *
 * The front page is a file in the box's document root, like every other site's, so a
 * rooted chainit.io can be defaced. An address page is never a file: the server builds it
 * from the ledger for each lookup, so nobody who roots the box can make it say an address
 * holds anything it does not.
 *
 * Every page opens with the lookup form, and the form is the documentation: a reader of
 * the markup learns from `action="/address"`, `method="GET"` and `name="a"` exactly what
 * to give `curl`. The ledger is shown in a `<pre>` as `wallet` prints it, so the site and
 * the command never word an address differently.
 */

import { escapeHtml } from '../findit/page.js';
import type { TransferRecord } from '../wallet/handleWalletHistory.js';
import { historyLine, ledgerTime } from '../wallet/historyLine.js';

const FRONT_TITLE = 'chainit.io - the JSC block explorer';

const DESCRIPTION =
  'Look up any JSC address: its balance and its transfers. The latest transfers on the chain, and the richest addresses.';

/** A chainit page: the form, re-filled with what was looked up, and whatever the page
 *  says beneath it. */
const chainitDocument = (options: {
  readonly title: string;
  readonly description?: string;
  readonly lookedUp: string;
  readonly body: readonly string[];
}): string =>
  [
    '<html>',
    '<head>',
    `<title>${escapeHtml(options.title)}</title>`,
    ...(options.description === undefined
      ? []
      : [`<meta name="description" content="${escapeHtml(options.description)}">`]),
    '</head>',
    '<body>',
    '<h1>chainit.io</h1>',
    '<form action="/address" method="GET">',
    `<input type="text" name="a" value="${escapeHtml(options.lookedUp)}" placeholder="A JSC address">`,
    '<button type="submit">Look up</button>',
    '</form>',
    '<hr>',
    ...options.body,
    '</body>',
    '</html>',
    '',
  ].join('\n');

export const CHAINIT_FRONT_PAGE = chainitDocument({
  title: FRONT_TITLE,
  description: DESCRIPTION,
  lookedUp: '',
  body: [
    '<p>The public ledger of JSC. Type an address to see what it holds, and what it has sent and received.</p>',
    '<p><a href="/recent">Latest transfers</a> | <a href="/rich">Richest addresses</a></p>',
  ],
});

/** An address on a page, as a link to that address's own page. An address is `jsc` and
 *  hex, so it carries nothing that needs escaping. */
const addressLink = (address: string): string => `<a href="/address?a=${address}">${address}</a>`;

/**
 * What an address holds and its latest transfers, newest first — `wallet balance`'s
 * line, then `wallet history`'s, with every address at the other end a link to follow.
 */
export const addressPage = (
  address: string,
  balance: number,
  transfers: readonly TransferRecord[],
): string =>
  chainitDocument({
    title: `${address} - chainit.io`,
    lookedUp: address,
    body: [
      `<pre>${[
        `${address}  ${balance} JSC`,
        '',
        ...(transfers.length === 0
          ? ['No transfers.']
          : transfers.map((transfer) => historyLine(address, transfer, addressLink))),
      ].join('\n')}</pre>`,
    ],
  });

/** The answer to a lookup of something that is not an address: what was typed, back in
 *  the form to be corrected. */
export const notAnAddressPage = (typed: string): string =>
  chainitDocument({
    title: 'Not a JSC address - chainit.io',
    lookedUp: typed,
    body: [`<p>Not a JSC address: ${escapeHtml(`"${typed}"`)}</p>`],
  });

/** What one address holds, as the rich list ranks it. */
export type Holding = {
  readonly address: string;
  readonly balance: number;
};

/** A page that lists the whole chain: what the list is, then its lines, or what to say
 *  when there are none. The form is empty, as nothing was looked up. */
const chainPage = (options: {
  readonly title: string;
  readonly caption: string;
  readonly lines: readonly string[];
  readonly none: string;
}): string =>
  chainitDocument({
    title: options.title,
    lookedUp: '',
    body: [
      `<p>${options.caption}</p>`,
      `<pre>${(options.lines.length === 0 ? [options.none] : options.lines).join('\n')}</pre>`,
    ],
  });

/** The latest transfers across the whole chain, newest first, both ends on each line.
 *  Minted coins came from no address, and the word in its place is the wallet's own. */
export const recentPage = (transfers: readonly TransferRecord[]): string =>
  chainPage({
    title: 'Latest transfers - chainit.io',
    caption: 'The latest 20 transfers on the chain, newest first.',
    lines: transfers.map(
      ({ from, to, amount, at }) =>
        `${ledgerTime(at)}  ${amount} JSC  ${from === null ? 'coinbase' : addressLink(from)} -> ${addressLink(to)}`,
    ),
    none: 'No transfers.',
  });

/** The richest addresses, largest first, each with its rank. The rank is padded to two
 *  places so the addresses line up down the list. */
export const richPage = (holdings: readonly Holding[]): string =>
  chainPage({
    title: 'Richest addresses - chainit.io',
    caption: 'The 20 richest addresses, largest first.',
    lines: holdings.map(
      ({ address, balance }, place) =>
        `${String(place + 1).padStart(2)}  ${addressLink(address)}  ${balance} JSC`,
    ),
    none: 'Nobody holds any JSC.',
  });
