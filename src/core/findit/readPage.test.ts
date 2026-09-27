import { describe, expect, it } from 'vitest';
import { readPage } from './readPage';

/**
 * What a search engine takes from a homepage: what it is called, what it says about
 * itself, and the words a reader of it sees. Only what is on the page counts, so its
 * author decides how it is found.
 */

const page = (head: string, body: string): string =>
  `<html>\n<head>${head}</head>\n<body>\n${body}\n</body>\n</html>`;

describe('readPage', () => {
  it('reads the title and the description a page gives itself', () => {
    const html = page(
      '<title>Ridgemont University</title><meta name="description" content="Admissions and campus life.">',
      '<h1>Ridgemont University</h1>\n<p>Welcome.</p>',
    );
    expect(readPage(html, 'ridgemont.edu')).toEqual({
      title: 'Ridgemont University',
      description: 'Admissions and campus life.',
      text: 'Ridgemont University\nWelcome.',
    });
  });

  it('titles a page that names nothing by the address it answers at', () => {
    expect(readPage(page('', '<p>Hello</p>'), '203.0.113.7').title).toBe('203.0.113.7');
    expect(readPage(page('<title>   </title>', '<p>Hello</p>'), '203.0.113.7').title).toBe(
      '203.0.113.7',
    );
  });

  it('describes a page that says nothing about itself by the first thing it says', () => {
    const html = page('<title>Home</title>', '\n<h1>  </h1>\n<p>Fresh bread daily.</p>\n<p>Open late.</p>');
    expect(readPage(html, 'bakery.example').description).toBe('Fresh bread daily.');
  });

  it('describes an empty page by nothing at all', () => {
    expect(readPage(page('<title>Blank</title>', ''), 'blank.example').description).toBe('');
  });

  it('reads the words a browser shows, not the ones its source hides', () => {
    const html = page(
      '<title>Diner</title>',
      '<!-- admin password is hunter2 -->\n<script>var secret = 1;</script>\n<style>p { color: red }</style>\n<p>Pie &amp; coffee</p>',
    );
    const read = readPage(html, 'diner.example');
    expect(read.text).toBe('Pie & coffee');
    expect(read.description).toBe('Pie & coffee');
  });

  it('decodes the characters a page writes as entities', () => {
    const html = page(
      '<title>Brew &amp; Code</title><meta name="description" content="Tea &lt;and&gt; &quot;code&quot; &#39;here&#39;">',
      '<p>x</p>',
    );
    expect(readPage(html, 'brewandcode.com')).toMatchObject({
      title: 'Brew & Code',
      description: 'Tea <and> "code" \'here\'',
    });
  });

  it('finds a title and a description however the tags are cased or spaced', () => {
    const html = page(
      '<TITLE>Loud</TITLE>\n<META content="Shouting." NAME="Description" >',
      '<P>body</P>',
    );
    expect(readPage(html, 'loud.example')).toMatchObject({
      title: 'Loud',
      description: 'Shouting.',
    });
  });

  it('reads whatever markup a person wrote by hand without failing', () => {
    const broken = '<title>Half<p>unclosed <b>bold <!-- never closed';
    expect(() => readPage(broken, 'broken.example')).not.toThrow();
    expect(readPage('', 'empty.example')).toEqual({
      title: 'empty.example',
      description: '',
      text: '',
    });
  });
});

