import type { Command } from '../../components/Terminal/types';
import type { NcQuitOutput } from '../../components/Terminal/types';

export const ncExitCommand: Command = {
  name: 'exit',
  category: 'network',
  description: 'Close connection',
  fn: (): NcQuitOutput => ({
    __type: 'nc_quit',
  }),
};
