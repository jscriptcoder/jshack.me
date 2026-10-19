/**
 * talkit.io's views of the forum: the thread list at `/threads` and one thread with its
 * comments at `/thread?id=<n>`, read off the forum's tables for each visit.
 *
 * The rows come off the wire, written by players, so each is parsed before it is shown;
 * the pages escape what the rows say.
 */

import { z } from 'zod';
import { exactCount } from '../wallet/exactCount.js';
import { NO_SUCH_PAGE, threadPage, threadsPage } from './pages.js';

/** How many threads a page of the list shows. */
const PAGE_LENGTH = 20;

/** A page number a reader may ask for: no sign, no leading zero, six digits at most. */
const PAGE_NUMBER = /^[1-9][0-9]{0,5}$/;

/** A thread id: no sign, no leading zero, and short enough to stay exact as a number. */
export const THREAD_ID = /^[1-9][0-9]{0,14}$/;

/** A read off the forum's table. Typed as unknown because the rows come off the wire,
 *  and are parsed before they are used. */
type ForumRead<Asked extends readonly unknown[]> = (
  ...asked: Asked
) => Promise<{ readonly data: unknown; readonly error: unknown }>;

/** The reads of the forum. */
export type ForumReads = {
  /** `limit` threads from `offset`, the most recently active first, equal times by id
   *  descending. */
  readonly findThreads: ForumRead<[offset: number, limit: number]>;
  /** The thread with this id, or no row when nobody started one. */
  readonly findThread: ForumRead<[id: number]>;
  /** Every comment on the thread with this id, by number. */
  readonly findComments: ForumRead<[threadId: number]>;
};

/** What a view answers: a page, or the plain 404 of a thread that is not there. Null
 *  when the forum could not be read, or handed back a row that is not a thread. */
export type ViewAnswer =
  | { readonly status: 200; readonly page: string }
  | { readonly status: 404 }
  | null;

const threadId = z.number().int().positive();

/** A time must carry its offset: one that does not could be anybody's clock. */
const instant = z.iso.datetime({ offset: true }).transform((at) => new Date(at).toISOString());

const listingRowSchema = z
  .object({
    id: threadId,
    title: z.string(),
    author: z.string(),
    comment_count: exactCount,
    last_activity_at: instant,
  })
  .transform((row) => ({
    id: row.id,
    title: row.title,
    author: row.author,
    commentCount: row.comment_count,
    lastActivityAt: row.last_activity_at,
  }));

const threadRowSchema = z
  .object({
    id: threadId,
    title: z.string(),
    author: z.string(),
    body: z.string(),
    created_at: instant,
  })
  .transform((row) => ({
    id: row.id,
    title: row.title,
    author: row.author,
    body: row.body,
    createdAt: row.created_at,
  }));

const commentRowSchema = z
  .object({
    number: z.number().int().positive(),
    author: z.string(),
    body: z.string(),
    created_at: instant,
  })
  .transform((row) => ({
    number: row.number,
    author: row.author,
    body: row.body,
    createdAt: row.created_at,
  }));

/** One query field of the request, or null when it is absent. The base only lets `URL`
 *  read a path; nothing of it is used. */
const asked = (requestPath: string, field: string): string | null =>
  new URL(requestPath, 'http://talkit.io').searchParams.get(field);

const page = (content: string): ViewAnswer => ({ status: 200, page: content });

/** One page of the thread list. An absent page is the first; a page that is not a page
 *  number reads nothing. One row more than a page is read, to tell whether an older
 *  page exists. */
export const answerThreads = async (
  requestPath: string,
  forum: ForumReads,
): Promise<ViewAnswer> => {
  const typed = asked(requestPath, 'page') ?? '1';
  if (!PAGE_NUMBER.test(typed)) return page(NO_SUCH_PAGE);
  const number = Number(typed);

  const found = await forum.findThreads((number - 1) * PAGE_LENGTH, PAGE_LENGTH + 1);
  if (found.error) return null;
  const rows = z.array(listingRowSchema).safeParse(found.data);
  if (!rows.success) return null;
  return page(
    threadsPage({
      page: number,
      threads: rows.data.slice(0, PAGE_LENGTH),
      hasOlder: rows.data.length > PAGE_LENGTH,
    }),
  );
};

/** One thread and its comments, or the 404 of an id that names none — an absent page, as
 *  a missing file is. Text that is not an id reads nothing, and a thread that is not there
 *  has no comments to read. */
export const answerThread = async (requestPath: string, forum: ForumReads): Promise<ViewAnswer> => {
  const typed = asked(requestPath, 'id') ?? '';
  if (!THREAD_ID.test(typed)) return { status: 404 };

  const found = await forum.findThread(Number(typed));
  if (found.error) return null;
  if (found.data === null) return { status: 404 };
  const thread = threadRowSchema.safeParse(found.data);
  if (!thread.success) return null;

  const commented = await forum.findComments(thread.data.id);
  if (commented.error) return null;
  const comments = z.array(commentRowSchema).safeParse(commented.data);
  return comments.success ? page(threadPage(thread.data, comments.data)) : null;
};
