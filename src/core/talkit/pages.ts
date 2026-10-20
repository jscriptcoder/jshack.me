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

/** A comment as its thread's page shows it, numbered within the thread. */
export type WrittenComment = {
  readonly number: number;
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
};

/** A comment the operator removed: its number stays taken, so "see #4" still means #4,
 *  and nothing else of it is kept. */
export type RemovedComment = { readonly number: number; readonly removed: true };

export type ThreadComment = WrittenComment | RemovedComment;

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
    // No handle and no password: the login the reader keeps for emailit.io goes with
    // the form, and the form is the same file for everybody.
    '<h2>Start a thread</h2>',
    '<form action="/post" method="post">',
    '<p>Title<br><input type="text" name="title"></p>',
    '<p>Post<br><textarea name="body" rows="4"></textarea></p>',
    '<p><input type="submit" value="Post"></p>',
    '</form>',
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

const commentLines = (comment: ThreadComment): readonly string[] =>
  'removed' in comment
    ? [`<p>#${comment.number} [removed]</p>`]
    : [
        `<p>#${comment.number} by ${escapeHtml(comment.author)}, ${ledgerTime(comment.createdAt)}</p>`,
        `<p>${playerText(comment.body)}</p>`,
      ];

/** A thread, its comments in the order given, and the form to add one. */
export const threadPage = (thread: Thread, comments: readonly ThreadComment[]): string =>
  talkitDocument({
    title: `${thread.title} - talkit.io`,
    body: [
      `<h2>${escapeHtml(thread.title)}</h2>`,
      `<p>by ${escapeHtml(thread.author)}, ${ledgerTime(thread.createdAt)}</p>`,
      `<p>${playerText(thread.body)}</p>`,
      ...(comments.length === 0 ? ['<p>No comments yet.</p>'] : comments.flatMap(commentLines)),
      // The thread's id is the server's own number, so the form holds nothing a player
      // wrote, and the commenter's login goes beside it as it does with a post.
      '<h2>Comment</h2>',
      '<form action="/comment" method="post">',
      `<input type="hidden" name="id" value="${thread.id}">`,
      '<p><textarea name="body" rows="4"></textarea></p>',
      '<p><input type="submit" value="Comment"></p>',
      '</form>',
    ],
  });

const BACK_TO_FRONT = '<p><a href="/">Back to talkit.io</a></p>';

/** What a post answers with once the thread is up: who it went up as, and the way to it. */
export const postedPage = ({ handle, id }: { readonly handle: string; readonly id: number }) =>
  talkitDocument({
    title: 'Posted - talkit.io',
    body: [
      `<p>Posted as ${escapeHtml(handle)}.</p>`,
      `<p><a href="/thread?id=${id}">Read your thread</a></p>`,
      BACK_TO_FRONT,
    ],
  });

/** What a comment answers with once it is up: who it went up as, and the way back to the
 *  thread it is under. */
export const commentedPage = ({
  handle,
  threadId,
}: {
  readonly handle: string;
  readonly threadId: number;
}) =>
  talkitDocument({
    title: 'Commented - talkit.io',
    body: [
      `<p>Commented as ${escapeHtml(handle)}.</p>`,
      `<p><a href="/thread?id=${threadId}">Back to the thread</a></p>`,
      BACK_TO_FRONT,
    ],
  });

/** What a refused post or comment answers with: why, in a sentence that may name the handle the
 *  login gave, which is escaped as everything a player sent is. */
export const notPostedPage = (reason: string): string =>
  talkitDocument({
    title: 'Not posted - talkit.io',
    body: [`<p>${escapeHtml(reason)}</p>`, BACK_TO_FRONT],
  });

export const NO_SUCH_PAGE = talkitDocument({
  title: 'No such page - talkit.io',
  body: ['<p>No such page.</p>'],
});
