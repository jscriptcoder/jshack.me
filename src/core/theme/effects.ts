/**
 * The effects a player can switch one at a time with `effects`: the text glow,
 * the banner glitch, the HUD frame and the block cursor. The glow, the glitch and
 * the cursor belong to the neon look, not to a palette, so they show only under a
 * theme that has `neonColors`. The HUD shows under every theme: its bars report
 * live game state, which a plain palette needs as much as a neon one. The player's
 * settings stand whichever theme they wear.
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

/** The effects that show only under a neon theme, in listing order. */
export const NEON_ONLY_EFFECTS: readonly EffectName[] = ['glow', 'glitch', 'cursor'];

export const needsNeonLook = (name: EffectName): boolean => NEON_ONLY_EFFECTS.includes(name);
