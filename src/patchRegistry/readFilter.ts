import { canRead } from '../filesystem/permissionWalker.js';
import { deriveHostnameSuffix } from '../homeNetworks/homeNetworkHelpers.js';
import type { FilePermissions } from '../filesystem/types.js';
import type { Credentials } from '../sessionRegistry/types.js';
import type { PatchSummary } from './types.js';
import { matchesReadAllowlist } from './readAllowlist.js';
import { ancestorPaths } from './pathAncestors.js';

// Three-tier server-side read filter for listPatchesForMachines. Per the
// locked-in design (plans/read-path-privacy-filter.md), each row goes
// through:
//
//   Tier 1 — Owner of the machine (workstation suffix matches requester's
//            player_key suffix) → permit. Workstation-only bypass; never
//            fires for other players' workstations, home-net, world-net,
//            or mission machines.
//
//   Tier 2 — Has active session on the machine → walker.canRead with the
//            full ancestor chain. Drop if denied. Applies uniformly to
//            any machine type. Leaf-only fallback: if the target has no
//            row in machine_filesystems, permit (mirrors L2-write).
//
//   Tier 3 — No session → permit only if path matches the externally-
//            observable allowlist; default-deny otherwise. Universal.
//
// The two adapter-injection points (sessionLookup, fsLookup) keep this
// pure: handler-side wiring builds Maps from one bulk SQL call each and
// hands per-machine/per-path getters in.

export type SessionLookup = (machine_id: string) => Credentials | null;
export type FsLookup = (machine_id: string, path: string) => FilePermissions | null;

const isOwnWorkstation = (machine_id: string, playerKey: string): boolean => {
  const expectedSuffix = deriveHostnameSuffix(`ed25519:${playerKey}`);
  return machine_id.endsWith(`-${expectedSuffix}`);
};

export const isRowReadable = (
  row: PatchSummary,
  requesterPlayerKey: string,
  sessionLookup: SessionLookup,
  fsLookup: FsLookup,
): boolean => {
  if (isOwnWorkstation(row.machine_id, requesterPlayerKey)) return true;

  const credentials = sessionLookup(row.machine_id);
  if (credentials !== null) {
    const target = fsLookup(row.machine_id, row.path);
    if (target === null) return true;
    const parentChain = ancestorPaths(row.path)
      .map((parentPath) => fsLookup(row.machine_id, parentPath))
      .filter((perms): perms is FilePermissions => perms !== null);
    return canRead({ userType: credentials.userType, target, parentChain }).allowed;
  }

  return matchesReadAllowlist(row.path);
};

export const filterReadablePatches = (
  rows: readonly PatchSummary[],
  requesterPlayerKey: string,
  sessionLookup: SessionLookup,
  fsLookup: FsLookup,
): readonly PatchSummary[] =>
  rows.filter((row) => isRowReadable(row, requesterPlayerKey, sessionLookup, fsLookup));
