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

describe('a table on a page', () => {
  it('shows one line per row, each column padded to its widest cell with two spaces between', () => {
    const html =
      '<body><table>' +
      '<tr><th>Item</th><th>Price</th><th>Size</th></tr>' +
      '<tr><td>Flat white</td><td>3</td><td>small</td></tr>' +
      '<tr><td>Tea</td><td>12</td><td>large</td></tr>' +
      '</table></body>';

    expect(asLines(html)).toEqual([
      'Item        Price  Size',
      'Flat white  3      small',
      'Tea         12     large',
    ]);
  });

  it('sets a table apart from the text around it, as a block', () => {
    const html = '<body><p>before</p><table><tr><td>a</td><td>b</td></tr></table>after</body>';

    expect(asLines(html)).toEqual(['before', '', 'a  b', '', 'after']);
  });

  it('reads through thead, tbody and tfoot to the rows inside them, in order', () => {
    const html =
      '<body><table><thead><tr><th>Day</th><th>Open</th></tr></thead>' +
      '<tbody><tr><td>Mon</td><td>8-18</td></tr></tbody>' +
      '<tfoot><tr><td>Sun</td><td>closed</td></tr></tfoot></table></body>';

    expect(asLines(html)).toEqual(['Day  Open', 'Mon  8-18', 'Sun  closed']);
  });

  it('shows a caption on its own line above the rows', () => {
    const html =
      '<body><table><caption>Opening hours</caption><tr><td>Mon</td><td>8-18</td></tr></table></body>';

    expect(asLines(html)).toEqual(['Opening hours', 'Mon  8-18']);
  });

  it('leaves a short row short, without failing on the cells it lacks', () => {
    const html =
      '<body><table><tr><td>one</td><td>two</td><td>three</td></tr><tr><td>alone</td></tr></table></body>';

    expect(asLines(html)).toEqual(['one    two  three', 'alone']);
  });

  it('collapses the whitespace inside a cell and keeps a break in it on the same row', () => {
    const html = '<body><table><tr><td>  two\n  words </td><td>a<br>b</td></tr></table></body>';

    expect(asLines(html)).toEqual(['two words  a b']);
  });

  it('closes up two breaks in a row inside a cell to a single space', () => {
    expect(asLines('<body><table><tr><td>a<br><br>b</td><td>c</td></tr></table></body>')).toEqual([
      'a b  c',
    ]);
  });

  it('leaves no padding after a row whose last cells are empty', () => {
    const html =
      '<body><table><tr><td>a</td><td></td></tr><tr><td>bb</td><td>c</td></tr></table></body>';

    expect(asLines(html)).toEqual(['a', 'bb  c']);
  });

  it('hands the browser a row as plain text runs and the links inside it, nothing else', () => {
    const html =
      '<body><table><tr><td>Menu</td><td><a href="/menu.html">see</a></td></tr>' +
      '<tr><td>Opening</td><td>8-18</td></tr></table></body>';

    expect(renderPage({ html, url: PAGE_URL })).toEqual([
      [
        { kind: 'text', text: 'Menu' },
        { kind: 'text', text: '     ' },
        { kind: 'link', text: '[1]see', url: 'http://192.168.1.5/menu.html', index: 1 },
      ],
      [
        { kind: 'text', text: 'Opening' },
        { kind: 'text', text: '  ' },
        { kind: 'text', text: '8-18' },
      ],
    ]);
  });

  it('shows a table inside a wrapper the same way', () => {
    const html = '<body><div><table><tr><td>a</td><td>b</td></tr></table></div></body>';

    expect(asLines(html)).toEqual(['a  b']);
  });

  it('shows a table inside a list item under the item, at its indent', () => {
    const html =
      '<body><ul><li>Rota<table><tr><td>Mon</td><td>Ana</td></tr><tr><td>Tuesday</td><td>Joe</td></tr></table></li></ul></body>';

    expect(asLines(html)).toEqual(['  * Rota', '    Mon      Ana', '    Tuesday  Joe']);
  });

  it('keeps two tables in two list items on their own grids', () => {
    const html =
      '<body><ul><li>A<table><tr><td>a-long-cell</td><td>x</td></tr></table></li>' +
      '<li>B<table><tr><td>b</td><td>y</td></tr></table></li></ul></body>';

    expect(asLines(html)).toEqual(['  * A', '    a-long-cell  x', '  * B', '    b  y']);
  });

  it('numbers the links in its cells row by row, and pads each column to the numbered text', () => {
    const html =
      '<body><table>' +
      '<tr><td><a href="/menu.html">Menu</a></td><td>food</td></tr>' +
      '<tr><td>Hours</td><td><a href="/hours.html">when</a></td></tr>' +
      '</table></body>';
    const lines = renderPage({ html, url: PAGE_URL });

    expect(asLines(html)).toEqual(['[1]Menu  food', 'Hours    [2]when']);
    expect(lines.flat().filter((segment) => segment.kind === 'link')).toEqual([
      { kind: 'link', text: '[1]Menu', url: 'http://192.168.1.5/menu.html', index: 1 },
      { kind: 'link', text: '[2]when', url: 'http://192.168.1.5/hours.html', index: 2 },
    ]);
  });

  it('aligns each table on its own widths, not on another table on the same page', () => {
    const html =
      '<body><table><tr><td>a-very-long-cell</td><td>x</td></tr></table>' +
      '<table><tr><td>b</td><td>y</td></tr></table></body>';

    expect(asLines(html)).toEqual(['a-very-long-cell  x', '', 'b  y']);
  });
});

