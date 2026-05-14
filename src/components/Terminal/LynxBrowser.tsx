import { useState, useEffect, useRef, useCallback } from 'react';
import type { HttpResponse } from '../../network/http';
import { renderHtml, type RenderResult, type Segment } from '../../commands/lynx/render';

type LynxBrowserProps = {
  readonly initialUrl: string;
  readonly onFetch: (url: string) => Promise<HttpResponse>;
  readonly onClose: () => void;
};

type HistoryEntry = {
  readonly url: string;
  readonly response: HttpResponse;
  readonly rendered: RenderResult;
  readonly title: string;
};

// Lynx defaults to 80 columns. The container could be measured at mount
// to derive a runtime column count, but the renderer's word-wrap is
// width-tolerant — short content fits any width, long content wraps
// regardless. Keeping a stable constant simplifies tests and avoids a
// measurement pass that jsdom can't reliably perform.
const COLS = 80;

const isHtmlContentType = (response: HttpResponse): boolean =>
  response.headers.some(
    ([k, v]) => k.toLowerCase() === 'content-type' && v.toLowerCase().includes('text/html'),
  );

const renderResponse = (response: HttpResponse): RenderResult => {
  if (isHtmlContentType(response)) return renderHtml(response.body, { width: COLS });
  // Non-HTML body: each source line becomes a single text segment.
  const lines = response.body.split('\n');
  const segments = lines.map((l): readonly Segment[] => [{ kind: 'text', text: l }]);
  return { lines, segments, references: [] };
};

// Real lynx puts the page <title> in its title bar. Our block renderer
// drops <head>, so we extract the title from the raw HTML separately.
// Returns '' for non-HTML bodies or pages without a <title>.
const extractPageTitle = (response: HttpResponse): string => {
  if (!isHtmlContentType(response)) return '';
  const match = response.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim().replace(/\s+/g, ' ') : '';
};

const resolveUrl = (href: string, baseUrl: string): string => {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
};

export const LynxBrowser = ({ initialUrl, onFetch, onClose }: LynxBrowserProps) => {
  const [history, setHistory] = useState<readonly HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(`Getting ${initialUrl}...`);
  const [selectedLink, setSelectedLink] = useState(0);
  const linkRefs = useRef<Map<number, HTMLElement | null>>(new Map());

  const current = history[history.length - 1];

  const fetchUrl = useCallback(
    async (url: string) => {
      setLoading(true);
      setStatus(`Getting ${url}...`);
      try {
        const response = await onFetch(url);
        const rendered = renderResponse(response);
        const title = extractPageTitle(response);
        setHistory((prev) => [...prev, { url, response, rendered, title }]);
        setSelectedLink(0);
        setStatus(`HTTP/1.1 ${response.statusCode} ${response.statusText}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        setStatus(`Alert!: ${msg}`);
      } finally {
        setLoading(false);
      }
    },
    [onFetch],
  );

  // Initial fetch on mount — runs once.
  useEffect(() => {
    void fetchUrl(initialUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (loading) return;
      const links = current?.rendered.references ?? [];
      if (e.key === 'q' || e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedLink((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedLink((i) => Math.min(Math.max(links.length - 1, 0), i + 1));
        return;
      }
      if (e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        const href = links[selectedLink];
        if (href && current) {
          void fetchUrl(resolveUrl(href, current.url));
        }
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
        e.preventDefault();
        if (history.length > 1) {
          setHistory((prev) => prev.slice(0, -1));
          setSelectedLink(0);
        }
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [loading, selectedLink, history, current, fetchUrl, onClose]);

  // Auto-scroll the selected link into view whenever it changes.
  // jsdom doesn't implement scrollIntoView, so we guard the call. In the
  // real browser this is a no-op when the element is already visible.
  useEffect(() => {
    const el = linkRefs.current.get(selectedLink);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedLink, history]);

  const title = current?.title ?? '';
  const url = current?.url ?? initialUrl;

  return (
    <div
      data-testid="lynx-browser"
      className="fixed inset-0 z-50 flex flex-col font-mono text-sm"
      style={{ backgroundColor: 'var(--theme-bg)' }}
    >
      <div
        data-testid="lynx-title"
        className="px-4 py-0.5 flex items-center gap-4 text-xs"
        style={{ backgroundColor: 'var(--theme-accent)', color: 'var(--theme-accent-text)' }}
      >
        <span className="font-bold">{title}</span>
        <span>{url}</span>
      </div>

      <div
        data-testid="lynx-body"
        className="flex-1 overflow-auto p-2 whitespace-pre"
        style={{ color: 'var(--theme-text-bright)' }}
      >
        {current?.rendered.segments.map((segLine, lineIdx) => (
          <div key={lineIdx}>
            {segLine.length === 0
              ? ' '
              : segLine.map((seg, segIdx) =>
                  seg.kind === 'link' ? (
                    <span
                      key={segIdx}
                      data-link-index={seg.refIndex - 1}
                      data-selected={seg.refIndex - 1 === selectedLink}
                      ref={(el) => {
                        linkRefs.current.set(seg.refIndex - 1, el);
                      }}
                      style={
                        seg.refIndex - 1 === selectedLink
                          ? {
                              backgroundColor: 'var(--theme-accent)',
                              color: 'var(--theme-accent-text)',
                            }
                          : undefined
                      }
                    >
                      {`[${seg.refIndex}]${seg.text}`}
                    </span>
                  ) : (
                    <span key={segIdx}>{seg.text}</span>
                  ),
                )}
          </div>
        ))}
      </div>

      <div
        data-testid="lynx-status"
        className="px-4 py-0.5 text-xs"
        style={{ color: 'var(--theme-text-dim)' }}
      >
        {status}
      </div>

      <div
        className="px-4 py-0.5 text-xs flex gap-6"
        style={{ backgroundColor: 'var(--theme-border)', color: 'var(--theme-text-dim)' }}
      >
        <span>↑↓ Links</span>
        <span>↵ Follow</span>
        <span>← Back</span>
        <span>q Quit</span>
      </div>
    </div>
  );
};
