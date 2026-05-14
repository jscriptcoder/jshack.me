import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LynxBrowser } from './LynxBrowser';
import type { HttpResponse } from '../../network/http';

// --- Factory Functions ---

const mockHtmlResponse = (body: string, statusCode = 200, statusText = 'OK'): HttpResponse => ({
  statusCode,
  statusText,
  headers: [['Content-Type', 'text/html; charset=UTF-8']],
  body,
});

const mockTextResponse = (body: string): HttpResponse => ({
  statusCode: 200,
  statusText: 'OK',
  headers: [['Content-Type', 'text/plain']],
  body,
});

const createProps = (overrides?: {
  readonly initialUrl?: string;
  readonly onFetch?: (url: string) => Promise<HttpResponse>;
  readonly onClose?: () => void;
}) => ({
  initialUrl: overrides?.initialUrl ?? 'http://example.com/',
  onFetch: overrides?.onFetch ?? vi.fn().mockResolvedValue(mockHtmlResponse('<p>default</p>')),
  onClose: overrides?.onClose ?? vi.fn(),
});

describe('LynxBrowser', () => {
  describe('initial fetch', () => {
    it('shows "Getting <url>..." in the status bar while fetching', () => {
      const onFetch = vi.fn(() => new Promise<HttpResponse>(() => undefined));
      render(<LynxBrowser {...createProps({ onFetch, initialUrl: 'http://x.io/' })} />);
      expect(screen.getByTestId('lynx-status')).toHaveTextContent('Getting http://x.io/');
    });

    it('renders the page body after the fetch resolves', async () => {
      const onFetch = vi.fn().mockResolvedValue(mockHtmlResponse('<h1>Hello</h1><p>world</p>'));
      render(<LynxBrowser {...createProps({ onFetch })} />);
      await waitFor(() => expect(screen.getByTestId('lynx-body')).toHaveTextContent('Hello'));
      expect(screen.getByTestId('lynx-body')).toHaveTextContent('world');
    });

    it('updates the status bar to "HTTP/1.1 <code> <text>" after success', async () => {
      const onFetch = vi.fn().mockResolvedValue(mockHtmlResponse('<p>x</p>', 200, 'OK'));
      render(<LynxBrowser {...createProps({ onFetch })} />);
      await waitFor(() =>
        expect(screen.getByTestId('lynx-status')).toHaveTextContent('HTTP/1.1 200 OK'),
      );
    });

    it('surfaces a lynx-style alert on fetch rejection without crashing', async () => {
      const onFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
      render(<LynxBrowser {...createProps({ onFetch })} />);
      await waitFor(() =>
        expect(screen.getByTestId('lynx-status')).toHaveTextContent('Alert!: Connection refused'),
      );
    });
  });

  describe('link selection', () => {
    it('highlights the first link by default after the page renders', async () => {
      const onFetch = vi
        .fn()
        .mockResolvedValue(
          mockHtmlResponse('<p><a href="http://a.com/">A</a> <a href="http://b.com/">B</a></p>'),
        );
      const { container } = render(<LynxBrowser {...createProps({ onFetch })} />);
      await screen.findByText(/A/);
      const selected = container.querySelector('[data-selected="true"]');
      expect(selected?.textContent).toContain('[1]A');
    });

    it('moves selection forward on ArrowDown', async () => {
      const onFetch = vi
        .fn()
        .mockResolvedValue(
          mockHtmlResponse('<p><a href="http://a.com/">A</a> <a href="http://b.com/">B</a></p>'),
        );
      const { container } = render(<LynxBrowser {...createProps({ onFetch })} />);
      await screen.findByText(/A/);
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      const selected = container.querySelector('[data-selected="true"]');
      expect(selected?.textContent).toContain('[2]B');
    });

    it('clamps selection at 0 when ArrowUp is pressed at the top', async () => {
      const onFetch = vi
        .fn()
        .mockResolvedValue(
          mockHtmlResponse('<p><a href="http://a.com/">A</a> <a href="http://b.com/">B</a></p>'),
        );
      const { container } = render(<LynxBrowser {...createProps({ onFetch })} />);
      await screen.findByText(/A/);
      fireEvent.keyDown(window, { key: 'ArrowUp' });
      const selected = container.querySelector('[data-selected="true"]');
      expect(selected?.textContent).toContain('[1]A');
    });

    it('clamps selection at the last link on ArrowDown past the end', async () => {
      const onFetch = vi
        .fn()
        .mockResolvedValue(
          mockHtmlResponse('<p><a href="http://a.com/">A</a> <a href="http://b.com/">B</a></p>'),
        );
      const { container } = render(<LynxBrowser {...createProps({ onFetch })} />);
      await screen.findByText(/A/);
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      const selected = container.querySelector('[data-selected="true"]');
      expect(selected?.textContent).toContain('[2]B');
    });
  });

  describe('following links', () => {
    it('fetches the selected link URL on Enter', async () => {
      const onFetch = vi
        .fn()
        .mockResolvedValueOnce(mockHtmlResponse('<p><a href="http://a.com/">A</a></p>'))
        .mockResolvedValueOnce(mockHtmlResponse('<p>second page</p>'));
      render(<LynxBrowser {...createProps({ onFetch })} />);
      await screen.findByText(/A/);
      fireEvent.keyDown(window, { key: 'Enter' });
      await waitFor(() => expect(onFetch).toHaveBeenCalledWith('http://a.com/'));
    });

    it('fetches the selected link URL on ArrowRight', async () => {
      const onFetch = vi
        .fn()
        .mockResolvedValueOnce(mockHtmlResponse('<p><a href="http://a.com/">A</a></p>'))
        .mockResolvedValueOnce(mockHtmlResponse('<p>second page</p>'));
      render(<LynxBrowser {...createProps({ onFetch })} />);
      await screen.findByText(/A/);
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      await waitFor(() => expect(onFetch).toHaveBeenCalledWith('http://a.com/'));
    });

    it('resolves relative URLs against the current page URL', async () => {
      const onFetch = vi
        .fn()
        .mockResolvedValueOnce(mockHtmlResponse('<p><a href="/about">About</a></p>'))
        .mockResolvedValueOnce(mockHtmlResponse('<p>about</p>'));
      render(<LynxBrowser {...createProps({ onFetch, initialUrl: 'http://example.com/home' })} />);
      await screen.findByText(/About/);
      fireEvent.keyDown(window, { key: 'Enter' });
      await waitFor(() => expect(onFetch).toHaveBeenCalledWith('http://example.com/about'));
    });
  });

  describe('back navigation', () => {
    it('pops the history stack on ArrowLeft without refetching', async () => {
      const onFetch = vi
        .fn()
        .mockResolvedValueOnce(mockHtmlResponse('<p><a href="http://a.com/">A</a></p>'))
        .mockResolvedValueOnce(mockHtmlResponse('<h1>second</h1>'));
      render(<LynxBrowser {...createProps({ onFetch })} />);
      await screen.findByText(/A/);
      fireEvent.keyDown(window, { key: 'Enter' });
      await screen.findByText('second');
      const callsBeforeBack = onFetch.mock.calls.length;
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      await screen.findByText(/A/);
      expect(onFetch.mock.calls.length).toBe(callsBeforeBack);
    });

    it('pops the history stack on Backspace', async () => {
      const onFetch = vi
        .fn()
        .mockResolvedValueOnce(mockHtmlResponse('<p><a href="http://a.com/">A</a></p>'))
        .mockResolvedValueOnce(mockHtmlResponse('<h1>second</h1>'));
      render(<LynxBrowser {...createProps({ onFetch })} />);
      await screen.findByText(/A/);
      fireEvent.keyDown(window, { key: 'Enter' });
      await screen.findByText('second');
      fireEvent.keyDown(window, { key: 'Backspace' });
      await screen.findByText(/A/);
    });

    it('does not pop when history has only one page', async () => {
      const onFetch = vi.fn().mockResolvedValue(mockHtmlResponse('<p>only page</p>'));
      const onClose = vi.fn();
      render(<LynxBrowser {...createProps({ onFetch, onClose })} />);
      await screen.findByText('only page');
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      // Body still shows the only page; onClose not called.
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText('only page')).toBeInTheDocument();
    });
  });

  describe('quit', () => {
    it('calls onClose on q', async () => {
      const onFetch = vi.fn().mockResolvedValue(mockHtmlResponse('<p>x</p>'));
      const onClose = vi.fn();
      render(<LynxBrowser {...createProps({ onFetch, onClose })} />);
      await screen.findByText('x');
      fireEvent.keyDown(window, { key: 'q' });
      expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose on Escape', async () => {
      const onFetch = vi.fn().mockResolvedValue(mockHtmlResponse('<p>x</p>'));
      const onClose = vi.fn();
      render(<LynxBrowser {...createProps({ onFetch, onClose })} />);
      await screen.findByText('x');
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('non-HTML responses', () => {
    it('renders text/plain bodies verbatim with no rendering pass', async () => {
      const onFetch = vi
        .fn()
        .mockResolvedValue(mockTextResponse('User-agent: *\nDisallow: /admin'));
      render(<LynxBrowser {...createProps({ onFetch })} />);
      await waitFor(() => expect(screen.getByTestId('lynx-body')).toHaveTextContent('User-agent'));
      expect(screen.getByTestId('lynx-body')).toHaveTextContent('Disallow: /admin');
    });

    it('does not show a References block for non-HTML bodies', async () => {
      const onFetch = vi
        .fn()
        .mockResolvedValue(mockTextResponse('plain http://nope.example/ text'));
      render(<LynxBrowser {...createProps({ onFetch })} />);
      await waitFor(() => expect(screen.getByTestId('lynx-body')).toHaveTextContent('plain'));
      expect(screen.getByTestId('lynx-body')).not.toHaveTextContent('References');
    });
  });

  describe('help bar', () => {
    it('shows the standard lynx key bindings', () => {
      const onFetch = vi.fn(() => new Promise<HttpResponse>(() => undefined));
      render(<LynxBrowser {...createProps({ onFetch })} />);
      expect(screen.getByText(/Quit/)).toBeInTheDocument();
      expect(screen.getByText(/Follow/)).toBeInTheDocument();
      expect(screen.getByText(/Back/)).toBeInTheDocument();
    });
  });
});
