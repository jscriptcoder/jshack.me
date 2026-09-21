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
 * divs, lists, anchors, `<br>`, tables and preformatted blocks. Anything else
 * contributes its text to the line being built, which is what an unknown inline tag
 * should do and a graceful-enough failure for an unknown block one.
 *
 * A table is laid out in columns, each as wide as its widest cell, because a menu or
 * a timetable read as one run of words loses the only thing that made it a table. A
 * preformatted block keeps its author's spacing and line breaks, because a command
 * or an example response re-flowed into a paragraph no longer says what it said.
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

/** Where a table cell starts. How far apart cells sit cannot be known while the page
 *  is walked: a link's number widens its cell, and links are numbered only once the
 *  whole page is laid out. So each cell names its table and the columns are measured
 *  last, against the text a reader actually sees. */
type CellStart = { readonly kind: 'cell'; readonly table: Element };

/** What a line holds before its table columns are measured. */
type LinePiece = Piece | CellStart;

type Line = readonly LinePiece[];

const HEADING_TAGS: ReadonlySet<string> = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Elements whose content is program text, not page text. A reader sees neither,
 *  the same way a comment is invisible — `curl` is what shows a page's source. */
const SILENT_TAGS: ReadonlySet<string> = new Set(['script', 'style']);

/** One step of list indentation, and the margin every list sits in. */
const INDENT = '  ';

/** What separates two table columns, beyond the padding that lines them up. */
const COLUMN_GAP = '  ';

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
const inlinePieces = (node: Node, base: string): readonly Piece[] =>
  piecesOf(node, base, (data) => data.replace(/\n/g, ' '));

/** The pieces a preformatted block contributes, whitespace and newlines as written:
 *  in a `<pre>` a source newline IS a line break, since keeping the author's layout
 *  is the whole point of the element. */
const preformattedPieces = (node: Node, base: string): readonly Piece[] =>
  piecesOf(node, base, (data) => data);

