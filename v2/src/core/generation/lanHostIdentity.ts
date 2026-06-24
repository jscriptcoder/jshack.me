/**
 * resolveLanHostIdentity — the single map from a host on the player's OWN LAN to
 * its storage machine_id + seeded base filesystem.
 *
 * The scan trace (`logHostScan`), ssh reachability + the session it stamps, and the
 * server-side auth gate all need this same mapping; keeping it in one place is what
 * stops the client and server from disagreeing about which box a hop landed on
 * (a divergence would silently route a session onto the wrong machine's tree).
 *
 * Four kinds of host:
 * - the edge router at `.1` keeps its key-only identity (`computeRouterId` /
 *   `buildRouterBaseFs`) — it is the box `network_registry` holds, so cross-player
 *   resolution stays untouched;
 * - an inner gateway (any OTHER router) takes its octet-keyed identity
 *   (`computeInnerGatewayId` / `buildInnerGatewayBaseFs`) so it never aliases the
 *   edge or a sibling;
 * - a switch is the second inner-gateway device type; it REUSES the octet-keyed
 *   inner-gateway identity (`computeInnerGatewayId`) — its distinct octet keeps it
 *   apart from the inner router — but its own `buildSwitchBaseFs` (an `acl.conf`
 *   box, not a NAT `rules.v4` one);
 * - every other host is a coordinate-seeded NPC (`hostMachineId` /
 *   `buildRemoteHostFs`).
 */

import type { Directory } from '../filesystem/types';
import { computeDeepGatewayId, computeInnerGatewayId, computeRouterId } from '../identity/router';
import {
  buildDeepGatewayBaseFs,
  buildInnerGatewayBaseFs,
  buildRouterBaseFs,
  buildSwitchBaseFs,
} from './routerFs';
import { buildRemoteHostFs } from './remoteHostFs';
import { hostMachineId } from './remoteHostId';
import { generateHomeLan, type LanHost, type LanHostKind } from './generateHomeLan';
import { generateDeepLayer } from './generateDeepLayer';

export type LanHostIdentity = {
  readonly machineId: string;
  readonly baseFs: Directory;
};

const lanHostOctet = (host: LanHost): number => Number(host.ip.split('.')[3]);

/** Whether a LAN host is an INNER GATEWAY — a `router` OR a `switch` deeper than the
 *  edge `.1` (both are reachable gateway devices a hop can land on). Its scan + ssh
 *  route SERVER-side (the gateway's config lives on its journal, not the client's
 *  static world); the edge `.1` and ordinary siblings stay client-side. The one rule
 *  the scan gate, the ssh-reach gate, and the `nmap`/`ssh` client branches all share,
 *  so they can't drift on what counts as a gateway. */
export const isInnerGateway = (host: LanHost): boolean =>
  (host.kind === 'router' || host.kind === 'switch') && lanHostOctet(host) !== 1;

/** The host at `target` on the caller's regenerated LAN, but only when it is an
 *  inner gateway — the edge `.1`, an ordinary sibling, and an off-LAN address all
 *  yield null. Shared by the server scan + ssh-reach gates so a forged or mis-routed
 *  target finds nothing the same way in both. */
export const innerGatewayAt = (
  ownerKeyHex: string,
  essid: string,
  target: string,
): LanHost | null => {
  const host = generateHomeLan(ownerKeyHex, essid).hosts.find(
    (candidate) => candidate.ip === target,
  );
  return host !== undefined && isInnerGateway(host) ? host : null;
};

/** A LAN host's storage machine_id — without building its FS (the cheap half, used
 *  by the reverse lookup to match an id against the regenerated LAN). */
export const machineIdForLanHost = (host: LanHost, ownerKeyHex: string, essid: string): string => {
  const octet = lanHostOctet(host);
  if (host.kind === 'router') {
    return octet === 1 ? computeRouterId(ownerKeyHex) : computeInnerGatewayId(ownerKeyHex, octet);
  }
  if (host.kind === 'switch') {
    return computeInnerGatewayId(ownerKeyHex, octet);
  }
  return hostMachineId(host, essid);
};

/** A LAN host's seeded base filesystem — the edge router, an inner gateway, a switch,
 *  or a coordinate-seeded NPC tree. */
export const baseFsForLanHost = (host: LanHost, ownerKeyHex: string, essid: string): Directory => {
  const octet = lanHostOctet(host);
  if (host.kind === 'router') {
    return octet === 1 ? buildRouterBaseFs(ownerKeyHex) : buildInnerGatewayBaseFs(ownerKeyHex, octet);
  }
  if (host.kind === 'switch') {
    return buildSwitchBaseFs(ownerKeyHex, octet);
  }
  return buildRemoteHostFs(ownerKeyHex, essid, host);
};

