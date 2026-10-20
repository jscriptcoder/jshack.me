/**
 * emailit.io's pages: where an email address comes from.
 *
 * The front page is a file in the box's document root, like every other site's, so a
 * rooted emailit.io can be defaced. It is served at `/signup` too, so a browser going
 * back to a page it reached by signing up asks for the form and gets it, rather than
 * sending the form again. Signing up is not a page: a POST to `/signup` is answered by
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

/** Why a sign-up was refused, and the line of the form it is said under: the field the
 *  reader has to change, or the button when there is nothing to change but the day. */
export type Refusal = {
  readonly message: string;
  readonly under: 'handle' | 'password' | 'submit';
};

/**
 * The front page, with the sign-up form. After a refused sign-up it says why as an alert
 * under the line it is about, and the form keeps the handle as it was typed; the password
 * field is always empty, so a password never comes back in a page.
 */
export const emailitFrontPage = ({
  refusal,
  handle = '',
}: { readonly refusal?: Refusal; readonly handle?: string } = {}): string => {
  const saidUnder = (line: Refusal['under']): readonly string[] =>
    refusal?.under === line ? [`<p role="alert">${escapeHtml(refusal.message)}</p>`] : [];
  return page(
    'emailit.io',
    [
      '<h1>emailit.io</h1>',
      '<p>Free email for everybody on the net. Pick a handle and a password, and',
      'handle@emailit.io is yours.</p>',
      '<h2>Sign up</h2>',
      '<form action="/signup" method="post">',
      `<p>Handle <input name="handle" value="${escapeHtml(handle)}"></p>`,
      ...saidUnder('handle'),
      '<p>Password <input type="password" name="password"></p>',
      ...saidUnder('password'),
      '<p><input type="submit" value="Sign up"></p>',
      ...saidUnder('submit'),
      '</form>',
      '<p>A handle starts with a letter, then letters, numbers, hyphens or underscores, up to',
      '24 characters. A password needs at least 4 characters. First come, first served.</p>',
      `<p>${REAL_PASSWORD_WARNING}</p>`,
      '<p>Or from a terminal:</p>',
      '<pre>',
      '$ curl -d "handle=&lt;handle&gt;&amp;password=&lt;password&gt;" http://emailit.io/signup',
      '</pre>',
      '<h2>Reading your mail</h2>',
      ...GETTING_MAIL,
    ],
    'emailit.io: free email for everybody on the net. Sign up for an address, and read your mail with mail.',
  );
};

export const EMAILIT_FRONT_PAGE = emailitFrontPage();

/** What a sign-up that worked answers with. */
export const welcomePage = (address: string): string =>
  page(`Welcome, ${escapeHtml(address)}`, [
    `<h1>Welcome, ${escapeHtml(address)}</h1>`,
    '<p>Your mailbox is ready, and a welcome message is waiting in it.</p>',
    ...GETTING_MAIL,
    '<p><a href="/">Back to emailit.io</a></p>',
  ]);
