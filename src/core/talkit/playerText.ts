/**
 * The one way text a player wrote reaches a talkit.io page.
 *
 * Every talkit form will carry the poster's emailit login, so a post that became markup
 * could plant a form that posts as whoever reads it. Each piece is escaped, and the only
 * elements a player gets are a line break and a link to a plain `http://` address.
 */

import { escapeHtml } from '../findit/page.js';

/** An address is matched on the raw text, never the escaped one, so an entity such as
 *  `&quot;` cannot end up inside a link. It stops at whitespace, a quote or an angle
 *  bracket, and never ends on the punctuation a sentence puts after it. It captures, so
 *  splitting on it leaves every address at an odd place among the pieces. */
const ADDRESS = /(http:\/\/[^\s<>"']*[^\s<>"'.,;:!?)])/;

const link = (address: string): string => {
  const escaped = escapeHtml(address);
  return `<a href="${escaped}">${escaped}</a>`;
};

const escapeLines = (text: string): string => escapeHtml(text).replace(/\n/g, '<br>');

export const playerText = (text: string): string =>
  text
    .split(ADDRESS)
    .map((piece, place) => (place % 2 === 1 ? link(piece) : escapeLines(piece)))
    .join('');
