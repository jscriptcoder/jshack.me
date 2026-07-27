/**
 * isCrossPlayerWorkstation — the machine-level "am I standing on another PLAYER's
 * box?" check. A machine is cross-player when it is neither the caller's OWN
 * workstation (identity-derived suffix match) nor any machine the NETWORK generates
 * — a home-LAN host, an inner gateway/switch, a deep chain door, or a deep NPC
 * behind one (`generatedBaseFsForMachineId` rebuilds its tree). Recognizing the deep
 * chain here is what stops a generated gateway/deep box from being misread as
 * foreign and served an empty tree instead of its real journal-replayed filesystem.
 *
 * A generated box is shared, not owned: every occupant of the ESSID reaches the same
 * one. What this check separates is generated-world boxes (rebuilt locally from the
 * seed, then replayed) from another player's WORKSTATION (fetched server-side) — the
 * only machine on the network that genuinely belongs to somebody.
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
import { generatedBaseFsForMachineId } from '../generation/lanHostIdentity';

export const isCrossPlayerWorkstation = (args: {
  readonly machineId: string;
  readonly publicKeyHex: string;
  readonly essid: string | null;
}): boolean =>
  !isOwnWorkstation(args.machineId, args.publicKeyHex) &&
  args.essid !== null &&
  generatedBaseFsForMachineId(args.essid, args.machineId) === null;
