import type { Command, ExitOutput } from '../components/Terminal/types';

export const exitCommand: Command = {
  name: 'exit',
  category: 'general',
  description: 'Return to previous session (SSH connection or user)',
  manual: {
    synopsis: 'exit()',
    description:
      'Return to the previous session state. If switched to another user via su(), ' +
      'returns to the previous user. If in an SSH session, closes the connection ' +
      'and returns to the previous machine. Restores user, machine, and working directory.',
    examples: [{ command: 'exit()', description: 'Return from su or close SSH connection' }],
  },
  fn: (): ExitOutput => ({
    __type: 'exit',
  }),
};
