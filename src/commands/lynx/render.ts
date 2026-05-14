// Pure HTML→terminal renderer. Walks the DOM produced by DOMParser and
// emits a sequence of plain-text lines plus an accumulated References
// list. Used by the lynx terminal browser overlay; no fetch, no I/O,
// same input → same output.

export type RenderOpts = {
  readonly width: number;
};

export type RenderResult = {
  readonly lines: readonly string[];
  readonly references: readonly string[];
};

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

// Collapses any run of whitespace — including the non-breaking space
// U+00A0 that DOMParser produces from &nbsp; — into a single ASCII
// space. The explicit \xA0 makes the intent obvious and is bulletproof
// against any regex-engine variance in what \s covers.
const normalizeWhitespace = (text: string): string => text.replace(/[\s\xA0]+/g, ' ');

const wrap = (text: string, width: number): readonly string[] => {
  const words = text.split(/[\s\xA0]+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
};

// Splits on hard newlines (from <br>) first, then word-wraps each segment.
const wrapWithBreaks = (text: string, width: number): readonly string[] =>
  text.split('\n').flatMap((segment) => wrap(segment, width));

const trimTrailingBlanks = (lines: readonly string[]): readonly string[] => {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === '') end -= 1;
  return lines.slice(0, end);
};

// Renders a node as inline text — used inside paragraphs, headings,
// list items, and table cells. Returns a single string that may
// contain spaces and hard '\n' breaks (from <br>). The wrap step
// later turns this into a sequence of width-bounded lines.
const renderInline = (node: Node, links: LinkRegistry): string => {
  if (node.nodeType === node.TEXT_NODE) {
    return normalizeWhitespace(node.textContent ?? '');
  }
  if (node.nodeType !== node.ELEMENT_NODE) return '';

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === 'br') return '\n';
  if (tag === 'script' || tag === 'style') return '';
  if (tag === 'a') {
    const href = el.getAttribute('href') ?? '';
    const inner = renderChildrenInline(el, links).replace(/^[\s\xA0]+/, '');
    const n = links.register(href);
    return `[${n}]${inner}`;
  }
  if (tag === 'input' || tag === 'textarea') return ' ___ ';
  if (tag === 'button') {
    return ` [Button: ${renderChildrenInline(el, links).trim()}] `;
  }
  return renderChildrenInline(el, links);
};

const renderChildrenInline = (el: Element, links: LinkRegistry): string =>
  Array.from(el.childNodes)
    .map((c) => renderInline(c, links))
    .join('');

const renderHeading = (el: Element, opts: RenderOpts, links: LinkRegistry): readonly string[] => {
  const text = renderChildrenInline(el, links).trim();
  if (!text) return [];
  const level = Number.parseInt(el.tagName[1] ?? '6', 10);
  const wrapped = wrap(text, opts.width);
  const lastLineLen = wrapped[wrapped.length - 1]?.length ?? text.length;
  const underlineChar = level === 1 ? '=' : level === 2 ? '-' : '';
  if (!underlineChar) return [...wrapped, ''];
  return [...wrapped, underlineChar.repeat(lastLineLen), ''];
};

const renderParagraph = (el: Element, opts: RenderOpts, links: LinkRegistry): readonly string[] => {
  const text = renderChildrenInline(el, links).trim();
  if (!text) return [];
  return [...wrapWithBreaks(text, opts.width), ''];
};

