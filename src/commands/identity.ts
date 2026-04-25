import type { Command } from '../components/Terminal/types';
import type { Identity } from '../identity/identity.js';

type CreateIdentityCommandOptions = {
  readonly getIdentity: () => Identity;
};

// Renders the first N hex characters as a short, human-glanceable fingerprint.
// The full public key stays available for copy-paste below.
const FINGERPRINT_LENGTH = 16;

export const createIdentityCommand = ({ getIdentity }: CreateIdentityCommandOptions): Command => ({
  name: 'identity',
  category: 'general',
  description: 'Show your player identity (Ed25519 public key)',
  manual: {
    synopsis: 'identity',
    description:
      "Print your player's Ed25519 public key. The key is generated on first run and stored in browser localStorage; it survives in-game permadeath but is replaced if you clear the browser data. The key is your identity on the server — every signed action references it. To start a fresh identity, clear localStorage via browser devtools.",
    examples: [{ command: 'identity', description: 'Show the current public key + fingerprint' }],
  },
  fn: (): string => {
    const { publicKeyHex } = getIdentity();
    const fingerprint = publicKeyHex.slice(0, FINGERPRINT_LENGTH);
    return [`Identity:    ed25519:${publicKeyHex}`, `Fingerprint: ${fingerprint}`].join('\n');
  },
});
