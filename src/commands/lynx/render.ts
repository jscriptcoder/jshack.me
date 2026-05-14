// Pure HTML→terminal renderer. Walks the DOM produced by DOMParser
// and emits two parallel views of the same content:
//   - `lines`: flat strings (one per output line)
//   - `segments`: same lines split into structured text/link spans
//
// The token-stream pass keeps anchors atomic so a multi-word link does
// not get split across whitespace; the consumer (the LynxBrowser
// overlay) needs to know which span is part of which link in order to
// highlight the cursor's selection.

export type RenderOpts = {
  readonly width: number;
};

export type Segment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly refIndex: number };

export type SegmentLine = readonly Segment[];

export type RenderResult = {
  readonly lines: readonly string[];
  readonly segments: readonly SegmentLine[];
  readonly references: readonly string[];
};

type Token =
  | { readonly kind: 'text-word'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly refIndex: number }
  | { readonly kind: 'hardbreak' };

type LinkRegistry = {
  readonly register: (url: string) => number;
  readonly list: () => readonly string[];
};

const createLinkRegistry = (): LinkRegistry => {
  const order: string[] = [];
  const indexByUrl = new Map<string, number>();
  return {
    register: (url) => {
      const existing = indexByUrl.get(url);
      if (existing !== undefined) return existing;
      const n = order.length + 1;
      indexByUrl.set(url, n);
      order.push(url);
      return n;
    },
    list: () => order,
  };
};

// Collapses any run of whitespace — including U+00A0 from &nbsp; — into
// a single ASCII space. Bulletproof against regex-engine variance.
const normalizeWhitespace = (text: string): string => text.replace(/[\s\xA0]+/g, ' ');

// Flattens an element's descendants to plain text (for anchor / button
// labels). Links inside links / buttons don't get separate refIndices —
// they're absorbed into the parent's label text.
const collectInlineString = (el: Element): string =>
  Array.from(el.childNodes)
    .map((n) => {
      if (n.nodeType === n.TEXT_NODE) return normalizeWhitespace(n.textContent ?? '');
      if (n.nodeType !== n.ELEMENT_NODE) return '';
      const child = n as Element;
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') return ' ';
      if (tag === 'script' || tag === 'style') return '';
      return collectInlineString(child);
    })
    .join('');

const renderInlineTokens = (node: Node, links: LinkRegistry): readonly Token[] => {
  if (node.nodeType === node.TEXT_NODE) {
    const text = normalizeWhitespace(node.textContent ?? '');
    return text
      .split(' ')
      .filter(Boolean)
      .map((w) => ({ kind: 'text-word', text: w }) as const);
  }
  if (node.nodeType !== node.ELEMENT_NODE) return [];

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === 'br') return [{ kind: 'hardbreak' }];
  if (tag === 'script' || tag === 'style') return [];
  if (tag === 'a') {
    const href = el.getAttribute('href') ?? '';
    const innerText = collectInlineString(el).trim();
    const refIndex = links.register(href);
    return [{ kind: 'link', text: innerText, refIndex }];
  }
  if (tag === 'input' || tag === 'textarea') {
    return [{ kind: 'text-word', text: '___' }];
  }
  if (tag === 'button') {
    const label = collectInlineString(el).trim();
    return [{ kind: 'text-word', text: `[Button: ${label}]` }];
  }
  // Container — descend
  return Array.from(el.childNodes).flatMap((c) => renderInlineTokens(c, links));
};

const collectInlineTokens = (el: Element, links: LinkRegistry): readonly Token[] =>
  Array.from(el.childNodes).flatMap((c) => renderInlineTokens(c, links));

const tokenWidth = (t: Token): number => {
  if (t.kind === 'text-word') return t.text.length;
  if (t.kind === 'link') return `[${t.refIndex}]${t.text}`.length;
  return 0;
};

const tokenToSegment = (t: Exclude<Token, { kind: 'hardbreak' }>): Segment =>
  t.kind === 'link'
    ? { kind: 'link', text: t.text, refIndex: t.refIndex }
    : { kind: 'text', text: t.text };

// Merges adjacent text segments to keep the segment list tidy.
const pushSegment = (line: readonly Segment[], seg: Segment): readonly Segment[] => {
  const last = line[line.length - 1];
  if (last && last.kind === 'text' && seg.kind === 'text') {
    return [...line.slice(0, -1), { kind: 'text', text: last.text + seg.text }];
  }
  return [...line, seg];
};

