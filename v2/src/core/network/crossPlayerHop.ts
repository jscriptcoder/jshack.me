/**
 * isCrossPlayerWorkstation — the machine-level "am I standing on ANOTHER player's
 * registered box?" check. A machine is cross-player when it is none of: the
 * caller's OWN workstation (identity-derived suffix match), the caller's OWN
 * router (its own id namespace), or ANY machine the caller owns in their own
 * generated world — a home-LAN host, an inner gateway/switch, a deep chain door,
 * or a deep NPC behind one (`ownChainBaseFsForMachineId` rebuilds its tree). The
 * only way to hold a session on a cross-player machine is a public-IP login into
 * another identity's box. Recognizing the deep chain here is what stops your own
 * gateway/deep boxes from being misread as foreign and served an empty tree
 * instead of their real journal-replayed filesystem.
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
import { isOwnRouter } from '../identity/router';
import { ownChainBaseFsForMachineId } from '../generation/lanHostIdentity';

export const isCrossPlayerWorkstation = (args: {
  readonly machineId: string;
  readonly publicKeyHex: string;
  readonly essid: string | null;
}): boolean =>
  !isOwnWorkstation(args.machineId, args.publicKeyHex) &&
  !isOwnRouter(args.machineId, args.publicKeyHex) &&
  args.essid !== null &&
  ownChainBaseFsForMachineId(args.publicKeyHex, args.essid, args.machineId) === null;
