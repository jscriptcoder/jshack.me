/**
 * pwd — print the current working directory.
 *
 * Reads `env.fs.cwd()` (which routes through the UI's cwd signal) and emits
 * it as a single text line. Positional args are ignored to match real bash.
 */

import type { Command } from './types';

const execute: Command['execute'] = async (env) => ({
  kind: 'sync',
  lines: [{ kind: 'text', content: env.fs.cwd() }],
  exitCode: 0,
});

export const pwd: Command = {
  name: 'pwd',
  description: 'Print the working directory',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'pwd',
    description: 'Print the absolute path of the current shell working directory.',
    examples: [
      { command: 'pwd', description: 'Print the current working directory' },
    ],
  },
  execute,
};
