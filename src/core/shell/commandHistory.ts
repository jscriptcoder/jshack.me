/**
 * Shell command-history navigation — pure reducer logic for the up/down-arrow
 * recall in the terminal input. Kept framework-free (no Solid imports) so the
 * boundary behaviour is unit-testable in isolation; `ui/state.ts` owns the
 * actual signals and feeds them through these functions.
 *
 * `index === -1` (HISTORY_IDLE) means "not navigating — sitting at the live
 * prompt". The first ArrowUp captures whatever was half-typed as the `draft`;
 * ArrowDown past the newest entry restores that draft, matching bash/zsh.
 */

export const HISTORY_IDLE = -1;

/** Navigation cursor: where we are in history, plus the line we left behind. */
export type HistoryNav = {
  /** Index into the history array, or HISTORY_IDLE when at the live prompt. */
  readonly index: number;
  /** The in-progress input captured when navigation began. */
  readonly draft: string;
};

/** The outcome of one arrow press: the new cursor and the value to display. */
export type NavStep = {
  readonly nav: HistoryNav;
  readonly value: string;
};

/** A fresh, not-navigating cursor with no captured draft. */
export const idleNav = (): HistoryNav => ({ index: HISTORY_IDLE, draft: '' });

/** ArrowUp: recall an older command. From the live prompt this captures the
 *  current input as the draft and jumps to the newest entry; further presses
 *  walk backward, clamping at the oldest. */
export const navigateUp = (
  history: readonly string[],
  nav: HistoryNav,
  currentInput: string,
): NavStep => {
  if (history.length === 0) return { nav, value: currentInput };

  const navigating = nav.index !== HISTORY_IDLE;
  const draft = navigating ? nav.draft : currentInput;
  const index = navigating ? Math.max(0, nav.index - 1) : history.length - 1;

  return { nav: { index, draft }, value: history[index] };
};

/** ArrowDown: move toward newer commands. A no-op at the live prompt; stepping
 *  past the newest entry ends navigation and restores the captured draft. */
export const navigateDown = (
  history: readonly string[],
  nav: HistoryNav,
  currentInput: string,
): NavStep => {
  if (nav.index === HISTORY_IDLE) return { nav, value: currentInput };

  const index = nav.index + 1;
  if (index >= history.length) return { nav: idleNav(), value: nav.draft };

  return { nav: { index, draft: nav.draft }, value: history[index] };
};
