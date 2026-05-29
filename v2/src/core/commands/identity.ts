/**
 * identity — print the player's Ed25519 public key + a short fingerprint.
 *
 * Reads `env.identity.publicKeyHex` (already on the CommandEnv — commands
 * never reach for globals). The key is generated on first launch and persisted
 * in localStorage; it's the player's identifier on the server, referenced by
 * every signed action. Positional args are ignored to match the other no-arg
 * builtins.
 */

import type { Command } from './types';

/** First N hex chars — a glanceable handle for cross-player recognition. */
const FINGERPRINT_LENGTH = 16;

const execute: Command['execute'] = async (env) => {
  const { publicKeyHex } = env.identity;
  const fingerprint = publicKeyHex.slice(0, FINGERPRINT_LENGTH);
  return {
    kind: 'sync',
    lines: [
      { kind: 'text', content: `Identity: ed25519:${publicKeyHex}` },
      { kind: 'text', content: `Fingerprint: ${fingerprint}` },
    ],
    exitCode: 0,
  };
};

export const identity: Command = {
  name: 'identity',
  description: 'Show your player identity (Ed25519 public key)',
  category: 'general',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'identity',
    description:
      'Print your Ed25519 public key and a short fingerprint. The key is generated on first run and stored in browser localStorage; clear it via devtools to start a fresh identity.',
    examples: [
      { command: 'identity', description: 'Print your public key and fingerprint' },
    ],
  },
  execute,
};
