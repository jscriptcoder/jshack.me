import { describe, expect, it } from 'vitest';
import {
  NO_SUCH_PAGE,
  TALKIT_FRONT_PAGE,
  threadPage,
  threadsPage,
  type ThreadListing,
  type Thread,
  type ThreadComment,
} from './pages.js';

/**
 * What talkit.io answers with. Every page opens with the forum's name and a link to the
 * thread list, so a reader who lands anywhere can find the rest. Titles and handles are
 * escaped; a body may also break lines and link to `http://` addresses.
 */

const listing = (overrides: Partial<ThreadListing> = {}): ThreadListing => ({
  id: 1,
  title: 'Welcome to talkit.io',
  author: 'talkit',
  commentCount: 0,
  lastActivityAt: '2026-10-19T08:30:12.000Z',
  ...overrides,
});

const thread = (overrides: Partial<Thread> = {}): Thread => ({
  id: 1,
  title: 'Welcome to talkit.io',
  author: 'talkit',
  body: 'This is the forum for the whole valley.',
  createdAt: '2026-10-19T08:30:12.000Z',
  ...overrides,
});

const comment = (overrides: Partial<ThreadComment> = {}): ThreadComment => ({
  number: 1,
  author: 'neo',
  body: 'Thanks for having us.',
  createdAt: '2026-10-19T09:05:41.000Z',
  ...overrides,
});

const parsed = (page: string): Document => new DOMParser().parseFromString(page, 'text/html');

/** The page's own part: everything after the heading and the nav line. */
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

/** Every kind of page, each built when a test asks for it. */
const PAGES: readonly (readonly [string, () => string])[] = [
  ['front', () => TALKIT_FRONT_PAGE],
  ['list', () => threadsPage({ page: 1, threads: [listing()], hasOlder: false })],
  ['thread', () => threadPage(thread(), [])],
  ['no such page', () => NO_SUCH_PAGE],
];

const INJECTIONS = [
  '<script>alert(1)</script>',
  '"><form action=/comment method=post><input type=submit>',
  '</textarea>',
  '&lt;b&gt;',
  'javascript:alert(1)',
  'http://x.io/a"onmouseover="1',
] as const;

