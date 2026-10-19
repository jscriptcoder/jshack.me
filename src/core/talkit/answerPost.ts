/**
 * Starting a thread at talkit.io: what a form POSTed to `/post` becomes.
 *
 * The form asks for no login. The poster's own, the one their `~/.mailrc` keeps for
 * emailit.io, travels beside it, and the store checks its password as emailit.io checks
 * one, so a stolen login posts as its owner and a stale one fails. No login at all is
 * refused before anything else is looked at, with no word about where one comes from.
 *
 * What was typed is checked here before the store is asked, so a post that is refused
 * spends neither a password check nor a place under the hourly cap. Line endings are made
 * one kind first, then any other control character refuses the post: the forum is plain
 * text, and a character a terminal would act on has no place in it. Then the title must
 * be one line, both are trimmed, and their lengths are counted as a reader counts them.
 * What passes is handed on exactly as typed, never escaped: every page escapes it, the
 * same way, every time it is shown.
 *
 * The store is handed the md5 of the password, never the password, as emailit.io's is.
 */

import { z } from 'zod';
import { md5 } from '../generation/md5.js';
import { EMAILIT_DOMAIN } from '../generation/fixedSites.js';
import type { MailLogin } from '../commands/types.js';
import { notPostedPage, postedPage } from './pages.js';

const TITLE_LIMIT = 80;
const BODY_LIMIT = 4000;

/** The first character a terminal prints rather than acts on, and DEL, the one after the
 *  printable run that it acts on too. */
const FIRST_PRINTABLE = 0x20;
const DEL = 0x7f;

/** Whether `text` holds a C0 control or DEL: a character a terminal acts on rather than
 *  prints. A line break is one too, so a body's line breaks are taken out before asking. */
const holdsControl = (text: string): boolean =>
  [...text].some((character) => {
    const code = character.codePointAt(0) ?? FIRST_PRINTABLE;
    return code < FIRST_PRINTABLE || code === DEL;
  });

/** The thread the store is asked to post. */
export type NewThread = {
  readonly handle: string;
  readonly passwordMd5: string;
  /** The player who posted, counted against the hourly cap. Never part of the thread: a
   *  post belongs to whoever holds the handle's password. */
  readonly playerKey: string;
  readonly title: string;
  readonly body: string;
};

/** Post a thread, or say why not: the store's reply as it came off the wire, read here. */
export type PostThread = (
  thread: NewThread,
) => Promise<{ readonly data: unknown; readonly error: unknown }>;

/** The store's word for what it did. `posted` names the new thread. */
const postOutcomeSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('posted'), id: z.number().int().positive() }),
  z.object({ outcome: z.literal('login_failed') }),
  z.object({ outcome: z.literal('throttled') }),
  z.object({ outcome: z.literal('capped') }),
]);

/** The page a post answers with, and the thread it posted, for the log; null when
 *  nothing was posted. */
export type PostAnswer = {
  readonly page: string;
  readonly posted: { readonly id: number; readonly handle: string } | null;
};

const refused = (reason: string): PostAnswer => ({ page: notPostedPage(reason), posted: null });

const charactersIn = (text: string): number => [...text].length;

/** What is wrong with a title and a body as typed, or the two as they are to be kept. */
const checked = (
  typedTitle: string,
  typedBody: string,
): { readonly refusal: string } | { readonly title: string; readonly body: string } => {
  const title = typedTitle.replace(/\r\n?/g, '\n');
  const body = typedBody.replace(/\r\n?/g, '\n');
  if (holdsControl(title.replace(/\n/g, '')) || holdsControl(body.replace(/\n/g, ''))) {
    return { refusal: 'A post cannot hold control characters.' };
  }
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  if (title.includes('\n') || trimmedTitle === '' || charactersIn(trimmedTitle) > TITLE_LIMIT) {
    return { refusal: 'A title is 1 to 80 characters on one line.' };
  }
  if (trimmedBody === '' || charactersIn(trimmedBody) > BODY_LIMIT) {
    return { refusal: 'A post is 1 to 4,000 characters.' };
  }
  return { title: trimmedTitle, body: trimmedBody };
};

/** The page a post answers with, or null when the store could not be asked. */
export const answerPost = async ({
  form,
  login,
  playerKey,
  postThread,
}: {
  /** The request body exactly as sent. */
  readonly form: string;
  /** The login the poster keeps for emailit.io, or null when they keep none. */
  readonly login: MailLogin | null;
  readonly playerKey: string;
  readonly postThread: PostThread;
}): Promise<PostAnswer | null> => {
  if (login === null) return refused('Not logged in to emailit.io.');

  const fields = new URLSearchParams(form);
  const thread = checked(fields.get('title') ?? '', fields.get('body') ?? '');
  if ('refusal' in thread) return refused(thread.refusal);

  const reply = await postThread({
    handle: login.handle,
    passwordMd5: md5(login.password),
    playerKey,
    title: thread.title,
    body: thread.body,
  });
  // A store that failed, or answered with a word nobody taught it, has not said what
  // happened: a page claiming either way would be a guess.
  const read = postOutcomeSchema.safeParse(reply.data);
  if (reply.error || !read.success) return null;
  const outcome = read.data;
  if (outcome.outcome === 'posted') {
    return {
      page: postedPage({ handle: login.handle, id: outcome.id }),
      posted: { id: outcome.id, handle: login.handle },
    };
  }
  if (outcome.outcome === 'login_failed') {
    return refused(`Login failed for ${login.handle}@${EMAILIT_DOMAIN}.`);
  }
  if (outcome.outcome === 'throttled') return refused('Too many failed logins. Wait a minute.');
  return refused('You have posted 20 times in the last hour. Wait a while.');
};
