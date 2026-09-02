import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME_ID } from '../core/theme/themes';
import { readStoredTheme, storeTheme, THEME_KEY } from './themePersistence';

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