const renderListItem = (
  li: Element,
  opts: RenderOpts,
  links: LinkRegistry,
  indent: number,
  bullet: string,
): readonly string[] => {
  const blockChildren = Array.from(li.children).filter((c) =>
    ['ul', 'ol'].includes(c.tagName.toLowerCase()),
  );
  const blockSet = new Set<Node>(blockChildren);
  const inlineText = Array.from(li.childNodes)
    .filter((n) => !blockSet.has(n))
    .map((n) => renderInline(n, links))
    .join('')
    .trim();

  const indentSpaces = ' '.repeat(indent * 2);
  const fullPrefix = `${indentSpaces}  ${bullet}`;
  const hangingIndent = ' '.repeat(fullPrefix.length);
  const wrapWidth = Math.max(opts.width - fullPrefix.length, 1);
  const wrapped = wrap(inlineText, wrapWidth);
  const itemLines =
    wrapped.length === 0
      ? [fullPrefix.trimEnd()]
      : [fullPrefix + wrapped[0], ...wrapped.slice(1).map((w) => hangingIndent + w)];

  const nestedLines = blockChildren.flatMap((c) => renderNode(c, opts, links, indent + 1));
  return [...itemLines, ...nestedLines];
};

const renderList = (
  el: Element,
  opts: RenderOpts,
  links: LinkRegistry,
  indent: number,
  tag: 'ul' | 'ol',
): readonly string[] => {
  const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li');
  return items.flatMap((li, i) => {
    const bullet = tag === 'ul' ? '* ' : `${i + 1}. `;
    return renderListItem(li, opts, links, indent, bullet);
  });
};

const collectRowCells = (tr: Element, links: LinkRegistry): readonly string[] =>
  Array.from(tr.children)
    .filter((c) => {
      const t = c.tagName.toLowerCase();
      return t === 'td' || t === 'th';
    })
    .map((c) => renderChildrenInline(c, links).trim());

const renderTable = (el: Element, links: LinkRegistry): readonly string[] => {
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

  const padRow = (row: readonly string[]): string =>
    row
      .map((cell, i) => cell.padEnd(widths[i] ?? 0, ' '))
      .join('  ')
      .trimEnd();

  const lines: string[] = [];
  if (headerRow) {
    lines.push(padRow(headerRow));
    const totalWidth = widths.reduce((a, b) => a + b, 0) + Math.max(widths.length - 1, 0) * 2;
    lines.push('-'.repeat(totalWidth));
  }
  bodyRows.forEach((row) => lines.push(padRow(row)));
  lines.push('');
  return lines;
};

const renderInlineAsBlock = (
  el: Element,
  opts: RenderOpts,
  links: LinkRegistry,
): readonly string[] => {
  const text = renderInline(el, links).trim();
  if (!text) return [];
  return wrapWithBreaks(text, opts.width);
};

const renderNode = (
  node: Node,
  opts: RenderOpts,
  links: LinkRegistry,
  indent: number,
): readonly string[] => {
  if (node.nodeType === node.TEXT_NODE) {
    const text = normalizeWhitespace(node.textContent ?? '').trim();
    if (!text) return [];
    return wrapWithBreaks(text, opts.width);
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
      return ['_'.repeat(opts.width)];
    case 'br':
      return [];
    case 'input':
    case 'textarea':
    case 'button':
      return renderInlineAsBlock(el, opts, links);
    case 'tr':
    case 'thead':
    case 'tbody':
    case 'td':
    case 'th':
    case 'li':
      // Outside their parent block these have no meaning — drop them.
      return [];
    default:
      return Array.from(el.childNodes).flatMap((c) => renderNode(c, opts, links, indent));
  }
};

const buildReferencesBlock = (refs: readonly string[]): readonly string[] => {
  if (refs.length === 0) return [];
  return ['', 'References', '', ...refs.map((url, i) => `   ${i + 1}. ${url}`)];
};

export const renderHtml = (rawHtml: string, opts: RenderOpts): RenderResult => {
  if (!rawHtml.trim()) return { lines: [], references: [] };

  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  const links = createLinkRegistry();
  const bodyLines = renderNode(doc.body, opts, links, 0);

  const trimmed = trimTrailingBlanks(bodyLines);
  const refs = links.list();
  const refLines = buildReferencesBlock(refs);

  return {
    lines: [...trimmed, ...refLines],
    references: refs,
  };
};
