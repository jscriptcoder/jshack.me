/**
 * Theme palettes — the four looks the terminal can wear.
 *
 * Pure data, no DOM: `core/` stays framework-agnostic, so the `theme` command
 * can list what exists while the UI alone knows how to paint it.
 *
 * TEN tokens, which is exactly what the app paints today. Legacy carried
 * fourteen; the rest describe chrome this rewrite has not built, and a token
 * nothing reads is a value free to drift from the design forever without a
 * single test noticing. They arrive with the screens that need them — `link` and
 * `avatarBorder` did, with the author card. Legacy's `linkHover` did not: the
 * card's hover uses `textBright`, which every palette already defines and half
 * the app already paints, rather than adding a ninth value whose only job is to
 * be a slightly different shade of one we have.
 */

export type ThemeId = 'amber' | 'green' | 'cyan' | 'light';

export type ThemeColors = {
  readonly bg: string;
  readonly text: string;
  readonly textBright: string;
  readonly textDim: string;
  readonly error: string;
  readonly caret: string;
  readonly scrollThumb: string;
  readonly scrollThumbHover: string;
  readonly link: string;
  readonly avatarBorder: string;
};

/** No `id` field: the record key IS the id, and `THEME_IDS` is the order. A
 *  second copy of it inside each definition would be one more thing that can
 *  disagree with the key, and nothing would ever read it to find out. */
export type ThemeDefinition = {
  readonly name: string;
  readonly colors: ThemeColors;
};

/** What a player who has never chosen sees, and the fallback for a stored value
 *  that no longer names a theme. Amber is what `index.css` paints before any
 *  script runs, so the two agree at first paint. */
export const DEFAULT_THEME_ID: ThemeId = 'amber';

export const THEMES: Readonly<Record<ThemeId, ThemeDefinition>> = {
  amber: {
    name: 'Amber',
    colors: {
      bg: '#000000',
      text: '#f59e0b',
      textBright: '#fcd34d',
      textDim: '#d97706',
      error: '#ef4444',
      caret: '#fbbf24',
      scrollThumb: 'rgba(120, 53, 15, 0.5)',
      scrollThumbHover: 'rgba(146, 64, 14, 0.7)',
      link: '#fbbf24',
      avatarBorder: '#f59e0b',
    },
  },
  green: {
    name: 'Green Phosphor',
    colors: {
      bg: '#000000',
      text: '#22c55e',
      textBright: '#86efac',
      textDim: '#16a34a',
      error: '#ef4444',
      caret: '#4ade80',
      scrollThumb: 'rgba(20, 83, 45, 0.5)',
      scrollThumbHover: 'rgba(22, 101, 52, 0.7)',
      link: '#4ade80',
      avatarBorder: '#22c55e',
    },
  },
  cyan: {
    name: 'Cyan',
    colors: {
      bg: '#000000',
      text: '#06b6d4',
      textBright: '#67e8f9',
      textDim: '#0891b2',
      error: '#ef4444',
      caret: '#22d3ee',
      scrollThumb: 'rgba(21, 94, 117, 0.5)',
      scrollThumbHover: 'rgba(14, 116, 144, 0.7)',
      link: '#22d3ee',
      avatarBorder: '#06b6d4',
    },
  },
  light: {
    name: 'Light',
    colors: {
      bg: '#f5f5f4',
      text: '#292524',
      textBright: '#0c0a09',
      textDim: '#57534e',
      error: '#dc2626',
      caret: '#292524',
      scrollThumb: 'rgba(168, 162, 158, 0.5)',
      scrollThumbHover: 'rgba(120, 113, 108, 0.7)',
      link: '#2563eb',
      avatarBorder: '#57534e',
    },
  },
};

/** Listing order for `theme` and for the "Available:" line of its refusal —
 *  declared rather than derived from `Object.keys`, so the order a player reads
 *  is a decision rather than a property of how the record happens to be typed. */
export const THEME_IDS: readonly ThemeId[] = ['amber', 'green', 'cyan', 'light'];

/** Widened to `string` so the lookup needs no assertion to narrow `unknown`. */
const THEME_ID_SET: ReadonlySet<string> = new Set(THEME_IDS);

/** The `typeof` guard is what lets `Set<string>.has` take an `unknown` without an
 *  assertion. It changes no answer at runtime — a non-string is not in the set
 *  either way — so it is deliberately not something a test can falsify. */
export const isValidThemeId = (value: unknown): value is ThemeId =>
  typeof value === 'string' && THEME_ID_SET.has(value);
