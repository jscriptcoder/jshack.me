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
 *   2. a FOREIGN player workstation, rebuilt from the OWNER's identity held in
 *      `home_network_occupants` (decision D6) — a cross-player write to another
 *      player's box. The own-LAN resolvers miss (it's not on the caller's LAN), so we
 *      reverse-look-up occupancy and rebuild A's tree the SAME way the cross-player
 *      READ does, then walk it at the session tier. Occupancy doubles as the
 *      reachability test: a machine taken off the WiFi resolves to nothing.
 * A target that resolves as neither can't be perm-checked, so the write is denied
 * (fail closed). Own-workstation writes never reach here (L1 bypasses L2).
 */

import { applyPatches, type Patch } from '../filesystem/applyPatches';
import { createFsView } from '../filesystem/fsView';
import {
  chainGatewayBaseFsForMachineId,
  lanBaseFsForMachineId,
} from '../generation/lanHostIdentity';
import { buildWorkstationBaseFsFromIdentity } from '../generation/workstationFs';
import { buildApGatewayBaseFs } from '../generation/routerFs';
import { computeApGatewayId } from '../identity/router';
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

/** Whose workstation this is, from `home_network_occupants` (PK `(essid, owner_key)`),
 *  which carries the identity fields needed to rebuild A's tree. Occupancy means "this
 *  machine is on that WiFi" — exactly the condition that makes a box writable — so a
 *  player who ran `nmcli disconnect` resolves to nothing here and the write fails
 *  closed. Only ever a WORKSTATION: every gateway on the session's own ESSID is already
 *  resolved above it, from the ESSID itself. */
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
  readonly machineId: string;
  readonly session: ActiveSession;
  readonly findOccupantWorkstationByMachineId: FindOccupantWorkstationByMachineId;
}): Promise<ResolvedBase> => {
  // Any host on the session's LAN — a journal-backed edge router or inner gateway (a
  // `ssh root@<gateway>` hop), or an NPC sibling — rebuilds from the ESSID via the shared
  // resolver, the SAME tree the client edits, so a root-tier `rules.v4` write walks the
  // real router perms.
  // The AP gateway at `.1`. The LAN walker deliberately skips that octet — the gateway
  // belongs to the access point rather than sitting on its LAN as a host — so it gets
  // its own arm. Standing on it means holding a session opened against it, and that
  // session records the ESSID, which is the whole seed its tree needs. The id is a pure
  // function of the ESSID, so a gateway on any OTHER network cannot be reached by
  // claiming its id here.
  if (computeApGatewayId(args.session.essid) === args.machineId) {
    return { fs: buildApGatewayBaseFs(args.session.essid), error: null };
  }
  const lanFs = lanBaseFsForMachineId(args.session.essid, args.machineId);
  if (lanFs !== null) {
    return { fs: lanFs, error: null };
  }
  // A deep chain gateway (an L2+ chain door rooted through a forward) lives BELOW the home
  // LAN, so it isn't a `generateHomeLan` host. Resolve it from the ESSID so `nano rules.v4`
  // on it walks the real router perms — the write that lets a player chain a forward one
  // layer deeper, on the box every other occupant of the network reaches too.
  const deepGatewayFs = chainGatewayBaseFsForMachineId(args.session.essid, args.machineId);
  if (deepGatewayFs !== null) {
    return { fs: deepGatewayFs, error: null };
  }
  // Not a machine the session's own network generates, so it is another player's
  // workstation. Occupancy is both the identity source and the reachability test: it
  // rebuilds the OWNER's tree (D6), so the write walks the SAME perms the owner sees
  // rather than a caller regeneration — and a machine whose owner has taken it off the
  // WiFi resolves to nothing, leaving `fs: null` so the caller fails the write closed.
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
  readonly machineId: string;
  readonly path: string;
  readonly session: ActiveSession | null;
  readonly listMachinePatches: ListMachinePatches;
  readonly findOccupantWorkstationByMachineId: FindOccupantWorkstationByMachineId;
}): Promise<L2Denial | null> => {
  if (args.session === null) return null;

  const prior = await args.listMachinePatches({ machine_id: args.machineId });
  if (prior.error) return { status: 500, error: 'permission_check_failed' };

  const base = await resolveTargetBaseFs({
    machineId: args.machineId,
    session: args.session,
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
