// Public surface of the identity module.
//
// The singleton getIdentity() lazy-initializes from localStorage on first
// call — generating a fresh keypair if none is stored. This is the typical
// entry point for any code that needs the player's identity (commands,
// future patch-signing flows, etc.).
//
// To force a fresh identity, the player clears localStorage manually via
// browser devtools (no in-game UI for this — see
// project_multiplayer_identity_wallet_keys memory).

export { generateIdentity, sign, verify, type Identity } from './identity.js';
export { saveIdentity, loadIdentity, clearIdentity, getOrCreateIdentity } from './storage.js';

import { getOrCreateIdentity } from './storage.js';
import type { Identity } from './identity.js';

let cached: Identity | null = null;

// Lazy singleton — reads or generates the identity on first call, caches
// the result for the lifetime of the page. `localStorage` is available
// synchronously in the browser, so this stays sync.
export const getIdentity = (): Identity => {
  if (cached) return cached;
  cached = getOrCreateIdentity(localStorage);
  return cached;
};

// Test-only: clears the in-memory cache so the next getIdentity() re-reads
// from storage. Doesn't touch localStorage itself.
export const resetIdentityCache = (): void => {
  cached = null;
};
