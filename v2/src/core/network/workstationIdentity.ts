/**
 * workstationIdentityFields — derive the registry fields the server needs to
 * RECONSTRUCT a player's workstation for a cross-player reader (Story 2).
 *
 * A player's box is seeded from their Ed25519 pubkey PLUS their player-chosen
 * `GameConfig` (`username`/`machineName`/`rootPassword`), which lives only in
 * their browser. To let the server rebuild the box (so a different identity can
 * read it), the client ships these three fields on join. The root password
 * travels as an md5 HASH, never plaintext — the server stores it opaquely and
 * never sees the secret. (The guest password is pubkey-seeded, so the server
 * recomputes it from `owner_key` and it does NOT need to travel.)
 *
 * Keeping the hashing here in `core/` — not in the adapter — makes "the plaintext
 * never leaves the browser" a unit-testable property of a pure function.
 */

import { md5 } from '../generation/md5';
import type { GameConfig } from '../gameConfig/gameConfig';

export type WorkstationIdentityFields = {
  readonly workstation_username: string;
  readonly workstation_machine_name: string;
  readonly workstation_root_hash: string;
};

export const workstationIdentityFields = (config: GameConfig): WorkstationIdentityFields => ({
  workstation_username: config.username,
  workstation_machine_name: config.machineName,
  workstation_root_hash: md5(config.rootPassword),
});