/** The walk both of the above share: only how a text node reads differs. */
const piecesOf = (
  node: Node,
  base: string,
  readText: (data: string) => string,
): readonly Piece[] => {
  if (node instanceof Text) return [text(readText(node.data))];
  if (!(node instanceof Element)) return [];
  const tag = tagOf(node);
  if (SILENT_TAGS.has(tag)) return [];
  if (tag === 'br') return [text('\n')];
  const inner = Array.from(node.childNodes).flatMap((child) => piecesOf(child, base, readText));
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

/** A run of pieces cut into lines wherever a newline sits, and nowhere else. */
const splitAtBreaks = (pieces: readonly Piece[]): readonly (readonly Piece[])[] =>
  pieces.reduce<readonly (readonly Piece[])[]>(
    (lines, piece) => {
      const openLine = lines[lines.length - 1] ?? [];
      const closed = lines.slice(0, -1);
      if (piece.kind === 'link') return [...closed, [...openLine, piece]];
      const [head, ...rest] = piece.text.split('\n');
      return [...closed, [...openLine, text(head ?? '')], ...rest.map((part) => [text(part)])];
    },
    [[]],
  );

/** A run of pieces as finished lines, split where `<br>` asked. */
const toLines = (pieces: readonly Piece[]): readonly (readonly Piece[])[] =>
  splitAtBreaks(pieces).map(finish);

/** A line that shows nothing: no link, and no text but whitespace. */
const isBlank = (line: readonly Piece[]): boolean =>
  line.every((piece) => piece.kind === 'text' && piece.text.trim() === '');

/**
 * A `<pre>` block's lines, exactly as written, minus the blank lines at its edges.
 *
 * A blank line INSIDE the block is kept as an empty run rather than an empty line:
 * an empty line is what the layout uses to separate blocks, and it collapses runs of
 * them into one — which would close up the gaps the author left on purpose.
 */
const renderPreformatted = (pre: Element, base: string): readonly Line[] => {
  const lines = splitAtBreaks(
    Array.from(pre.childNodes).flatMap((child) => preformattedPieces(child, base)),
  );
  const first = lines.findIndex((line) => !isBlank(line));
  const last = lines.findLastIndex((line) => !isBlank(line));
  return lines.slice(first, last + 1).map((line) => (isBlank(line) ? [text('')] : line));
};

/** One cell's content as a single run of pieces: a cell is one slot in a row, so a
 *  break inside it becomes a space rather than a new line. */
const cellPieces = (cell: Element, base: string): readonly Piece[] =>
  toLines(inlinePieces(cell, base))
    .filter((line) => line.length > 0)
    .flatMap((line, index) => (index === 0 ? line : [text(' '), ...line]));

/**
 * A table's rows, one line each, every cell marked where it starts for the layout to
 * measure.
 * Cells a row does not have, or leaves empty at its end, contribute nothing — a short
 * row stays short instead of trailing padding.
 */
const renderTable = (table: Element, base: string): readonly Line[] => {
  if (!(table instanceof HTMLTableElement)) return [];
  const caption = table.caption === null ? [] : toLines(inlinePieces(table.caption, base));
  const rows = Array.from(table.rows).map((row) => {
    const cells = Array.from(row.cells).map((cell) => cellPieces(cell, base));
    const lastFilled = cells.findLastIndex((cell) => cell.length > 0);
    return cells
      .slice(0, lastFilled + 1)
      .flatMap((cell): Line => [{ kind: 'cell', table }, ...cell]);
  });
  return [...caption, ...rows];
};

/** The lines of a block that lays itself out — a table or a preformatted block — or
 *  null when `element` is neither. */
const renderLaidOutBlock = (element: Element, base: string): readonly Line[] | null => {
  const tag = tagOf(element);
  if (tag === 'table') return renderTable(element, base);
  if (tag === 'pre') return renderPreformatted(element, base);
  return null;
};

const isLaidOutBlock = (node: Node): node is Element =>
  node instanceof Element && (tagOf(node) === 'table' || tagOf(node) === 'pre');

/** Every element inside a list is an item, `li` or not: a hand-written list with
 *  something else in it should show that content rather than swallow it, and
 *  nothing generated puts anything else there. */
const renderList = (list: Element, depth: number, base: string): readonly Line[] => {
  const ordered = tagOf(list) === 'ol';
  return Array.from(list.children).flatMap((item, index) =>
    renderItem(item, depth, ordered ? `${index + 1}. ` : '* ', base),
  );
};

/** One list item: its own text under the marker, then any table or preformatted
 *  block inside it at the item's text indent, then any list nested inside it,
 *  indented a further step. A nested list numbers from one — it is its own list. */
const renderItem = (
  item: Element,
  depth: number,
  marker: string,
  base: string,
): readonly Line[] => {
  const margin = INDENT.repeat(depth + 1);
  const own = toLines(
    Array.from(item.childNodes)
      .filter((child) => !isList(child) && !isLaidOutBlock(child))
      .flatMap((child) => inlinePieces(child, base)),
  );
  // A wrapped item lines up under its own text rather than under its marker.
  const hanging = ' '.repeat(marker.length);
  const lines = own.map((line, index): Line => [
    text(`${margin}${index === 0 ? marker : hanging}`),
    ...line,
  ]);
  const blocks = Array.from(item.children)
    .flatMap((child) => renderLaidOutBlock(child, base) ?? [])
    .map((line): Line => [text(`${margin}${hanging}`), ...line]);
  const nested = Array.from(item.children)
    .filter(isList)
    .flatMap((list) => renderList(list, depth + 1, base));
  return [...lines, ...blocks, ...nested];
};

/**
 * The lines inside one container, with a blank line marking every block boundary.
 *
 * Blanks are emitted generously and normalized afterwards, so no rule here has to
 * know what came before it — a heading opening the page and a heading between two
 * paragraphs are the same case.
 */
const renderContainer = (container: Element, depth: number, base: string): readonly Line[] => {
  const lines: Line[] = [];
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
    const laidOut = renderLaidOutBlock(child, base);
    if (laidOut !== null) {
      flush();
      lines.push([], ...laidOut, []);
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
const normalize = (lines: readonly Line[]): readonly Line[] => {
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
const numbered = (lines: readonly Line[]): readonly (readonly (Segment | CellStart)[])[] => {
  let count = 0;
  return lines.map((line) =>
    line.map((piece) => {
      if (piece.kind !== 'link') return piece;
      count += 1;
      return { kind: 'link', text: `[${count}]${piece.text}`, url: piece.url, index: count };
    }),
  );
};

/** A numbered row: what sits before its first cell (a list's indent), and its cells
 *  in column order. */
type Row = { readonly prefix: readonly Segment[]; readonly cells: readonly (readonly Segment[])[] };

const rowOf = (line: readonly (Segment | CellStart)[]): Row =>
  line.reduce<Row>(
    (row, piece) => {
      if (piece.kind === 'cell') return { ...row, cells: [...row.cells, []] };
      if (row.cells.length === 0) return { ...row, prefix: [...row.prefix, piece] };
      return { ...row, cells: [...row.cells.slice(0, -1), [...(row.cells.at(-1) ?? []), piece]] };
    },
    { prefix: [], cells: [] },
  );

const widthOf = (cell: readonly Segment[]): number =>
  cell.reduce((width, segment) => width + segment.text.length, 0);

/** The table a line is a row of, or null when it is not a row. */
const tableOf = (line: readonly (Segment | CellStart)[]): Element | null =>
  line.find((piece): piece is CellStart => piece.kind === 'cell')?.table ?? null;

/**
 * Every table's rows laid out in columns.
 *
 * Measured on numbered text, because `[12]` is part of what a reader sees in a cell.
 * Each table is measured on its own rows only — two tables on one page are two grids.
 * The last cell of a row needs no padding after it, but still counts toward its
 * column's width, so a longer cell in a short row pushes the next column out for
 * every row.
 *
 * A line that is not a row needs no case of its own: it has no cells, so it measures
 * nothing and lays out as its prefix — which is the whole line.
 */
const aligned = (lines: readonly (readonly (Segment | CellStart)[])[]): readonly RenderedLine[] => {
  const widths = lines.reduce((found, line) => {
    const table = tableOf(line);
    const known = found.get(table) ?? [];
    const cells = rowOf(line).cells.map(widthOf);
    const longest = Array.from({ length: Math.max(known.length, cells.length) }, (_, column) =>
      Math.max(known[column] ?? 0, cells[column] ?? 0),
    );
    return new Map(found).set(table, longest);
  }, new Map<Element | null, readonly number[]>());

  return lines.map((line) => {
    const columns = widths.get(tableOf(line)) ?? [];
    const { prefix, cells } = rowOf(line);
    const laidOut = cells.flatMap((cell, column): readonly Segment[] => {
      const isLast = column === cells.length - 1;
      if (isLast) return cell;
      const padding = ' '.repeat((columns[column] ?? 0) - widthOf(cell)) + COLUMN_GAP;
      return [...cell, { kind: 'text', text: padding }];
    });
    return [...prefix, ...laidOut];
  });
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
  aligned(
    numbered(
      normalize(renderContainer(new DOMParser().parseFromString(html, 'text/html').body, 0, url)),
    ),
  );
