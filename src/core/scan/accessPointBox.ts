/**
 * A box the ACCESS POINT owns, as it stands right now — asked of the server.
 *
 * An NPC sibling, the edge `.1` gateway every occupant shares, or an inner gateway: the
 * ESSID seeds all three, so a client can rebuild the box the world SHIPPED offline. It
 * cannot rebuild what anyone has done to it since — a stopped daemon, a planted
 * listener, a `/boot` tombstone — because that lives on the machine's server-side
 * journal. So every tool that asks whether such a box is there, or what it runs, asks
 * here, and `ping`, `nmap` and `ssh` can never disagree about a box someone has bricked.
 *
 * An inner gateway is read from its upstream side, where the NAT forward into the layer
 * behind it is visible and that forward lives on its journal; every other box is read
 * as the network sees it.
 */

import type { CommandEnv, PublicScanResolution } from '../commands/types.js';
import type { LanHost } from '../generation/generateHomeLan.js';
import { isInnerGateway } from '../generation/lanHostIdentity.js';

/** The box at `host` as the server holds it: `found: false` for a box that cannot boot,
 *  and `null` when OUR round trip failed — which is not the box being down, so a caller
 *  must not report it as one. The request names the box the shell stands on, so the
 *  server answers only for the network that box is on. */
export const resolveAccessPointBox = (
  env: CommandEnv,
  essid: string,
  host: LanHost,
): Promise<PublicScanResolution | null> => {
  const caller = env.session.machineId;
  return isInnerGateway(host)
    ? env.scan.resolveInnerGateway(essid, host.ip, caller)
    : env.scan.resolveSameLan(essid, host.ip, caller);
};

/** Whether the server holds the box at `host` as down. A failed round trip leaves it up:
 *  the generated world has already placed the box on the LAN, and calling it down would
 *  blame a live machine for our own outage. */
export const accessPointBoxIsDown = async (
  env: CommandEnv,
  essid: string,
  host: LanHost,
): Promise<boolean> => (await resolveAccessPointBox(env, essid, host))?.found === false;
