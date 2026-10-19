/**
 * talkit.io's pages: the valley's forum, read in a browser.
 *
 * The front page is a file in the box's document root, like every other site's, so a
 * rooted talkit.io can be defaced. The thread list and a thread are never files: the
 * server builds them from the forum's table for each visit, so nobody who roots the box
 * can change what a player wrote.
 *
 * Players write the titles, the handles and the bodies, so every one is escaped. A body
 * goes through `playerText`, which also breaks its lines and links its addresses; a
 * title never links, as it is a link itself on the list and plain text in `<title>`.
 */

import { escapeHtml } from '../findit/page.js';
import { ledgerTime } from '../wallet/historyLine.js';
import { playerText } from './playerText.js';

const FRONT_TITLE = 'talkit.io - the Harrow Valley forum';

const DESCRIPTION =
  'A forum for the whole valley: start a thread, or join one. Sign in with your emailit.io account.';

/** A thread as the list shows it, without its body. */
export type ThreadListing = {
  readonly id: number;
  readonly title: string;
  readonly author: string;
  readonly commentCount: number;
  readonly lastActivityAt: string;
};

/** A thread as its own page shows it. */
export type Thread = {
  readonly id: number;
  readonly title: string;
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
};

/** A talkit page: the forum's name, the way to the list, and whatever the page says
 *  beneath them. */
const talkitDocument = (options: {
  readonly title: string;
  readonly description?: string;
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
    '<h1>talkit.io</h1>',
    '<p><a href="/threads">Threads</a></p>',
    '<hr>',
    ...options.body,
    '</body>',
    '</html>',
    '',
  ].join('\n');

export const TALKIT_FRONT_PAGE = talkitDocument({
  title: FRONT_TITLE,
  description: DESCRIPTION,
  body: [
    '<p>The forum for the whole valley: WiFi, jobs, new routers, and anything else on your mind.</p>',
    '<p><a href="/threads">Read the threads</a></p>',
  ],
});

const comments = (count: number): string => (count === 1 ? '1 comment' : `${count} comments`);

const listLine = (listing: ThreadListing): string =>
  `<p><a href="/thread?id=${listing.id}">${escapeHtml(listing.title)}</a><br>` +
  `by ${escapeHtml(listing.author)}, ${comments(listing.commentCount)}, last ${ledgerTime(listing.lastActivityAt)}</p>`;

const pageLink = (page: number, label: string): string =>
  `<a href="/threads?page=${page}">${label}</a>`;

/** The links to the pages either side, newer first, or nothing on a lone page. */
const pagingLine = (page: number, hasOlder: boolean): readonly string[] => {
  const paging = [
    ...(page > 1 ? [pageLink(page - 1, 'newer')] : []),
    ...(hasOlder ? [pageLink(page + 1, 'older')] : []),
  ];
  return paging.length === 0 ? [] : [`<p>${paging.join(' | ')}</p>`];
};

/** One page of the list, the most recently active thread first. */
export const threadsPage = (options: {
  readonly page: number;
  readonly threads: readonly ThreadListing[];
  readonly hasOlder: boolean;
}): string =>
  talkitDocument({
    title: 'Threads - talkit.io',
    body:
      options.threads.length === 0
        ? ['<p>No threads here.</p>']
        : [...options.threads.map(listLine), ...pagingLine(options.page, options.hasOlder)],
  });

export const threadPage = (thread: Thread): string =>
  talkitDocument({
    title: `${thread.title} - talkit.io`,
    body: [
      `<h2>${escapeHtml(thread.title)}</h2>`,
      `<p>by ${escapeHtml(thread.author)}, ${ledgerTime(thread.createdAt)}</p>`,
      `<p>${playerText(thread.body)}</p>`,
      '<p>No comments yet.</p>',
    ],
  });

export const NO_SUCH_PAGE = talkitDocument({
  title: 'No such page - talkit.io',
  body: ['<p>No such page.</p>'],
});

export const NO_SUCH_THREAD = talkitDocument({
  title: 'No such thread - talkit.io',
  body: ['<p>No such thread.</p>'],
});
