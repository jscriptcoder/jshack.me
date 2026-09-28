/**
 * Theme persistence — the "survives a reload" half of `theme` and `effects`.
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

import { ALL_EFFECTS_ON, EFFECT_NAMES, isEffectName } from '../core/theme/effects.js';
import type { Effects } from '../core/theme/effects.js';
import { DEFAULT_THEME_ID, isValidThemeId } from '../core/theme/themes.js';
import type { ThemeId } from '../core/theme/themes.js';

export const THEME_KEY = 'jshack:theme';
export const EFFECTS_KEY = 'jshack:effects';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const readStoredTheme = (storage: StorageLike): ThemeId => {
  const stored = storage.getItem(THEME_KEY);
  return isValidThemeId(stored) ? stored : DEFAULT_THEME_ID;
};

export const storeTheme = (storage: StorageLike, id: ThemeId): void => {
  storage.setItem(THEME_KEY, id);
};

/** Stored as the names of the effects that are OFF, space-separated, so an effect
 *  added later comes up on for a player who switched some other one off. A value
 *  with any word that is not an effect is not half-read: every effect comes up on.
 *  That covers the empty value stored when nothing is off, whose one word is empty. */
export const readStoredEffects = (storage: StorageLike): Effects => {
  const off = (storage.getItem(EFFECTS_KEY) ?? '').split(' ');
  if (!off.every(isEffectName)) return ALL_EFFECTS_ON;
  return EFFECT_NAMES.reduce<Effects>(
    (effects, name) => ({ ...effects, [name]: !off.includes(name) }),
    ALL_EFFECTS_ON,
  );
};

export const storeEffects = (storage: StorageLike, effects: Effects): void => {
  storage.setItem(EFFECTS_KEY, EFFECT_NAMES.filter((name) => !effects[name]).join(' '));
};
