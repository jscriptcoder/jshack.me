/**
 * hireme.io's pages: where contract work is applied for.
 *
 * The front page is a file in the box's document root, like every other site's, so a
 * rooted hireme.io can be defaced. It is served at `/apply` too, so a browser going back
 * to a page it reached by applying asks for the form and gets it, rather than sending the
 * form again. Applying is not a page: a POST to `/apply` is answered by the server, so a
 * defaced front page leaves applying working, and a dark box takes both down.
 *
 * No page holds a board's address. Anyone may apply for any handle, so the address goes
 * only into the handle's inbox. The board itself is built here too, though it is served by
 * the boards' server, not by hireme.io's.
 *
 * Plain HTML within what `lynx` renders, a command in a `<pre>` behind its `$ ` prompt.
 */

import { escapeHtml } from '../findit/page.js';

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

/** Why an application was refused, and the line of the form it is said under: the field
 *  when what was typed is wrong, or the button when only time will help. */
export type Refusal = {
  readonly message: string;
  readonly under: 'email' | 'submit';
};

/**
 * The front page, with the application form. After a refused application it says why as
 * an alert under the line it is about, and the form keeps the address as it was typed.
 */
export const hiremeFrontPage = ({
  refusal,
  email = '',
}: { readonly refusal?: Refusal; readonly email?: string } = {}): string => {
  const saidUnder = (line: Refusal['under']): readonly string[] =>
    refusal?.under === line ? [`<p role="alert">${escapeHtml(refusal.message)}</p>`] : [];
  return page(
    'hireme.io - contract work',
    [
      '<h1>hireme.io</h1>',
      '<p>Freelance contracts for independent IT and security people. Apply with your',
      'emailit.io address and we will send you your contractor board.</p>',
      '<form action="/apply" method="post">',
      `<p>Email <input name="email" value="${escapeHtml(email)}"></p>`,
      ...saidUnder('email'),
      '<p><input type="submit" value="Apply"></p>',
      ...saidUnder('submit'),
      '</form>',
      '<p>Or from a terminal:</p>',
      '<pre>',
      '$ curl -d "email=neo@emailit.io" http://hireme.io/apply',
      '</pre>',
    ],
    'Freelance contract work for independent IT and security people. Apply with your emailit.io address.',
  );
};

export const HIREME_FRONT_PAGE = hiremeFrontPage();

/** What an application that was mailed answers with. */
export const thanksPage = (handle: string, address: string): string =>
  page('Thanks for applying', [
    '<h1>Thanks for applying</h1>',
    `<p>Thanks, ${escapeHtml(handle)}. We have sent your contractor board to ${escapeHtml(address)}.</p>`,
  ]);

/** A handle's contractor board, answered by the server at the board's address. It says
 *  whose it is, since whoever holds the address reads it. */
export const boardPage = (handle: string): string =>
  page('hireme.io - contractor board', [
    `<h1>Welcome back, ${escapeHtml(handle)}.</h1>`,
    '<p>Contractor board — no contracts available yet. New work is coming soon.</p>',
  ]);
