/**
 * One hop onto a deep layer, for the two kinds of box that live there: the CHILD GATEWAY
 * fronting the next layer down, and the TERMINAL host at the end of the chain. Both the
 * reach (`resolveInnerGatewayTarget`) and the upstream scan (`resolveInnerGatewayScan`)
 * walk the same chain, and both resolve a box the same way: derive its identity, replay
 * its OWN journal over its seeded base, and boot-gate it. Keeping that in one place is
 * what stops the reach and the scan from disagreeing about what is down there — a
 * disagreement that was real for the terminal box, which neither of them read at all
 * until every symptom of it had shipped.
 *
 * Three outcomes: the materialized box (its tree + machine id); a brick (a `/boot`
 * tombstone on its journal takes it dark, and a gateway's brick darkens the chain below
 * it); or a journal-fetch failure (a server error, kept distinct from a dark box so a
 * lookup failure never reads as "unreachable"). What each caller DOES with a brick is its
 * own: the reach refuses it, the scan advertises nothing for it.
 *
 * Neither hop asks what is listening. Which box a port names and whether its daemon is up
 * are different questions, and the second one belongs to the door that names a service.
 */

import { canBoot } from '../boot/bootFiles';
import { resolveDeepGatewayIdentity } from '../generation/lanHostIdentity';
import { buildDeepHostFs } from '../generation/deepHostFs';
import { hostMachineId } from '../generation/remoteHostId';
import { materializeMachineFs, type OwnerPatchRow } from './materializeMachineFs';
import type { Directory } from '../filesystem/types';
import type { LanHost, LanHostKind } from '../generation/generateHomeLan';

export type DeepBoxHop =
  | { readonly kind: 'box'; readonly fs: Directory; readonly machineId: string }
  | { readonly kind: 'bricked' }
  | { readonly kind: 'lookup_failed' };

/** The journal lookup the hop replays a child gateway from — scoped to its `machine_id`,
 *  in server order. Both chain handlers already carry one of exactly this shape. */
export type FindPatches = (query: {
  readonly machine_id: string;
}) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;

/** The step both hops share: fetch this box's journal, replay it over the seeded base
 *  the caller derived, and refuse it if what comes out cannot boot. */
const replayBox = async (
  box: { readonly machineId: string; readonly baseFs: Directory },
  findPatches: FindPatches,
): Promise<DeepBoxHop> => {
  const patches = await findPatches({ machine_id: box.machineId });
  if (patches.error) {
    return { kind: 'lookup_failed' };
  }
  const fs = materializeMachineFs(box.baseFs, patches.data);
  return canBoot(fs).ok ? { kind: 'box', fs, machineId: box.machineId } : { kind: 'bricked' };
};

/** The child gateway fronting the next layer down. Its `kind` is the caller's to supply —
 *  the caller already holds the `childGateway` LanHost. */
export const resolveChildGatewayHop = async (args: {
  readonly parentMachineId: string;
  readonly childIp: string;
  readonly childKind: LanHostKind;
  readonly findPatches: FindPatches;
}): Promise<DeepBoxHop> =>
  replayBox(
    resolveDeepGatewayIdentity(args.parentMachineId, args.childIp, args.childKind),
    args.findPatches,
  );

/** The terminal NPC at the end of the chain — the box a session lands on, the accounts a
 *  sweep enumerates, and the store or database a data door answers from. */
export const resolveDeepHostHop = async (args: {
  readonly essid: string;
  readonly host: LanHost;
  readonly findPatches: FindPatches;
}): Promise<DeepBoxHop> =>
  replayBox(
    {
      machineId: hostMachineId(args.host, args.essid),
      baseFs: buildDeepHostFs(args.essid, args.host),
    },
    args.findPatches,
  );
