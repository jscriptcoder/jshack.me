/**
 * exit — leave the active elevated/hopped session, returning to the one beneath
 * it (the inverse of su's push). At the base login session there is nothing to
 * return to, so exit is a harmless no-op — it NEVER closes the game.
 *
 * The decision lives here (core): `env.hopChain` is the stack of sessions below
 * the active one, so a non-empty chain means "we hopped/elevated and can return."
 * The actual pop — restoring the previous tier, prompt, and working directory —
 * is the UI's `env.popSession` seam, mirroring how `su` owns validation but
 * delegates the push to `env.pushSession`. exit is silent on success: the
 * restored prompt is the only feedback.
 */

import type { Command, CommandResult } from './types';

const silent = (): CommandResult => ({ kind: 'sync', lines: [], exitCode: 0 });

const execute: Command['execute'] = async (env) => {
  if (env.hopChain.length > 0) env.popSession();
  return silent();
};

export const exit: Command = {
  name: 'exit',
  description: 'Return to the previous session (drop a su/ssh hop)',
  category: 'general',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  // Popping a hop the script cannot see: `env` is a per-line snapshot, so
  // everything after this would go on answering about the box it left.
  withoutScript: 'exit: cannot be run from a script',
  manual: {
    synopsis: 'exit',
    description:
      'Return to the previous session. After "su", drops the root shell back to your user, restoring your working directory. At your base login shell it does nothing — it never closes the game.',
    examples: [{ command: 'exit', description: 'Drop back to your user after su' }],
  },
  execute,
};
