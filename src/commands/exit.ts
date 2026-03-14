import type { Command, ExitOutput } from '../components/Terminal/types';

export const exitCommand: Command = {
  name: 'exit',
  category: 'general',
  description: 'Close SSH connection and return to previous machine',
  manual: {
    synopsis: 'exit()',
    description:
      'Close the current SSH session and return to the previous machine. ' +
      'This command restores the session state (user, machine, working directory) ' +
      'to what it was before the SSH connection was established.',
    examples: [
      { command: 'exit()', description: 'Close SSH connection and return to previous machine' },
    ],
  },
  fn: (): ExitOutput => ({
    __type: 'exit',
  }),
};
