/**
 * Render a served HTML page as the lines a text browser shows.
 *
 * The parser is the platform's own: `DOMParser` decodes entities, tolerates the
 * malformed markup a player writes by hand, and hands back a tree whose comments
 * and scripts are distinguishable by node type rather than by pattern-matching
 * angle brackets. Parsing this way runs nothing — `text/html` builds an inert
 * document, and only text content is ever read out of it, never re-inserted as
 * markup.
 *
 * It lives in the UI layer because it needs a DOM, and `core/` is framework-free
 * on purpose: one interpretation of a URL is shared with the server, but how a
 * page LOOKS is the client's business alone.
 *
 * **No width, no wrapping.** Long lines wrap in CSS exactly as terminal output
 * does, so this returns logical lines and the viewport decides where they break.
 * A width parameter would put a second, worse line-breaker beside the browser's.
 *
 * The tags handled are the ones this world's pages contain: headings, paragraphs,
 * divs, lists, and `<br>`. Anything else contributes its text to the line being
 * built, which is what an unknown inline tag should do and a graceful-enough
 * failure for an unknown block one. Tables and preformatted blocks are absent
 * deliberately — no page has either, and their column arithmetic was the bulk of
 * a text browser's rendering code.
 */

const HEADING_TAGS: ReadonlySet<string> = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Elements whose content is program text, not page text. A reader sees neither,
 *  the same way a comment is invisible — `curl` is what shows a page's source. */
const SILENT_TAGS: ReadonlySet<string> = new Set(['script', 'style']);

/** One step of list indentation, and the margin every list sits in. */
const INDENT = '  ';

const tagOf = (element: Element): string => element.tagName.toLowerCase();

const isList = (node: Node): node is Element =>
  node instanceof Element && (tagOf(node) === 'ul' || tagOf(node) === 'ol');

/**
 * The text `node` contributes to the line being built.
 *
 * Source newlines are neutralized here, at the point each text node is read, so
 * that the only newline reaching `toLines` is the one `<br>` put there. A page
 * indented for a human to read must not render as ragged fragments because of it.
 * Collapsing the resulting run of spaces is `toLines`' job, once the pieces of a
 * line have been joined.
 */
const inlineText = (node: Node): string => {
  if (node instanceof Text) return node.data.replace(/\n/g, ' ');
  if (!(node instanceof Element)) return '';
  const tag = tagOf(node);
  if (SILENT_TAGS.has(tag)) return '';
  if (tag === 'br') return '\n';
  return Array.from(node.childNodes).map(inlineText).join('');
};

/** A run of inline text as finished lines, split where `<br>` asked. */
const toLines = (text: string): readonly string[] =>
  text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim());

/** Every element inside a list is an item, `li` or not: a hand-written list with
 *  something else in it should show that content rather than swallow it, and
 *  nothing generated puts anything else there. */
const renderList = (list: Element, depth: number): readonly string[] => {
  const ordered = tagOf(list) === 'ol';
  return Array.from(list.children).flatMap((item, index) =>
    renderItem(item, depth, ordered ? `${index + 1}. ` : '* '),
  );
};

/** One list item: its own text under the marker, then any list nested inside it,
 *  indented a further step. A nested list numbers from one — it is its own list. */
const renderItem = (item: Element, depth: number, marker: string): readonly string[] => {
  const margin = INDENT.repeat(depth + 1);
  const own = toLines(
    Array.from(item.childNodes)
      .filter((child) => !isList(child))
      .map(inlineText)
      .join(''),
  );
  // A wrapped item lines up under its own text rather than under its marker.
  const hanging = ' '.repeat(marker.length);
  const lines = own.map((line, index) => `${margin}${index === 0 ? marker : hanging}${line}`);
  const nested = Array.from(item.children)
    .filter(isList)
    .flatMap((list) => renderList(list, depth + 1));
  return [...lines, ...nested];
};

/**
 * The lines inside one container, with a blank line marking every block boundary.
 *
 * Blanks are emitted generously and normalized afterwards, so no rule here has to
 * know what came before it — a heading opening the page and a heading between two
 * paragraphs are the same case.
 */
const renderContainer = (container: Element, depth: number): readonly string[] => {
  const lines: string[] = [];
  let pending = '';
  const flush = () => {
    lines.push('', ...toLines(pending));
    pending = '';
  };

  for (const child of Array.from(container.childNodes)) {
    if (!(child instanceof Element)) {
      pending += inlineText(child);
      continue;
    }
    const tag = tagOf(child);
    // Script and style need no skip here: they fall through to the inline branch,
    // and `inlineText` is the one place that decides they contribute nothing.
    if (isList(child)) {
      flush();
      lines.push('', ...renderList(child, depth), '');
      continue;
    }
    if (HEADING_TAGS.has(tag) || tag === 'p') {
      flush();
      lines.push('', ...toLines(inlineText(child)), '');
      continue;
    }
    if (tag === 'div') {
      flush();
      lines.push('', ...renderContainer(child, depth), '');
      continue;
    }
    pending += inlineText(child);
  }
  flush();
  return lines;
};

/**
 * One blank line between blocks, none at either end — whatever the markup's own
 * spacing was, and whatever the generous blanks above emitted.
 *
 * Dropping a blank that follows another blank ALSO drops a leading one, since the
 * first line has no predecessor to be separated from. That is why only the tail
 * needs trimming here: by then a leading blank cannot have survived.
 */
const normalize = (lines: readonly string[]): readonly string[] => {
  const collapsed = lines.filter(
    (line, index) => line !== '' || (index > 0 && lines[index - 1] !== ''),
  );
  const last = collapsed.reduce((found, line, index) => (line === '' ? found : index), -1);
  return collapsed.slice(0, last + 1);
};

/** `html` as the lines a reader sees. */
export const renderPage = (html: string): readonly string[] =>
  normalize(renderContainer(new DOMParser().parseFromString(html, 'text/html').body, 0));
