import type { Command } from '../components/Terminal/types';

export const xtermCommand: Command = {
  name: 'xterm',
  description: 'Open a new terminal in a browser tab',
  manual: {
    synopsis: 'xterm()',
    description:
      'Open a new terminal session in a separate browser tab. Each tab runs an independent session with its own user, machine, path, and command history. Filesystem, WiFi state, and mission state are shared across tabs.',
    examples: [{ command: 'xterm()', description: 'Open a new terminal tab' }],
  },
  fn: (): string => {
    window.open(window.location.href, '_blank');
    return 'Opening new terminal...';
  },
};
