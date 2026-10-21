import { describe, expect, it } from 'vitest';
import { answerSection, answerStory, type NewsReads } from './answerViews.js';

/**
 * What valleynews.io answers at a section and at a story, read off the stories table for
 * each visit. Every page says which voice it is in, the valley's, the developer's or the
 * real world's, so a reader who lands on a story from a link still knows. Nothing in a
 * story becomes markup or a link: a real source is text to copy, never somewhere to go.
 */

type ListingRow = {
  readonly id: number;
  readonly title: string;
  readonly byline: string;
  readonly posted_at: string;
};

type StoryRow = ListingRow & { readonly section: string; readonly body: string };

const listingRow = (overrides: Partial<ListingRow> = {}): ListingRow => ({
  id: 7,
  title: 'A router flaw nobody patched',
  byline: 'The wire desk',
  posted_at: '2026-10-21T09:15:00+00:00',
  ...overrides,
});

const storyRow = (overrides: Partial<StoryRow> = {}): StoryRow => ({
  ...listingRow(),
  section: 'wire',
  body: 'First paragraph.\n\nSource: The Record - https://therecord.media/a-router-flaw',
  ...overrides,
});

const answered = (data: unknown) => async () => ({ data, error: null });

const newsReads = (overrides: Partial<NewsReads> = {}): NewsReads => ({
  findStories: answered([]),
  findStory: answered(null),
  ...overrides,
});

const parsed = (page: string): Document => new DOMParser().parseFromString(page, 'text/html');

/** The page's own part: everything after the paper's name and the nav line. */
const contentOf = (page: string): readonly Element[] => {
  const body = [...parsed(page).body.children];
  return body.slice(body.findIndex((element) => element.tagName === 'HR') + 1);
};

const contentText = (page: string): readonly string[] =>
  contentOf(page).map((element) => element.textContent ?? '');

const links = (elements: readonly Element[]) =>
  elements.flatMap((element) =>
    [...element.querySelectorAll('a')].map((link) => ({
      text: link.textContent,
      href: link.getAttribute('href'),
    })),
  );

const pageOf = (answer: Awaited<ReturnType<typeof answerStory>>): string => {
  if (answer === null || answer.status !== 200) throw new Error('no page');
  return answer.page;
};

describe('a section', () => {
  it.each([
    ['valley', 'The valley', 'News from Harrow Valley'],
    ['dev', 'The dev log', 'From the people who build jshack.me'],
    ['wire', 'The wire', 'Security news from the real world'],
  ] as const)(
    'heads the %s section with its name and its voice',
    async (section, heading, label) => {
      const page = pageOf(await answerSection(section, newsReads()));
      expect(parsed(page).title).toBe(`${heading} - valleynews.io`);
      expect(contentText(page).slice(0, 2)).toEqual([heading, label]);
    },
  );

  it('reads only its own section', async () => {
    const asked: string[] = [];
    await answerSection(
      'dev',
      newsReads({
        findStories: async (section) => {
          asked.push(section);
          return { data: [], error: null };
        },
      }),
    );
    expect(asked).toEqual(['dev']);
  });

  it('lists each story in the order read, linked to its own page, with its byline and day', async () => {
    const page = pageOf(
      await answerSection(
        'wire',
        newsReads({
          findStories: answered([
            listingRow({
              id: 9,
              title: 'Newer',
              byline: 'Ana',
              posted_at: '2026-10-21T23:59:00+00:00',
            }),
            listingRow({
              id: 4,
              title: 'Older',
              byline: 'Ben',
              posted_at: '2026-10-02T00:00:00+00:00',
            }),
          ]),
        }),
      ),
    );
    expect(contentText(page).slice(2)).toEqual([
      'Newerby Ana, 2026-10-21',
      'Olderby Ben, 2026-10-02',
    ]);
    expect(links(contentOf(page))).toEqual([
      { text: 'Newer', href: '/story?id=9' },
      { text: 'Older', href: '/story?id=4' },
    ]);
  });

  it('dates a story by its day in UTC, whatever offset the read gave', async () => {
    const page = pageOf(
      await answerSection(
        'valley',
        newsReads({
          findStories: answered([listingRow({ posted_at: '2026-10-21T23:30:00-02:00' })]),
        }),
      ),
    );
    expect(contentText(page)[2]).toContain('2026-10-22');
  });

  it('says so when it holds no story', async () => {
    const page = pageOf(await answerSection('valley', newsReads()));
    expect(contentText(page).slice(2)).toEqual(['No stories yet.']);
  });

  it('shows a title and byline holding markup as the text they are', async () => {
    const page = pageOf(
      await answerSection(
        'wire',
        newsReads({
          findStories: answered([listingRow({ title: '<b>Bold</b> & co', byline: '<i>Desk</i>' })]),
        }),
      ),
    );
    expect(contentText(page)[2]).toBe('<b>Bold</b> & coby <i>Desk</i>, 2026-10-21');
    expect(parsed(page).querySelector('b, i')).toBeNull();
  });

  it.each([
    ['a failed read', async () => ({ data: null, error: new Error('down') })],
    ['a row that is not a story', answered([{ id: 'seven', title: 'x' }])],
    ['a time with no offset', answered([listingRow({ posted_at: '2026-10-21T09:15:00' })])],
  ])('answers nothing for %s', async (_case, findStories) => {
    expect(await answerSection('wire', newsReads({ findStories }))).toBeNull();
  });
});

