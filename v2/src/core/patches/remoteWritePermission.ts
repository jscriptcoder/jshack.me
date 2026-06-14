/**
 * remoteWritePermission — L2 for the patch write path: once L1 (`authorizeMachineAccess`)
 * confirms the caller holds an ACTIVE ssh session on a foreign host, L2 confirms
 * the session's TIER is actually allowed to write the target path on THAT host.
 *
 * v2 has no stored permission projection — the host FS is pure-generated — so the
 * server REGENERATES it: recover the host from its coordinate `machine_id` + the
 * session's `essid` (`hostForMachineId`), rebuild `buildRemoteHostFs`, replay the
 * machine's prior patches, and ask the SHARED `createFsView`/`walker` the exact
 * same `canWrite` question the own-box client asks — one walker, no drift. A host
 * that no longer resolves on the LAN can't be perm-checked, so the write is denied
 * (fail closed). Own-workstation writes never reach here (L1 bypasses L2).
 */

import { applyPatches, type Patch } from '../filesystem/applyPatches';
import { createFsView } from '../filesystem/fsView';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { hostForMachineId } from '../generation/remoteHostId';
import { asAbsPath } from '../types';
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

export type RemoteWriteCheck = {
  readonly publicKey: string;
  readonly machineId: string;
  readonly path: string;
  readonly session: ActiveSession;
  readonly priorPatches: readonly Patch[];
};

export const isRemoteWriteAllowed = (check: RemoteWriteCheck): boolean => {
  const host = hostForMachineId(check.publicKey, check.session.essid, check.machineId);
  if (host === null) return false;
  const tree = applyPatches(
    buildRemoteHostFs(check.publicKey, check.session.essid, host),
    check.priorPatches,
  );
  return createFsView(tree, { userType: check.session.userType }).canWrite(asAbsPath(check.path))
    .allowed;
};

/** A 403/500 the caller should return verbatim, or `null` when the write may
 *  proceed. */
export type L2Denial = { readonly status: number; readonly error: string };

/**
 * The shared L2 step for the write handlers (`upsertPatch`, `removePatch`). Given
 * the L1 outcome's `session` (null = own-workstation bypass; client enforces
 * own-box L2), fetch the machine's prior patches and ask `isRemoteWriteAllowed`.
 * Returns the denial response to surface, or `null` to let the write through.
 */
export const enforceRemoteWriteL2 = async (args: {
  readonly publicKey: string;
  readonly machineId: string;
  readonly path: string;
  readonly session: ActiveSession | null;
  readonly listMachinePatches: ListMachinePatches;
}): Promise<L2Denial | null> => {
  if (args.session === null) return null;

  const prior = await args.listMachinePatches({
    machine_id: args.machineId,
  });
  if (prior.error) return { status: 500, error: 'permission_check_failed' };

  const allowed = isRemoteWriteAllowed({
    publicKey: args.publicKey,
    machineId: args.machineId,
    path: args.path,
    session: args.session,
    priorPatches: prior.data ?? [],
  });
  return allowed ? null : { status: 403, error: 'permission_denied' };
};