export const resolveLanHostIdentity = (
  host: LanHost,
  ownerKeyHex: string,
  essid: string,
): LanHostIdentity => ({
  machineId: machineIdForLanHost(host, ownerKeyHex, essid),
  baseFs: baseFsForLanHost(host, ownerKeyHex, essid),
});

/** A deep CHILD GATEWAY's storage identity — its machine_id + seeded base FS — from the
 *  owner key, the machine_id of the gateway that FRONTS its parent layer, and the
 *  child's own deep IP. The child is keyed off its parent so two children at the same
 *  octet behind different gateways never alias. One place owns the octet parse so the
 *  reach gate, the upstream-scan port resolver, and the pivot scan can't disagree on
 *  which box the chain door is. */
export const resolveDeepGatewayIdentity = (
  ownerKeyHex: string,
  parentMachineId: string,
  childIp: string,
): LanHostIdentity => {
  const octet = Number(childIp.split('.')[3]);
  return {
    machineId: computeDeepGatewayId(ownerKeyHex, parentMachineId, octet),
    baseFs: buildDeepGatewayBaseFs(ownerKeyHex, parentMachineId, octet),
  };
};

/** The reverse of `resolveLanHostIdentity`: the seeded base FS of the host on the
 *  player's OWN LAN whose machine_id equals `machineId` (edge router, inner gateway,
 *  or NPC), or null when none matches. The write path (L2) and the client read-back
 *  rebuild a journal-backed box this way — a session carries only a machine_id, so
 *  the tree it replays its journal over is recovered by regenerating the LAN. */
export const ownLanBaseFsForMachineId = (
  ownerKeyHex: string,
  essid: string,
  machineId: string,
): Directory | null => {
  const host = generateHomeLan(ownerKeyHex, essid).hosts.find(
    (candidate) => machineIdForLanHost(candidate, ownerKeyHex, essid) === machineId,
  );
  return host === undefined ? null : baseFsForLanHost(host, ownerKeyHex, essid);
};

/** The gateway behind which a pivot scan resolves the deep layer the active shell can
 *  reach: which machine_id keys that layer, the gateway's `kind` (a switch ACL-filters
 *  its downstream, a router forwards), and whether the layer it fronts hangs a child
 *  (the chain continues) or is terminal (the depth bound). */
export type PivotVantage = {
  readonly machineId: string;
  readonly kind: LanHostKind;
  readonly hangsChild: boolean;
};

/** Resolve the active session's machine_id to the pivot vantage it stands on, or null
 *  when the shell is on the edge `.1`, an ordinary host, or the player's own
 *  workstation. Two kinds of vantage front a deep layer:
 *  - an L1 INNER GATEWAY (router or switch) sitting directly on the home LAN — it
 *    fronts a child-bearing layer (the chain continues below it);
 *  - a deep CHILD GATEWAY one layer down (reached through a forward on the inner
 *    router) — it fronts a TERMINAL layer, the bound that caps the chain's depth.
 *  The machine_id-keyed counterpart of `innerGatewayAt` (a session carries an id, not
 *  an address); a pivot scan reads the vantage to resolve the downstream segment
 *  instead of home. */
export const pivotVantageForMachineId = (
  ownerKeyHex: string,
  essid: string,
  machineId: string,
): PivotVantage | null => {
  const innerGateways = generateHomeLan(ownerKeyHex, essid).hosts.filter(isInnerGateway);

  const direct = innerGateways.find(
    (gateway) => machineIdForLanHost(gateway, ownerKeyHex, essid) === machineId,
  );
  if (direct !== undefined) {
    return { machineId, kind: direct.kind, hangsChild: true };
  }

  // Walk one layer down: regenerate each inner router's deep layer and match its child
  // gateway by machine_id. A switch fronts no child, so it is skipped by construction.
  const childMatch = innerGateways
    .map((gateway) => {
      const parentId = machineIdForLanHost(gateway, ownerKeyHex, essid);
      const child = generateDeepLayer(ownerKeyHex, essid, {
        machineId: parentId,
        kind: gateway.kind,
      }).childGateway;
      return child === null ? null : { child, parentId };
    })
    .find(
      (entry) =>
        entry !== null &&
        resolveDeepGatewayIdentity(ownerKeyHex, entry.parentId, entry.child.ip).machineId ===
          machineId,
    );

  return childMatch == null
    ? null
    : { machineId, kind: childMatch.child.kind, hangsChild: false };
};
