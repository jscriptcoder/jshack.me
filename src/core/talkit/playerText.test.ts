import { describe, expect, it } from 'vitest';
import { playerText } from './playerText.js';

/**
 * How talkit.io shows what a player wrote. Every talkit form will carry the poster's
 * emailit login, so text that became markup could plant a form that posts as whoever
 * reads it; nothing a player types may become an element but a link or a line break.
 */

/** A fragment as a browser builds it. */
const parsed = (html: string): HTMLDivElement => {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
};

const tagsIn = (html: string): readonly string[] =>
  [...parsed(html).querySelectorAll('*')].map((element) => element.tagName.toLowerCase());

const linksIn = (html: string) =>
  [...parsed(html).querySelectorAll('a')].map((link) => ({
    href: link.getAttribute('href'),
    attributes: link.getAttributeNames(),
    text: link.textContent,
  }));

const INJECTIONS = [
  '<script>alert(1)</script>',
  '"><form action=/comment method=post><input type=submit>',
  '</textarea>',
  '&lt;b&gt;',
  'javascript:alert(1)',
  'it\'s <b>bold</b> & "quoted"',
] as const;

describe('playerText', () => {
  it('leaves plain words as they are', () => {
    expect(playerText('My router keeps dropping the WiFi')).toBe(
      'My router keeps dropping the WiFi',
    );
  });

  it('escapes each character that could open markup', () => {
    expect(playerText(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
  });

  it.each(INJECTIONS)('shows %s as the text it is, with no element', (payload) => {
    expect(tagsIn(playerText(payload))).toEqual([]);
    expect(parsed(playerText(payload)).textContent).toBe(payload);
  });

  it('breaks the line at each newline', () => {
    expect(playerText('first\nsecond\n\nfourth')).toBe('first<br>second<br><br>fourth');
  });

  it('links an http address to itself', () => {
    expect(linksIn(playerText('see http://findit.io/?q=router for more'))).toEqual([
      {
        href: 'http://findit.io/?q=router',
        attributes: ['href'],
        text: 'http://findit.io/?q=router',
      },
    ]);
    expect(parsed(playerText('see http://findit.io/?q=router for more')).textContent).toBe(
      'see http://findit.io/?q=router for more',
    );
  });

  it('escapes an ampersand inside a link without changing where it goes', () => {
    const html = playerText('http://findit.io/?q=a&page=2');
    expect(html).toBe(
      '<a href="http://findit.io/?q=a&amp;page=2">http://findit.io/?q=a&amp;page=2</a>',
    );
    expect(linksIn(html).map((link) => link.href)).toEqual(['http://findit.io/?q=a&page=2']);
  });

  it.each(['.', ',', ';', ':', '!', '?', ')'])(
    'leaves a trailing %s outside the link',
    (punctuation) => {
      const html = playerText(`try http://findit.io/?q=router${punctuation}`);
      expect(linksIn(html).map((link) => link.href)).toEqual(['http://findit.io/?q=router']);
      expect(parsed(html).textContent).toBe(`try http://findit.io/?q=router${punctuation}`);
    },
  );

  it('leaves a run of trailing punctuation outside the link', () => {
    const html = playerText('(see http://findit.io/a).');
    expect(linksIn(html).map((link) => link.href)).toEqual(['http://findit.io/a']);
    expect(parsed(html).textContent).toBe('(see http://findit.io/a).');
  });

  it('keeps punctuation inside an address when more of the address follows it', () => {
    expect(linksIn(playerText('http://x.io/a.b?c=d!e')).map((link) => link.href)).toEqual([
      'http://x.io/a.b?c=d!e',
    ]);
  });

  it('ends an address at a quote, so a quote cannot reach the attribute', () => {
    const html = playerText('http://x.io/a"onmouseover="1');
    expect(linksIn(html)).toEqual([
      { href: 'http://x.io/a', attributes: ['href'], text: 'http://x.io/a' },
    ]);
    expect(parsed(html).textContent).toBe('http://x.io/a"onmouseover="1');
  });

  it.each([
    ['an apostrophe', "http://x.io/a'b", 'http://x.io/a'],
    ['an angle bracket', 'http://x.io/a<b', 'http://x.io/a'],
    ['a closing angle bracket', 'http://x.io/a>b', 'http://x.io/a'],
    ['a space', 'http://x.io/a b', 'http://x.io/a'],
    ['a newline', 'http://x.io/a\nb', 'http://x.io/a'],
  ])('ends an address at %s', (_boundary, text, href) => {
    expect(linksIn(playerText(text)).map((link) => link.href)).toEqual([href]);
  });

  it('escapes the text on both sides of a link', () => {
    const html = playerText('<b>new</b>\nhttp://a.io <i>router</i>');
    expect(tagsIn(html)).toEqual(['br', 'a']);
    expect(parsed(html).textContent).toBe('<b>new</b>http://a.io <i>router</i>');
  });

  it('links each address in the text', () => {
    expect(linksIn(playerText('http://a.io and http://b.io')).map((link) => link.href)).toEqual([
      'http://a.io',
      'http://b.io',
    ]);
  });

  it.each([
    ['an https address, which no browser here can follow', 'https://x.io'],
    ['a scheme in capitals', 'HTTP://x.io'],
    ['a scheme with nothing after it', 'http://'],
    ['a scheme followed only by punctuation', 'http://.'],
    ['a javascript: address', 'javascript:alert(1)'],
  ])('does not link %s', (_case, text) => {
    expect(tagsIn(playerText(text))).toEqual([]);
    expect(parsed(playerText(text)).textContent).toBe(text);
  });
});
