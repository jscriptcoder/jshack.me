/**
 * The pages findit.io serves — its front page, and the page a search answers with.
 *
 * Both open with the same form, and the form IS the documentation: there is no help
 * text, and a reader of the markup learns from `action="/"`, `method="GET"` and
 * `name="q"` exactly what to type into an address bar.
 */

import type { IndexedPage } from './search';

/** Everything interpolated into a page is escaped, because other people write what is
 *  interpolated: the query is a searcher's, and the titles are the sites'. */
export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** A findit page: the form, re-filled with what was searched for, and whatever the
 *  page says beneath it. */
export const finditDocument = (options: {
  readonly title: string;
  readonly query: string;
  readonly body: readonly string[];
}): string =>
  [
    '<html>',
    `<head><title>${escapeHtml(options.title)}</title></head>`,
    '<body>',
    '<h1>findit.io</h1>',
    '<form action="/" method="GET">',
    `<input type="text" name="q" value="${escapeHtml(options.query)}" placeholder="Search the public web">`,
    '<button type="submit">Search</button>',
    '</form>',
    '<hr>',
    ...options.body,
    '</body>',
    '</html>',
    '',
  ].join('\n');

/** The front page: the form, and nothing else to read. */
export const FINDIT_FRONT_PAGE = finditDocument({ title: 'findit.io', query: '', body: [] });

/** One result: a name to follow, the address behind it, and what the site says of
 *  itself. The link is spelled out in full because a reader may be `curl`, which
 *  follows nothing and needs the address to be readable as text. */
const resultItem = (page: IndexedPage): readonly string[] => [
  '<li>',
  `<h2><a href="http://${escapeHtml(page.address)}/">${escapeHtml(page.title)}</a></h2>`,
  `<p>${escapeHtml(page.address)}</p>`,
  `<p>${escapeHtml(page.description)}</p>`,
  '</li>',
];

/**
 * The answer to a search: the form again, carrying what was asked so the next search
 * starts from the last one, and the pages that answered it in the order they ranked.
 */
export const searchResultsPage = (
  query: string,
  results: readonly IndexedPage[],
): string =>
  finditDocument({
    title: `${query} — findit.io`,
    query,
    body:
      results.length === 0
        ? [`<p>No matches for ${escapeHtml(`"${query}"`)}.</p>`]
        : ['<ol>', ...results.flatMap(resultItem), '</ol>'],
  });