describe("talkit.io's pages", () => {
  it.each(PAGES)('the %s page opens with the forum and a link to the threads', (_name, build) => {
    const document = parsed(build());
    expect(document.querySelector('h1')?.textContent).toBe('talkit.io');
    expect(links([...document.body.children].slice(1, 2))).toEqual([
      { text: 'Threads', href: '/threads' },
    ]);
    expect(document.body.children[2]?.tagName).toBe('HR');
  });

  it.each(PAGES)('the %s page is a whole document, as curl prints it', (_name, build) => {
    const page = build();
    expect(page).toMatch(/^<html>\n<head>\n<title>[^\n]*<\/title>\n/);
    expect(page).toContain('\n</head>\n<body>\n<h1>talkit.io</h1>\n');
    expect(page).toMatch(/\n<\/body>\n<\/html>\n$/);
  });

  it.each(PAGES.filter(([name]) => name !== 'front'))(
    'only the front page describes itself to a search engine, not the %s page',
    (_name, build) => {
      expect(build()).toMatch(/^<html>\n<head>\n<title>[^\n]*<\/title>\n<\/head>\n/);
    },
  );

  describe('the front page', () => {
    it('names the forum and describes it for a search engine', () => {
      const document = parsed(TALKIT_FRONT_PAGE);
      expect(document.title).toBe('talkit.io - the Harrow Valley forum');
      expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
        'A forum for the whole valley: start a thread, or join one. Sign in with your emailit.io account.',
      );
    });

    it('welcomes the reader and links to the threads', () => {
      expect(contentText(TALKIT_FRONT_PAGE)[0]).toBe(
        'The forum for the whole valley: WiFi, jobs, new routers, and anything else on your mind.',
      );
      expect(links(contentOf(TALKIT_FRONT_PAGE))).toEqual([
        { text: 'Read the threads', href: '/threads' },
      ]);
    });

    it('offers a form to start a thread: a title, a body four rows tall and a button', () => {
      const document = parsed(TALKIT_FRONT_PAGE);
      const form = document.querySelector('form');

      expect(document.querySelector('h2')?.textContent).toBe('Start a thread');
      expect([form?.getAttribute('action'), form?.getAttribute('method')]).toEqual([
        '/post',
        'post',
      ]);
      expect(
        [...(form?.querySelectorAll('input, textarea') ?? [])].map((control) => [
          control.tagName,
          control.getAttribute('type'),
          control.getAttribute('name') ?? control.getAttribute('value'),
        ]),
      ).toEqual([
        ['INPUT', 'text', 'title'],
        ['TEXTAREA', null, 'body'],
        ['INPUT', 'submit', 'Post'],
      ]);
      expect(form?.querySelector('textarea')?.getAttribute('rows')).toBe('4');
      expect(form?.querySelector('textarea')?.textContent).toBe('');
    });
  });

  describe('the thread list', () => {
    it('is titled as the list of threads', () => {
      expect(parsed(threadsPage({ page: 1, threads: [listing()], hasOlder: false })).title).toBe(
        'Threads - talkit.io',
      );
    });

    it('gives each thread its title as a link, its author, its comments and its last activity', () => {
      const page = threadsPage({ page: 1, threads: [listing()], hasOlder: false });
      expect(contentText(page)).toEqual([
        'Welcome to talkit.io' + 'by talkit, 0 comments, last 2026-10-19 08:30',
      ]);
      expect(links(contentOf(page))).toEqual([
        { text: 'Welcome to talkit.io', href: '/thread?id=1' },
      ]);
    });

    it('puts the author line under the title', () => {
      const page = threadsPage({ page: 1, threads: [listing()], hasOlder: false });
      expect(contentOf(page)[0]?.innerHTML).toBe(
        '<a href="/thread?id=1">Welcome to talkit.io</a><br>by talkit, 0 comments, last 2026-10-19 08:30',
      );
    });

    it.each([
      [0, '0 comments'],
      [1, '1 comment'],
      [2, '2 comments'],
    ])('counts %i comments as "%s"', (commentCount, counted) => {
      const page = threadsPage({ page: 1, threads: [listing({ commentCount })], hasOlder: false });
      expect(contentText(page)[0]).toContain(`by talkit, ${counted}, last`);
    });

    it('lists the threads in the order given', () => {
      const page = threadsPage({
        page: 1,
        threads: [listing({ id: 7, title: 'Newest' }), listing({ id: 3, title: 'Older' })],
        hasOlder: false,
      });
      expect(links(contentOf(page))).toEqual([
        { text: 'Newest', href: '/thread?id=7' },
        { text: 'Older', href: '/thread?id=3' },
      ]);
    });

    it('links to the older page when there is one', () => {
      const page = threadsPage({ page: 1, threads: [listing()], hasOlder: true });
      expect(links(contentOf(page)).slice(1)).toEqual([{ text: 'older', href: '/threads?page=2' }]);
    });

    it('links back to the newer page from page 2 onwards', () => {
      const page = threadsPage({ page: 3, threads: [listing()], hasOlder: false });
      expect(links(contentOf(page)).slice(1)).toEqual([{ text: 'newer', href: '/threads?page=2' }]);
    });

    it('links both ways from a page in the middle', () => {
      const page = threadsPage({ page: 2, threads: [listing()], hasOlder: true });
      expect(links(contentOf(page)).slice(1)).toEqual([
        { text: 'newer', href: '/threads?page=1' },
        { text: 'older', href: '/threads?page=3' },
      ]);
      expect(contentText(page).at(-1)).toBe('newer | older');
    });

    it('ends a lone page with its last thread, and no paging line', () => {
      const page = threadsPage({ page: 1, threads: [listing()], hasOlder: false });
      expect(page).toContain('last 2026-10-19 08:30</p>\n</body>');
    });

    it('says when a page holds no threads', () => {
      const page = threadsPage({ page: 9, threads: [], hasOlder: false });
      expect(contentText(page)).toEqual(['No threads here.']);
      expect(links(contentOf(page))).toEqual([]);
    });
  });

  describe('a thread', () => {
    it('is titled with its own title', () => {
      expect(parsed(threadPage(thread({ title: 'My new router' }), [])).title).toBe(
        'My new router - talkit.io',
      );
    });

    it('shows its title, its author and when it was posted, and its body', () => {
      expect(contentText(threadPage(thread(), [])).slice(0, 3)).toEqual([
        'Welcome to talkit.io',
        'by talkit, 2026-10-19 08:30',
        'This is the forum for the whole valley.',
      ]);
      expect(contentOf(threadPage(thread(), []))[0]?.tagName).toBe('H2');
    });

    it('breaks the body at each line break and links its addresses', () => {
      const page = threadPage(thread({ body: 'Ask findit:\nhttp://findit.io/?q=router' }), []);
      expect(contentOf(page)[2]?.innerHTML).toBe(
        'Ask findit:<br><a href="http://findit.io/?q=router">http://findit.io/?q=router</a>',
      );
    });

    it('never links an address in the title', () => {
      const page = threadPage(thread({ title: 'see http://findit.io' }), []);
      expect(contentOf(page)[0]?.innerHTML).toBe('see http://findit.io');
    });

    it('says so under the body while nobody has commented', () => {
      expect(contentText(threadPage(thread(), [])).slice(3, 5)).toEqual([
        'No comments yet.',
        'Comment',
      ]);
    });

    it('shows each comment under the body, in the order given: its number, author, time and body', () => {
      const page = threadPage(thread(), [
        comment(),
        comment({
          number: 2,
          author: 'trinity',
          body: 'Mine too.',
          createdAt: '2026-10-19T11:47:03.000Z',
        }),
      ]);
      expect(contentText(page).slice(3, 8)).toEqual([
        '#1 by neo, 2026-10-19 09:05',
        'Thanks for having us.',
        '#2 by trinity, 2026-10-19 11:47',
        'Mine too.',
        'Comment',
      ]);
    });

    it("breaks a comment's body at each line break and links its addresses", () => {
      const page = threadPage(thread(), [comment({ body: 'Try this:\nhttp://findit.io/?q=wifi' })]);
      expect(contentOf(page)[4]?.innerHTML).toBe(
        'Try this:<br><a href="http://findit.io/?q=wifi">http://findit.io/?q=wifi</a>',
      );
    });

    it('ends with a form to comment on this thread: its id, a body four rows tall and a button', () => {
      const document = parsed(threadPage(thread({ id: 12 }), [comment()]));
      const form = document.querySelector('form');

      expect(contentOf(threadPage(thread({ id: 12 }), [comment()])).at(-1)?.tagName).toBe('FORM');
      expect([form?.getAttribute('action'), form?.getAttribute('method')]).toEqual([
        '/comment',
        'post',
      ]);
      expect(
        [...(form?.querySelectorAll('input, textarea') ?? [])].map((control) => [
          control.tagName,
          control.getAttribute('type'),
          control.getAttribute('name'),
          control.getAttribute('value'),
        ]),
      ).toEqual([
        ['INPUT', 'hidden', 'id', '12'],
        ['TEXTAREA', null, 'body', null],
        ['INPUT', 'submit', null, 'Comment'],
      ]);
      expect(form?.querySelector('textarea')?.getAttribute('rows')).toBe('4');
      expect(form?.querySelector('textarea')?.textContent).toBe('');
    });
  });

  it('says so when a page of the list is not a page', () => {
    expect(parsed(NO_SUCH_PAGE).title).toBe('No such page - talkit.io');
    expect(contentText(NO_SUCH_PAGE)).toEqual(['No such page.']);
  });

  describe('no player text becomes markup', () => {
    const OWN_TAGS = ['A', 'BR', 'H1', 'H2', 'HR', 'P'];
    /** A thread page's own form: the comment form, and nothing else. */
    const FORM_TAGS = ['FORM', 'INPUT', 'TEXTAREA'];

    const tagsIn = (page: string): readonly string[] => [
      ...new Set([...parsed(page).body.querySelectorAll('*')].map((element) => element.tagName)),
    ];

    it.each(INJECTIONS)('on the list, a thread titled %s', (payload) => {
      const page = threadsPage({
        page: 1,
        threads: [listing({ title: payload, author: payload })],
        hasOlder: false,
      });
      expect(tagsIn(page).filter((tag) => !OWN_TAGS.includes(tag))).toEqual([]);
      expect(links(contentOf(page))).toEqual([{ text: payload, href: '/thread?id=1' }]);
      expect(contentText(page)[0]).toBe(
        `${payload}by ${payload}, 0 comments, last 2026-10-19 08:30`,
      );
    });

    /** What a thread page's form holds: exactly the comment form's three controls. */
    const formControlsIn = (page: string): readonly string[] =>
      [...parsed(page).querySelectorAll('form, input, textarea, button, select')].map(
        (control) => `${control.tagName} ${control.getAttribute('name') ?? ''}`,
      );

    it.each(INJECTIONS)('on a thread, a title, author and body of %s', (payload) => {
      const page = threadPage(thread({ title: payload, author: payload, body: payload }), []);
      expect(tagsIn(page).filter((tag) => ![...OWN_TAGS, ...FORM_TAGS].includes(tag))).toEqual([]);
      expect(formControlsIn(page)).toEqual(['FORM ', 'INPUT id', 'TEXTAREA body', 'INPUT ']);
      expect(parsed(page).title).toBe(`${payload} - talkit.io`);
      expect(contentText(page).slice(0, 3)).toEqual([
        payload,
        `by ${payload}, 2026-10-19 08:30`,
        payload,
      ]);
    });

    it.each(INJECTIONS)('on a thread, a comment whose author and body are %s', (payload) => {
      const page = threadPage(thread(), [comment({ author: payload, body: payload })]);
      expect(tagsIn(page).filter((tag) => ![...OWN_TAGS, ...FORM_TAGS].includes(tag))).toEqual([]);
      expect(formControlsIn(page)).toEqual(['FORM ', 'INPUT id', 'TEXTAREA body', 'INPUT ']);
      expect(contentText(page).slice(3, 5)).toEqual([
        `#1 by ${payload}, 2026-10-19 09:05`,
        payload,
      ]);
    });

    it('the only link a body gets goes where its address says, and holds nothing more', () => {
      const page = threadPage(thread({ body: 'http://x.io/a"onmouseover="1' }), []);
      const bodyLinks = [...(contentOf(page)[2]?.querySelectorAll('a') ?? [])];
      expect(bodyLinks.map((link) => link.getAttributeNames())).toEqual([['href']]);
      expect(bodyLinks.map((link) => link.getAttribute('href'))).toEqual(['http://x.io/a']);
    });
  });
});
