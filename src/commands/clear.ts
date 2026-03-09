import type { Command } from '../components/Terminal/types';

export interface ClearAction {
  __type: 'clear';
}

export const clearCommand: Command = {
  name: 'clear',
  category: 'general',
  description: 'Clear the terminal screen',
  manual: {
    synopsis: 'clear()',
    description:
      'Clear all output from the terminal screen, including the banner. The command history is preserved.',
    examples: [{ command: 'clear()', description: 'Clear the terminal screen' }],
  },
  fn: (): ClearAction => ({
    __type: 'clear',
  }),
};
