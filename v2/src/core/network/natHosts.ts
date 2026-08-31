/**
 * The hosts an AP's NAT forwards reach — the pure half of it.
 *
 * A `rules.v4` line names an INTERNAL ADDRESS, and on a shared access point the box
 * answering to that address is whichever occupant holds the LEASE on it. So an AP has
 * no single host behind its NAT: it has as many as its occupants publish forwards for,
 * and each forward is live or dark independently of the others.
 *
 * Both consumers — the public SCAN (which ports does the AP expose?) and the public SSH
 * gate (whose box does this port reach?) — resolve through here, so the two can never
 * disagree about what is behind a given forward. The async half (reading the occupancy,
 * the leases and each box's journal) stays in the handlers: `core/` holds no IO wiring.
 */

import { canBoot } from '../boot/bootFiles';
import { materializeWorkstationFs, type OwnerPatchRow } from './materializeWorkstationFs';
import { portsOpenToNetwork } from './portsOpenToNetwork';
import type { OpenPort } from '../services/pidfile';
import type { OccupantWorkstation } from '../patches/remoteWritePermission';
import type { Directory } from '../filesystem/types';

/** Rebuild the REAL box behind a forward — the shared generator's baseline for that
 *  occupant's identity with its persisted journal replayed over it — or `null` when it
 *  cannot come up. The dark gate behind the NAT: a bricked box (a `/boot` tombstone)
 *  answers nothing even if a stale `sshd` pidfile lingers in its `/var/run`. */
export const bootableOccupantFs = (
  occupant: OccupantWorkstation,
  patches: readonly OwnerPatchRow[] | null,
): Directory | null => {
  const occupantFs = materializeWorkstationFs(occupant, patches);
  return canBoot(occupantFs).ok ? occupantFs : null;
};

/** The `resolveTargetPorts` that `scanResult` injects: what is serving at the internal
 *  address a forward names. An address with no live box behind it — nobody leases it,
 *  its holder has left the WiFi, or the box is bricked — is simply absent from the map
 *  and answers nothing, which is what drops a dead forward from the public IP.
 *
 *  What the target answers to the NETWORK, not what it runs. A filter is honoured for
 *  the box that TERMINATES the forwarded traffic, and not for the gateway that merely
 *  passes it through — so an occupant closing a port closes the forward onto it, while
 *  the gateway's own filter leaves that forward alone. Without this the scan would go
 *  on advertising a port every door already refuses. */
export const natPortResolver =
  (treesByAddress: ReadonlyMap<string, Directory>) =>
  (internalIp: string): readonly OpenPort[] => {
    const occupantFs = treesByAddress.get(internalIp);
    return occupantFs === undefined ? [] : portsOpenToNetwork(occupantFs);
  };
