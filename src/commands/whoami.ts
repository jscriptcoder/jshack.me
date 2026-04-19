import type { Command } from '../components/Terminal/types';

export const createWhoamiCommand = (getUsername: () => string): Command => ({
  name: 'whoami',
  category: 'filesystem',
  description: 'Print current user name',
  manual: {
    synopsis: 'whoami',
    description:
      'Print the user name associated with the current session. This is useful to verify which user you are currently logged in as after using su to switch users.',
    examples: [{ command: 'whoami', description: 'Display the current user name' }],
  },
  fn: (): string => getUsername(),
});
