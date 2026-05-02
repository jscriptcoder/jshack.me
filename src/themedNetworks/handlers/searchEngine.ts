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

const errorResponse = (statusCode: number, statusText: string, body: string): HandlerResponse => ({
  statusCode,
  statusText,
  contentType: 'text/plain',
  body,
});

const indexUnavailable = (): HandlerResponse =>
  errorResponse(500, 'Internal Server Error', 'Search index unavailable.');

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

const formatEntry = (entry: IndexEntry, position: number): string =>
  `${position}. ${entry.title} — ${entry.domain}\n   ${entry.description}`;

const formatResults = (
  results: readonly { readonly entry: IndexEntry; readonly score: number }[],
  decodedQuery: string,
): string => {
  if (results.length === 0) return `No matches for "${decodedQuery}".`;
  return results.map(({ entry }, i) => formatEntry(entry, i + 1)).join('\n\n');
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
    contentType: 'text/plain',
    body: formatResults(scored, q),
  };
};
