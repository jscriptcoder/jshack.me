/**
 * valleynews.io's views of the paper: a section's stories at `/valley`, `/dev` and `/wire`,
 * and one story at `/story?id=<n>`, read off the stories table for each visit.
 *
 * The rows come off the wire, so each is parsed before it is shown; the pages escape what
 * the rows say.
 */

import { z } from 'zod';
import type { ViewAnswer } from '../talkit/answerViews.js';
import { sectionPage, storyPage } from './pages.js';
import { NEWS_SECTIONS, type NewsSection } from './storyFile.js';

/** A story id: no sign, no leading zero, and short enough to stay exact as a number. */
const STORY_ID = /^[1-9][0-9]{0,14}$/;

/** A read off the stories table. Typed as unknown because the rows come off the wire, and
 *  are parsed before they are used. */
type NewsRead<Asked extends readonly unknown[]> = (
  ...asked: Asked
) => Promise<{ readonly data: unknown; readonly error: unknown }>;

/** The reads of the paper. */
export type NewsReads = {
  /** Every story in the section, the newest first, equal times by id descending. */
  readonly findStories: NewsRead<[section: NewsSection]>;
  /** The story with this id, or no row when there is none. */
  readonly findStory: NewsRead<[id: number]>;
};

/** A time must carry its offset: one that does not could be anybody's clock. It is shown
 *  in UTC. */
const instant = z.iso.datetime({ offset: true }).transform((at) => new Date(at).toISOString());

const listingRowSchema = z
  .object({
    id: z.number().int().positive(),
    title: z.string(),
    byline: z.string(),
    posted_at: instant,
  })
  .transform(({ posted_at, ...row }) => ({ ...row, postedAt: posted_at }));

const storyRowSchema = z
  .object({
    id: z.number().int().positive(),
    section: z.enum(NEWS_SECTIONS),
    title: z.string(),
    byline: z.string(),
    body: z.string(),
    posted_at: instant,
  })
  .transform(({ posted_at, ...row }) => ({ ...row, postedAt: posted_at }));

const page = (content: string): ViewAnswer => ({ status: 200, page: content });

/** A section's page, every story it holds listed. */
export const answerSection = async (section: NewsSection, news: NewsReads): Promise<ViewAnswer> => {
  const found = await news.findStories(section);
  if (found.error) return null;
  const rows = z.array(listingRowSchema).safeParse(found.data);
  return rows.success ? page(sectionPage(section, rows.data)) : null;
};

/** One story, or the 404 of an id that names none — an absent page, as a missing file is.
 *  Text that is not an id reads nothing. */
export const answerStory = async (requestPath: string, news: NewsReads): Promise<ViewAnswer> => {
  // The base only lets `URL` read a path; nothing of it is used.
  const typed = new URL(requestPath, 'http://valleynews.io').searchParams.get('id') ?? '';
  if (!STORY_ID.test(typed)) return { status: 404 };

  const found = await news.findStory(Number(typed));
  if (found.error) return null;
  if (found.data === null) return { status: 404 };
  const story = storyRowSchema.safeParse(found.data);
  return story.success ? page(storyPage(story.data)) : null;
};
