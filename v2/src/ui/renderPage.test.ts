import { describe, expect, it } from 'vitest';
import { renderPage } from './renderPage';
import { pickWebPage } from '../core/generation/pools/webPages';

/** The page a test renders from, when where it came from does not matter. Links
 *  resolve against it, so it has to be a real address. */
const PAGE_URL = 'http://192.168.1.5/index.html';

/** The rendered lines as the plain text a reader sees, with the segment structure
 *  that carries link targets flattened away. */
const asLines = (html: string): readonly string[] =>
  renderPage({ html, url: PAGE_URL }).map((line) =>
    line.map((segment) => segment.text).join(''),
  );

/** The rendered page as one string, for assertions about what a reader can and
 *  cannot see anywhere on it. */
const asText = (html: string): string => asLines(html).join('\n');

describe('rendering a page as text', () => {
  it('shows a heading and a paragraph as separate lines, with a blank line between them', () => {
    const lines = asLines('<html><body><h1>Welcome</h1><p>Server operational.</p></body></html>');

    expect(lines).toEqual(['Welcome', '', 'Server operational.']);
  });

  it('never shows an HTML comment — the recon that stays source-only', () => {
    const lines = asLines(
      '<html><body><p>visible</p><!-- TODO: remove debug endpoints --></body></html>',
    );

    expect(lines).toEqual(['visible']);
  });

  // Text either side is what makes this a real check: a heading BETWEEN two
  // headings gets its own block whether or not it counts as one, so only text it
  // could have been swallowed into can tell the two apart.
  it.each([1, 2, 3, 4, 5, 6])('breaks the line around an h%i, not just the top level', (level) => {
    const lines = asLines(`<body>before<h${level}>Heading</h${level}>after</body>`);

    expect(lines).toEqual(['before', '', 'Heading', '', 'after']);
  });

  it('keeps an inline element inside the line it belongs to', () => {
    const lines = asLines('<body><p>Node.js <strong>v18.17.0</strong> is up</p></body>');

    expect(lines).toEqual(['Node.js v18.17.0 is up']);
  });

  // Whitespace either side of an inline element is one gap, not two: the space
  // before the tag and the space inside it are the same word boundary.
  it('collapses a gap that straddles the edge of an inline element', () => {
    expect(asLines('<body><p>Node.js <strong> v18.17.0 </strong> is up</p></body>')).toEqual([
      'Node.js v18.17.0 is up',
    ]);
  });

  it('keeps loose text beside an inline element at the top level of a page', () => {
    expect(asLines('<body>Node.js <strong>v18.17.0</strong> is up</body>')).toEqual([
      'Node.js v18.17.0 is up',
    ]);
  });

  // A break at the start of a block breaks nothing — there is no line above it to
  // separate from, so it must not push the page down by one.
  it('starts a page at its first words even when a break opens the block', () => {
    expect(asLines('<body><p><br>after</p></body>')).toEqual(['after']);
  });

  it('shows an inline element inside a list item as part of the item, not as a list', () => {
    expect(asLines('<body><ul><li>alpha <strong>bold</strong></li></ul></body>')).toEqual([
      '  * alpha bold',
    ]);
  });

  it('shows text a page left loose between its blocks', () => {
    const lines = asLines('<body>bare words<p>in a block</p>more bare words</body>');

    expect(lines).toEqual(['bare words', '', 'in a block', '', 'more bare words']);
  });

  it('reads through a wrapper to the blocks inside it', () => {
    const lines = asLines('<body><div><h1>Title</h1><p>body text</p></div></body>');

    expect(lines).toEqual(['Title', '', 'body text']);
  });

  it('lines a wrapped item up under its own text, not under its marker', () => {
    const lines = asLines('<body><ul><li>first part<br>second part</li></ul></body>');

    expect(lines).toEqual(['  * first part', '    second part']);
  });

  it('never shows what a script or a stylesheet contains', () => {
    const text = asText(
      '<html><body><script>var secret = 1;</script><style>body { color: red }</style><p>visible</p></body></html>',
    );

    expect(text).toBe('visible');
  });

  it('marks unordered items and numbers ordered ones, each on its own line', () => {
    const unordered = asLines('<body><ul><li>alpha</li><li>beta</li></ul></body>');
    const ordered = asLines('<body><ol><li>first</li><li>second</li></ol></body>');

    expect(unordered).toEqual(['  * alpha', '  * beta']);
    expect(ordered).toEqual(['  1. first', '  2. second']);
  });

  it('restarts numbering for a nested list and indents it under its parent item', () => {
    const lines = asLines(
      '<body><ol><li>outer<ol><li>inner</li><li>also inner</li></ol></li><li>second outer</li></ol></body>',
    );

    expect(lines).toEqual([
      '  1. outer',
      '    1. inner',
      '    2. also inner',
      '  2. second outer',
    ]);
  });

  it('breaks a line where the markup says to, and not where the source merely wraps', () => {
    // The source newline and indent inside the paragraph are formatting, not content:
    // collapsing them is what stops a hand-written page rendering as ragged fragments.
    // The third paragraph is the one that matters: with nothing but the newline
    // between the words, a break that vanishes instead of becoming a space fuses
    // them into one.
    const lines = asLines(
      '<body><p>one<br>two</p><p>\n  spread\n  over lines\n</p><p>alpha\nbeta</p></body>',
    );

    expect(lines).toEqual(['one', 'two', '', 'spread over lines', '', 'alpha beta']);
  });

  it('shows the character an entity stands for, not the entity', () => {
    expect(asText('<body><p>Workers: 4&nbsp;/&nbsp;4 &amp; rising &lt;fast&gt;</p></body>')).toBe(
      'Workers: 4 / 4 & rising <fast>',
    );
  });

  it('reads a page the generator actually serves, keeping its recon and dropping its comment', () => {
    const html = pickWebPage({ role: undefined, seed: 'a-seed', hostname: 'db-01' });
    // Guards the claim below: a page with no comment would pass it vacuously.
    expect(html).toContain('<!--');

    const text = asText(html);

    expect(text).toContain('db-01');
    expect(text).not.toContain('<!--');
    expect(text).not.toContain('-->');
    expect(text).not.toContain('<');
  });

  it('renders nothing at all for a page with no readable content', () => {
    expect(asLines('<html><head><title>unseen</title></head><body></body></html>')).toEqual([]);
  });
});

