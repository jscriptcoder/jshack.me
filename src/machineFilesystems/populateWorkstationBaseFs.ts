import { generateLocalhost } from '../generation/generateLocalhost';
import { computeWorkstationId } from '../homeNetworks/homeNetworkHelpers';
import { flattenFileSystemsToRows, type MachineFsRow } from './flattenFileNode';

// Server-side base-FS regen for the player's own workstation. Mirror of
// regenHomeNetworkRows / regenWorldNetworkRows for the workstations
// table — given (player_key, workstationName, username, seed,
// rootPassword), produce the MachineFsRow[] needed to populate
// machine_filesystems with the workstation's base FS.
//
// L2 background (chunk #1b — see project_l2_followups memory): without
// rows in machine_filesystems for the player's own workstation, an
// intruder with a cracked session on it forges signed envelopes that
// bypass L2 because enforceL2's leaf-only fallback (`if (!fsResult.found)
// return null;`) permits unchecked. The owner's own writes are gated by
// isOwnWorkstationOnServer (suffix-derived bypass) — that path is
// unaffected by this projection.
//
// PR 1 of plans/cross-player-base-fs-replication.md drops the previous
// PLACEHOLDER_SEED + PLACEHOLDER_ROOT_PASSWORD constants. Cross-player
// password validation (PR 2) compares the player's submitted password
// against the hash inside projected /etc/passwd content; with placeholder
// values, that comparison would always fail. Real seed and rootPassword
// come from the registration envelope; rootPassword is consumed here and
// discarded by the caller (never persisted as a column).
//
// FS structure invariant under (seed, rootPassword, hostname) is locked
// in by src/generation/generateLocalhost.test.ts — only /etc/passwd
// content depends on these inputs; paths/owners/perms are stable.

export type RegenWorkstationInput = {
  readonly playerKey: string;
  readonly workstationName: string;
  readonly username: string;
  readonly seed: string;
  readonly rootPassword: string;
};

export const regenWorkstationRows = (input: RegenWorkstationInput): readonly MachineFsRow[] => {
  // computeWorkstationId mirrors the client's computePlayerHostname —
  // both prepend 'ed25519:' before hashing. Using deriveHostnameSuffix
  // directly with raw playerKey would produce a different suffix and
  // make the server-stored machine_id diverge from the client's
  // session.machine. See homeNetworkHelpers.ts for the rationale.
  const machineId = computeWorkstationId(input.workstationName, input.playerKey);
  const result = generateLocalhost(
    {
      seed: input.seed,
      workstationName: input.workstationName,
      username: input.username,
      rootPassword: input.rootPassword,
    },
    machineId,
  );
  return flattenFileSystemsToRows({ [machineId]: result.fileSystem });
};
