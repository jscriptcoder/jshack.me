/**
 * clear — empty the terminal screen.
 *
 * Calls `env.clearScreen()`, which the UI backs by emptying the scrollback and
 * taking the boot banner down with it. Emits no lines of its own: anything it
 * printed would be the only thing left on the screen it just cleared.
 *
 * A real binary rather than a shell builtin, so `rm /bin/clear` takes it away
 * like any other tool — legacy made it a builtin, which no `/bin` listing could
 * account for.
 */

import type { Command } from './types';

const execute: Command['execute'] = async (env) => {
  env.clearScreen();
  return { kind: 'sync', lines: [], exitCode: 0 };
};

export const clear: Command = {
  name: 'clear',
  description: 'Clear the terminal screen',
  category: 'general',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'clear',
    description:
      'Empty the terminal screen, taking the boot banner with it. The command ' +
      'history is kept: the line you ran before the clear is still one press of ' +
      'the up arrow away. Ctrl-L does the same thing without submitting a line, ' +
      'and leaves whatever you were half-way through typing in place.',
    examples: [
      { command: 'clear', description: 'Empty the screen and carry on at a fresh prompt' },
    ],
  },
  // Acting on a terminal needs one that exists AND one the player is looking at.
  // A backdoor has no screen to clear; a script has a screen, but the player is
  // reading its output scroll past, and wiping it mid-run acts on a terminal
  // they are watching rather than driving.
  withoutTty: 'clear: must be run from a terminal',
  withoutScript: 'clear: cannot be run from a script',
  execute,
};