describe('preformatted text on a page', () => {
  it('keeps its own line breaks and runs of spaces exactly', () => {
    const html = '<body><pre>$ ssh admin@files\nPORT   STATE\n22     open</pre></body>';

    expect(asLines(html)).toEqual(['$ ssh admin@files', 'PORT   STATE', '22     open']);
  });

  it('keeps a blank line inside the block, but drops blank lines at its edges', () => {
    const html = '<body><p>before</p><pre>\n\nfirst\n\nsecond\n\n</pre><p>after</p></body>';

    expect(asLines(html)).toEqual(['before', '', 'first', '', 'second', '', 'after']);
  });

  it('drops an edge line that holds only spaces, as it drops an empty one', () => {
    expect(asLines('<body><pre>   \nfirst\n  \t\n</pre></body>')).toEqual(['first']);
  });

  it('keeps a link whose text is empty, even when it is all the block holds', () => {
    expect(asLines('<body><pre><a href="/x.html"></a></pre></body>')).toEqual(['[1]']);
  });

  it('keeps two blank lines in a row inside the block, as written', () => {
    expect(asLines('<body><pre>a\n\n\nb</pre></body>')).toEqual(['a', '', '', 'b']);
  });

  it('keeps the indentation a line opens with', () => {
    expect(asLines('<body><pre>{\n  "status": "ok"\n}</pre></body>')).toEqual([
      '{',
      '  "status": "ok"',
      '}',
    ]);
  });

  it('numbers a link inside it and keeps the text around the link as written', () => {
    const html = '<body><pre>see  <a href="/old/">old/</a>   2026-07-01</pre></body>';
    const lines = renderPage({ html, url: PAGE_URL });

    expect(asLines(html)).toEqual(['see  [1]old/   2026-07-01']);
    expect(lines.flat().filter((segment) => segment.kind === 'link')).toEqual([
      { kind: 'link', text: '[1]old/', url: 'http://192.168.1.5/old/', index: 1 },
    ]);
  });

  it('still hides what a script inside it contains, and shows an entity as its character', () => {
    expect(asLines('<body><pre>a &lt; b<script>x()</script></pre></body>')).toEqual(['a < b']);
  });

  it('breaks the line where a br sits inside it', () => {
    expect(asLines('<body><pre>one<br>two</pre></body>')).toEqual(['one', 'two']);
  });

  it('shows a block inside a list item under the item, at its indent', () => {
    expect(asLines('<body><ul><li>Run:<pre>make\n  install</pre></li></ul></body>')).toEqual([
      '  * Run:',
      '    make',
      '      install',
    ]);
  });
});

describe('a form on a page', () => {
  it('shows a text field as a box a reader can see is there', () => {
    const lines = asLines(
      '<body><form action="/" method="GET"><input type="text" name="q" placeholder="Search the public web"><button type="submit">Search</button></form></body>',
    );

    expect(lines.join('\n')).toContain('[Search the public web]');
    expect(lines.join('\n')).toContain('[ Search ]');
  });

  it('shows what a field already holds in place of what it suggests', () => {
    expect(asText('<body><input type="text" name="q" value="coffee" placeholder="Search"></body>'))
      .toContain('[coffee]');
  });

  it('shows an empty field with nothing in it rather than an empty line', () => {
    expect(asText('<body><input type="text" name="q"></body>')).toContain('[');
  });

  it('never shows what a password field holds', () => {
    const rendered = asText('<body><input type="password" name="pw" value="hunter2"></body>');

    expect(rendered).not.toContain('hunter2');
  });

  it('shows a hidden field not at all, as a browser does', () => {
    expect(asText('<body><input type="hidden" name="token" value="secret"><p>after</p></body>'))
      .toBe('after');
  });

  it('keeps the form on the page it is written on, above what follows it', () => {
    const lines = asLines('<body><form><input type="text" name="q"></form><p>results</p></body>');

    expect(lines[lines.length - 1]).toBe('results');
  });
});
