/**
 * isCrossPlayerWorkstation — the machine-level "am I standing on another PLAYER's
 * box?" check. A machine is cross-player when it is neither the caller's OWN
 * workstation (identity-derived suffix match) nor any machine the NETWORK generates
 * — a home-LAN host, an inner gateway/switch, a deep chain door, or a deep NPC
 * behind one (`generatedBaseFsForMachineId` knows them all).
 *
 * A generated box is shared, not owned: every occupant of the ESSID reaches the same
 * one. What this check separates is those boxes from another player's WORKSTATION, the
 * only machine on a network that genuinely belongs to somebody, and so the only one its
 * owner can take off the network under a visitor. The shell asks it for that reason
 * (`shell/runLine.ts`).
 *
 * It does not decide where a tree is read from. Every box that is not the caller's own
 * workstation is read as the tree the server serves, whoever made it.
 *
 * The AP gateway at `.1` is not a machine the generator's LAN walk makes, so it answers
 * true here; a caller that means players' boxes alone rules it out by its id.
 */

import { isOwnWorkstation } from '../identity/workstation.js';
import { generatedBaseFsForMachineId } from '../generation/lanHostIdentity.js';

export const isCrossPlayerWorkstation = (args: {
  readonly machineId: string;
  readonly publicKeyHex: string;
  readonly essid: string | null;
}): boolean =>
  !isOwnWorkstation(args.machineId, args.publicKeyHex) &&
  args.essid !== null &&
  generatedBaseFsForMachineId(args.essid, args.machineId) === null;
