/**
 * The neon effects a player can switch one at a time with `effects`: the text
 * glow, the banner glitch, the HUD frame and the block cursor. They belong to the
 * neon look, not to a palette, so they show only under a theme that has
 * `neonColors`, and the player's settings stand whichever theme they wear.
 *
 * Pure data, no DOM, for the same reason as `themes.ts`.
 */

/** Listing order for `effects`, and the one owner of what the effects are. */
export const EFFECT_NAMES = ['glow', 'glitch', 'hud', 'cursor'] as const;

export type EffectName = (typeof EFFECT_NAMES)[number];

export type Effects = Readonly<Record<EffectName, boolean>>;

/** What a player who has never switched one sees: the neon look in full. */
export const ALL_EFFECTS_ON: Effects = { glow: true, glitch: true, hud: true, cursor: true };

/** Widened to `string` so the lookup needs no assertion to narrow `unknown`. */
const EFFECT_NAME_SET: ReadonlySet<string> = new Set(EFFECT_NAMES);

export const isEffectName = (value: unknown): value is EffectName =>
  typeof value === 'string' && EFFECT_NAME_SET.has(value);
