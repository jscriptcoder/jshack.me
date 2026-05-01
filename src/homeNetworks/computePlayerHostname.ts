import type { Identity } from '../identity/identity.js';
import { deriveHostnameSuffix } from './deriveHostnameSuffix.js';

// Compose the player's full hostname from the workstation name they picked
// at intro plus the identity-derived suffix. Stable per (player, prefix) —
// every consumer (prompt, /etc/hostname, sample log entries, server-side
// occupant row) should resolve to the same value when given the same
// workstationName and identity.
//
// Computed once at game start (in App.tsx) and threaded down to
// SessionProvider, BootScreen, and generateLocalhost. The hostname is a
// permanent property of the player's machine — not a function of which
// LAN they're on. Real laptops don't rename themselves on WiFi connect.

export const computePlayerHostname = (workstationName: string, identity: Identity): string => {
  const playerKey = `ed25519:${identity.publicKeyHex}`;
  return `${workstationName}-${deriveHostnameSuffix(playerKey)}`;
};
