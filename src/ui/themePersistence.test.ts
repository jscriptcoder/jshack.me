import { describe, expect, it } from 'vitest';
import { ALL_EFFECTS_ON } from '../core/theme/effects.js';
import { DEFAULT_THEME_ID } from '../core/theme/themes.js';
import {
  EFFECTS_KEY,
  readStoredEffects,
  readStoredTheme,
  storeEffects,
  storeTheme,
  THEME_KEY,
} from './themePersistence.js';

/**
 * The theme is the one preference the game remembers for its own sake, so the
 * round-trip is proven over an injected storage rather than a browser. Every
 * unreadable value has to land on the default: the key is plain text in an
 * origin the player can hand-edit, and a boot that threw or painted nothing
 * would leave them with no way back.
 */
const fakeStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string): string | null => (map.has(key) ? (map.get(key) ?? null) : null),
    setItem: (key: string, value: string): void => {
      map.set(key, String(value));
    },
    removeItem: (key: string): void => {
      map.delete(key);
    },
  };
};

describe('theme persistence', () => {
  it('reads back the theme it stored', () => {
    const storage = fakeStorage();

    storeTheme(storage, 'green');

    expect(readStoredTheme(storage)).toBe('green');
  });

  it('keeps the newest choice when the theme is switched again', () => {
    const storage = fakeStorage();

    storeTheme(storage, 'green');
    storeTheme(storage, 'light');

    expect(readStoredTheme(storage)).toBe('light');
  });

  it('falls back to the default when nothing has ever been stored', () => {
    expect(readStoredTheme(fakeStorage())).toBe(DEFAULT_THEME_ID);
  });

  it('falls back to the default for a value that names no theme', () => {
    const storage = fakeStorage();
    storage.setItem(THEME_KEY, 'chartreuse');

    expect(readStoredTheme(storage)).toBe(DEFAULT_THEME_ID);
  });

  it('falls back to the default for an empty stored value', () => {
    const storage = fakeStorage();
    storage.setItem(THEME_KEY, '');

    expect(readStoredTheme(storage)).toBe(DEFAULT_THEME_ID);
  });
});

describe('effects persistence', () => {
  it('reads back the effects it stored', () => {
    const storage = fakeStorage();
    const chosen = { ...ALL_EFFECTS_ON, glitch: false, hud: false };

    storeEffects(storage, chosen);

    expect(readStoredEffects(storage)).toEqual(chosen);
  });

  it('reads back an effect switched on again', () => {
    const storage = fakeStorage();

    storeEffects(storage, { ...ALL_EFFECTS_ON, glow: false });
    storeEffects(storage, ALL_EFFECTS_ON);

    expect(readStoredEffects(storage)).toEqual(ALL_EFFECTS_ON);
  });

  it('keeps the effects under their own key, leaving the theme alone', () => {
    const storage = fakeStorage();
    storeTheme(storage, 'synth');

    storeEffects(storage, { ...ALL_EFFECTS_ON, cursor: false });

    expect(readStoredTheme(storage)).toBe('synth');
  });

  it('has every effect on when nothing has ever been stored', () => {
    expect(readStoredEffects(fakeStorage())).toEqual(ALL_EFFECTS_ON);
  });

  it.each([
    ['names no effect', 'scanlines'],
    ['names an effect beside one that is no effect', 'glitch scanlines'],
    ['is not a list of names at all', '{"glitch":false}'],
  ])('has every effect on when the stored value %s', (_case, stored) => {
    // The same rule as the theme: the key is plain text a player can hand-edit,
    // and a value this code did not write is not half-trusted.
    const storage = fakeStorage();
    storage.setItem(EFFECTS_KEY, stored);

    expect(readStoredEffects(storage)).toEqual(ALL_EFFECTS_ON);
  });
});
