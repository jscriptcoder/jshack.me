import { describe, it, expect } from 'vitest';
import { renderHtml } from './render';

const DEFAULT_OPTS = { width: 80 } as const;

const render = (html: string, opts: { readonly width: number } = DEFAULT_OPTS) =>
  renderHtml(html, opts);

describe('renderHtml', () => {
  describe('return shape', () => {
    it('returns lines and references arrays', () => {
      const result = render('<p>hello</p>');
      expect(Array.isArray(result.lines)).toBe(true);
      expect(Array.isArray(result.references)).toBe(true);
    });

    it('returns empty arrays for empty input', () => {
      const result = render('');
      expect(result.lines).toEqual([]);
      expect(result.references).toEqual([]);
    });

    it('omits the References section when there are no anchors', () => {
      const result = render('<p>just text</p>');
      expect(result.lines.join('\n')).not.toContain('References');
      expect(result.references).toEqual([]);
    });
  });

  describe('headings', () => {
    it('underlines h1 with === to the heading width', () => {
      const result = render('<h1>Title</h1>');
      expect(result.lines).toContain('Title');
      expect(result.lines).toContain('=====');
    });

    it('underlines h2 with --- to the heading width', () => {
      const result = render('<h2>Subtitle</h2>');
      expect(result.lines).toContain('Subtitle');
      expect(result.lines).toContain('--------');
    });

    it('does not underline h3', () => {
      const result = render('<h3>Section</h3>');
      expect(result.lines).toContain('Section');
      expect(result.lines).not.toContain('=======');
      expect(result.lines).not.toContain('-------');
    });

    it('separates consecutive headings with a blank line', () => {
      const result = render('<h1>A</h1><h2>B</h2>');
      const aIdx = result.lines.indexOf('A');
      const bIdx = result.lines.indexOf('B');
      expect(aIdx).toBeGreaterThanOrEqual(0);
      expect(bIdx).toBeGreaterThan(aIdx);
      const between = result.lines.slice(aIdx + 1, bIdx);
      expect(between).toContain('');
    });
  });

  describe('paragraphs', () => {
    it('renders a short paragraph as a single line', () => {
      const result = render('<p>hello world</p>');
      expect(result.lines).toContain('hello world');
    });

    it('wraps long paragraphs to the requested width', () => {
      const long = 'one two three four five six seven eight nine ten eleven twelve';
      const result = render(`<p>${long}</p>`, { width: 20 });
      const bodyLines = result.lines.filter((l) => l.length > 0);
      bodyLines.forEach((line) => {
        expect(line.length).toBeLessThanOrEqual(20);
      });
      expect(result.lines.join(' ').replace(/\s+/g, ' ').trim()).toContain(long);
    });

    it('packs words greedily up to exactly the width (boundary)', () => {
      // 'abc def gh' is exactly 10 chars; should fit on one line at width=10.
      // Catches the off-by-one where the wrap predicate uses `<` instead of `<=`.
      const result = render('<p>abc def gh</p>', { width: 10 });
      expect(result.lines).toContain('abc def gh');
    });

    it('separates consecutive paragraphs with a blank line', () => {
      const result = render('<p>first</p><p>second</p>');
      const firstIdx = result.lines.indexOf('first');
      const secondIdx = result.lines.indexOf('second');
      expect(firstIdx).toBeGreaterThanOrEqual(0);
      expect(secondIdx).toBeGreaterThan(firstIdx);
      expect(result.lines.slice(firstIdx + 1, secondIdx)).toContain('');
    });
  });

  describe('unordered lists', () => {
    it('prefixes each <li> with "  * "', () => {
      const result = render('<ul><li>apple</li><li>pear</li></ul>');
      expect(result.lines).toContain('  * apple');
      expect(result.lines).toContain('  * pear');
    });

    it('indents nested <ul> one level deeper', () => {
      const result = render('<ul><li>outer<ul><li>inner</li></ul></li></ul>');
      expect(result.lines.some((l) => l.includes('* outer'))).toBe(true);
      expect(result.lines.some((l) => l.includes('* inner'))).toBe(true);
      const outerLine = result.lines.find((l) => l.includes('* outer'));
      const innerLine = result.lines.find((l) => l.includes('* inner'));
      const outerIndent = (outerLine ?? '').indexOf('*');
      const innerIndent = (innerLine ?? '').indexOf('*');
      expect(innerIndent).toBeGreaterThan(outerIndent);
    });
  });

  describe('ordered lists', () => {
    it('numbers each <li> starting at 1', () => {
      const result = render('<ol><li>first</li><li>second</li><li>third</li></ol>');
      expect(result.lines).toContain('  1. first');
      expect(result.lines).toContain('  2. second');
      expect(result.lines).toContain('  3. third');
    });
  });

  describe('links', () => {
    it('renders an anchor inline as [N]text', () => {
      const result = render('<p>see <a href="http://example.com/">example</a> now</p>');
      expect(result.lines.join('\n')).toContain('[1]example');
    });

    it('appends a References section listing the anchor href', () => {
      const result = render('<p><a href="http://example.com/">example</a></p>');
      expect(result.lines).toContain('References');
      expect(result.lines.join('\n')).toContain('1. http://example.com/');
      expect(result.references).toEqual(['http://example.com/']);
    });

    it('numbers anchors in document order', () => {
      const result = render(
        '<p><a href="http://a.com/">A</a> and <a href="http://b.com/">B</a></p>',
      );
      const body = result.lines.join('\n');
      expect(body).toContain('[1]A');
      expect(body).toContain('[2]B');
      expect(result.references).toEqual(['http://a.com/', 'http://b.com/']);
    });

    it('collapses duplicate URLs to a single reference number', () => {
      const result = render(
        '<p><a href="http://a.com/">first</a> <a href="http://a.com/">second</a></p>',
      );
      const body = result.lines.join('\n');
      expect(body).toContain('[1]first');
      expect(body).toContain('[1]second');
      expect(result.references).toEqual(['http://a.com/']);
    });

    it('strips leading whitespace inside the anchor so the marker hugs the first word', () => {
      // &nbsp; before the visible text would otherwise leave a space between
      // [1] and 'text', which would let word-wrap split them across lines.
      const result = render('<p><a href="http://example.com/">&nbsp;text</a></p>');
      const body = result.lines.join('\n');
      expect(body).toMatch(/\[1\]text/);
      expect(body).not.toMatch(/\[1\] /);
    });

    it('keeps the reference marker sticky to the first word of the anchor text', () => {
      const result = render('<p><a href="http://example.com/">multi word link</a></p>', {
        width: 80,
      });
      const body = result.lines.join('\n');
      // [1] must hug the first word, not float free.
      expect(body).toMatch(/\[1\]multi/);
      expect(body).not.toMatch(/\[1\]\s/);
    });
  });

  describe('tables', () => {
    it('renders rows linearised with space-padded cells', () => {
      const result = render(
        '<table><tr><td>name</td><td>price</td></tr><tr><td>cpu</td><td>$99</td></tr></table>',
      );
      const body = result.lines.join('\n');
      expect(body).toContain('name');
      expect(body).toContain('price');
      expect(body).toContain('cpu');
      expect(body).toContain('$99');
    });

    it('separates a thead row from the body with a --- divider', () => {
      const result = render(
        '<table><thead><tr><th>name</th><th>price</th></tr></thead><tbody><tr><td>cpu</td><td>$99</td></tr></tbody></table>',
      );
      const headerIdx = result.lines.findIndex((l) => l.includes('name') && l.includes('price'));
      const bodyIdx = result.lines.findIndex((l) => l.includes('cpu') && l.includes('$99'));
      expect(headerIdx).toBeGreaterThanOrEqual(0);
      expect(bodyIdx).toBeGreaterThan(headerIdx);
      const between = result.lines.slice(headerIdx + 1, bodyIdx);
      expect(between.some((l) => /-{3,}/.test(l))).toBe(true);
    });

    it('aligns columns by padding cells to the widest cell in each column', () => {
      const result = render(
        '<table><tr><td>a</td><td>short</td></tr><tr><td>longer</td><td>x</td></tr></table>',
      );
      const lines = result.lines.filter((l) => l.includes('a') || l.includes('longer'));
      expect(lines.length).toBe(2);
      // Both rows reach the same column for the second cell.
      expect(lines[0].indexOf('short')).toBe(lines[1].indexOf('x'));
    });
  });

  describe('forms', () => {
    it('renders an <input> as a labelled placeholder', () => {
      const result = render('<form><label>Email <input name="email" type="email"></label></form>');
      const body = result.lines.join('\n');
      expect(body).toContain('Email');
      expect(body).toContain('___');
    });

    it('renders a <button> as a labelled button placeholder', () => {
      const result = render('<form><button type="submit">Sign In</button></form>');
      expect(result.lines.join('\n')).toContain('[Button: Sign In]');
    });

    it('renders a <textarea> as a multi-line placeholder', () => {
      const result = render(
        '<form><label>Message <textarea name="message"></textarea></label></form>',
      );
      const body = result.lines.join('\n');
      expect(body).toContain('Message');
      expect(body).toContain('___');
    });
  });

  describe('inline elements', () => {
    it('renders <strong> text inline', () => {
      const result = render('<p>this is <strong>important</strong> text</p>');
      expect(result.lines.join(' ')).toContain('this is important text');
    });

    it('renders <em>, <small>, <code>, <cite> inline', () => {
      const result = render(
        '<p><em>italic</em> <small>small</small> <code>code</code> <cite>cite</cite></p>',
      );
      const joined = result.lines.join(' ');
      expect(joined).toContain('italic');
      expect(joined).toContain('small');
      expect(joined).toContain('code');
      expect(joined).toContain('cite');
    });
  });

  describe('br and hr', () => {
    it('renders <br> as a line break inside a paragraph', () => {
      const result = render('<p>line one<br>line two</p>');
      expect(result.lines).toContain('line one');
      expect(result.lines).toContain('line two');
    });

    it('renders <hr> as a row of underscores to the requested width', () => {
      const result = render('<hr>', { width: 20 });
      expect(result.lines).toContain('_'.repeat(20));
    });
  });

  describe('dropped tags', () => {
    it('drops <head> content', () => {
      const result = render(
        '<html><head><title>secret</title></head><body><p>visible</p></body></html>',
      );
      expect(result.lines.join('\n')).not.toContain('secret');
      expect(result.lines.join('\n')).toContain('visible');
    });

    it('drops <script> content', () => {
      const result = render('<p>visible</p><script>alert("x")</script>');
      expect(result.lines.join('\n')).not.toContain('alert');
      expect(result.lines.join('\n')).toContain('visible');
    });

    it('drops <style> content', () => {
      const result = render('<style>body{color:red}</style><p>visible</p>');
      expect(result.lines.join('\n')).not.toContain('color:red');
      expect(result.lines.join('\n')).toContain('visible');
    });
  });

  describe('unknown tags', () => {
    it('renders the children of an unknown tag inline', () => {
      const result = render('<custom-element>inner text</custom-element>');
      expect(result.lines.join('\n')).toContain('inner text');
    });
  });

  describe('HTML entities', () => {
    it('decodes &mdash; via the DOM parser', () => {
      const result = render('<p>hello &mdash; world</p>');
      expect(result.lines.join('\n')).toContain('hello — world');
    });

    it('decodes &amp; via the DOM parser', () => {
      const result = render('<p>cats &amp; dogs</p>');
      expect(result.lines.join('\n')).toContain('cats & dogs');
    });

    it('decodes &nbsp; and normalises U+00A0 to ASCII space', () => {
      const result = render('<p>a&nbsp;b</p>');
      const joined = result.lines.join('\n');
      // DOMParser yields U+00A0; renderer normalises so wrap works.
      expect(joined).toContain('a b');
      expect(joined).not.toContain('a b');
    });
  });

  describe('segments API', () => {
    it('returns a parallel segments array of the same length as lines', () => {
      const result = render('<h1>Title</h1><p>hello world</p>');
      expect(result.segments.length).toBe(result.lines.length);
    });

    it('renders a plain paragraph as a single text segment', () => {
      const result = render('<p>hello world</p>');
      expect(result.segments[0]).toEqual([{ kind: 'text', text: 'hello world' }]);
    });

    it('emits a link segment for an anchor', () => {
      const result = render('<p>see <a href="http://example.com/">example</a> now</p>');
      const linkSeg = result.segments.flat().find((s) => s.kind === 'link');
      expect(linkSeg).toEqual({ kind: 'link', text: 'example', refIndex: 1 });
    });

    it('numbers anchor segments in document order', () => {
      const result = render(
        '<p><a href="http://a.com/">A</a> and <a href="http://b.com/">B</a></p>',
      );
      const indices = result.segments
        .flat()
        .filter((s) => s.kind === 'link')
        .map((s) => (s.kind === 'link' ? s.refIndex : -1));
      expect(indices).toEqual([1, 2]);
    });

    it('marks duplicate anchors with the same refIndex', () => {
      const result = render(
        '<p><a href="http://a.com/">first</a> <a href="http://a.com/">second</a></p>',
      );
      const linkSegs = result.segments
        .flat()
        .filter((s): s is Extract<typeof s, { kind: 'link' }> => s.kind === 'link');
      expect(linkSegs.map((s) => s.refIndex)).toEqual([1, 1]);
      expect(linkSegs.map((s) => s.text)).toEqual(['first', 'second']);
    });

    it('keeps the link text atomic — internal whitespace stays inside the link segment', () => {
      const result = render('<p><a href="http://x.com/">multi word link</a></p>');
      const linkSeg = result.segments.flat().find((s) => s.kind === 'link');
      expect(linkSeg).toEqual({ kind: 'link', text: 'multi word link', refIndex: 1 });
    });

    it('References block lines contain only text segments', () => {
      const result = render('<p><a href="http://x.com/">x</a></p>');
      const refsHeadingIdx = result.lines.indexOf('References');
      expect(refsHeadingIdx).toBeGreaterThanOrEqual(0);
      const refSegments = result.segments.slice(refsHeadingIdx);
      refSegments.forEach((line) => {
        line.forEach((seg) => expect(seg.kind).toBe('text'));
      });
    });

    it('preserves the lines invariant — segments serialise back to lines', () => {
      const html = '<h1>Title</h1><p>see <a href="http://x.com/">link</a> now</p>';
      const result = render(html);
      result.segments.forEach((segLine, i) => {
        const serialised = segLine
          .map((s) => (s.kind === 'link' ? `[${s.refIndex}]${s.text}` : s.text))
          .join('');
        expect(result.lines[i]).toBe(serialised);
      });
    });
  });

  describe('purity', () => {
    it('returns the same output for the same input on repeat calls', () => {
      const html = '<h1>Title</h1><p>Body with <a href="http://x.com/">link</a>.</p>';
      const a = render(html);
      const b = render(html);
      expect(a.lines).toEqual(b.lines);
      expect(a.references).toEqual(b.references);
    });
  });
});
