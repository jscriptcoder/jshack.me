/**
 * remoteWritePermission — L2 for the patch write path: once L1 (`authorizeMachineAccess`)
 * confirms the caller holds an ACTIVE ssh session on a foreign host, L2 confirms
 * the session's TIER is actually allowed to write the target path on THAT host.
 *
 * v2 has no stored permission projection — the host FS is pure-generated — so the
 * server REGENERATES it and asks the SHARED `createFsView`/walker the exact same
 * `canWrite` question the own-box client asks (one walker, no drift). The base FS
 * is resolved two ways:
 *   1. an NPC host on the CALLER's own regenerated LAN (`hostForMachineId` →
 *      `buildRemoteHostFs`) — an ssh hop to a generated machine, pure;
 *   2. a registered FOREIGN player workstation, rebuilt from the OWNER's identity
 *      via the registry (decision D6) — a cross-player write to another player's
 *      box. `hostForMachineId` misses (it's not on the caller's LAN), so we
 *      reverse-look-up the registry and rebuild A's tree the SAME way the
 *      cross-player READ does, then walk it at the session tier.
 * A target that resolves as neither can't be perm-checked, so the write is denied
 * (fail closed). Own-workstation writes never reach here (L1 bypasses L2).
 */

import { applyPatches, type Patch } from '../filesystem/applyPatches';
import { createFsView } from '../filesystem/fsView';
import { ownLanBaseFsForMachineId } from '../generation/lanHostIdentity';
import { buildWorkstationBaseFsFromIdentity } from '../generation/workstationFs';
import { buildRouterBaseFs } from '../generation/routerFs';
import { asAbsPath } from '../types';
import type { Directory } from '../filesystem/types';
import type { ActiveSession } from './authorizeMachineAccess';

/** Prior patches for the regenerated machine, the way `listPatches` returns them
 *  (already mapped to the client `Patch` shape so `applyPatches` can replay). */
export type ListMachinePatchesResult = {
  readonly data: readonly Patch[] | null;
  readonly error: unknown;
};

export type ListMachinePatches = (query: {
  readonly machine_id: string;
}) => Promise<ListMachinePatchesResult>;

/** The registry identity of a registered foreign WORKSTATION — the fields needed to
 *  rebuild the OWNER's box for the cross-player L2 perm check (decision D6). Mirrors
 *  the cross-player READ's registry row so the write walks the SAME tree the read
 *  materializes. */
export type RegistryWorkstation = {
  readonly owner_key: string;
  readonly workstation_username: string;
  readonly workstation_root_hash: string;
};

/** A registered machine resolved by machine_id for the L2 perm check — A's
 *  WORKSTATION (Story 2/3) or A's ROUTER (Story 5.2, B `ssh root`'d into it). The
 *  caller holds only the machine_id and can't know which, so the reverse-lookup
 *  discriminates and the walker rebuilds the matching OWNER tree. The router base
 *  is seeded from the owner key alone, so its arm carries only that. Per-module
 *  (mirrors `resolveCrossPlayerFs`'s `RegistryMachine`). */
export type RegistryMachine =
  | ({ readonly kind: 'workstation' } & RegistryWorkstation)
  | { readonly kind: 'router'; readonly owner_key: string };

export type FindRegistryByMachineId = (
  machineId: string,
) => Promise<{ readonly data: RegistryMachine | null; readonly error: unknown }>;

/** Same-LAN fallback when the registry has no row for the machine. The registry's PK is
 *  the ESSID-shared `public_ip` (last-writer-wins), so a fellow occupant who joined a
 *  shared AP before a later joiner is evicted from it — but never from
 *  `home_network_occupants` (PK `(essid, owner_key)`), which carries the identity fields
 *  needed to rebuild A's tree. Only ever a WORKSTATION — routers live solely in the
 *  registry. Without it a same-LAN cross-player write to an evicted occupant (e.g. a
 *  root `rm /boot`) can't resolve A's tree and falsely fails closed (403). */
export type FindOccupantWorkstationByMachineId = (
  machineId: string,
) => Promise<{ readonly data: RegistryWorkstation | null; readonly error: unknown }>;

/** Rebuild a registered foreign workstation's base FS from its registry identity row
 *  — from the OWNER's identity (decision D6), so the cross-player write L2 walks the
 *  SAME tree the cross-player read materializes, never a caller regeneration. */
