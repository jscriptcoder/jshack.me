/**
 * Theme palettes — the seven looks the terminal can wear: three neon ones in
 * the spirit of Cyberpunk 2077, and the four plain ones the game started with.
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

export type ThemeId = 'neon' | 'redline' | 'synth' | 'amber' | 'green' | 'cyan' | 'light';

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

/** What the neon look paints with beyond the ten shared tokens: the two colours
 *  the banner's glitch splits into, and the two faint tints lit into the top and
 *  bottom corners of the background. */
export type NeonColors = {
  readonly glitchA: string;
  readonly glitchB: string;
  readonly tintTop: string;
  readonly tintBottom: string;
};

/** No `id` field: the record key IS the id, and `THEME_IDS` is the order. A
 *  second copy of it inside each definition would be one more thing that can
 *  disagree with the key, and nothing would ever read it to find out.
 *
 *  `neonColors` is also the switch: a theme that has them wears the neon look
 *  (glow, the neon font, the glitching banner), and one without them looks as
 *  the terminal always has. A separate flag beside them could say "neon" with
 *  no colours to paint it in. */
export type ThemeDefinition = {
  readonly name: string;
  readonly colors: ThemeColors;
  readonly neonColors?: NeonColors;
};

/** What a player who has never chosen sees, and the fallback for a stored value
 *  that no longer names a theme. `index.css` paints the same palette before any
 *  script runs, so the two agree at first paint — a test holds them together. */
export const DEFAULT_THEME_ID: ThemeId = 'neon';

export const THEMES: Readonly<Record<ThemeId, ThemeDefinition>> = {
  neon: {
    name: 'Neon',
    colors: {
      bg: '#06070c',
      text: '#4ee6ee',
      textBright: '#fcee0a',
      textDim: '#33909a',
      error: '#ff1f4b',
      caret: '#fcee0a',
      scrollThumb: 'rgba(252, 238, 10, 0.3)',
      scrollThumbHover: 'rgba(252, 238, 10, 0.6)',
      link: '#fcee0a',
      avatarBorder: '#4ee6ee',
    },
    neonColors: {
      glitchA: '#ff1f4b',
      glitchB: '#4ee6ee',
      tintTop: 'rgba(78, 230, 238, 0.08)',
      tintBottom: 'rgba(252, 238, 10, 0.05)',
    },
  },
  redline: {
    name: 'Redline',
    colors: {
      bg: '#0c0305',
      text: '#ff5e57',
      textBright: '#5ef6ff',
      textDim: '#c4524b',
      // Red is the body text here, so an error needs a colour that is not red.
      error: '#fcee0a',
      caret: '#5ef6ff',
      scrollThumb: 'rgba(255, 94, 87, 0.3)',
      scrollThumbHover: 'rgba(255, 94, 87, 0.6)',
      link: '#5ef6ff',
      avatarBorder: '#ff5e57',
    },
    neonColors: {
      glitchA: '#5ef6ff',
      glitchB: '#fcee0a',
      tintTop: 'rgba(255, 94, 87, 0.09)',
      tintBottom: 'rgba(94, 246, 255, 0.05)',
    },
  },
  synth: {
    name: 'Synth',
    colors: {
      bg: '#090320',
      text: '#b9f3ff',
      textBright: '#ff2a6d',
      textDim: '#7b6cb3',
      error: '#fdf500',
      caret: '#ff2a6d',
      scrollThumb: 'rgba(255, 42, 109, 0.3)',
      scrollThumbHover: 'rgba(255, 42, 109, 0.6)',
      link: '#05d9e8',
      avatarBorder: '#b9f3ff',
    },
    neonColors: {
      glitchA: '#05d9e8',
      glitchB: '#ff2a6d',
      tintTop: 'rgba(255, 42, 109, 0.1)',
      tintBottom: 'rgba(5, 217, 232, 0.08)',
    },
  },
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
export const THEME_IDS: readonly ThemeId[] = [
  'neon',
  'redline',
  'synth',
  'amber',
  'green',
  'cyan',
  'light',
];

/** Widened to `string` so the lookup needs no assertion to narrow `unknown`. */
const THEME_ID_SET: ReadonlySet<string> = new Set(THEME_IDS);

/** The `typeof` guard is what lets `Set<string>.has` take an `unknown` without an
 *  assertion. It changes no answer at runtime — a non-string is not in the set
 *  either way — so it is deliberately not something a test can falsify. */
export const isValidThemeId = (value: unknown): value is ThemeId =>
  typeof value === 'string' && THEME_ID_SET.has(value);
