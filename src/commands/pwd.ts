import type { Command } from '../components/Terminal/types';

export const createPwdCommand = (getCurrentPath: () => string): Command => ({
  name: 'pwd',
  category: 'filesystem',
  description: 'Print current working directory',
  manual: {
    synopsis: 'pwd',
    description: 'Print the absolute path of the current working directory.',
    examples: [{ command: 'pwd', description: 'Show current directory path' }],
  },
  fn: (): string => getCurrentPath(),
});
