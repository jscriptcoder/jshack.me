/**
 * whoami — print the account the current session holds.
 *
 * Reads the ACTIVE session, which is what makes the command worth having: it is
 * how a player confirms that an `su` elevation or an `ssh` hop actually took,
 * rather than trusting a prompt they could be misreading.
 */

import type { Command } from './types';

const execute: Command['execute'] = async (env) => ({
  kind: 'sync',
  lines: [{ kind: 'text', content: env.session.username }],
  exitCode: 0,
});

export const whoami: Command = {
  name: 'whoami',
  description: 'Print current user name',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'whoami',
    description:
      'Print the user name of the current session. Use it to confirm which ' +
      'account you are holding after an su elevation or an ssh hop, rather than ' +
      'trusting the prompt.',
    examples: [
      { command: 'whoami', description: 'Print the account the current session holds' },
    ],
  },
  execute,
};
