import { describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Lynx, type FollowOutcome } from './Lynx';

const PAGE =
  '<html><body><h1>db-01</h1><p>Server operational. Build 4.2.1</p><!-- TODO: remove debug endpoints --></body></html>';

/** A page whose links are the point: two the browser can follow, one it cannot. */
const LINKED_PAGE =
  '<html><body><p>See <a href="/notes.html">the notes</a> or <a href="status.html">the status</a>.</p>' +
  '<p><a href="mailto:root@db-01">mail the admin</a></p></body></html>';

const renderLynx = (overrides?: {
  content?: string;
  url?: string;
  onExit?: () => void;
  onFollow?: (url: string) => Promise<FollowOutcome>;
}) => {
  const onExit = overrides?.onExit ?? vi.fn();
  const onFollow = overrides?.onFollow ?? vi.fn().mockResolvedValue({ ok: true });
  render(() => (
    <Lynx
      url={overrides?.url ?? 'http://192.168.1.5/'}
      content={overrides?.content ?? PAGE}
      onExit={onExit}
      onFollow={onFollow}
    />
  ));
  return { onExit, onFollow };
};

const browser = () => screen.getByRole('main');

/** The link the reader would follow if they pressed Enter now. */
const selectedLink = () =>
  screen.getAllByRole('link').find((link) => link.getAttribute('aria-current') === 'true');

