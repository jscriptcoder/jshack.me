/**
 * resolveChildGatewayHop — descend into the CHILD GATEWAY that fronts the next layer
 * down a home's deep chain. Both the ssh reach (`authCreateSessionInnerGateway`) and the
 * upstream scan (`resolveInnerGatewayScan`) walk that chain hop by hop, and both resolve
 * a child the same way: derive its identity from the parent gateway + the child's deep
 * IP, replay its OWN journal over its seeded base, and boot-gate it. Keeping that in one
 * place is what stops the reach and the scan from disagreeing about whether a deeper
 * gateway is reachable.
 *
 * Three outcomes: the materialized gateway (its tree + machine id); a brick (a `/boot`
 * tombstone on its journal takes the deeper chain dark); or a journal-fetch failure (a
 * server error, kept distinct from a dark gateway so a lookup failure never reads as
 * "unreachable"). The child's `kind` is the caller's to supply — it already holds the
 * `childGateway` LanHost — so the hop returns only what it had to fetch to resolve.
 */

import { canBoot } from '../boot/bootFiles';
import { resolveDeepGatewayIdentity } from '../generation/lanHostIdentity';
import { materializeMachineFs, type OwnerPatchRow } from './materializeMachineFs';
import type { Directory } from '../filesystem/types';

export type ChildGatewayHop =
  | { readonly kind: 'gateway'; readonly fs: Directory; readonly machineId: string }
  | { readonly kind: 'bricked' }
  | { readonly kind: 'lookup_failed' };

/** The journal lookup the hop replays a child gateway from — scoped to its `machine_id`,
 *  in server order. Both chain handlers already carry one of exactly this shape. */
export type FindPatches = (query: {
  readonly machine_id: string;
}) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;

export const resolveChildGatewayHop = async (args: {
  readonly ownerKeyHex: string;
  readonly parentMachineId: string;
  readonly childIp: string;
  readonly findPatches: FindPatches;
}): Promise<ChildGatewayHop> => {
  const child = resolveDeepGatewayIdentity(args.ownerKeyHex, args.parentMachineId, args.childIp);
  const childPatches = await args.findPatches({ machine_id: child.machineId });
  if (childPatches.error) {
    return { kind: 'lookup_failed' };
  }
  const fs = materializeMachineFs(child.baseFs, childPatches.data);
  if (!canBoot(fs).ok) {
    return { kind: 'bricked' };
  }
  return { kind: 'gateway', fs, machineId: child.machineId };
};