describe('a story', () => {
  it('reads the story the id names', async () => {
    const asked: number[] = [];
    await answerStory(
      '/story?id=12',
      newsReads({
        findStory: async (id) => {
          asked.push(id);
          return { data: null, error: null };
        },
      }),
    );
    expect(asked).toEqual([12]);
  });

  it('shows its section and voice, its title, byline and day, then its paragraphs', async () => {
    const page = pageOf(
      await answerStory('/story?id=7', newsReads({ findStory: answered(storyRow()) })),
    );
    expect(parsed(page).title).toBe('A router flaw nobody patched - valleynews.io');
    expect(contentText(page)).toEqual([
      'The wire: Security news from the real world',
      'A router flaw nobody patched',
      'by The wire desk, 2026-10-21',
      'First paragraph.',
      'Source: The Record - https://therecord.media/a-router-flaw',
    ]);
    expect(links(contentOf(page))).toEqual([{ text: 'The wire', href: '/wire' }]);
  });

  it('reads a body wrapped across lines as one paragraph per blank-line block', async () => {
    const page = pageOf(
      await answerStory(
        '/story?id=7',
        newsReads({
          findStory: answered(
            storyRow({
              body: 'The fog came in\nover Ridgemont\n   at dawn.\n \n\nBy noon it was gone.',
            }),
          ),
        }),
      ),
    );
    expect(contentText(page).slice(3)).toEqual([
      'The fog came in over Ridgemont at dawn.',
      'By noon it was gone.',
    ]);
  });

  it('shows no empty paragraph for blank lines around the body, and no indent', async () => {
    const page = pageOf(
      await answerStory(
        '/story?id=7',
        newsReads({ findStory: answered(storyRow({ body: '\n\n   Indented start.\n\n' })) }),
      ),
    );
    expect(contentText(page).slice(3)).toEqual(['Indented start.']);
  });

  it('shows a body holding markup or an address as the text it is, linking nothing', async () => {
    const body = '<script>alert(1)</script> see http://findit.io and https://example.com';
    const page = pageOf(
      await answerStory('/story?id=7', newsReads({ findStory: answered(storyRow({ body })) })),
    );
    expect(contentText(page).slice(3)).toEqual([body]);
    expect(parsed(page).querySelector('script')).toBeNull();
    expect(links(contentOf(page)).slice(1)).toEqual([]);
  });

  it.each([
    ['valley', 'The valley: News from Harrow Valley', '/valley'],
    ['dev', 'The dev log: From the people who build jshack.me', '/dev'],
  ])('carries the %s section it was posted to', async (section, line, href) => {
    const page = pageOf(
      await answerStory('/story?id=7', newsReads({ findStory: answered(storyRow({ section })) })),
    );
    expect(contentText(page)[0]).toBe(line);
    expect(links(contentOf(page))[0]?.href).toBe(href);
  });

  it.each([
    ['no id', '/story'],
    ['an empty id', '/story?id='],
    ['an id that is not a number', '/story?id=abc'],
    ['an id of 0', '/story?id=0'],
    ['a leading zero', '/story?id=07'],
    ['a sign', '/story?id=+7'],
    ['an id too long to stay exact', '/story?id=1000000000000000'],
  ])('is not there for %s, without asking the table', async (_case, path) => {
    const asked: number[] = [];
    const reads = newsReads({
      findStory: async (id) => {
        asked.push(id);
        return { data: storyRow(), error: null };
      },
    });
    expect(await answerStory(path, reads)).toEqual({ status: 404 });
    expect(asked).toEqual([]);
  });

  it('reads the longest id a story can have', async () => {
    expect(
      await answerStory(
        '/story?id=999999999999999',
        newsReads({ findStory: answered(storyRow()) }),
      ),
    ).toMatchObject({ status: 200 });
  });

  it('is not there when no story has the id', async () => {
    expect(await answerStory('/story?id=12', newsReads())).toEqual({ status: 404 });
  });

  it.each([
    ['a failed read', async () => ({ data: null, error: new Error('down') })],
    ['a row in no section', answered(storyRow({ section: 'sports' }))],
    ['a row with no body', answered({ ...listingRow(), section: 'wire' })],
  ])('answers nothing for %s', async (_case, findStory) => {
    expect(await answerStory('/story?id=7', newsReads({ findStory }))).toBeNull();
  });
});
