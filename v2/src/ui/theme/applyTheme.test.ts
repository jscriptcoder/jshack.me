import { describe, expect, it } from 'vitest';
import { applyTheme } from './applyTheme';
import { THEME_IDS } from '../../core/theme/themes';

/**
 * The eight custom properties `index.css` actually reads. Written out rather
 * than derived from `ThemeColors`, deliberately: this is the contract BETWEEN
 * the palette and the stylesheet, so renaming a field in `themes.ts` without
 * renaming the token in the CSS has to fail here. Deriving the list from the
 * same object under test would agree with any rename and prove nothing.
 */
const PAINTED_TOKENS = [
  '--theme-bg',
  '--theme-text',
  '--theme-text-bright',
  '--theme-text-dim',
  '--theme-error',
  '--theme-caret',
  '--theme-scroll-thumb',
  '--theme-scroll-thumb-hover',
] as const;

describe('applyTheme', () => {
  it.each([...THEME_IDS])(
    'paints every token the stylesheet reads, and leaves none of them blank: %s',
    (id) => {
      document.documentElement.removeAttribute('style');

      applyTheme(id);

      // A blank token is the failure that matters: the browser falls back to an
      // inherited or unset value, so one missing colour can leave text the same
      // shade as the background with nothing in the console to say why.
      for (const token of PAINTED_TOKENS) {
        expect(document.documentElement.style.getPropertyValue(token)).not.toBe('');
      }
    },
  );
});
