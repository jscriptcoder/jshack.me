/**
 * Commenting on a thread at talkit.io: what a form POSTed to `/comment` becomes.
 *
 * The form names the thread by its id and holds the comment; the commenter's login, the
 * one their `~/.mailrc` keeps for emailit.io, travels beside it, as it does with a post.
 * No login at all is refused before anything else is looked at, then an id that cannot
 * name a thread, then the comment as a post's body is checked (`writing.ts`). A comment
 * refused here spends neither a password check nor a place under the hourly cap.
 *
 * The store numbers the comment within its thread and moves the thread to the top of the
 * list; a thread that is not there is its refusal, as nothing here can know that. What
 * passes is handed on exactly as typed, never escaped: the thread's page escapes it.
 */

import { z } from 'zod';
import { md5 } from '../generation/md5.js';
import type { MailLogin } from '../commands/types.js';
import { THREAD_ID } from './answerViews.js';
import { commentedPage, notPostedPage } from './pages.js';
import {
  BODY_LIMIT,
  NOT_LOGGED_IN,
  STORE_REFUSALS,
  charactersIn,
  holdsControl,
  storeRefusal,
  withLineBreaks,
} from './writing.js';

/** The comment the store is asked to post. */
export type NewComment = {
  readonly handle: string;
  readonly passwordMd5: string;
  /** The player who commented, counted against the hourly cap. Never part of the
   *  comment: a comment belongs to whoever holds the handle's password. */
  readonly playerKey: string;
  readonly threadId: number;
  readonly body: string;
};

/** Post a comment, or say why not: the store's reply as it came off the wire, read here. */
export type PostComment = (
  newComment: NewComment,
) => Promise<{ readonly data: unknown; readonly error: unknown }>;

/** The store's word for what it did. `commented` gives the comment's number. */
const commentOutcomeSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('commented'), number: z.number().int().positive() }),
  z.object({ outcome: z.literal('no_thread') }),
  ...STORE_REFUSALS,
]);

/** The page a comment answers with, and the comment it posted, for the log; null when
 *  nothing was posted. */
export type CommentAnswer = {
  readonly page: string;
  readonly commented: {
    readonly threadId: number;
    readonly number: number;
    readonly handle: string;
  } | null;
};

const NO_SUCH_THREAD = 'No such thread.';

const refused = (reason: string): CommentAnswer => ({
  page: notPostedPage(reason),
  commented: null,
});

/** The page a comment answers with, or null when the store could not be asked. */
export const answerComment = async ({
  form,
  login,
  playerKey,
  postComment,
}: {
  /** The request body exactly as sent. */
  readonly form: string;
  /** The login the commenter keeps for emailit.io, or null when they keep none. */
  readonly login: MailLogin | null;
  readonly playerKey: string;
  readonly postComment: PostComment;
}): Promise<CommentAnswer | null> => {
  if (login === null) return refused(NOT_LOGGED_IN);

  const fields = new URLSearchParams(form);
  const typedId = fields.get('id') ?? '';
  if (!THREAD_ID.test(typedId)) return refused(NO_SUCH_THREAD);
  const threadId = Number(typedId);

  const body = withLineBreaks(fields.get('body') ?? '');
  if (holdsControl(body)) return refused('A comment cannot hold control characters.');
  const trimmed = body.trim();
  if (trimmed === '' || charactersIn(trimmed) > BODY_LIMIT) {
    return refused('A comment is 1 to 4,000 characters.');
  }

  const reply = await postComment({
    handle: login.handle,
    passwordMd5: md5(login.password),
    playerKey,
    threadId,
    body: trimmed,
  });
  // A store that failed, or answered with a word nobody taught it, has not said what
  // happened: a page claiming either way would be a guess.
  const read = commentOutcomeSchema.safeParse(reply.data);
  if (reply.error || !read.success) return null;
  const outcome = read.data;
  if (outcome.outcome === 'commented') {
    return {
      page: commentedPage({ handle: login.handle, threadId }),
      commented: { threadId, number: outcome.number, handle: login.handle },
    };
  }
  if (outcome.outcome === 'no_thread') return refused(NO_SUCH_THREAD);
  return refused(storeRefusal(outcome.outcome, login.handle));
};
