/**
 * theme — list the terminal's colour schemes, or switch to one.
 *
 * A GAME command, not a real Linux tool: there is no `/bin/theme` to remove, so
 * it is always available.
 *
 * The listing is column-aligned with a `*` against the active scheme, which is
 * how legacy read and what players of it will expect.
 */

import { isValidThemeId, THEME_IDS, THEMES } from '../theme/themes';
import type { ThemeId } from '../theme/themes';
import type { Command, TerminalLine } from './types';

/** `  * amber    Amber` — marker column, padded id, display name. */
const listingLine = (id: ThemeId, active: ThemeId): TerminalLine => ({
  kind: 'text',
  content: `  ${id === active ? '*' : ' '} ${id.padEnd(8)} ${THEMES[id].name}`,
});

const execute: Command['execute'] = async (env, args) => {
  const requested = args[0];
  if (requested === undefined) {
    const active = env.currentTheme();
    return {
      kind: 'sync',
      lines: THEME_IDS.map((id) => listingLine(id, active)),
      exitCode: 0,
    };
  }

  if (!isValidThemeId(requested)) {
    return {
      kind: 'sync',
      lines: [
        {
          kind: 'error',
          content: `theme: unknown theme '${requested}'. Available: ${THEME_IDS.join(', ')}`,
        },
      ],
      exitCode: 1,
    };
  }

  env.setTheme(requested);
  return {
    kind: 'sync',
    lines: [{ kind: 'text', content: `Switched to ${THEMES[requested].name} theme` }],
    exitCode: 0,
  };
};

export const theme: Command = {
  name: 'theme',
  description: 'List or switch terminal color themes',
  category: 'general',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'theme [name]',
    description:
      'Without arguments, lists the available themes with the current one ' +
      'marked. With a theme name, switches to it. The choice is remembered, so ' +
      'the terminal comes back up in the colour you left it in.',
    arguments: [
      {
        name: 'name',
        description: 'The theme to switch to',
        required: false,
        // Also what `theme <TAB>` completes against.
        values: [...THEME_IDS],
      },
    ],
    examples: [
      { command: 'theme', description: 'List the available themes' },
      { command: 'theme green', description: 'Switch to the green phosphor theme' },
      { command: 'theme light', description: 'Switch to the light theme' },
    ],
  },
  // Same pair as `clear`, for the same reason: a backdoor has no colours to
  // change, and a script repainting the terminal mid-run changes a screen the
  // player is reading rather than one they asked it to touch.
  withoutTty: 'theme: must be run from a terminal',
  withoutScript: 'theme: cannot be run from a script',
  execute,
};
