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

const PUBLIC_PAGE_PATHS = [
  '/catalog.html',
  '/about.html',
  '/shipping.html',
  '/contact.html',
  '/faq.html',
] as const;

describe('TECHPARTS_PAGES manifest — public page set', () => {
  it.each(PUBLIC_PAGE_PATHS)('manifest exports a linked html page at %s', (path) => {
    const page = TECHPARTS_PAGES.find((p) => p.path === path);
    expect(page).toBeDefined();
    expect(page!.kind).toBe('html');
    expect(page!.visibility).toBe('linked');
    expect(page!.title.length).toBeGreaterThan(0);
    expect(page!.body.length).toBeGreaterThan(0);
  });

  it.each(PUBLIC_PAGE_PATHS)('landing page has an <a href> nav link to %s', (path) => {
    const landing = TECHPARTS_PAGES.find((p) => p.path === '/');
    expect(landing).toBeDefined();
    const doc = parseHtml(landing!.body);
    const hrefs = Array.from(doc.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(path);
  });

  it.each(PUBLIC_PAGE_PATHS)('public page %s has a back-to-home <a href="/"> link', (path) => {
    const page = TECHPARTS_PAGES.find((p) => p.path === path);
    const doc = parseHtml(page!.body);
    const hrefs = Array.from(doc.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/');
  });
});

const PRODUCT_PATHS = [
  '/products/xeon-e5-2680v4.html',
  '/products/ddr4-32gb-ecc.html',
  '/products/samsung-pm981-1tb.html',
  '/products/cisco-3850-12s.html',
  '/products/rigol-ds1054z.html',
  '/products/salvage-mb-aug2024.html',
] as const;

describe('TECHPARTS_PAGES manifest — product pages', () => {
  it.each(PRODUCT_PATHS)('manifest exports a linked html product page at %s', (path) => {
    const page = TECHPARTS_PAGES.find((p) => p.path === path);
    expect(page).toBeDefined();
    expect(page!.kind).toBe('html');
    expect(page!.visibility).toBe('linked');
    expect(page!.title.length).toBeGreaterThan(0);
    expect(page!.body.length).toBeGreaterThan(0);
  });

  it('product page titles are distinct', () => {
    const titles = PRODUCT_PATHS.map((path) => TECHPARTS_PAGES.find((p) => p.path === path)!.title);
    const unique = new Set(titles);
    expect(unique.size).toBe(titles.length);
  });

  it.each(PRODUCT_PATHS)('catalog page links to product %s', (path) => {
    const catalog = TECHPARTS_PAGES.find((p) => p.path === '/catalog.html');
    expect(catalog).toBeDefined();
    const doc = parseHtml(catalog!.body);
    const hrefs = Array.from(doc.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(path);
  });
});

const HIDDEN_HTML_PATHS = ['/admin', '/backup/', '/uploads/'] as const;

const HIDDEN_TEXT_PATHS = [
  '/robots.txt',
  '/staff-notes.txt',
  '/.env.bak',
  '/changelog.txt',
] as const;

const HIDDEN_PATHS = [...HIDDEN_HTML_PATHS, ...HIDDEN_TEXT_PATHS] as const;

describe('TECHPARTS_PAGES manifest — hidden / gobuster-only pages', () => {
  it.each(HIDDEN_HTML_PATHS)('manifest exports a hidden html page at %s', (path) => {
    const page = TECHPARTS_PAGES.find((p) => p.path === path);
    expect(page).toBeDefined();
    expect(page!.kind).toBe('html');
    expect(page!.visibility).toBe('hidden');
    expect(page!.body.length).toBeGreaterThan(0);
  });

  it.each(HIDDEN_TEXT_PATHS)('manifest exports a hidden text page at %s', (path) => {
    const page = TECHPARTS_PAGES.find((p) => p.path === path);
    expect(page).toBeDefined();
    expect(page!.kind).toBe('text');
    expect(page!.visibility).toBe('hidden');
    expect(page!.body.length).toBeGreaterThan(0);
  });

  it.each(HIDDEN_PATHS)(
    'no linked page references hidden path %s via <a href> (preserves gobuster-only quality)',
    (path) => {
      const violators = LINKED_PAGES.filter((p) => p.kind === 'html').flatMap((page) => {
        const doc = parseHtml(page.body);
        const hrefs = Array.from(doc.querySelectorAll('a[href]')).map(
          (a) => a.getAttribute('href') ?? '',
        );
        return hrefs.includes(path) ? [page.path] : [];
      });
      expect(violators).toEqual([]);
    },
  );

  it('robots.txt body contains Disallow directives naming at least 3 other hidden paths', () => {
    const robots = TECHPARTS_PAGES.find((p) => p.path === '/robots.txt');
    expect(robots).toBeDefined();
    expect(robots!.kind).toBe('text');
    const namedHiddenPaths = HIDDEN_PATHS.filter(
      (h) => h !== '/robots.txt' && robots!.body.includes(`Disallow: ${h}`),
    );
    expect(namedHiddenPaths.length).toBeGreaterThanOrEqual(3);
  });
});
