import { describe, it, expect } from 'vitest';
import { searchEngineHandler, INDEX_PATH } from './searchEngine';
import type { MachineFsAccess, RequestArgs } from '../types';

// --- Factories ---

const buildFs = (files: Readonly<Record<string, string>> = {}): MachineFsAccess => ({
  readFile: (path: string) => files[path] ?? null,
});

const buildRequest = (overrides: Partial<RequestArgs> = {}): RequestArgs => ({
  method: 'GET',
  path: '/',
  query: '',
  ...overrides,
});

const indexJson = (entries: ReadonlyArray<unknown>): string => JSON.stringify(entries);

// Standard well-shaped index entry — tests can spread + override fields.
const sampleIndex = indexJson([
  {
    domain: 'techparts.io',
    title: 'Tech Parts Store',
    description: 'Quality computer components and peripherals.',
    keywords: ['gpu', 'cpu', 'graphic card'],
  },
  {
    domain: 'rgbglow.shop',
    title: 'RGB Glow',
    description: 'LED strips, cooling fans, gaming accessories.',
    keywords: ['rgb', 'lighting'],
  },
]);

// --- Fall-through cases (handler returns null) ---

describe('searchEngineHandler — fall-through to static', () => {
  it('returns null for non-GET methods', () => {
    const result = searchEngineHandler(
      buildRequest({ method: 'POST', query: 'q=foo' }),
      buildFs({ [INDEX_PATH]: sampleIndex }),
    );
    expect(result).toBeNull();
  });

  it('returns null for non-root paths even with q', () => {
    const result = searchEngineHandler(
      buildRequest({ path: '/about', query: 'q=foo' }),
      buildFs({ [INDEX_PATH]: sampleIndex }),
    );
    expect(result).toBeNull();
  });

  it('returns null when query has no q parameter', () => {
    const result = searchEngineHandler(
      buildRequest({ query: 'page=2' }),
      buildFs({ [INDEX_PATH]: sampleIndex }),
    );
    expect(result).toBeNull();
  });

  it('returns null when q is empty string', () => {
    const result = searchEngineHandler(
      buildRequest({ query: 'q=' }),
      buildFs({ [INDEX_PATH]: sampleIndex }),
    );
    expect(result).toBeNull();
  });

  it('returns null when q is whitespace only', () => {
    const result = searchEngineHandler(
      buildRequest({ query: 'q=%20%20%20' }),
      buildFs({ [INDEX_PATH]: sampleIndex }),
    );
    expect(result).toBeNull();
  });

  it('returns null with empty query string', () => {
    const result = searchEngineHandler(
      buildRequest({ query: '' }),
      buildFs({ [INDEX_PATH]: sampleIndex }),
    );
    expect(result).toBeNull();
  });
});

// --- Error cases (500) ---

describe('searchEngineHandler — error handling', () => {
  it('returns 500 when index file is missing', () => {
    const result = searchEngineHandler(buildRequest({ query: 'q=foo' }), buildFs({}));
    expect(result?.statusCode).toBe(500);
    expect(result?.contentType).toBe('text/plain');
  });

  it('returns 500 when index JSON is malformed', () => {
    const result = searchEngineHandler(
      buildRequest({ query: 'q=foo' }),
      buildFs({ [INDEX_PATH]: '{not valid json' }),
    );
    expect(result?.statusCode).toBe(500);
  });

  it('returns 500 when index fails schema validation', () => {
    const bogusIndex = indexJson([{ domain: 'foo' }]); // missing title/description
    const result = searchEngineHandler(
      buildRequest({ query: 'q=foo' }),
      buildFs({ [INDEX_PATH]: bogusIndex }),
    );
    expect(result?.statusCode).toBe(500);
  });

  it('returns 500 when index is not an array', () => {
    const result = searchEngineHandler(
      buildRequest({ query: 'q=foo' }),
      buildFs({ [INDEX_PATH]: '{"not": "an array"}' }),
    );
    expect(result?.statusCode).toBe(500);
  });
});

// --- Match scoring & ranking ---

