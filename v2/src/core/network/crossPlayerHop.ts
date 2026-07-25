/**
 * isCrossPlayerWorkstation — the machine-level "am I standing on a box that is not
 * mine?" check. A machine is cross-player when it is neither the caller's OWN
 * workstation (identity-derived suffix match) nor ANY machine the caller owns in
 * their own generated world — a home-LAN host, an inner gateway/switch, a deep
 * chain door, or a deep NPC behind one (`ownChainBaseFsForMachineId` rebuilds its
 * tree). Recognizing the deep chain here is what stops your own gateway/deep boxes
 * from being misread as foreign and served an empty tree instead of their real
 * journal-replayed filesystem.
 *
 * The AP gateway at `.1` is deliberately NOT exempt: it belongs to the access point
 * and is shared by every occupant, so it resolves through the server like any other
 * contested box. That is what makes one occupant's writes to it visible to the rest.
 *
 * This is the shared core of two callers that must agree:
 *   - `ui/activeRoot`'s `isCrossPlayerHop` adds the shell-kind requirement (a hop's
 *     served tree is fetched for an `ssh` hop or a `su` elevation on it), then this.
 *   - `su`'s routing: it doesn't care about the current session's kind, only
 *     whether the box it runs on is foreign (→ server-authoritative elevation) or
 *     own/NPC (→ local passwd read). Keeping the definition in one place stops the
 *     two from drifting.
 */

import { isOwnWorkstation } from '../identity/workstation';
import { ownChainBaseFsForMachineId } from '../generation/lanHostIdentity';

export const isCrossPlayerWorkstation = (args: {
  readonly machineId: string;
  readonly publicKeyHex: string;
  readonly essid: string | null;
}): boolean =>
  !isOwnWorkstation(args.machineId, args.publicKeyHex) &&
  args.essid !== null &&
  ownChainBaseFsForMachineId(args.publicKeyHex, args.essid, args.machineId) === null;
