/**
 * What a search engine takes from a homepage — read from the markup alone, with no DOM,
 * because this runs on the SERVER, where there is no browser to parse with. `lynx` has
 * `DOMParser` and uses it; a crawler cannot.
 *
 * The reading is forgiving on purpose. Pages are written by hand, by people, and a
 * crawler that choked on an unclosed tag would drop a site from the index over a typo.
 * So nothing here fails: whatever cannot be found reads as absent. Everything it returns
 * is TEXT — never markup — and the results page escapes it again before showing it, so
 * a page cannot write itself into somebody else's listing.
 */

export type ReadPage = {
  /** What the page calls itself, or the address it answers at when it names nothing. */
  readonly title: string;
  /** What the page says about itself, or the first thing it says when it says nothing. */
  readonly description: string;
  /** The words a reader of the page sees, a line per block. */
  readonly text: string;
};

const TITLE_ELEMENT = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i;
const META_ELEMENT = /<meta\b[^>]*>/gi;

/** An attribute's value, quoted either way or not at all — the three spellings a
 *  hand-written tag uses. */
const NAME_ATTRIBUTE = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const CONTENT_ATTRIBUTE = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

const attributeValue = (tag: string, pattern: RegExp): string | null => {
  const match = pattern.exec(tag);
  if (match === null) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
};

/** The entities a page writes instead of the characters themselves. Decoded in ONE pass
 *  rather than one replace per name, so `&amp;lt;` comes back as the text `&lt;` a page
 *  meant to show rather than as a `<` a second pass would have turned it into. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const HIGHEST_CODE_POINT = 0x10ffff;

const decodeEntities = (text: string): string =>
  text.replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (entity, body: string) => {
    if (!body.startsWith('#')) return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
    const isHex = body.toLowerCase().startsWith('#x');
    const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
    // A number naming no character is left as the page wrote it: it is what a reader
    // would see, and `String.fromCodePoint` would throw on it.
    return Number.isInteger(code) && code > 0 && code <= HIGHEST_CODE_POINT
      ? String.fromCodePoint(code)
      : entity;
  });

/** What a browser never shows: its own notes, its scripts and styles, and the head. A
 *  comment nobody closed swallows the rest of the page, exactly as it does in a browser. */
const HIDDEN = [
  /<!--[\s\S]*?-->/g,
  /<!--[\s\S]*$/,
  /<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi,
  /<title\b[^>]*>[\s\S]*?<\/title\s*>/gi,
];

/** The tags that end a line, because a reader sees each of them start somewhere new. */
const BLOCK_ELEMENT =
  /<\/?(?:p|div|h[1-6]|li|ul|ol|tr|table|br|hr|pre|section|article|header|footer|nav|form|blockquote)\b[^>]*>/gi;

/** A table's cells stay on their row's line: a menu read one cell per line is no longer
 *  a menu. */
const CELL_ELEMENT = /<\/?(?:td|th)\b[^>]*>/gi;

/** The words a reader of `html` sees, a line per block, with everything a browser hides
 *  left out. */
const visibleText = (html: string): string =>
  decodeEntities(
    HIDDEN.reduce((stripped, pattern) => stripped.replace(pattern, ' '), html)
      .replace(BLOCK_ELEMENT, '\n')
      .replace(CELL_ELEMENT, ' ')
      // Whatever tags are left are inline, and an inline tag breaks nothing.
      .replace(/<[^>]*>/g, ''),
  )
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');

/** The description the page gives itself, or null when it gives none. */
const metaDescription = (html: string): string | null => {
  for (const [tag] of html.matchAll(META_ELEMENT)) {
    const name = attributeValue(tag, NAME_ATTRIBUTE);
    if (name === null || name.toLowerCase() !== 'description') continue;
    const content = attributeValue(tag, CONTENT_ATTRIBUTE);
    if (content !== null) return decodeEntities(content).trim();
  }
  return null;
};

/**
 * Read `html` as a search engine reads it. `fallbackTitle` is what the page is called
 * when it calls itself nothing — the domain or address it answered at, which is the one
 * thing about it that is true whatever its author wrote.
 */
export const readPage = (html: string, fallbackTitle: string): ReadPage => {
  const title = decodeEntities(TITLE_ELEMENT.exec(html)?.[1] ?? '').trim();
  const text = visibleText(html);
  const described = metaDescription(html);
  return {
    title: title === '' ? fallbackTitle : title,
    // A page that says nothing about itself is described by the first thing it says,
    // which is what its author put at the top for a reader to see first.
    description: described !== null && described !== '' ? described : (text.split('\n')[0] ?? ''),
    text,
  };
};
