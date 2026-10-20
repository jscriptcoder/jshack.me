/**
 * What the operator's removal script reads from its words, and what it prints.
 *
 * Nothing checks the order again before a thread or a comment is gone for good, so a near
 * miss is refused, never repaired, and the kind is named so that a forgotten number never
 * removes a whole thread. The lines name the database, the one guard against removing from
 * the wrong one, and quote what a player wrote so that none of it acts on the operator's
 * terminal.
 */

import { THREAD_ID } from './answerViews.js';

/** A comment's number: no sign, no leading zero, and short enough for the count it is
 *  taken from, a Postgres `INTEGER`. */
const COMMENT_NUMBER = /^[1-9][0-9]{0,8}$/;

export type ThreadRemoval = { readonly kind: 'thread'; readonly threadId: number };
export type CommentRemoval = {
  readonly kind: 'comment';
  readonly threadId: number;
  readonly number: number;
};
export type RemovalOrder = ThreadRemoval | CommentRemoval;

/** What the operator typed after the script's name, or `null` when it is not exactly
 *  `thread <id>` or `comment <id> <number>`. */
export const readRemovalOrder = (words: readonly string[]): RemovalOrder | null => {
  const [kind, idText = '', numberText = ''] = words;
  if (!THREAD_ID.test(idText)) return null;
  const threadId = Number(idText);
  if (kind === 'thread' && words.length === 2) return { kind, threadId };
  if (kind === 'comment' && words.length === 3 && COMMENT_NUMBER.test(numberText)) {
    return { kind, threadId, number: Number(numberText) };
  }
  return null;
};

const BACKSLASH = '\\';

/** A control or a format character: one a terminal acts on, or one that reorders or hides
 *  the text around it. */
const UNPRINTABLE = /[\p{Cc}\p{Cf}]/u;

const spelled = (character: string): string => {
  const code = character.codePointAt(0) ?? 0;
  const hex = code.toString(16);
  return code > 0xffff ? `${BACKSLASH}u{${hex}}` : `${BACKSLASH}u${hex.padStart(4, '0')}`;
};

/** `text` in double quotes, its quotes and backslashes escaped and every unprintable
 *  character spelled out by its code. */
const quoted = (text: string): string =>
  `"${[...text]
    .map((character) => {
      if (character === '"' || character === BACKSLASH) return `${BACKSLASH}${character}`;
      return UNPRINTABLE.test(character) ? spelled(character) : character;
    })
    .join('')}"`;

const comments = (count: number): string => `${count} ${count === 1 ? 'comment' : 'comments'}`;

const commentName = (order: CommentRemoval): string =>
  `comment #${order.number} on #${order.threadId}`;

export const removingThreadLine = (
  order: ThreadRemoval,
  thread: { readonly title: string; readonly author: string; readonly commentCount: number },
  host: string,
): string =>
  `Removing thread #${order.threadId} ${quoted(thread.title)} by ${quoted(thread.author)}, ` +
  `${comments(thread.commentCount)}, on ${host}`;

export const removingCommentLine = (
  order: CommentRemoval,
  comment: { readonly author: string },
  host: string,
): string => `Removing ${commentName(order)} by ${quoted(comment.author)} on ${host}`;

export const noThreadLine = (order: ThreadRemoval, host: string): string =>
  `No thread #${order.threadId} on ${host}`;

export const noCommentLine = (order: CommentRemoval, host: string): string =>
  `No ${commentName(order)} on ${host}`;

export const alreadyRemovedLine = (order: CommentRemoval, host: string): string =>
  `Comment #${order.number} on #${order.threadId} is already removed on ${host}`;

export const removedLine = (order: RemovalOrder): string =>
  order.kind === 'thread' ? `Removed thread #${order.threadId}` : `Removed ${commentName(order)}`;