describe('the links a page offers', () => {
  /** Every link on the page, in the order a reader meets them. */
  const linksOn = (html: string, url: string = PAGE_URL) =>
    renderPage({ html, url }).flatMap((line) => line.filter((segment) => segment.kind === 'link'));

  it('numbers a link and remembers where it goes', () => {
    expect(linksOn('<body><p><a href="/notes.html">the notes</a></p></body>')).toEqual([
      { kind: 'link', text: '[1]the notes', url: 'http://192.168.1.5/notes.html', index: 1 },
    ]);
  });

  it('numbers links in the order they appear, across the blocks they sit in', () => {
    const links = linksOn(
      '<body><p><a href="/a.html">first</a></p><ul><li><a href="/b.html">second</a></li></ul><p><a href="/c.html">third</a></p></body>',
    );

    expect(links.map((link) => link.text)).toEqual(['[1]first', '[2]second', '[3]third']);
  });

  it('keeps a link in the line it belongs to, with the words either side of it', () => {
    const [line] = renderPage({
      html: '<body><p>See <a href="/notes.html">the notes</a> for more.</p></body>',
      url: PAGE_URL,
    });

    expect(line).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: '[1]the notes', url: 'http://192.168.1.5/notes.html', index: 1 },
      { kind: 'text', text: ' for more.' },
    ]);
  });

  it('resolves a relative link against the page it is written on', () => {
    const links = linksOn(
      '<body><p><a href="next.html">onward</a></p></body>',
      'http://192.168.1.5/docs/intro.html',
    );

    expect(links).toEqual([
      { kind: 'link', text: '[1]onward', url: 'http://192.168.1.5/docs/next.html', index: 1 },
    ]);
  });

  // Numbering something the browser cannot fetch would be the same broken promise
  // the generated pages just had taken out of them.
  it('shows an href it cannot follow as ordinary text, and does not number it', () => {
    const html = '<body><p><a href="mailto:root@box">contact</a> <a href="/ok.html">ok</a></p></body>';

    expect(linksOn(html).map((link) => link.text)).toEqual(['[1]ok']);
    expect(asLines(html)).toEqual(['contact [1]ok']);
  });

  it('still numbers a link whose text is empty, so a reader can reach it', () => {
    expect(linksOn('<body><p><a href="/hidden.html"></a></p></body>')).toEqual([
      { kind: 'link', text: '[1]', url: 'http://192.168.1.5/hidden.html', index: 1 },
    ]);
  });

  it('offers no links for a page that has none', () => {
    expect(linksOn('<body><p>nothing to click</p></body>')).toEqual([]);
  });

  // One link, however many elements its text was written across — otherwise
  // selecting it would highlight only the fragment the markup happened to end on.
  it('reads a link written across several elements as one run of text', () => {
    expect(
      linksOn('<body><p><a href="/notes.html">the <strong>important</strong> notes</a></p></body>'),
    ).toEqual([
      { kind: 'link', text: '[1]the important notes', url: 'http://192.168.1.5/notes.html', index: 1 },
    ]);
  });

  // A page written across indented lines puts whitespace inside the anchor. The
  // highlight should cover what the link SAYS, not the author's formatting.
  it('tightens a link text to what it says, ignoring the markup around it', () => {
    expect(linksOn('<body><p><a href="/notes.html">\n  the   notes\n  </a></p></body>')).toEqual([
      { kind: 'link', text: '[1]the notes', url: 'http://192.168.1.5/notes.html', index: 1 },
    ]);
  });

  // An anchor with nowhere to go is writing. Numbering it would promise a reader a
  // destination that was never named.
  it('shows an anchor with no destination at all as ordinary text', () => {
    const html = '<body><p><a>go nowhere</a> <a href="/ok.html">ok</a></p></body>';

    expect(linksOn(html).map((link) => link.text)).toEqual(['[1]ok']);
    expect(asLines(html)).toEqual(['go nowhere [1]ok']);
  });
});
