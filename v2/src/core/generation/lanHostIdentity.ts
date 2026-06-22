/**
 * resolveLanHostIdentity — the single map from a host on the player's OWN LAN to
 * its storage machine_id + seeded base filesystem.
 *
 * The scan trace (`logHostScan`), ssh reachability + the session it stamps, and the
 * server-side auth gate all need this same mapping; keeping it in one place is what
 * stops the client and server from disagreeing about which box a hop landed on
 * (a divergence would silently route a session onto the wrong machine's tree).
 *
 * Three kinds of host:
 * - the edge router at `.1` keeps its key-only identity (`computeRouterId` /
 *   `buildRouterBaseFs`) — it is the box `network_registry` holds, so cross-player
 *   resolution stays untouched;
 * - an inner gateway (any OTHER router) takes its octet-keyed identity
 *   (`computeInnerGatewayId` / `buildInnerGatewayBaseFs`) so it never aliases the
 *   edge or a sibling;
 * - every other host is a coordinate-seeded NPC (`hostMachineId` /
 *   `buildRemoteHostFs`).
 */

import type { Directory } from '../filesystem/types';
import { computeInnerGatewayId, computeRouterId } from '../identity/router';
import { buildInnerGatewayBaseFs, buildRouterBaseFs } from './routerFs';
import { buildRemoteHostFs } from './remoteHostFs';
import { hostMachineId } from './remoteHostId';
import type { LanHost } from './generateHomeLan';

export type LanHostIdentity = {
  readonly machineId: string;
  readonly baseFs: Directory;
};

export const resolveLanHostIdentity = (
  host: LanHost,
  ownerKeyHex: string,
  essid: string,
): LanHostIdentity => {
  if (host.kind === 'router') {
    const octet = Number(host.ip.split('.')[3]);
    return octet === 1
      ? { machineId: computeRouterId(ownerKeyHex), baseFs: buildRouterBaseFs(ownerKeyHex) }
      : {
          machineId: computeInnerGatewayId(ownerKeyHex, octet),
          baseFs: buildInnerGatewayBaseFs(ownerKeyHex, octet),
        };
  }
  return {
    machineId: hostMachineId(host, essid),
    baseFs: buildRemoteHostFs(ownerKeyHex, essid, host),
  };
};
