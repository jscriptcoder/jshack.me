/**
 * valleynews.io's pages: the Harrow Valley paper, read in a browser.
 *
 * The masthead is a file in the box's document root, like every other site's front page,
 * so a rooted valleynews.io can be defaced. A section and a story are never files: the
 * server builds them from the stories table for each visit, so nobody who roots the box
 * can change what the paper printed.
 *
 * The paper speaks in three voices, the valley's, the developer's and the real world's, and
 * every section and story page says which one it is in, so a reader who lands on a story
 * from a link still knows. A story's text is escaped and links nothing: a real source is
 * text to copy into a real browser, never somewhere to go from inside the world.
 */

import { escapeHtml } from '../findit/page.js';
import type { NewsSection } from './storyFile.js';

/** A section's name over its page, and the voice it is in. */
const SECTIONS: Readonly<
  Record<NewsSection, { readonly heading: string; readonly label: string }>
> = {
  valley: { heading: 'The valley', label: 'News from Harrow Valley' },
  dev: { heading: 'The dev log', label: 'From the people who build jshack.me' },
  wire: { heading: 'The wire', label: 'Security news from the real world' },
};

/** A story as its section lists it, without its body. */
export type StoryListing = {
  readonly id: number;
  readonly title: string;
  readonly byline: string;
  readonly postedAt: string;
};

/** A story as its own page shows it. */
export type PostedStory = StoryListing & {
  readonly section: NewsSection;
  readonly body: string;
};

/** A valleynews page: the paper's name, the way to each section, and whatever the page
 *  says beneath them. */
const paperDocument = (options: {
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
    '<h1>valleynews.io</h1>',
    '<p><a href="/valley">Valley</a> | <a href="/dev">Dev</a> | <a href="/wire">Wire</a></p>',
    '<hr>',
    ...options.body,
    '</body>',
    '</html>',
    '',
  ].join('\n');

export const VALLEYNEWS_FRONT_PAGE = paperDocument({
  title: 'valleynews.io - the Harrow Valley paper',
  description:
    'News from Harrow Valley, from the people who build it, and from the wider world of security.',
  body: [
    '<p>The Harrow Valley paper.</p>',
    ...Object.entries(SECTIONS).map(
      ([section, { heading, label }]) => `<p><a href="/${section}">${heading}</a><br>${label}</p>`,
    ),
  ],
});

/** The day a story was posted, as a paper prints it. */
const day = (postedAt: string): string => postedAt.slice(0, 10);

const listLine = (story: StoryListing): string =>
  `<p><a href="/story?id=${story.id}">${escapeHtml(story.title)}</a><br>` +
  `by ${escapeHtml(story.byline)}, ${day(story.postedAt)}</p>`;

/** A section's stories, in the order given. */
export const sectionPage = (section: NewsSection, stories: readonly StoryListing[]): string => {
  const { heading, label } = SECTIONS[section];
  return paperDocument({
    title: `${heading} - valleynews.io`,
    body: [
      `<h2>${heading}</h2>`,
      `<p>${label}</p>`,
      ...(stories.length === 0 ? ['<p>No stories yet.</p>'] : stories.map(listLine)),
    ],
  });
};

/** A body's paragraphs, split on its blank lines. A story file may be wrapped at any width,
 *  so a single line break inside a paragraph is only a space. */
const paragraphs = (body: string): readonly string[] =>
  body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim().replace(/\s*\n\s*/g, ' '))
    .filter((paragraph) => paragraph !== '');

/** A story, under its section and the voice it is in. */
export const storyPage = (story: PostedStory): string => {
  const { heading, label } = SECTIONS[story.section];
  return paperDocument({
    title: `${story.title} - valleynews.io`,
    body: [
      `<p><a href="/${story.section}">${heading}</a>: ${label}</p>`,
      `<h2>${escapeHtml(story.title)}</h2>`,
      `<p>by ${escapeHtml(story.byline)}, ${day(story.postedAt)}</p>`,
      ...paragraphs(story.body).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    ],
  });
};