export const buildRegisteredWorkstationFs = (registry: RegistryWorkstation): Directory =>
  buildWorkstationBaseFsFromIdentity({
    ownerKeyHex: registry.owner_key,
    username: registry.workstation_username,
    rootPasswordHash: registry.workstation_root_hash,
  });

/** A 403/500 the caller should return verbatim, or `null` when the write may
 *  proceed. */
export type L2Denial = { readonly status: number; readonly error: string };

type ResolvedBase = { readonly fs: Directory | null; readonly error: unknown };

/** Resolve the target's base FS for the L2 perm check: an NPC host on the caller's
 *  own LAN (pure), else a registered foreign workstation via the registry (D6),
 *  else `fs: null` (unresolvable → fail closed). `error` surfaces a registry-lookup
 *  failure so the caller 500s rather than issuing a false deny. */
const resolveTargetBaseFs = async (args: {
  readonly publicKey: string;
  readonly machineId: string;
  readonly session: ActiveSession;
  readonly findRegistryByMachineId: FindRegistryByMachineId;
  readonly findOccupantWorkstationByMachineId: FindOccupantWorkstationByMachineId;
}): Promise<ResolvedBase> => {
  // Any host on the caller's OWN LAN — a journal-backed edge router or inner gateway
  // (a `ssh root@<gateway>` hop), or an NPC sibling — rebuilds from the caller's own
  // key via the shared resolver, the SAME tree the client edits, so a root-tier
  // `rules.v4` write walks the real router perms.
  const ownFs = ownLanBaseFsForMachineId(args.publicKey, args.session.essid, args.machineId);
  if (ownFs !== null) {
    return { fs: ownFs, error: null };
  }
  const registry = await args.findRegistryByMachineId(args.machineId);
  if (registry.error) return { fs: null, error: registry.error };
  if (registry.data !== null) {
    // A registered foreign ROUTER (B `ssh root`'d into A's router) rebuilds from the
    // owner's key alone; a foreign workstation from its persisted identity (D6). Both
    // rebuild the OWNER's tree, so the write walks the SAME perms the owner sees —
    // never a caller regeneration (Story 5.2).
    const fs =
      registry.data.kind === 'router'
        ? buildRouterBaseFs(registry.data.owner_key)
        : buildRegisteredWorkstationFs(registry.data);
    return { fs, error: null };
  }
  // Registry miss → same-LAN occupancy fallback: a shared-AP occupant evicted from the
  // registry by a later joiner (see the dep doc). Always a workstation. A genuine miss
  // here (no occupant either) leaves `fs: null` → the caller fails the write closed.
  const occupant = await args.findOccupantWorkstationByMachineId(args.machineId);
  if (occupant.error) return { fs: null, error: occupant.error };
  if (occupant.data === null) return { fs: null, error: null };
  return { fs: buildRegisteredWorkstationFs(occupant.data), error: null };
};

/**
 * The shared L2 step for the write handlers (`upsertPatch`, `removePatch`). Given
 * the L1 outcome's `session` (null = own-workstation bypass; client enforces
 * own-box L2), resolve the target's tree, replay its prior patches, and ask
 * `createFsView(...).canWrite` at the session tier. Returns the denial response to
 * surface, or `null` to let the write through.
 */
export const enforceRemoteWriteL2 = async (args: {
  readonly publicKey: string;
  readonly machineId: string;
  readonly path: string;
  readonly session: ActiveSession | null;
  readonly listMachinePatches: ListMachinePatches;
  readonly findRegistryByMachineId: FindRegistryByMachineId;
  readonly findOccupantWorkstationByMachineId: FindOccupantWorkstationByMachineId;
}): Promise<L2Denial | null> => {
  if (args.session === null) return null;

  const prior = await args.listMachinePatches({ machine_id: args.machineId });
  if (prior.error) return { status: 500, error: 'permission_check_failed' };

  const base = await resolveTargetBaseFs({
    publicKey: args.publicKey,
    machineId: args.machineId,
    session: args.session,
    findRegistryByMachineId: args.findRegistryByMachineId,
    findOccupantWorkstationByMachineId: args.findOccupantWorkstationByMachineId,
  });
  if (base.error) return { status: 500, error: 'permission_check_failed' };
  if (base.fs === null) return { status: 403, error: 'permission_denied' };

  const tree = applyPatches(base.fs, prior.data ?? []);
  const allowed = createFsView(tree, { userType: args.session.userType }).canWrite(
    asAbsPath(args.path),
  ).allowed;
  return allowed ? null : { status: 403, error: 'permission_denied' };
};
