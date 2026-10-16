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
import { historyLine } from '../wallet/historyLine.js';

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