describe('searchEngineHandler — search results', () => {
  it('returns 200 with matching entry in body', () => {
    const result = searchEngineHandler(
      buildRequest({ query: 'q=gpu' }),
      buildFs({ [INDEX_PATH]: sampleIndex }),
    );
    expect(result?.statusCode).toBe(200);
    expect(result?.contentType).toBe('text/plain');
    expect(result?.body).toContain('Tech Parts Store');
    expect(result?.body).toContain('techparts.io');
  });

  it('formats results with title, domain, and description', () => {
    const result = searchEngineHandler(
      buildRequest({ query: 'q=gpu' }),
      buildFs({ [INDEX_PATH]: sampleIndex }),
    );
    expect(result?.body).toContain('1. Tech Parts Store — techparts.io');
    expect(result?.body).toContain('Quality computer components and peripherals.');
  });

  it('returns "no matches" body when no entry scores', () => {
    const result = searchEngineHandler(
      buildRequest({ query: 'q=zzznothingmatches' }),
      buildFs({ [INDEX_PATH]: sampleIndex }),
    );
    expect(result?.statusCode).toBe(200);
    expect(result?.body).toContain('No matches');
    expect(result?.body).toContain('zzznothingmatches');
  });

  it('decodes URL-encoded characters in q', () => {
    const result = searchEngineHandler(
      buildRequest({ query: 'q=graphic%20card' }),
      buildFs({ [INDEX_PATH]: sampleIndex }),
    );
    expect(result?.body).toContain('Tech Parts Store');
  });

  it('treats + in q as space', () => {
    const result = searchEngineHandler(
      buildRequest({ query: 'q=graphic+card' }),
      buildFs({ [INDEX_PATH]: sampleIndex }),
    );
    expect(result?.body).toContain('Tech Parts Store');
  });

  it('matches case-insensitively', () => {
    const result = searchEngineHandler(
      buildRequest({ query: 'q=GPU' }),
      buildFs({ [INDEX_PATH]: sampleIndex }),
    );
    expect(result?.body).toContain('Tech Parts Store');
  });

  it('sorts higher-scoring entries first (keyword > title > description)', () => {
    // Both entries match "gaming" — but only the first via description,
    // the second via keyword (higher weight).
    const idx = indexJson([
      {
        domain: 'a.io',
        title: 'A Site',
        description: 'gaming gear at low prices',
        keywords: [],
      },
      {
        domain: 'b.io',
        title: 'B Site',
        description: 'unrelated',
        keywords: ['gaming'],
      },
    ]);
    const result = searchEngineHandler(
      buildRequest({ query: 'q=gaming' }),
      buildFs({ [INDEX_PATH]: idx }),
    );
    const aIdx = result?.body.indexOf('a.io') ?? -1;
    const bIdx = result?.body.indexOf('b.io') ?? -1;
    expect(bIdx).toBeGreaterThan(-1);
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeLessThan(aIdx); // b appears first (higher score)
  });

  it('scores per term — multi-term queries accumulate', () => {
    // "graphic card" = 2 terms. Entry with keyword 'graphic card' has
    // both terms as substrings → high score; entry matching only one
    // term scores lower.
    const idx = indexJson([
      {
        domain: 'partial.io',
        title: 'Partial',
        description: 'card games and trinkets',
        keywords: [],
      },
      {
        domain: 'full.io',
        title: 'Full Match',
        description: 'irrelevant',
        keywords: ['graphic card'],
      },
    ]);
    const result = searchEngineHandler(
      buildRequest({ query: 'q=graphic+card' }),
      buildFs({ [INDEX_PATH]: idx }),
    );
    const fullIdx = result?.body.indexOf('full.io') ?? -1;
    const partialIdx = result?.body.indexOf('partial.io') ?? -1;
    expect(fullIdx).toBeGreaterThan(-1);
    expect(partialIdx).toBeGreaterThan(-1);
    expect(fullIdx).toBeLessThan(partialIdx);
  });

  it('limits results to top 10', () => {
    // Build 15 entries that all match the query
    const entries = Array.from({ length: 15 }, (_, i) => ({
      domain: `site${i}.io`,
      title: `Site ${i}`,
      description: `description with foo`,
      keywords: ['foo'],
    }));
    const result = searchEngineHandler(
      buildRequest({ query: 'q=foo' }),
      buildFs({ [INDEX_PATH]: indexJson(entries) }),
    );
    // Count numbered list entries — should be exactly 10.
    const matches = result?.body.match(/^\d+\./gm) ?? [];
    expect(matches.length).toBe(10);
  });

  it('excludes entries that score zero', () => {
    const idx = indexJson([
      {
        domain: 'match.io',
        title: 'Match',
        description: 'has foo',
        keywords: [],
      },
      {
        domain: 'nomatch.io',
        title: 'Other',
        description: 'unrelated content',
        keywords: [],
      },
    ]);
    const result = searchEngineHandler(
      buildRequest({ query: 'q=foo' }),
      buildFs({ [INDEX_PATH]: idx }),
    );
    expect(result?.body).toContain('match.io');
    expect(result?.body).not.toContain('nomatch.io');
  });

  it('handles empty index (no entries) → no matches', () => {
    const result = searchEngineHandler(
      buildRequest({ query: 'q=foo' }),
      buildFs({ [INDEX_PATH]: indexJson([]) }),
    );
    expect(result?.statusCode).toBe(200);
    expect(result?.body).toContain('No matches');
  });
});
