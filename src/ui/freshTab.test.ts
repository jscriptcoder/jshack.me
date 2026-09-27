import { describe, expect, it, vi } from 'vitest';
import { consumeFreshTabFlag, FRESH_TAB_FLAG } from './freshTab';

/**
 * `xterm` opens a tab carrying a flag that says "come up at home, do not rebuild
 * this player's hop chain". The flag has to be spent as it is read: the URL is
 * what a reload re-requests, so a flag left in place would make every reload of
 * that tab fresh — and a player who elevated in it would come back demoted, with
 * the `su` row still open on the server.
 *
 * Proven over injected `location`/`history` fakes rather than a browser, the way
 * theme persistence is proven over an injected storage.
 */
const fakeBrowser = (search: string) => {
  const replaceState = vi.fn();
  return {
    location: { search, pathname: '/' },
    history: { replaceState },
    replaceState,
  };
};

describe('the fresh-tab flag', () => {
  it('reports a flagged boot and spends the flag doing it', () => {
    const browser = fakeBrowser(`?${FRESH_TAB_FLAG}`);

    expect(consumeFreshTabFlag(browser.location, browser.history)).toBe(true);

    // Rewritten to the bare path, so the next reload of this tab is an ordinary
    // one. `replaceState` rather than a navigation: spending the flag must not
    // reload the page that is already coming up.
    expect(browser.replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  it('reports an ordinary boot and leaves the address bar alone', () => {
    const browser = fakeBrowser('');

    expect(consumeFreshTabFlag(browser.location, browser.history)).toBe(false);

    // Nothing to spend, so nothing is rewritten — a reload should not quietly
    // become a history entry of its own.
    expect(browser.replaceState).not.toHaveBeenCalled();
  });
});
