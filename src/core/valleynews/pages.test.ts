import { describe, expect, it } from 'vitest';
import { VALLEYNEWS_FRONT_PAGE } from './pages.js';

/**
 * valleynews.io's masthead: the one page on the box's disk, and so the one a root can
 * rewrite. It names the paper, says what it carries for findit to list, and leads to the
 * three sections, each with the voice it is in.
 */

const parsed = (page: string): Document => new DOMParser().parseFromString(page, 'text/html');

describe("valleynews.io's masthead", () => {
  it('names the paper and says what it carries', () => {
    const page = parsed(VALLEYNEWS_FRONT_PAGE);
    expect(page.title).toBe('valleynews.io - the Harrow Valley paper');
    expect(page.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'News from Harrow Valley, from the people who build it, and from the wider world of security.',
    );
    expect(page.querySelector('h1')?.textContent).toBe('valleynews.io');
  });

  it('is a whole document as curl prints it, its head holding its title and description', () => {
    expect(
      VALLEYNEWS_FRONT_PAGE.startsWith(
        '<html>\n<head>\n<title>valleynews.io - the Harrow Valley paper</title>\n<meta name="description" content="',
      ),
    ).toBe(true);
    expect(VALLEYNEWS_FRONT_PAGE).toContain('.">\n</head>\n<body>\n<h1>valleynews.io</h1>\n');
    expect(VALLEYNEWS_FRONT_PAGE.endsWith('</body>\n</html>\n')).toBe(true);
  });

  it('leads to the three sections from its nav line', () => {
    const nav = parsed(VALLEYNEWS_FRONT_PAGE).querySelector('h1 + p');
    expect(
      [...(nav?.querySelectorAll('a') ?? [])].map((link) => [
        link.textContent,
        link.getAttribute('href'),
      ]),
    ).toEqual([
      ['Valley', '/valley'],
      ['Dev', '/dev'],
      ['Wire', '/wire'],
    ]);
  });

  it('names each section with the voice it is in', () => {
    const body = [...parsed(VALLEYNEWS_FRONT_PAGE).body.children];
    const content = body.slice(body.findIndex((element) => element.tagName === 'HR') + 1);
    expect(content.map((element) => element.textContent)).toEqual([
      'The Harrow Valley paper.',
      'The valleyNews from Harrow Valley',
      'The dev logFrom the people who build jshack.me',
      'The wireSecurity news from the real world',
    ]);
    expect(
      content.flatMap((element) =>
        [...element.querySelectorAll('a')].map((link) => link.getAttribute('href')),
      ),
    ).toEqual(['/valley', '/dev', '/wire']);
  });
});
