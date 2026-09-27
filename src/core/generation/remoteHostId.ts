/**
 * remoteHostId — a generated NPC host's machine_id, and the reverse lookup.
 *
 * A host's id is derived from its network COORDINATES (`essid` + `ip`), in a
 * namespace distinct from the player's `'ed25519:'` workstation suffix — so
 * `isOwnWorkstation` never mistakes it for the player's box, and the same host
 * keeps the same id across reloads (forward-compatible with shared LANs: the seed
 * is the host's place on the network, not the viewer's identity).
 *
 * The suffix is a one-way hash, so `hostForMachineId` recovers the host (and thus
 * its IP) by regenerating the current LAN and matching ids — this is how the
 * client/server rebuild the remote FS for a session whose `machine_id` is all
 * they hold.
 */

import { deriveHostnameSuffix } from '../identity/workstation';
import { generateHomeLan, type LanHost } from './generateHomeLan';

/** The coordinate-derived machine_id for a generated host reachable on `essid`. */
export const hostMachineId = (host: LanHost, essid: string): string =>
  `${host.hostname}-${deriveHostnameSuffix(`host:${essid}:${host.ip}`)}`;

/** The host on the ESSID's LAN whose coordinate id equals `machineId`, or null when
 *  none matches (an unknown id, or an id from a different network). Every occupant
 *  resolves an id to the SAME host: the population is the access point's, so a
 *  machine_id names one box rather than whatever each viewer happened to draw at
 *  that address. */
export const hostForMachineId = (essid: string, machineId: string): LanHost | null =>
  generateHomeLan(essid).hosts.find((host) => hostMachineId(host, essid) === machineId) ?? null;
