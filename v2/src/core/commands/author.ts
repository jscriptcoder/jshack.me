/**
 * author — show the card of the person who wrote this.
 *
 * A screen, not a line. The scrollback holds `{ kind, content }` strings and
 * cannot carry a component, so the card arrives the way `nano` and `lynx` do: a
 * `mode_change` the UI answers by handing over the whole terminal. The
 * alternative — teaching `TerminalLine` a renderable kind — would make pipes,
 * redirects, a script's captured output and the log writers all answer what a
 * non-string line means, for one command.
 *
 * A GAME command: there is no `/bin/author` to remove.
 */

import type { Command } from './types';

const execute: Command['execute'] = async () => ({
  kind: 'mode_change',
  mode: { kind: 'author' },
});

export const author: Command = {
  name: 'author',
  description: 'Show the card of the person who wrote this',
  category: 'general',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'author',
    description:
      'Open a full-screen card about the person who wrote this terminal: who ' +
      'they are, what they have worked on, and where to find them. The links ' +
      'open in a new browser tab. Press ESC or q to go back to the shell.',
    examples: [{ command: 'author', description: 'Open the card' }],
  },
  // The same pair as `clear` and `theme`, for the same reason: this takes over a
  // terminal, so it needs one that exists and one the player is looking at. A
  // backdoor has no screen to take, and a script's output is captured — a card
  // opened mid-run would cover the output the player is reading.
  withoutTty: 'author: must be run from a terminal',
  withoutScript: 'author: cannot be run from a script',
  execute,
};
