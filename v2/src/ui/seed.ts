/**
 * Seed state for the terminal — the player's own workstation.
 *
 * The base filesystem tree is now generated deterministically from the
 * player's Ed25519 identity pubkey by `core/generation/buildWorkstationBaseFs`
 * (the seeded-workstation-fs slice). The same identity + `GameConfig` always
 * yields the same `/etc/passwd` + home dirs. IndexedDB-persisted patches are
 * replayed over this base by `state.ts`.
 *
 * Permission note: `/etc/passwd` is readable by root + user only (NOT guest,
 * NOT world) — passwords live inline (jshack has no /etc/shadow), so leaking
 * passwd is a real privilege boundary.
 */

import { asAbsPath, asEpochMs, asMachineId, asPlayerKeyHex, type AbsPath } from '../core/types';
import type { Directory } from '../core/filesystem/types';
import type { Identity, Session } from '../core/commands/types';
import type { GameConfig } from '../core/gameConfig/gameConfig';
import { computeWorkstationId } from '../core/identity/workstation';
import { buildWorkstationBaseFs } from '../core/generation/workstationFs';

/** Default config used by tests + as the development fallback — reproduces the
 *  pre-intro `alice@workstation` workstation so existing behaviour is stable. */
export const SEED_CONFIG: GameConfig = {
  machineName: 'workstation',
  username: 'alice',
  rootPassword: 'hunter2',
};

/** The player's home directory path for a given username. */
export const homePathFor = (username: string): AbsPath => asAbsPath(`/home/${username}`);

/** The player's own-workstation base filesystem, seeded by their identity
 *  pubkey (decision 1: `createPrng('workstation-' + pubkey)`). */
export const seedFs = (config: GameConfig, identity: Identity): Directory =>
  buildWorkstationBaseFs(identity.publicKeyHex, config);

/** Build the bootstrap session for the player's own workstation. The machine
 *  id MUST be the identity-derived `computeWorkstationId` so the server's
 *  own-workstation L1 bypass (suffix match) accepts writes/reads, and the
 *  player_key MUST be the real pubkey the envelope is signed with. The
 *  machine name + username come from the player's typed `GameConfig`. */
export const seedSession = (identity: Identity, config: GameConfig): Session => ({
  id: 'seed-session',
  playerKey: asPlayerKeyHex(identity.publicKeyHex),
  machineId: asMachineId(computeWorkstationId(config.machineName, identity.publicKeyHex)),
  username: config.username,
  userType: 'user',
  kind: 'su',
  createdAt: asEpochMs(0),
});
