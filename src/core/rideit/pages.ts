/**
 * rideit.io's pages: coach and rail tickets to every town in the valley.
 *
 * The front page is a file in the box's document root, like every other site's, so a
 * rooted rideit.io can be defaced. It is the same file for everybody, so it never says
 * where the reader stands: working that out is the reader's own reconnaissance.
 *
 * Plain HTML within what `lynx` renders.
 */

import { escapeHtml } from '../findit/page.js';
import { TOWNS } from '../generation/world.js';
import { RIDE_FARE } from './fare.js';

const DESCRIPTION = 'Coach and rail tickets to every town in Harrow Valley. One fare, any town.';

export const RIDEIT_FRONT_PAGE = [
  '<html>',
  '<head>',
  '<title>rideit.io - coach and rail tickets across the valley</title>',
  `<meta name="description" content="${DESCRIPTION}">`,
  '</head>',
  '<body>',
  '<h1>rideit.io</h1>',
  '<p>Travel by coach and rail to every town in Harrow Valley.',
  `One fare to anywhere: ${RIDE_FARE} JSC.</p>`,
  '<h2>Where we go</h2>',
  '<ul>',
  ...TOWNS.map((town) => `<li>${escapeHtml(town.name)}</li>`),
  '</ul>',
  '<p>Booking opens soon.</p>',
  '</body>',
  '</html>',
  '',
].join('\n');
