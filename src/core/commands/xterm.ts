/**
 * xterm — open another terminal.
 *
 * The new one boots on the player's OWN workstation as their own user, even when
 * this one is three ssh hops deep: `env.openTerminal()` asks the UI for a tab
 * that skips hop rehydration. Without that, a second tab would rebuild the hop
 * chain from the server's session rows and land inside the box this tab is
 * standing in — where `exit` in one ends a row the other still believes it
 * holds. The filesystem and the wifi state stay shared; the session does not.
 *
 * A GAME command: there is no `/bin/xterm` to remove.
 */

import type { Command } from './types';

const execute: Command['execute'] = async (env) => {
  env.openTerminal();
  return {
    kind: 'sync',
    lines: [{ kind: 'text', content: 'Opening new terminal...' }],
    exitCode: 0,
  };
};

export const xterm: Command = {
  name: 'xterm',
  description: 'Open another terminal in a new browser tab',
  category: 'general',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'xterm',
    description:
      'Open another terminal in a new browser tab. It starts on your own ' +
      'workstation as your own user, with its own command history, even if this ' +
      'terminal is logged into somewhere else — so you can keep a shell at home ' +
      'while you work elsewhere. The filesystem and your wifi connection are ' +
      'shared between terminals; the session is not.',
    examples: [{ command: 'xterm', description: 'Open another terminal' }],
  },
  // The same pair as `clear`, `theme` and `author`. A backdoor has no browser to
  // open a tab in, and a script looping over this is a popup storm rather than a
  // command.
  withoutTty: 'xterm: must be run from a terminal',
  withoutScript: 'xterm: cannot be run from a script',
  execute,
};