const wrapTokens = (tokens: readonly Token[], width: number): readonly SegmentLine[] => {
  const lines: SegmentLine[] = [];
  let current: readonly Segment[] = [];
  let currentWidth = 0;

  for (const tok of tokens) {
    if (tok.kind === 'hardbreak') {
      lines.push(current);
      current = [];
      currentWidth = 0;
      continue;
    }
    const w = tokenWidth(tok);
    const needsSpace = currentWidth > 0;
    const projected = currentWidth + (needsSpace ? 1 : 0) + w;
    if (projected <= width || currentWidth === 0) {
      if (needsSpace) {
        current = pushSegment(current, { kind: 'text', text: ' ' });
        currentWidth += 1;
      }
      current = pushSegment(current, tokenToSegment(tok));
      currentWidth += w;
    } else {
      lines.push(current);
      current = [tokenToSegment(tok)];
      currentWidth = w;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
};

const segmentLineToString = (line: SegmentLine): string =>
  line.map((s) => (s.kind === 'link' ? `[${s.refIndex}]${s.text}` : s.text)).join('');

const trimTrailingBlankSegmentLines = (lines: readonly SegmentLine[]): readonly SegmentLine[] => {
  let end = lines.length;
  while (end > 0 && segmentLineToString(lines[end - 1] ?? []) === '') end -= 1;
  return lines.slice(0, end);
};

const renderHeading = (
  el: Element,
  opts: RenderOpts,
  links: LinkRegistry,
): readonly SegmentLine[] => {
  const tokens = collectInlineTokens(el, links);
  if (tokens.length === 0) return [];
  const wrapped = wrapTokens(tokens, opts.width);
  const lastLine = wrapped[wrapped.length - 1] ?? [];
  const lastLineLen = segmentLineToString(lastLine).length;
  const level = Number.parseInt(el.tagName[1] ?? '6', 10);
  const underlineChar = level === 1 ? '=' : level === 2 ? '-' : '';
  if (!underlineChar) return [...wrapped, []];
  return [...wrapped, [{ kind: 'text', text: underlineChar.repeat(lastLineLen) }], []];
};

const renderParagraph = (
  el: Element,
  opts: RenderOpts,
  links: LinkRegistry,
): readonly SegmentLine[] => {
  const tokens = collectInlineTokens(el, links);
  if (tokens.length === 0) return [];
  return [...wrapTokens(tokens, opts.width), []];
};

const renderListItem = (
  li: Element,
  opts: RenderOpts,
  links: LinkRegistry,
  indent: number,
  bullet: string,
): readonly SegmentLine[] => {
  const blockChildren = Array.from(li.children).filter((c) =>
    ['ul', 'ol'].includes(c.tagName.toLowerCase()),
  );
  const blockSet = new Set<Node>(blockChildren);
  const inlineTokens = Array.from(li.childNodes)
    .filter((n) => !blockSet.has(n))
    .flatMap((n) => renderInlineTokens(n, links));

  const indentSpaces = ' '.repeat(indent * 2);
  const fullPrefix = `${indentSpaces}  ${bullet}`;
  const hangingIndent = ' '.repeat(fullPrefix.length);
  const wrapWidth = Math.max(opts.width - fullPrefix.length, 1);
  const wrapped = wrapTokens(inlineTokens, wrapWidth);

  const decoratedLines: SegmentLine[] = [];
  if (wrapped.length === 0) {
    decoratedLines.push([{ kind: 'text', text: fullPrefix.trimEnd() }]);
  } else {
    wrapped.forEach((line, i) => {
      const prefixSeg: Segment = { kind: 'text', text: i === 0 ? fullPrefix : hangingIndent };
      let merged: readonly Segment[] = [prefixSeg];
      for (const seg of line) merged = pushSegment(merged, seg);
      decoratedLines.push(merged);
    });
  }

  const nestedLines = blockChildren.flatMap((c) => renderNode(c, opts, links, indent + 1));
  return [...decoratedLines, ...nestedLines];
};

const renderList = (
  el: Element,
  opts: RenderOpts,
  links: LinkRegistry,
  indent: number,
  tag: 'ul' | 'ol',
): readonly SegmentLine[] => {
  const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li');
  return items.flatMap((li, i) => {
    const bullet = tag === 'ul' ? '* ' : `${i + 1}. `;
    return renderListItem(li, opts, links, indent, bullet);
  });
};

const collectCellText = (cell: Element, links: LinkRegistry): string => {
  // Tables don't wrap, so we collapse each cell to a single string. Any
  // anchors inside still get registered (the link list captures them) so
  // they show up in the References block.
  const tokens = collectInlineTokens(cell, links);
  return tokens
    .map((t) => {
      if (t.kind === 'text-word') return t.text;
      if (t.kind === 'link') return `[${t.refIndex}]${t.text}`;
      return '';
    })
    .filter(Boolean)
    .join(' ');
};

const collectRowCells = (tr: Element, links: LinkRegistry): readonly string[] =>
  Array.from(tr.children)
    .filter((c) => {
      const t = c.tagName.toLowerCase();
      return t === 'td' || t === 'th';
    })
    .map((c) => collectCellText(c as Element, links));

const renderTable = (el: Element, links: LinkRegistry): readonly SegmentLine[] => {
  const thead = Array.from(el.children).find((c) => c.tagName.toLowerCase() === 'thead');
  const tbody = Array.from(el.children).find((c) => c.tagName.toLowerCase() === 'tbody');

  const headerRow = thead
    ? (Array.from(thead.children)
        .filter((c) => c.tagName.toLowerCase() === 'tr')
        .map((tr) => collectRowCells(tr, links))[0] ?? null)
    : null;

  const bodySource = tbody ?? el;
  const bodyRows: readonly (readonly string[])[] = Array.from(bodySource.children)
    .filter((c) => c.tagName.toLowerCase() === 'tr')
    .map((tr) => collectRowCells(tr, links));

  const allRows = headerRow ? [headerRow, ...bodyRows] : bodyRows;
  if (allRows.length === 0) return [];

  const colCount = Math.max(...allRows.map((r) => r.length));
  const widths: number[] = new Array(colCount).fill(0);
  allRows.forEach((row) => {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  });

  const padRowText = (row: readonly string[]): string =>
    row
      .map((cell, i) => cell.padEnd(widths[i] ?? 0, ' '))
      .join('  ')
      .trimEnd();

  const rowsAsLines: SegmentLine[] = [];
  if (headerRow) {
    rowsAsLines.push([{ kind: 'text', text: padRowText(headerRow) }]);
    const totalWidth = widths.reduce((a, b) => a + b, 0) + Math.max(widths.length - 1, 0) * 2;
    rowsAsLines.push([{ kind: 'text', text: '-'.repeat(totalWidth) }]);
  }
  bodyRows.forEach((row) => rowsAsLines.push([{ kind: 'text', text: padRowText(row) }]));
  rowsAsLines.push([]);
  return rowsAsLines;
};

const renderNode = (
  node: Node,
  opts: RenderOpts,
  links: LinkRegistry,
  indent: number,
): readonly SegmentLine[] => {
  if (node.nodeType === node.TEXT_NODE) {
    const text = normalizeWhitespace(node.textContent ?? '').trim();
    if (!text) return [];
    const tokens = text
      .split(' ')
      .filter(Boolean)
      .map((w) => ({ kind: 'text-word', text: w }) as const);
    return wrapTokens(tokens, opts.width);
  }
  if (node.nodeType !== node.ELEMENT_NODE) return [];

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case 'script':
    case 'style':
    case 'head':
      return [];
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return renderHeading(el, opts, links);
    case 'p':
      return renderParagraph(el, opts, links);
    case 'ul':
    case 'ol':
      return renderList(el, opts, links, indent, tag);
    case 'table':
      return renderTable(el, links);
    case 'hr':
      return [[{ kind: 'text', text: '_'.repeat(opts.width) }]];
    case 'br':
      return [];
    case 'input':
    case 'textarea':
    case 'button': {
      const tokens = renderInlineTokens(el, links);
      if (tokens.length === 0) return [];
      return wrapTokens(tokens, opts.width);
    }
    case 'tr':
    case 'thead':
    case 'tbody':
    case 'td':
    case 'th':
    case 'li':
      return [];
    default:
      return Array.from(el.childNodes).flatMap((c) => renderNode(c, opts, links, indent));
  }
};

const buildReferencesBlock = (refs: readonly string[]): readonly SegmentLine[] => {
  if (refs.length === 0) return [];
  return [
    [],
    [{ kind: 'text', text: 'References' }],
    [],
    ...refs.map((url, i) => [{ kind: 'text', text: `   ${i + 1}. ${url}` }] as SegmentLine),
  ];
};

export const renderHtml = (rawHtml: string, opts: RenderOpts): RenderResult => {
  if (!rawHtml.trim()) return { lines: [], segments: [], references: [] };

  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  const links = createLinkRegistry();
  const bodySegmentLines = renderNode(doc.body, opts, links, 0);

  const trimmed = trimTrailingBlankSegmentLines(bodySegmentLines);
  const refs = links.list();
  const refLines = buildReferencesBlock(refs);
  const allSegments: readonly SegmentLine[] = [...trimmed, ...refLines];

  return {
    lines: allSegments.map(segmentLineToString),
    segments: allSegments,
    references: refs,
  };
};
