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
 * **A line is segments, not a string**, because a reader has to see which run of
 * characters is the link they are about to follow. Text a page never linked is one
 * plain segment and reads exactly as it did before.
 *
 * **No width, no wrapping.** Long lines wrap in CSS exactly as terminal output
 * does, so this returns logical lines and the viewport decides where they break.
 * A width parameter would put a second, worse line-breaker beside the browser's.
 *
 * The tags handled are the ones this world's pages contain: headings, paragraphs,
 * divs, lists, anchors, and `<br>`. Anything else contributes its text to the line
 * being built, which is what an unknown inline tag should do and a graceful-enough
 * failure for an unknown block one. Tables and preformatted blocks are absent
 * deliberately — no page has either, and their column arithmetic was the bulk of
 * a text browser's rendering code.
 */

import { resolveHref } from '../core/network/http';

/** A run of rendered characters. A link carries where it goes and the number the
 *  reader types past — everything else is text a page merely said. */
export type Segment =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'link';
      readonly text: string;
      readonly url: string;
      readonly index: number;
    };

/** One rendered line, as the runs of text it is made of. */
export type RenderedLine = readonly Segment[];

/** A segment before the page has been walked far enough to know its number. */
type Piece =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly url: string };

const HEADING_TAGS: ReadonlySet<string> = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Elements whose content is program text, not page text. A reader sees neither,
 *  the same way a comment is invisible — `curl` is what shows a page's source. */
const SILENT_TAGS: ReadonlySet<string> = new Set(['script', 'style']);

/** One step of list indentation, and the margin every list sits in. */
const INDENT = '  ';

const tagOf = (element: Element): string => element.tagName.toLowerCase();

const isList = (node: Node): node is Element =>
  node instanceof Element && (tagOf(node) === 'ul' || tagOf(node) === 'ol');

const text = (content: string): Piece => ({ kind: 'text', text: content });

/**
 * The pieces `node` contributes to the line being built.
 *
 * Source newlines are neutralized here, at the point each text node is read, so
 * that the only newline reaching `toLines` is the one `<br>` put there. A page
 * indented for a human to read must not render as ragged fragments because of it.
 * Collapsing the resulting run of spaces is `toLines`' job, once the pieces of a
 * line have been assembled.
 *
 * An anchor the browser cannot follow contributes its own text and nothing else:
 * a link that goes nowhere is writing, not a link.
 */
const inlinePieces = (node: Node, base: string): readonly Piece[] => {
  if (node instanceof Text) return [text(node.data.replace(/\n/g, ' '))];
  if (!(node instanceof Element)) return [];
  const tag = tagOf(node);
  if (SILENT_TAGS.has(tag)) return [];
  if (tag === 'br') return [text('\n')];
  const inner = Array.from(node.childNodes).flatMap((child) => inlinePieces(child, base));
  if (tag !== 'a') return inner;
  const url = resolveHref({ base, href: node.getAttribute('href') ?? '' });
  if (url === null) return inner;
  // A link is one run however many elements its text was written across, so that
  // selecting it highlights the whole thing.
  return [{ kind: 'link', text: inner.map((piece) => piece.text).join(''), url }];
};

/** Adjacent text merged into single runs, so that whitespace spanning a boundary
 *  collapses the way it would have inside one text node. Only a link breaks a run. */
const merged = (pieces: readonly Piece[]): readonly Piece[] =>
  pieces.reduce<readonly Piece[]>((joined, piece) => {
    const last = joined[joined.length - 1];
    if (piece.kind !== 'text' || last === undefined || last.kind !== 'text') {
      return [...joined, piece];
    }
    return [...joined.slice(0, -1), text(`${last.text}${piece.text}`)];
  }, []);

/** A piece with its internal whitespace collapsed, and a link's text tightened to
 *  what it says — a link whose markup was written across indented lines must not
 *  render with the indentation inside its highlight. */
const squeezed = (piece: Piece): Piece =>
  piece.kind === 'text'
    ? text(piece.text.replace(/\s+/g, ' '))
    : { ...piece, text: piece.text.replace(/\s+/g, ' ').trim() };

/** One finished line: whitespace collapsed, the line's own ends trimmed, and runs
 *  that ended up saying nothing dropped. A numbered link survives an empty text —
 *  its number is the part a reader needs. */
const finish = (pieces: readonly Piece[]): readonly Piece[] => {
  const squeezedPieces = merged(pieces).map(squeezed);
  const trimmed = squeezedPieces.map((piece, index) => {
    if (piece.kind !== 'text') return piece;
    const start = index === 0 ? piece.text.trimStart() : piece.text;
    return text(index === squeezedPieces.length - 1 ? start.trimEnd() : start);
  });
  return trimmed.filter((piece) => piece.kind === 'link' || piece.text !== '');
};

