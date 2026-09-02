/**
 * Theme persistence — the "survives a reload" half of `theme`.
 *
 * Takes an injected `Storage`-like object rather than reaching for
 * `localStorage`, so the round-trip is pure and unit-testable with a fake map;
 * `ui/state` supplies the real one.
 *
 * Every unreadable value reads back as the default. The key is plain text in an
 * origin the player can hand-edit, and a boot that threw — or painted nothing —
 * on a bad value would leave them staring at an unstyled page with no command
 * line to fix it from.
 */

import { DEFAULT_THEME_ID, isValidThemeId } from '../core/theme/themes';
import type { ThemeId } from '../core/theme/themes';

export const THEME_KEY = 'jshack:theme';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const readStoredTheme = (storage: StorageLike): ThemeId => {
  const stored = storage.getItem(THEME_KEY);
  return isValidThemeId(stored) ? stored : DEFAULT_THEME_ID;
};

export const storeTheme = (storage: StorageLike, id: ThemeId): void => {
  storage.setItem(THEME_KEY, id);
};
