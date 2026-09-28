/**
 * Paint a palette onto the document.
 *
 * The one place that knows a theme becomes CSS custom properties on
 * `:root` — `core/theme/themes.ts` holds the values and has no idea they are
 * ever painted, which is what keeps that module framework-agnostic.
 *
 * `index.css` declares the same ten properties in its `:root` block. That is
 * the PRE-JS fallback and nothing else: it paints the frame before any script
 * runs, and this function takes over from the first render onward. Change a
 * colour in `themes.ts`, not there.
 */

import { EFFECT_NAMES } from '../../core/theme/effects.js';
import type { Effects } from '../../core/theme/effects.js';
import { THEMES } from '../../core/theme/themes.js';
import type { ThemeId } from '../../core/theme/themes.js';

/** `scrollThumbHover` → `scroll-thumb-hover`, so the token names in `index.css`
 *  and the field names in `ThemeColors` stay one edit apart. */
const camelToKebab = (name: string): string =>
  name.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`);

/** The neon look is switched by a mark on `<html>` rather than by the colours
 *  alone, because most of what it changes (glow, font, the banner's glitch) is
 *  not a colour. Every neon rule in `index.css` hangs off this mark, so taking it
 *  away is what makes a plain theme look exactly as it always has. The neon
 *  colours a previous theme painted are left behind: nothing reads them once
 *  the mark is gone.
 *
 *  Each effect the player has on gets its own mark beside it, in `data-effects`,
 *  and the glow and glitch rules hang off those. They go with the neon mark under a
 *  plain theme, which shows no effects whatever the player chose. */
export const applyTheme = (id: ThemeId, effects: Effects): void => {
  const root = document.documentElement;
  const { colors, neonColors } = THEMES[id];
  for (const [token, value] of Object.entries({ ...colors, ...neonColors })) {
    root.style.setProperty(`--theme-${camelToKebab(token)}`, value);
  }
  if (neonColors === undefined) {
    delete root.dataset.look;
    delete root.dataset.effects;
  } else {
    root.dataset.look = 'neon';
    root.dataset.effects = EFFECT_NAMES.filter((name) => effects[name]).join(' ');
  }
};
