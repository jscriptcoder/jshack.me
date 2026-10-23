/**
 * rideit.io's pages: coach and rail tickets to every town in the valley.
 *
 * The front page is a file in the box's document root, like every other site's, so a
 * rooted rideit.io can be defaced. The ticket page and the answers to a boarding are
 * written by the service itself, so a defaced front page never stops anybody riding.
 * None of them says where the reader stands: working that out is the reader's own
 * reconnaissance.
 *
 * Plain HTML within what `lynx` renders. It has no drop-down list, so each town is its
 * own small form whose one button boards for it.
 */

import { escapeHtml } from '../findit/page.js';
import { RIDEIT_DOMAIN } from '../generation/fixedSites.js';
import { TOWNS } from '../generation/world.js';
import { RIDE_FARE } from './fare.js';

const DESCRIPTION = 'Coach and rail tickets to every town in Harrow Valley. One fare, any town.';

/** Where the ticket form is, and where it boards. */
export const TICKET_PATH = '/ticket';
export const BOARD_PATH = '/board';

/** A whole rideit.io page around `body`, under the service's own heading. */
const page = (title: string, body: readonly string[], description?: string): string =>
  [
    '<html>',
    '<head>',
    `<title>${title}</title>`,
    ...(description === undefined ? [] : [`<meta name="description" content="${description}">`]),
    '</head>',
    '<body>',
    '<h1>rideit.io</h1>',
    ...body,
    '</body>',
    '</html>',
    '',
  ].join('\n');

export const RIDEIT_FRONT_PAGE = page(
  'rideit.io - coach and rail tickets across the valley',
  [
    '<p>Travel by coach and rail to every town in Harrow Valley.',
    `One fare to anywhere: ${RIDE_FARE} JSC.</p>`,
    '<h2>Where we go</h2>',
    '<ul>',
    ...TOWNS.map((town) => `<li>${escapeHtml(town.name)}</li>`),
    '</ul>',
    `<p><a href="${TICKET_PATH}">Book a ticket</a></p>`,
  ],
  DESCRIPTION,
);

/** The booking form: every town in the world's order, each boarding for itself. */
export const TICKET_PAGE = page('rideit.io - book a ticket', [
  '<h2>Book a ticket</h2>',
  ...TOWNS.map((town) =>
    [
      `<form action="${BOARD_PATH}" method="post">`,
      `<p>${escapeHtml(town.name)}`,
      `<input type="hidden" name="town" value="${escapeHtml(town.name)}">`,
      '<input type="submit" value="Board"></p>',
      '</form>',
    ].join('\n'),
  ),
  '<p>Or from a terminal:</p>',
  '<pre>',
  `$ curl -d "town=${TOWNS[0]!.name}" http://${RIDEIT_DOMAIN}${BOARD_PATH}`,
  '</pre>',
]);

/** The answer to a boarding that took the player to `town`. */
export const arrivedPage = (town: string): string =>
  page('rideit.io - arrived', [
    `<p>You have arrived in ${escapeHtml(town)}.</p>`,
    '<p>Thank you for travelling with rideit.io.</p>',
  ]);

/** The answer to a boarding for anywhere the world does not declare. */
export const NOWHERE_PAGE = page('rideit.io - no such town', [
  '<p>We do not go there.</p>',
  `<p><a href="${TICKET_PATH}">Book a ticket</a></p>`,
]);

/** The answer to a boarding that another boarding of the same player's beat to the
 *  ticket: that one moved them, and this one only left. */
export const USED_TICKET_PAGE = page('rideit.io - ticket used', [
  '<p>This ticket has already been used.</p>',
]);
