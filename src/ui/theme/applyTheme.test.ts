import { describe, expect, it } from 'vitest';
import { applyTheme } from './applyTheme.js';
import { DEFAULT_THEME_ID, THEME_IDS } from '../../core/theme/themes.js';
// The stylesheet as text: tests run without Tailwind, so there is no cascade to
// read the pre-script palette from, only the source that declares it.
import stylesheet from '../../index.css?raw';

/**
 * Every custom property the app actually reads. Written out rather than derived
 * from `ThemeColors`, deliberately: this is the contract BETWEEN the palette and
 * the things that paint from it, so renaming a field in `themes.ts` without
 * renaming the token at the other end has to fail here. Deriving the list from
 * the same object under test would agree with any rename and prove nothing.
 *
 * The list grows only when something starts painting a token — a colour nothing
 * reads is a value free to drift from the design forever without a test noticing.
 * The last two arrived with the author card, which is the only thing that shows a
 * link or an avatar.
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
  '--theme-link',
  '--theme-avatar-border',
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

  it('paints the default theme exactly as the stylesheet does before any script runs', () => {
    // `index.css` has to hold its own copy of the default palette, because it
    // paints the first frame before this module has loaded. A copy nothing
    // checks is one a change of default forgets, and then a first-time player
    // boots in one colour and flips to another as the script arrives.
    document.documentElement.removeAttribute('style');

    applyTheme(DEFAULT_THEME_ID);

    const painted = Object.fromEntries(
      PAINTED_TOKENS.map((token) => [
        token,
        document.documentElement.style.getPropertyValue(token),
      ]),
    );
    expect(preScriptPalette()).toEqual(painted);
  });
});

/** The `--theme-*` properties declared in the stylesheet's first `:root` block. */
const preScriptPalette = (): Readonly<Record<string, string>> => {
  const rootBlock = /:root\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? '';
  return Object.fromEntries(
    [...rootBlock.matchAll(/(--theme-[\w-]+)\s*:\s*([^;]+);/g)].map(([, token, value]) => [
      token,
      value?.trim(),
    ]),
  );
};
