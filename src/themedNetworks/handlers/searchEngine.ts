import { z } from 'zod';
import type { HandlerResponse, RequestHandler } from '../types';

// Path on findit.io's filesystem where the search index lives.
// Snapshotted from world_networks.search_metadata at seed time. Exported
// so tests + the seed generator stay in sync on the file location.
export const INDEX_PATH = '/etc/findit/index.json';

const MAX_RESULTS = 10;

// Match weights — keywords (explicit tags) > title > description.
const SCORE_KEYWORD = 3;
const SCORE_TITLE = 2;
const SCORE_DESCRIPTION = 1;

const IndexEntrySchema = z.object({
  domain: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  keywords: z.array(z.string()),
});

const IndexSchema = z.array(IndexEntrySchema);

type IndexEntry = z.infer<typeof IndexEntrySchema>;

// HTML escape — defends against an attacker-controlled query (or
// search_metadata) injecting markup that breaks the page or smuggles
// content into other entries. Cheap; better to escape everywhere we
// interpolate user-or-data-supplied strings into HTML.
const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Standard envelope for every response findit.io's handler emits —
// search results, no-results, and errors. Re-renders the search form
// at the top so players can refine queries by reading the markup.
const wrapHtml = (title: string, body: string, queryValue: string = ''): string =>
  `<!DOCTYPE html>
<html>
  <head><title>${escapeHtml(title)}</title></head>
  <body>
    <h1>findit.io</h1>
    <form action="/" method="GET">
      <input type="text" name="q" value="${escapeHtml(queryValue)}" placeholder="Search the public web">
      <button type="submit">Search</button>
    </form>
    <hr>
${body}
  </body>
</html>
`;

const errorResponse = (
  statusCode: number,
  statusText: string,
  bodyHtml: string,
): HandlerResponse => ({
  statusCode,
  statusText,
  contentType: 'text/html',
  body: wrapHtml(`${statusCode} ${statusText}`, bodyHtml),
});

const indexUnavailable = (): HandlerResponse =>
  errorResponse(
    500,
    'Internal Server Error',
    '    <p><strong>Search index unavailable.</strong></p>',
  );

// Splits a decoded query string on whitespace, lowercases, drops
// empties. URLSearchParams already decoded `+` → space and `%XX` →
// char, so a plain whitespace split is sufficient here.
const splitTerms = (decodedQuery: string): readonly string[] =>
  decodedQuery
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);

// Score one entry against a list of query terms. Each term contributes
// independently — keyword (3) + title (2) + description (1) — and
// scores accumulate across terms.
const scoreEntry = (entry: IndexEntry, terms: readonly string[]): number => {
  const title = entry.title.toLowerCase();
  const description = entry.description.toLowerCase();
  const keywords = entry.keywords.map((k) => k.toLowerCase());
  return terms.reduce((acc, term) => {
    let s = 0;
    if (keywords.some((k) => k.includes(term))) s += SCORE_KEYWORD;
    if (title.includes(term)) s += SCORE_TITLE;
    if (description.includes(term)) s += SCORE_DESCRIPTION;
    return acc + s;
  }, 0);
};

// Each result is a self-contained list item with a clickable link
// (pointless in a terminal but read by `gobuster`-style recon as a
// recognizable href) plus the domain on its own line and the blurb.
const formatEntry = (entry: IndexEntry): string =>
  `      <li>
        <h2><a href="http://${escapeHtml(entry.domain)}/">${escapeHtml(entry.title)}</a></h2>
        <p class="domain">${escapeHtml(entry.domain)}</p>
        <p class="description">${escapeHtml(entry.description)}</p>
      </li>`;

const formatResults = (
  results: readonly { readonly entry: IndexEntry; readonly score: number }[],
  decodedQuery: string,
): string => {
  if (results.length === 0) {
    return `    <p>No matches for &quot;${escapeHtml(decodedQuery)}&quot;.</p>`;
  }
  const items = results.map(({ entry }) => formatEntry(entry)).join('\n');
  return `    <ol>\n${items}\n    </ol>`;
};

export const searchEngineHandler: RequestHandler = (args, fs) => {
  // Only handle root-path GET requests with a q param. Everything else
  // falls through to the static-file pipeline.
  if (args.method !== 'GET') return null;
  if (args.path !== '/') return null;

  const params = new URLSearchParams(args.query);
  const rawQ = params.get('q');
  const q = rawQ?.trim() ?? '';
  if (q.length === 0) return null;

  const raw = fs.readFile(INDEX_PATH);
  if (raw === null) return indexUnavailable();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return indexUnavailable();
  }

  const result = IndexSchema.safeParse(parsed);
  if (!result.success) return indexUnavailable();

  const terms = splitTerms(q);
  const scored = result.data
    .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);

  return {
    statusCode: 200,
    statusText: 'OK',
    contentType: 'text/html',
    body: wrapHtml(`findit.io — results for "${q}"`, formatResults(scored, q), q),
  };
};
