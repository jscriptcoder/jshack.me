import { describe, expect, it } from 'vitest';
import { renderPage } from './renderPage';
import { pickWebPage } from '../core/generation/pools/webPages';

/** The rendered page as one string, for assertions about what a reader can and
 *  cannot see anywhere on it. */
const asText = (html: string): string => renderPage(html).join('\n');

describe('rendering a page as text', () => {
  it('shows a heading and a paragraph as separate lines, with a blank line between them', () => {
    const lines = renderPage('<html><body><h1>Welcome</h1><p>Server operational.</p></body></html>');

    expect(lines).toEqual(['Welcome', '', 'Server operational.']);
  });

  it('never shows an HTML comment — the recon that stays source-only', () => {
    const lines = renderPage(
      '<html><body><p>visible</p><!-- TODO: remove debug endpoints --></body></html>',
    );

    expect(lines).toEqual(['visible']);
  });

  // Text either side is what makes this a real check: a heading BETWEEN two
  // headings gets its own block whether or not it counts as one, so only text it
  // could have been swallowed into can tell the two apart.
  it.each([1, 2, 3, 4, 5, 6])('breaks the line around an h%i, not just the top level', (level) => {
    const lines = renderPage(`<body>before<h${level}>Heading</h${level}>after</body>`);

    expect(lines).toEqual(['before', '', 'Heading', '', 'after']);
  });

  it('keeps an inline element inside the line it belongs to', () => {
    const lines = renderPage('<body><p>Node.js <strong>v18.17.0</strong> is up</p></body>');

    expect(lines).toEqual(['Node.js v18.17.0 is up']);
  });

  it('shows text a page left loose between its blocks', () => {
    const lines = renderPage('<body>bare words<p>in a block</p>more bare words</body>');

    expect(lines).toEqual(['bare words', '', 'in a block', '', 'more bare words']);
  });

  it('reads through a wrapper to the blocks inside it', () => {
    const lines = renderPage('<body><div><h1>Title</h1><p>body text</p></div></body>');

    expect(lines).toEqual(['Title', '', 'body text']);
  });

  it('lines a wrapped item up under its own text, not under its marker', () => {
    const lines = renderPage('<body><ul><li>first part<br>second part</li></ul></body>');

    expect(lines).toEqual(['  * first part', '    second part']);
  });

  it('never shows what a script or a stylesheet contains', () => {
    const text = asText(
      '<html><body><script>var secret = 1;</script><style>body { color: red }</style><p>visible</p></body></html>',
    );

    expect(text).toBe('visible');
  });

  it('marks unordered items and numbers ordered ones, each on its own line', () => {
    const unordered = renderPage('<body><ul><li>alpha</li><li>beta</li></ul></body>');
    const ordered = renderPage('<body><ol><li>first</li><li>second</li></ol></body>');

    expect(unordered).toEqual(['  * alpha', '  * beta']);
    expect(ordered).toEqual(['  1. first', '  2. second']);
  });

  it('restarts numbering for a nested list and indents it under its parent item', () => {
    const lines = renderPage(
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
    const lines = renderPage(
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
    const html = pickWebPage({ seed: 'a-seed', hostname: 'db-01' });
    // Guards the claim below: a page with no comment would pass it vacuously.
    expect(html).toContain('<!--');

    const text = asText(html);

    expect(text).toContain('db-01');
    expect(text).not.toContain('<!--');
    expect(text).not.toContain('-->');
    expect(text).not.toContain('<');
  });

  it('renders nothing at all for a page with no readable content', () => {
    expect(renderPage('<html><head><title>unseen</title></head><body></body></html>')).toEqual([]);
  });
});
