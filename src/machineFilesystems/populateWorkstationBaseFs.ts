import { generateLocalhost } from '../generation/generateLocalhost';
import { deriveHostnameSuffix } from '../homeNetworks/homeNetworkHelpers';
import { flattenFileSystemsToRows, type MachineFsRow } from './flattenFileNode';

// Server-side base-FS regen for the player's own workstation. Mirror of
// regenHomeNetworkRows / regenWorldNetworkRows for the workstations
// table — given (player_key, workstationName, username), produce the
// MachineFsRow[] needed to populate machine_filesystems with the
// workstation's base FS.
//
// L2 background (chunk #1b — see plans/l2-own-workstation-backfill.md
// and project_l2_followups memory): without rows in machine_filesystems
// for the player's own workstation, an intruder with a cracked session
// on it forges signed envelopes that bypass L2 because enforceL2's
// leaf-only fallback (`if (!fsResult.found) return null;`) permits
// unchecked. The owner's own writes are gated by isOwnWorkstationOnServer
// (suffix-derived bypass) — that path is unaffected by this projection.
//
// Placeholder values for fields that don't affect FS structure:
//   - PLACEHOLDER_SEED:           seed only drives /etc/passwd content
//                                 (guest password hash) — content is NOT
//                                 stored in machine_filesystems.
//   - PLACEHOLDER_ROOT_PASSWORD:  same — only affects root's hash in
//                                 /etc/passwd content.
//
// The structural invariant is locked in by
// src/generation/generateLocalhost.test.ts. Don't expand the workstations
// table to include seed/rootPassword without first re-validating that
// invariant — the assumption is load-bearing here.

const PLACEHOLDER_SEED = 'regen-only';
const PLACEHOLDER_ROOT_PASSWORD = 'regen-only';

export type RegenWorkstationInput = {
  readonly playerKey: string;
  readonly workstationName: string;
  readonly username: string;
};

export const regenWorkstationRows = (input: RegenWorkstationInput): readonly MachineFsRow[] => {
  const machineId = `${input.workstationName}-${deriveHostnameSuffix(input.playerKey)}`;
  const result = generateLocalhost(
    {
      seed: PLACEHOLDER_SEED,
      workstationName: input.workstationName,
      username: input.username,
      rootPassword: PLACEHOLDER_ROOT_PASSWORD,
    },
    machineId,
  );
  return flattenFileSystemsToRows({ [machineId]: result.fileSystem });
};