/** A run of pieces as finished lines, split where `<br>` asked. */
const toLines = (pieces: readonly Piece[]): readonly (readonly Piece[])[] => {
  const split = pieces.reduce<readonly (readonly Piece[])[]>(
    (lines, piece) => {
      const openLine = lines[lines.length - 1] ?? [];
      const closed = lines.slice(0, -1);
      if (piece.kind === 'link') return [...closed, [...openLine, piece]];
      const [head, ...rest] = piece.text.split('\n');
      return [...closed, [...openLine, text(head ?? '')], ...rest.map((part) => [text(part)])];
    },
    [[]],
  );
  return split.map(finish);
};

/** Every element inside a list is an item, `li` or not: a hand-written list with
 *  something else in it should show that content rather than swallow it, and
 *  nothing generated puts anything else there. */
const renderList = (list: Element, depth: number, base: string): readonly (readonly Piece[])[] => {
  const ordered = tagOf(list) === 'ol';
  return Array.from(list.children).flatMap((item, index) =>
    renderItem(item, depth, ordered ? `${index + 1}. ` : '* ', base),
  );
};

/** One list item: its own text under the marker, then any list nested inside it,
 *  indented a further step. A nested list numbers from one — it is its own list. */
const renderItem = (
  item: Element,
  depth: number,
  marker: string,
  base: string,
): readonly (readonly Piece[])[] => {
  const margin = INDENT.repeat(depth + 1);
  const own = toLines(
    Array.from(item.childNodes)
      .filter((child) => !isList(child))
      .flatMap((child) => inlinePieces(child, base)),
  );
  // A wrapped item lines up under its own text rather than under its marker.
  const hanging = ' '.repeat(marker.length);
  const lines = own.map((line, index) => [
    text(`${margin}${index === 0 ? marker : hanging}`),
    ...line,
  ]);
  const nested = Array.from(item.children)
    .filter(isList)
    .flatMap((list) => renderList(list, depth + 1, base));
  return [...lines, ...nested];
};

/**
 * The lines inside one container, with a blank line marking every block boundary.
 *
 * Blanks are emitted generously and normalized afterwards, so no rule here has to
 * know what came before it — a heading opening the page and a heading between two
 * paragraphs are the same case.
 */
const renderContainer = (
  container: Element,
  depth: number,
  base: string,
): readonly (readonly Piece[])[] => {
  const lines: (readonly Piece[])[] = [];
  let pending: readonly Piece[] = [];
  const flush = () => {
    lines.push([], ...toLines(pending));
    pending = [];
  };

  for (const child of Array.from(container.childNodes)) {
    if (!(child instanceof Element)) {
      pending = [...pending, ...inlinePieces(child, base)];
      continue;
    }
    const tag = tagOf(child);
    // Script and style need no skip here: they fall through to the inline branch,
    // and `inlinePieces` is the one place that decides they contribute nothing.
    if (isList(child)) {
      flush();
      lines.push([], ...renderList(child, depth, base), []);
      continue;
    }
    if (HEADING_TAGS.has(tag) || tag === 'p') {
      flush();
      lines.push([], ...toLines(inlinePieces(child, base)), []);
      continue;
    }
    if (tag === 'div') {
      flush();
      lines.push([], ...renderContainer(child, depth, base), []);
      continue;
    }
    pending = [...pending, ...inlinePieces(child, base)];
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
const normalize = (
  lines: readonly (readonly Piece[])[],
): readonly (readonly Piece[])[] => {
  const collapsed = lines.filter(
    (line, index) => line.length > 0 || (index > 0 && (lines[index - 1] ?? []).length > 0),
  );
  const last = collapsed.reduce((found, line, index) => (line.length > 0 ? index : found), -1);
  return collapsed.slice(0, last + 1);
};

/**
 * The links numbered in the order a reader meets them, top to bottom.
 *
 * Numbering last means nothing that walks the tree has to carry a counter, and the
 * number a reader sees is the number the selection uses — there is only one.
 */
const numbered = (lines: readonly (readonly Piece[])[]): readonly RenderedLine[] => {
  let count = 0;
  return lines.map((line) =>
    line.map((piece) => {
      if (piece.kind === 'text') return piece;
      count += 1;
      return { kind: 'link', text: `[${count}]${piece.text}`, url: piece.url, index: count };
    }),
  );
};

/** `html`, as served from `url`, as the lines a reader sees. The address is what
 *  the page's own relative links resolve against. */
export const renderPage = ({
  html,
  url,
}: {
  readonly html: string;
  readonly url: string;
}): readonly RenderedLine[] =>
  numbered(
    normalize(renderContainer(new DOMParser().parseFromString(html, 'text/html').body, 0, url)),
  );
