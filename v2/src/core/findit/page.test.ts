import { describe, expect, it } from 'vitest';
import { FINDIT_FRONT_PAGE, searchResultsPage } from './page';
import type { IndexedPage } from './search';

/**
 * What findit answers with. The form is the whole of its documentation: a player who
 * reads the markup learns that a search is `?q=`, which is how the search engine is
 * used from a terminal at all.
 */

const indexedPage = (overrides: Partial<IndexedPage> = {}): IndexedPage => ({
  address: 'ridgemont.edu',
  title: 'Ridgemont University',
  description: 'Admissions, courses, research and campus life.',
  text: 'Admissions, courses, research and campus life.',
  ...overrides,
});

describe('the front page', () => {
  it('documents itself with the form it is searched by', () => {
    expect(FINDIT_FRONT_PAGE).toContain('<form action="/" method="GET">');
    expect(FINDIT_FRONT_PAGE).toContain('name="q"');
    expect(FINDIT_FRONT_PAGE).toContain('<title>findit.io</title>');
  });

  it('lists nothing before anything has been asked', () => {
    expect(FINDIT_FRONT_PAGE).not.toContain('<ol>');
    expect(FINDIT_FRONT_PAGE).not.toContain('No matches');
  });
});

describe('a page of results', () => {
  it('gives each result a name to follow, an address and what the site says of itself', () => {
    const page = searchResultsPage('university', [indexedPage()]);
    expect(page).toContain('<a href="http://ridgemont.edu/">Ridgemont University</a>');
    expect(page).toContain('ridgemont.edu');
    expect(page).toContain('Admissions, courses, research and campus life.');
    expect(page).toContain('<ol>');
  });

  it('keeps the search in the form, so the next search starts from the last one', () => {
    expect(searchResultsPage('coffee', [])).toContain('value="coffee"');
  });

  it('says so plainly when the web holds nothing that was asked for', () => {
    const page = searchResultsPage('submarine', []);
    expect(page).toContain('No matches for &quot;submarine&quot;.');
    expect(page).not.toContain('<ol>');
  });

  it('lists results in the order they were ranked', () => {
    const page = searchResultsPage('ridgemont', [
      indexedPage({ address: 'ridgemont.edu', title: 'University' }),
      indexedPage({ address: 'ridgemontlibrary.org', title: 'Library' }),
    ]);
    expect(page.indexOf('ridgemont.edu')).toBeLessThan(page.indexOf('ridgemontlibrary.org'));
  });

  it('shows what another site wrote as words, never as markup', () => {
    // Other people author these, and after players publish their own pages they are
    // authored by other PLAYERS. A title that closed the list and opened a script would
    // otherwise run in everybody else's results.
    const page = searchResultsPage('<script>alert(1)</script>', [
      indexedPage({
        address: 'evil.example',
        title: '</a></li></ol><script>alert(1)</script>',
        description: 'Say "hello" & <goodbye>',
      }),
    ]);
    expect(page).not.toContain('<script>');
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page).toContain('Say &quot;hello&quot; &amp; &lt;goodbye&gt;');
  });

  it('escapes an apostrophe as well, since a page may be titled with one', () => {
    const page = searchResultsPage("bean's", [indexedPage({ title: "Bean's Place" })]);
    expect(page).toContain('Bean&#39;s Place');
    expect(page).toContain('value="bean&#39;s"');
    expect(page).not.toContain("Bean's");
  });

  it('points at a page by its address whether that is a name or a number', () => {
    const page = searchResultsPage('page', [indexedPage({ address: '203.0.113.7', title: 'A box' })]);
    expect(page).toContain('<a href="http://203.0.113.7/">A box</a>');
  });
});

describe('the bytes findit puts on the wire', () => {
  // `curl` shows a page's SOURCE, so these bytes are what a player reads and learns the
  // search from. Pinned whole rather than sampled: a tag quietly lost from the form is a
  // search engine that no longer explains itself.
  it('serves its front page exactly so', () => {
    expect(FINDIT_FRONT_PAGE).toBe(
      [
        '<html>',
        '<head><title>findit.io</title></head>',
        '<body>',
        '<h1>findit.io</h1>',
        '<form action="/" method="GET">',
        '<input type="text" name="q" value="" placeholder="Search the public web">',
        '<button type="submit">Search</button>',
        '</form>',
        '<hr>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
    );
  });

  it('serves a result exactly so', () => {
    expect(searchResultsPage('coffee', [indexedPage({ address: 'beanthere.com', title: 'Bean There', description: 'Coffee.' })])).toBe(
      [
        '<html>',
        '<head><title>coffee — findit.io</title></head>',
        '<body>',
        '<h1>findit.io</h1>',
        '<form action="/" method="GET">',
        '<input type="text" name="q" value="coffee" placeholder="Search the public web">',
        '<button type="submit">Search</button>',
        '</form>',
        '<hr>',
        '<ol>',
        '<li>',
        '<h2><a href="http://beanthere.com/">Bean There</a></h2>',
        '<p>beanthere.com</p>',
        '<p>Coffee.</p>',
        '</li>',
        '</ol>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
    );
  });

  it('titles a page of results after what was searched for', () => {
    expect(searchResultsPage('coffee', [])).toContain('<title>coffee — findit.io</title>');
  });
});
