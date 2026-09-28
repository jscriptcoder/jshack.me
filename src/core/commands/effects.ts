/**
 * effects — list the neon effects, or switch one on or off.
 *
 * A GAME command, like `theme`: there is no `/bin/effects` to remove, so it is
 * always available. It exists so a player who likes a neon palette but not one of
 * its effects can keep the palette; before it, the only way out was a plain theme.
 */

import { EFFECT_NAMES, isEffectName } from '../theme/effects.js';
import type { EffectName } from '../theme/effects.js';
import { THEME_IDS, THEMES } from '../theme/themes.js';
import type { Command, CommandResult, TerminalLine } from './types.js';

/** The one place the words for a state are spelled: listed, confirmed, parsed and
 *  completed all go through it. */
const stateWord = (on: boolean): string => (on ? 'on' : 'off');
const BOTH_STATES = [true, false] as const;

const USAGE = 'effects: usage: effects [<effect> <on|off>]';

const NEON_THEME_IDS = THEME_IDS.filter((id) => THEMES[id].neonColors !== undefined);

/** `  glow     on` — padded like `theme`'s ids, so the states read down a column. */
const listingLine = (name: EffectName, on: boolean): TerminalLine => ({
  kind: 'text',
  content: `  ${name.padEnd(8)} ${stateWord(on)}`,
});

const refusal = (content: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content }],
  exitCode: 1,
});

const execute: Command['execute'] = async (env, args) => {
  const [requested, state] = args;
  if (requested === undefined) {
    const current = env.currentEffects();
    const listing = EFFECT_NAMES.map((name) => listingLine(name, current[name]));
    // The settings stand under a plain theme, so they are still listed; this line
    // is what stops a player wondering why switching one changed nothing.
    const plain = THEMES[env.currentTheme()].neonColors === undefined;
    return {
      kind: 'sync',
      lines: plain
        ? [
            ...listing,
            {
              kind: 'dim',
              content: `Effects show only under the neon themes: ${NEON_THEME_IDS.join(', ')}.`,
            },
          ]
        : listing,
      exitCode: 0,
    };
  }

  if (!isEffectName(requested)) {
    return refusal(`effects: unknown effect '${requested}'. Available: ${EFFECT_NAMES.join(', ')}`);
  }
  const on = BOTH_STATES.find((candidate) => stateWord(candidate) === state);
  if (on === undefined) return refusal(USAGE);

  env.setEffect(requested, on);
  return {
    kind: 'sync',
    lines: [{ kind: 'text', content: `Switched ${requested} ${stateWord(on)}` }],
    exitCode: 0,
  };
};

export const effects: Command = {
  name: 'effects',
  description: 'List or switch the neon effects',
  category: 'general',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'effects [effect on|off]',
    description:
      'Without arguments, lists the neon effects and whether each is on. With an ' +
      'effect and on or off, switches that one alone. The effects show only under ' +
      'the neon themes, and the choice is remembered, so it still stands after a ' +
      'switch to a plain theme and back.',
    arguments: [
      {
        name: 'effect',
        description: 'The effect to switch',
        required: false,
        // Also what `effects <TAB>` completes against.
        values: [...EFFECT_NAMES],
      },
      {
        name: 'state',
        description: 'on or off',
        required: false,
        // Also what `effects glow <TAB>` completes against.
        values: BOTH_STATES.map(stateWord),
      },
    ],
    examples: [
      { command: 'effects', description: 'List the effects and whether each is on' },
      { command: 'effects glitch off', description: 'Stop the banner glitching' },
      { command: 'effects hud off', description: 'Take the frame and its bars away' },
    ],
  },
  // The same pair as `theme`, for the same reason: a backdoor has no screen to
  // restyle, and a script restyling it mid-run changes a screen the player is
  // reading rather than one they asked it to touch.
  withoutTty: 'effects: must be run from a terminal',
  withoutScript: 'effects: cannot be run from a script',
  execute,
};