describe('readPage on the markup real pages carry', () => {
  it('reads a hex entity as well as a decimal one', () => {
    expect(readPage(page('<title>A &#x26; B</title>', '<p>&#65;</p>'), 'x').title).toBe('A & B');
    expect(readPage(page('<title>t</title>', '<p>&#65;</p>'), 'x').text).toBe('A');
  });

  it('leaves a number naming no character exactly as the page wrote it', () => {
    // The promise this keeps is that nothing here throws: `String.fromCodePoint` would,
    // on either of these.
    const html = page('<title>t</title>', '<p>&#0; &#99999999;</p>');
    expect(() => readPage(html, 'x')).not.toThrow();
    expect(readPage(html, 'x').text).toBe('&#0; &#99999999;');
  });

  it('decodes the two entities a page writes for a quote and a gap', () => {
    expect(readPage(page('<title>t</title>', '<p>it&apos;s&nbsp;here</p>'), 'x').text).toBe(
      "it's here",
    );
  });

  it('ignores the other things a page says about itself in its head', () => {
    const html = page(
      '<title>t</title><meta charset="utf-8"><meta name="keywords" content="wrong"><meta name="description" content="right">',
      '<p>body</p>',
    );
    expect(readPage(html, 'x').description).toBe('right');
  });

  it('describes a page by its body when its description tag carries nothing', () => {
    const noContent = page('<title>t</title><meta name="description">', '<p>the body</p>');
    expect(readPage(noContent, 'x').description).toBe('the body');
    const empty = page('<title>t</title><meta name="description" content="">', '<p>the body</p>');
    expect(readPage(empty, 'x').description).toBe('the body');
  });

  it('trims the description a page padded', () => {
    const html = page('<title>t</title><meta name="description" content="  spaced  ">', '<p>x</p>');
    expect(readPage(html, 'x').description).toBe('spaced');
  });

  it('starts a new line at each block, even where the source wrote none', () => {
    expect(readPage(page('<title>t</title>', '<h1>First</h1><p>Second</p>'), 'x').text).toBe(
      'First\nSecond',
    );
  });

  it('reads a run of spacing as the single gap a browser shows', () => {
    expect(readPage(page('<title>t</title>', '<p>far\t\t  apart</p>'), 'x').text).toBe('far apart');
  });

  it('keeps a table row on its own line, cell by cell', () => {
    const html = page(
      '<title>t</title>',
      '<table><tr><td>Nina</td><td>Webmaster</td></tr><tr><td>Otto</td><td>Barista</td></tr></table>',
    );
    expect(readPage(html, 'x').text).toBe('Nina Webmaster\nOtto Barista');
  });

  it('shows nothing a page hid behind a comment it never closed', () => {
    // A browser hides everything after an unterminated comment, so a note whose author
    // forgot the `-->` must not leak into the index either. Written without the closing
    // tags on purpose: with a later `>` on the page, stripping tags swallows the note by
    // accident, and an accident is not the behaviour being asked for.
    expect(readPage('<title>t</title><p>before</p><!-- the admin password is hunter2', 'x').text)
      .toBe('before');
    expect(readPage('<p>before</p><!-- unclosed', 'x').text).not.toContain('unclosed');
  });

  it('reads the highest character there is, and refuses the first number past it', () => {
    // The boundary itself is a real character; one past it is not one at all.
    expect(readPage(page('<title>t</title>', '<p>&#1114111;</p>'), 'x').text).toBe(
      String.fromCodePoint(1114111),
    );
    expect(readPage(page('<title>t</title>', '<p>&#1114112;</p>'), 'x').text).toBe('&#1114112;');
  });

  it('keeps two words apart when a comment was written between them', () => {
    expect(readPage(page('<title>t</title>', '<p>one<!-- note -->two</p>'), 'x').text).toBe(
      'one two',
    );
  });

  it('reads an attribute quoted either way, or not quoted at all', () => {
    const single = page("<title>t</title><meta name='description' content='single quoted'>", '<p>b</p>');
    expect(readPage(single, 'x').description).toBe('single quoted');
    const bare = page('<title>t</title><meta name=description content=bare>', '<p>b</p>');
    expect(readPage(bare, 'x').description).toBe('bare');
  });

  it('breaks a line where a page asked for a break with no block to close', () => {
    expect(readPage(page('<title>t</title>', '<p>top<br>bottom</p>'), 'x').text).toBe(
      ['top', 'bottom'].join('\n'),
    );
  });

  it('reads a title however its tag was written, and ignores one in the body', () => {
    expect(readPage('<html><head><title >Spaced</title ></head><body></body></html>', 'x').title)
      .toBe('Spaced');
  });
});
