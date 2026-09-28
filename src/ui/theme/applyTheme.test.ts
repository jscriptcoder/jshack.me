import { describe, expect, it } from 'vitest';
import { applyTheme } from './applyTheme.js';
import { ALL_EFFECTS_ON } from '../../core/theme/effects.js';
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

/** What only a neon theme paints: the banner glitch's two split colours, the
 *  background's two corner tints, and the two colours the HUD frame fades between.
 *  Listed by hand for the same reason as above. */
const NEON_PAINTED_TOKENS = [
  '--theme-glitch-a',
  '--theme-glitch-b',
  '--theme-tint-top',
  '--theme-tint-bottom',
  '--theme-frame-a',
  '--theme-frame-b',
] as const;

const resetDocument = () => {
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-look');
  document.documentElement.removeAttribute('data-effects');
};

/** The effects the document is marked as showing, in any order. */
const markedEffects = (): readonly string[] =>
  (document.documentElement.dataset.effects ?? '')
    .split(' ')
    .filter((word) => word !== '')
    .sort();

describe('applyTheme', () => {
  it.each([...THEME_IDS])(
    'paints every token the stylesheet reads, and leaves none of them blank: %s',
    (id) => {
      document.documentElement.removeAttribute('style');

      applyTheme(id, ALL_EFFECTS_ON);

      // A blank token is the failure that matters: the browser falls back to an
      // inherited or unset value, so one missing colour can leave text the same
      // shade as the background with nothing in the console to say why.
      for (const token of PAINTED_TOKENS) {
        expect(document.documentElement.style.getPropertyValue(token)).not.toBe('');
      }
    },
  );

  it.each(['neon', 'redline', 'synth'] as const)(
    'marks the document neon and paints the neon-only tokens: %s',
    (id) => {
      resetDocument();

      applyTheme(id, ALL_EFFECTS_ON);

      expect(document.documentElement.dataset.look).toBe('neon');
      for (const token of NEON_PAINTED_TOKENS) {
        expect(document.documentElement.style.getPropertyValue(token)).not.toBe('');
      }
    },
  );

  it.each(['amber', 'green', 'cyan', 'light'] as const)(
    'takes the neon mark away on switching to a plain theme: %s',
    (id) => {
      // A plain theme must look exactly as it did before the neon themes
      // existed, and every neon rule in the stylesheet hangs off this mark.
      resetDocument();
      applyTheme('neon', ALL_EFFECTS_ON);

      applyTheme(id, ALL_EFFECTS_ON);

      expect(document.documentElement.dataset.look).toBeUndefined();
    },
  );

  it('marks every effect under a neon theme with all of them on', () => {
    resetDocument();

    applyTheme('neon', ALL_EFFECTS_ON);

    expect(markedEffects()).toEqual(['cursor', 'glitch', 'glow', 'hud']);
  });

  it.each(['glow', 'glitch', 'hud', 'cursor'] as const)(
    'leaves the mark off for an effect switched off, and only that one: %s',
    (name) => {
      resetDocument();

      applyTheme('synth', { ...ALL_EFFECTS_ON, [name]: false });

      expect(markedEffects()).toEqual(
        ['cursor', 'glitch', 'glow', 'hud'].filter((marked) => marked !== name),
      );
      // The palette is not an effect: its font and colours stay.
      expect(document.documentElement.dataset.look).toBe('neon');
    },
  );

  it('takes every effect mark away with the neon one under a plain theme', () => {
    // The stylesheet's glow and glitch rules hang off these marks alone, so one
    // left behind would glow a plain theme.
    resetDocument();
    applyTheme('redline', ALL_EFFECTS_ON);

    applyTheme('green', ALL_EFFECTS_ON);

    expect(document.documentElement.dataset.effects).toBeUndefined();
  });

  it('paints the default theme exactly as the stylesheet does before any script runs', () => {
    // `index.css` has to hold its own copy of the default palette, because it
    // paints the first frame before this module has loaded. A copy nothing
    // checks is one a change of default forgets, and then a first-time player
    // boots in one colour and flips to another as the script arrives.
    document.documentElement.removeAttribute('style');

    applyTheme(DEFAULT_THEME_ID, ALL_EFFECTS_ON);

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
