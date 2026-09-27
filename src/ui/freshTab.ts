/**
 * The fresh-tab flag — how `xterm` tells the terminal it opens to come up at
 * home.
 *
 * A second tab is a second boot, and an ordinary boot rebuilds the hop chain from
 * the server's session rows so that a `su` elevation survives a refresh. That is
 * exactly wrong for a tab a player opened to have a shell somewhere else: it
 * would land them inside the box the first tab is ssh'd into, where `exit` in
 * either ends a row the other still believes it holds.
 *
 * The flag is spent as it is read. The URL is what a reload re-requests, so
 * leaving it in place would make every reload of that tab fresh — and a player
 * who elevated in it would come back demoted with the `su` row still open on the
 * server, which is worse than the reload lossiness two tabs already carry.
 *
 * Takes injected `location`/`history` rather than reaching for the globals, so
 * the round-trip is unit-testable; `main.tsx` supplies the real ones.
 */

export const FRESH_TAB_FLAG = 'fresh';

type LocationLike = Pick<Location, 'search' | 'pathname'>;
type HistoryLike = Pick<History, 'replaceState'>;

export const consumeFreshTabFlag = (location: LocationLike, history: HistoryLike): boolean => {
  if (!new URLSearchParams(location.search).has(FRESH_TAB_FLAG)) return false;
  // The whole query goes, not just this parameter, because it is the only one the
  // game has ever put there. Add a second and this has to learn the difference.
  history.replaceState(null, '', location.pathname);
  return true;
};