describe('Lynx browser screen', () => {
  it('shows the address being read', () => {
    renderLynx();

    expect(screen.getByText(/http:\/\/192\.168\.1\.5\//)).toBeInTheDocument();
  });

  it('shows the page as text rather than as markup', () => {
    renderLynx();

    expect(screen.getByText('db-01')).toBeInTheDocument();
    expect(screen.getByText('Server operational. Build 4.2.1')).toBeInTheDocument();
  });

  it('leaves the comment behind — reading a page is not reading its source', () => {
    renderLynx();

    expect(screen.queryByText(/TODO/)).not.toBeInTheDocument();
  });

  it('takes the keyboard on open, so quitting needs no click first', () => {
    renderLynx();

    expect(document.activeElement).toBe(browser());
  });

  // Real lynx quits on either case, and the editor beside it already takes `y`
  // and `Y` for the same answer — a held shift should not strand a reader.
  it.each(['q', 'Q'])('quits on %s', (key) => {
    const { onExit } = renderLynx();

    fireEvent.keyDown(browser(), { key });

    expect(onExit).toHaveBeenCalled();
  });

  it('quits on Escape', () => {
    const { onExit } = renderLynx();

    fireEvent.keyDown(browser(), { key: 'Escape' });

    expect(onExit).toHaveBeenCalled();
  });

  it('stays open on any other key', () => {
    const { onExit } = renderLynx();

    fireEvent.keyDown(browser(), { key: 'j' });
    fireEvent.keyDown(browser(), { key: 'Enter' });

    expect(onExit).not.toHaveBeenCalled();
  });

  it('shows an empty page as an empty screen rather than failing to open', () => {
    renderLynx({ content: '<html><body></body></html>' });

    expect(browser()).toBeInTheDocument();
  });
});

describe('following a link', () => {
  it('numbers the links a reader can follow, and only those', () => {
    renderLynx({ content: LINKED_PAGE });

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      '[1]the notes',
      '[2]the status',
    ]);
    expect(screen.getByText(/mail the admin/)).toBeInTheDocument();
  });

  it('selects the first link when the page opens, so Enter always has a target', () => {
    renderLynx({ content: LINKED_PAGE });

    expect(selectedLink()?.textContent).toBe('[1]the notes');
  });

  it('moves the selection down the page and back up again', () => {
    renderLynx({ content: LINKED_PAGE });

    fireEvent.keyDown(browser(), { key: 'ArrowDown' });
    expect(selectedLink()?.textContent).toBe('[2]the status');

    fireEvent.keyDown(browser(), { key: 'ArrowUp' });
    expect(selectedLink()?.textContent).toBe('[1]the notes');
  });

  // Clamping rather than wrapping: a reader holding a key down should come to rest
  // at the end of the page, not be thrown back to the other end of it.
  it('stays on the last link when there is nothing further down', () => {
    renderLynx({ content: LINKED_PAGE });

    fireEvent.keyDown(browser(), { key: 'ArrowDown' });
    fireEvent.keyDown(browser(), { key: 'ArrowDown' });
    fireEvent.keyDown(browser(), { key: 'ArrowDown' });

    expect(selectedLink()?.textContent).toBe('[2]the status');
  });

  it('stays on the first link when there is nothing further up', () => {
    renderLynx({ content: LINKED_PAGE });

    fireEvent.keyDown(browser(), { key: 'ArrowUp' });

    expect(selectedLink()?.textContent).toBe('[1]the notes');
  });

  it.each(['Enter', 'ArrowRight'])('follows the selected link on %s', async (key) => {
    const { onFollow } = renderLynx({ content: LINKED_PAGE });

    fireEvent.keyDown(browser(), { key });

    expect(onFollow).toHaveBeenCalledWith('http://192.168.1.5/notes.html');
  });

  it('follows the link the reader moved to, resolved against the page it sits on', () => {
    const { onFollow } = renderLynx({
      content: LINKED_PAGE,
      url: 'http://192.168.1.5/docs/index.html',
    });

    fireEvent.keyDown(browser(), { key: 'ArrowDown' });
    fireEvent.keyDown(browser(), { key: 'Enter' });

    expect(onFollow).toHaveBeenCalledWith('http://192.168.1.5/docs/status.html');
  });

  // The number tells a reader a link is there; the styling tells them which one
  // Enter will take. Both links are marked, and not the same way.
  it('shows the selected link differently from the ones beside it', () => {
    renderLynx({ content: LINKED_PAGE });

    const [first, second] = screen.getAllByRole('link');

    expect(first?.className).not.toBe('');
    expect(second?.className).not.toBe('');
    expect(first?.className).not.toBe(second?.className);
  });

  it('says how to move once there is somewhere to move to, and stays quiet when there is not', () => {
    renderLynx({ content: LINKED_PAGE });
    expect(screen.getByText(/Follow/)).toBeInTheDocument();

    cleanup();
    renderLynx();

    expect(screen.getByText('q Quit')).toBeInTheDocument();
    expect(screen.queryByText(/Follow/)).not.toBeInTheDocument();
  });

  it('does not wander off the page on a key that means nothing here', () => {
    const { onFollow } = renderLynx({ content: LINKED_PAGE });

    fireEvent.keyDown(browser(), { key: 'j' });

    expect(onFollow).not.toHaveBeenCalled();
  });

  it('starts at the top of a new address even when it reads the same as the last one', () => {
    const sameWords = LINKED_PAGE;
    const [page, setPage] = createSignal('http://192.168.1.5/');
    render(() => (
      <Lynx
        url={page()}
        content={sameWords}
        onExit={vi.fn()}
        onFollow={vi.fn().mockResolvedValue({ ok: true })}
      />
    ));

    fireEvent.keyDown(browser(), { key: 'ArrowDown' });
    expect(selectedLink()?.textContent).toBe('[2]the status');

    setPage('http://192.168.1.5/copy.html');

    expect(selectedLink()?.textContent).toBe('[1]the notes');
  });

  it('has nothing to follow on a page with no links, and does not quit trying', () => {
    const { onFollow, onExit } = renderLynx();

    fireEvent.keyDown(browser(), { key: 'Enter' });

    expect(onFollow).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('reports a follow that never reached the host, and stays on the page', async () => {
    const onFollow = vi
      .fn()
      .mockResolvedValue({ ok: false, alert: 'lynx: (7) Failed to connect to 192.168.1.9 port 80' });
    renderLynx({ content: LINKED_PAGE, onFollow });

    fireEvent.keyDown(browser(), { key: 'Enter' });
    await Promise.resolve();

    expect(await screen.findByText(/Failed to connect to 192\.168\.1\.9 port 80/)).toBeInTheDocument();
    expect(screen.getByText('[1]the notes')).toBeInTheDocument();
  });

  it('clears a stale alert once the reader is going somewhere new', async () => {
    const onFollow = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, alert: 'lynx: (7) Failed to connect' })
      .mockResolvedValue({ ok: true });
    renderLynx({ content: LINKED_PAGE, onFollow });

    fireEvent.keyDown(browser(), { key: 'Enter' });
    expect(await screen.findByText(/Failed to connect/)).toBeInTheDocument();

    fireEvent.keyDown(browser(), { key: 'ArrowDown' });
    fireEvent.keyDown(browser(), { key: 'Enter' });

    await vi.waitFor(() => expect(screen.queryByText(/Failed to connect/)).not.toBeInTheDocument());
  });

  it('starts the new page at its first link rather than where the last one was left', () => {
    // Arriving somewhere new, from the screen's side: the same component with a
    // different address and body, because the page it shows is the parent's state.
    const [page, setPage] = createSignal({ url: 'http://192.168.1.5/', content: LINKED_PAGE });
    render(() => (
      <Lynx
        url={page().url}
        content={page().content}
        onExit={vi.fn()}
        onFollow={vi.fn().mockResolvedValue({ ok: true })}
      />
    ));

    fireEvent.keyDown(browser(), { key: 'ArrowDown' });
    expect(selectedLink()?.textContent).toBe('[2]the status');

    setPage({
      url: 'http://192.168.1.5/notes.html',
      content: '<body><p><a href="/a.html">alpha</a> <a href="/b.html">beta</a></p></body>',
    });

    expect(selectedLink()?.textContent).toBe('[1]alpha');
  });
});
