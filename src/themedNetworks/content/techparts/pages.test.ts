import { describe, it, expect } from 'vitest';
import { TECHPARTS_PAGES, LINKED_PAGES, HIDDEN_PAGES, type TechpartsPage } from './pages';

const parseHtml = (markup: string): Document =>
  new DOMParser().parseFromString(markup, 'text/html');

const htmlPages = (): readonly TechpartsPage[] => TECHPARTS_PAGES.filter((p) => p.kind === 'html');

const htmlPagesAsCases = (): ReadonlyArray<readonly [string, string]> =>
  htmlPages().map((p) => [p.path, p.body] as const);

describe('TECHPARTS_PAGES manifest — path invariants', () => {
  it('every page path starts with /', () => {
    const violators = TECHPARTS_PAGES.filter((p) => !p.path.startsWith('/')).map((p) => p.path);
    expect(violators).toEqual([]);
  });

  it('every page path is unique across the manifest', () => {
    const paths = TECHPARTS_PAGES.map((p) => p.path);
    const duplicates = paths.filter((p, i) => paths.indexOf(p) !== i);
    expect(duplicates).toEqual([]);
  });
});

describe('TECHPARTS_PAGES manifest — HTML page well-formedness', () => {
  it.each(htmlPagesAsCases())('html page %s has a non-empty <body>', (_path, body) => {
    const doc = parseHtml(body);
    expect(doc.body.children.length).toBeGreaterThan(0);
  });

  it.each(htmlPagesAsCases())('html page %s has a <title> element', (_path, body) => {
    const doc = parseHtml(body);
    const title = doc.querySelector('title');
    expect(title).not.toBeNull();
    expect(title?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it.each(htmlPages().map((p) => [p.path, p.title, p.body] as const))(
    'html page %s exposes its manifest title %s inside the <title> element',
    (_path, manifestTitle, body) => {
      const doc = parseHtml(body);
      expect(doc.querySelector('title')?.textContent).toBe(manifestTitle);
    },
  );
});

describe('TECHPARTS_PAGES manifest — terminal-browser forbidden tags/attrs', () => {
  it.each(htmlPagesAsCases())('html page %s has no <script> elements', (_path, body) => {
    const doc = parseHtml(body);
    expect(doc.querySelectorAll('script')).toHaveLength(0);
  });

  it.each(htmlPagesAsCases())('html page %s has no <style> elements', (_path, body) => {
    const doc = parseHtml(body);
    expect(doc.querySelectorAll('style')).toHaveLength(0);
  });

  it.each(htmlPagesAsCases())('html page %s has no [class] attributes', (_path, body) => {
    const doc = parseHtml(body);
    expect(doc.querySelectorAll('[class]')).toHaveLength(0);
  });

  it.each(htmlPagesAsCases())('html page %s has no [id] attributes', (_path, body) => {
    const doc = parseHtml(body);
    expect(doc.querySelectorAll('[id]')).toHaveLength(0);
  });
});

describe('TECHPARTS_PAGES manifest — link integrity', () => {
  const extractInternalHrefs = (html: string): readonly string[] => {
    const doc = parseHtml(html);
    const anchors = Array.from(doc.querySelectorAll('a[href]'));
    return anchors.map((a) => a.getAttribute('href') ?? '').filter((href) => href.startsWith('/'));
  };

  it('every internal <a href="/..."> on html pages points to a path that exists in the manifest', () => {
    const knownPaths = new Set(TECHPARTS_PAGES.map((p) => p.path));
    const orphanedLinks = htmlPages().flatMap((p) =>
      extractInternalHrefs(p.body)
        .filter((href) => !knownPaths.has(href))
        .map((href) => `${p.path} -> ${href}`),
    );
    expect(orphanedLinks).toEqual([]);
  });
});

describe('TECHPARTS_PAGES manifest — projections', () => {
  it('exports a / landing page with kind: html and visibility: linked', () => {
    const landing = TECHPARTS_PAGES.find((p) => p.path === '/');
    expect(landing).toBeDefined();
    expect(landing?.kind).toBe('html');
    expect(landing?.visibility).toBe('linked');
  });

  it('LINKED_PAGES equals exactly the visibility=linked subset of TECHPARTS_PAGES', () => {
    expect(LINKED_PAGES).toEqual(TECHPARTS_PAGES.filter((p) => p.visibility === 'linked'));
  });

  it('HIDDEN_PAGES equals exactly the visibility=hidden subset of TECHPARTS_PAGES', () => {
    expect(HIDDEN_PAGES).toEqual(TECHPARTS_PAGES.filter((p) => p.visibility === 'hidden'));
  });

  it('LINKED_PAGES and HIDDEN_PAGES partition TECHPARTS_PAGES (no overlap, full coverage)', () => {
    expect(LINKED_PAGES.length + HIDDEN_PAGES.length).toBe(TECHPARTS_PAGES.length);
  });
});
