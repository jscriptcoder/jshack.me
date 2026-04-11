// Phase 3 game-time model: real-world-clock time anchored at first game
// start. The game's CVE table has a `publishedAt` field on every entry
// measuring game days since `startedAt`; once game time passes that
// threshold, the CVE becomes "active" and can be exploited.
//
// Offline accrual is a feature: leave the game for a week, come back to a
// week's worth of newly-published CVEs. Matches how real system
// administration feels.
//
// `startedAt` is persisted in localStorage so it survives browser reloads.
// Permadeath resets it via `resetGameTime()`.

const GAME_STARTED_AT_KEY = 'jshack.gameStartedAt';
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Initializes startedAt to Date.now() if it hasn't been set yet. Safe to
// call on every app startup. Returns the anchor time.
export const initGameTimeIfUnset = (): number => {
  try {
    const existing = localStorage.getItem(GAME_STARTED_AT_KEY);
    if (existing !== null) {
      const parsed = parseInt(existing, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  } catch {
    // localStorage unavailable (e.g., SSR) — fall through to a fresh anchor
  }

  const now = Date.now();
  try {
    localStorage.setItem(GAME_STARTED_AT_KEY, String(now));
  } catch {
    // Non-critical — if we can't persist, the anchor resets on next load.
  }
  return now;
};

// Reads the stored anchor without side effects. Returns null if the game
// hasn't been started yet (no anchor recorded).
export const readStartedAt = (): number | null => {
  try {
    const stored = localStorage.getItem(GAME_STARTED_AT_KEY);
    if (stored === null) return null;
    const parsed = parseInt(stored, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

// Current game time in whole days since the game was first started.
// Returns 0 if the game hasn't been initialized yet (caller treats this as
// "day 1" — all classic CVEs are active).
export const getGameTime = (): number => {
  const startedAt = readStartedAt();
  if (startedAt === null) return 0;
  const elapsed = Date.now() - startedAt;
  return Math.max(0, Math.floor(elapsed / MS_PER_DAY));
};

// Clears the anchor so the next initGameTimeIfUnset() call will start fresh.
// Called on permadeath / new game.
export const resetGameTime = (): void => {
  try {
    localStorage.removeItem(GAME_STARTED_AT_KEY);
  } catch {
    // Non-critical
  }
};
