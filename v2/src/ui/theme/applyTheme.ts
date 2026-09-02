/**
 * Paint a palette onto the document.
 *
 * The one place that knows a theme becomes CSS custom properties on
 * `:root` — `core/theme/themes.ts` holds the values and has no idea they are
 * ever painted, which is what keeps that module framework-agnostic.
 *
 * `index.css` declares the same eight properties in its `:root` block. That is
 * the PRE-JS fallback and nothing else: it paints the frame before any script
 * runs, and this function takes over from the first render onward. Change a
 * colour in `themes.ts`, not there.
 */

import { THEMES } from '../../core/theme/themes';
import type { ThemeId } from '../../core/theme/themes';

/** `scrollThumbHover` → `scroll-thumb-hover`, so the token names in `index.css`
 *  and the field names in `ThemeColors` stay one edit apart. */
const camelToKebab = (name: string): string =>
  name.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`);

export const applyTheme = (id: ThemeId): void => {
  const style = document.documentElement.style;
  for (const [token, value] of Object.entries(THEMES[id].colors)) {
    style.setProperty(`--theme-${camelToKebab(token)}`, value);
  }
};
