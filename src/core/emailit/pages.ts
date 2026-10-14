/**
 * emailit.io's pages: where an email address comes from.
 *
 * The front page is a file in the box's document root, like every other site's, so a
 * rooted emailit.io can be defaced. Signing up is not a page: `/signup` is answered by
 * the server, so a defaced front page leaves sign-up working, and a dark box takes both
 * down.
 *
 * Plain HTML within what `lynx` renders. A command sits in a `<pre>` behind the prompt it
 * needs, `$ ` as the player and `# ` as root, as hackademy.io writes them.
 */

import { escapeHtml } from '../findit/page.js';
import { REAL_PASSWORD_WARNING } from '../gameConfig/gameConfig.js';

const page = (title: string, body: readonly string[], description?: string): string =>
  [
    '<html>',
    description === undefined
      ? `<head><title>${title}</title></head>`
      : `<head><title>${title}</title><meta name="description" content="${description}"></head>`,
    '<body>',
    ...body,
    '</body>',
    '</html>',
    '',
  ].join('\n');

const GETTING_MAIL = [
  '<p>Your mail is read with <code>mail</code>, which comes with mailutils:</p>',
  '<pre>',
  '# apt install mailutils',
  '</pre>',
];

/** The front page, with why a sign-up was refused above everything else when it was. */
export const emailitFrontPage = (refusal?: string): string =>
  page(
    'emailit.io',
    [
      '<h1>emailit.io</h1>',
      ...(refusal === undefined ? [] : [`<p><strong>${escapeHtml(refusal)}</strong></p>`]),
      '<p>Free email for everybody on the net. Pick a handle and a password, and',
      'handle@emailit.io is yours.</p>',
      '<h2>Sign up</h2>',
      '<p>Send us the handle you want and a password:</p>',
      '<pre>',
      '$ curl -d "handle=&lt;handle&gt;&amp;password=&lt;password&gt;" http://emailit.io/signup',
      '</pre>',
      '<p>A handle starts with a letter, then letters, numbers, hyphens or underscores, up to',
      '24 characters. A password needs at least 4 characters. First come, first served.</p>',
      `<p>${REAL_PASSWORD_WARNING}</p>`,
      '<h2>Reading your mail</h2>',
      ...GETTING_MAIL,
    ],
    'emailit.io: free email for everybody on the net. Sign up for an address, and read your mail with mail.',
  );

export const EMAILIT_FRONT_PAGE = emailitFrontPage();

/** What a sign-up that worked answers with. */
export const welcomePage = (address: string): string =>
  page(`Welcome, ${escapeHtml(address)}`, [
    `<h1>Welcome, ${escapeHtml(address)}</h1>`,
    '<p>Your mailbox is ready, and a welcome message is waiting in it.</p>',
    ...GETTING_MAIL,
    '<p><a href="/">Back to emailit.io</a></p>',
  ]);
