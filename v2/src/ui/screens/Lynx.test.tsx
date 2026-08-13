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

/** A keystroke and the round trip it starts. The page swaps while the key is still
 *  being handled, but what the screen RECORDS about the move lands only once the
 *  fetch it awaited has resolved — so a test that navigates twice in a row must let
 *  the first one finish or the second reads a screen that has forgotten it. */
const press = async (key: string) => {
  fireEvent.keyDown(browser(), { key });
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const HOME = 'http://192.168.1.5/';
const NOTES = 'http://192.168.1.5/notes.html';
const STATUS = 'http://192.168.1.5/status.html';

/** A site small enough to walk in a test and big enough to get lost in: home reaches
 *  both of the others, and the notes page reaches home again. */
const SITE: Readonly<Record<string, string>> = {
  [HOME]:
    '<body><p>See <a href="/notes.html">the notes</a> or <a href="/status.html">the status</a>.</p></body>',
  [NOTES]: '<body><h1>Notes</h1><p>Return to <a href="/">home</a>.</p></body>',
  [STATUS]: '<body><p>All green.</p></body>',
};

/** The browser over a site it can actually walk. `onFollow` behaves as the app's
 *  does: it swaps the page under the screen and reports that the reader moved. An
 *  address listed as `unreachable` answers the way a host that is not there does —
 *  nothing arrives, and nobody moves. */
const renderSite = (overrides?: {
  start?: string;
  pages?: Readonly<Record<string, string>>;
  unreachable?: readonly string[];
}) => {
  const pages = overrides?.pages ?? SITE;
  const unreachable = overrides?.unreachable ?? [];
  const start = overrides?.start ?? HOME;
  const [page, setPage] = createSignal({ url: start, content: pages[start] ?? '' });
  const onExit = vi.fn();
  const onFollow = vi.fn(async (url: string): Promise<FollowOutcome> => {
    if (unreachable.includes(url)) {
      return { ok: false, alert: `lynx: (7) Failed to connect to ${url}` };
    }
    setPage({ url, content: pages[url] ?? '<body><h1>404 Not Found</h1></body>' });
    return { ok: true };
  });
  render(() => (
    <Lynx url={page().url} content={page().content} onExit={onExit} onFollow={onFollow} />
  ));
  return { onExit, onFollow };
};

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

  // The whole line rather than a word of it: a hint that quietly loses a key still
  // answers a search for the keys it kept.
  it('says how to move once there is somewhere to move to, and stays quiet when there is not', () => {
    renderLynx({ content: LINKED_PAGE });
    expect(screen.getByText('↑↓ Select ⏎ Follow q Quit')).toBeInTheDocument();

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

describe('going back', () => {
  it.each(['ArrowLeft', 'Backspace'])('returns to the previous page on %s', async (key) => {
    const { onFollow } = renderSite();

    await press('Enter');
    expect(screen.getByText('Notes')).toBeInTheDocument();

    await press(key);

    // Asked for again rather than remembered: the reader sees the page as it is now.
    expect(onFollow).toHaveBeenLastCalledWith(HOME);
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
  });

  it('puts the reader back on the link they left by', async () => {
    renderSite();

    fireEvent.keyDown(browser(), { key: 'ArrowDown' });
    await press('Enter');
    expect(screen.getByText('All green.')).toBeInTheDocument();

    await press('ArrowLeft');

    expect(selectedLink()?.textContent).toBe('[2]the status');
  });

  it('has nowhere to go back to on the first page, and neither quits nor asks', async () => {
    const { onExit, onFollow } = renderSite();

    await press('ArrowLeft');
    await press('Backspace');

    expect(onFollow).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('walks a chain back one page at a time rather than jumping to the start', async () => {
    const { onFollow } = renderSite();

    await press('Enter');
    await press('Enter');
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();

    await press('ArrowLeft');
    expect(screen.getByText('Notes')).toBeInTheDocument();

    await press('ArrowLeft');
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
    expect(selectedLink()?.textContent).toBe('[1]the notes');

    // Every step spent: the page a reader started on is not still behind itself.
    await press('ArrowLeft');
    expect(onFollow).toHaveBeenCalledTimes(4);
  });

  it('does not go back on a key that means nothing here', async () => {
    const { onFollow } = renderSite();

    await press('Enter');
    await press('j');

    expect(onFollow).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  // The same rule a refused follow lives by, read backwards: a reader who could not
  // go back has not gone back, so the step they were taking is still ahead of them.
  it('stays put when the page behind cannot be reached, and keeps the step', async () => {
    const { onFollow } = renderSite({ unreachable: [HOME] });

    await press('Enter');
    await press('ArrowLeft');

    expect(await screen.findByText(/Failed to connect/)).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();

    await press('ArrowLeft');

    expect(onFollow).toHaveBeenCalledTimes(3);
    expect(onFollow).toHaveBeenLastCalledWith(HOME);
  });

  it('comes to rest on the last link when the page behind has lost some', async () => {
    // Asking again is what shows a reader that the page changed while they were away
    // — and a selection restored past the end of it would point at nothing.
    const [page, setPage] = createSignal({
      url: HOME,
      content:
        '<body><p><a href="/a.html">alpha</a> <a href="/b.html">beta</a> <a href="/c.html">gamma</a></p></body>',
    });
    const onFollow = vi.fn(async (url: string): Promise<FollowOutcome> => {
      setPage({
        url,
        content:
          url === HOME
            ? '<body><p><a href="/a.html">alpha</a></p></body>'
            : '<body><p>elsewhere</p></body>',
      });
      return { ok: true };
    });
    render(() => (
      <Lynx url={page().url} content={page().content} onExit={vi.fn()} onFollow={onFollow} />
    ));

    fireEvent.keyDown(browser(), { key: 'ArrowDown' });
    fireEvent.keyDown(browser(), { key: 'ArrowDown' });
    await press('Enter');
    await press('ArrowLeft');

    expect(selectedLink()?.textContent).toBe('[1]alpha');
  });

  it('names the way back only once there is somewhere to go back to', async () => {
    renderSite();
    expect(screen.getByText('↑↓ Select ⏎ Follow q Quit')).toBeInTheDocument();

    await press('Enter');

    expect(screen.getByText('↑↓ Select ⏎ Follow ← Back q Quit')).toBeInTheDocument();
  });

  it('opens with no history, so a page is never the tail of a session already left', async () => {
    renderSite();
    await press('Enter');
    cleanup();

    const { onFollow } = renderSite({ start: STATUS });
    await press('ArrowLeft');

    expect(onFollow).not.toHaveBeenCalled();
  });
});
