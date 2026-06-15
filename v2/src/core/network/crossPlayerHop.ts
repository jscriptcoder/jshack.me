/**
 * isCrossPlayerWorkstation — the machine-level "am I standing on ANOTHER player's
 * registered box?" check. A machine is cross-player when it is neither the
 * caller's OWN workstation (identity-derived suffix match) nor a host on the LAN
 * they're connected to (`hostForMachineId` resolves it) — the only way to hold a
 * session on such a machine is a public-IP login into another identity's box.
 *
 * This is the shared core of two callers that must agree:
 *   - `ui/activeRoot`'s `isCrossPlayerHop` adds the ssh-kind requirement (a hop's
 *     served tree is fetched only for an ssh session), then this.
 *   - `su`'s routing: it doesn't care about the current session's kind, only
 *     whether the box it runs on is foreign (→ server-authoritative elevation) or
 *     own/NPC (→ local passwd read). Keeping the definition in one place stops the
 *     two from drifting.
 */

import { isOwnWorkstation } from '../identity/workstation';
import { hostForMachineId } from '../generation/remoteHostId';

export const isCrossPlayerWorkstation = (args: {
  readonly machineId: string;
  readonly publicKeyHex: string;
  readonly essid: string | null;
}): boolean =>
  !isOwnWorkstation(args.machineId, args.publicKeyHex) &&
  args.essid !== null &&
  hostForMachineId(args.publicKeyHex, args.essid, args.machineId) === null;
