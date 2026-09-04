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
 * - the AP gateway at `.1` takes its ESSID-keyed identity (`computeApGatewayId` /
 *   `buildApGatewayBaseFs`) — it belongs to the access point, so every occupant of
 *   the ESSID resolves the same box behind the same public IP;
 * - an inner gateway (any OTHER router) takes its octet-keyed identity
 *   (`computeInnerGatewayId` / `buildInnerGatewayBaseFs`) so it never aliases the
 *   edge or a sibling;
 * - a switch is the second inner-gateway device type; it REUSES the octet-keyed
 *   inner-gateway identity (`computeInnerGatewayId`) — its distinct octet keeps it
 *   apart from the inner router — but its own `buildSwitchBaseFs` (an `acl.conf`
 *   box, not a NAT `rules.v4` one);
 * - every other host is a coordinate-seeded NPC (`hostMachineId` /
 *   `buildRemoteHostFs`).
 *
 * Its filesystem-free half is `lanTopology` — which host is a gateway, what
 * machine_id each has, and the shape of the deep chain. This module is where those
 * answers become trees, and it re-exports the two a caller most often wants beside
 * one, so the split costs nothing at the call sites.
 */

import type { Directory } from '../filesystem/types';
import { computeDeepGatewayId } from '../identity/router';
import {
  buildApGatewayBaseFs,
  buildDeepGatewayBaseFs,
  buildDeepSwitchBaseFs,
  buildInnerGatewayBaseFs,
  buildSwitchBaseFs,
} from './routerFs';
import { readOpenPorts } from '../services/pidfile';
import { buildRemoteHostFs } from './remoteHostFs';
import { hostMachineId } from './remoteHostId';
import { generateHomeLan, type LanHost, type LanHostKind } from './generateHomeLan';
import { generateDeepLayer } from './generateDeepLayer';
import { buildDeepHostFs } from './deepHostFs';
import {
  chainLinks,
  isInnerGateway,
  lanHostOctet,
  machineIdForLanHost,
  type ChainLink,
} from './lanTopology';

export { isInnerGateway, machineIdForLanHost } from './lanTopology';

export type LanHostIdentity = {
  readonly machineId: string;
  readonly baseFs: Directory;
};

/** The host at `target` on the caller's regenerated LAN, but only when it is an
 *  inner gateway — the edge `.1`, an ordinary sibling, and an off-LAN address all
 *  yield null. Shared by the server scan + ssh-reach gates so a forged or mis-routed
 *  target finds nothing the same way in both. */
export const innerGatewayAt = (essid: string, target: string): LanHost | null => {
  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.ip === target);
  return host !== undefined && isInnerGateway(host) ? host : null;
};

/** Does `port` on `target` address the hidden layer BEHIND it rather than the box
 *  itself? True only for an inner gateway on a port other than its own sshd: that is
 *  what a NAT forward is, and an inner gateway is the only kind of host that has a
 *  forward table. Everything else — the edge `.1`, a sibling, an off-LAN address, or a
 *  gateway's own ssh port — is the machine at that address.
 *
 *  This is the rule `ssh` routes its forward-login by, spelled once for callers that
 *  hold neither the host nor its running port; `ssh.ts` derives both for other decisions
 *  and so states it inline. Change one and change the other. */
export const forwardsIntoDeepLayer = (options: {
  readonly essid: string;
  readonly target: string;
  readonly port: number;
}): boolean => {
  const gateway = innerGatewayAt(options.essid, options.target);
  if (gateway === null) return false;
  // A gateway that ran no sshd at all would have no own port to be distinct from, and
  // `undefined !== port` says so without a separate branch for a case the generator
  // does not produce.
  const ownSshPort = readOpenPorts(baseFsForLanHost(gateway, options.essid)).find(
    (open) => open.service === 'ssh',
  )?.port;
  return ownSshPort !== options.port;
};

/** A LAN host's seeded base filesystem — the edge router, an inner gateway, a switch,
 *  or a coordinate-seeded NPC tree. */
export const baseFsForLanHost = (host: LanHost, essid: string): Directory => {
  const octet = lanHostOctet(host);
  if (host.kind === 'router') {
    return octet === 1 ? buildApGatewayBaseFs(essid) : buildInnerGatewayBaseFs(essid, octet);
  }
  if (host.kind === 'switch') {
    return buildSwitchBaseFs(essid, octet);
  }
  return buildRemoteHostFs(essid, host);
};

export const resolveLanHostIdentity = (host: LanHost, essid: string): LanHostIdentity => ({
  machineId: machineIdForLanHost(host, essid),
  baseFs: baseFsForLanHost(host, essid),
});

/** A deep CHILD GATEWAY's storage identity — its machine_id + seeded base FS — from the
 *  machine_id of the gateway that FRONTS its parent layer, the child's own deep IP, and
 *  its device `kind`. The child is keyed off its parent so two children at the same octet
 *  behind different gateways never alias. The `machine_id` is kind-agnostic (a slot is one
 *  kind), but the base FS branches: a switch is an `acl.conf` box that forwards nothing, a
 *  router a NAT `rules.v4` one. One place owns the octet parse + the kind branch so the
 *  reach gate, the upstream-scan port resolver, and the pivot scan can't disagree on which
 *  box the chain door is. */
export const resolveDeepGatewayIdentity = (
  parentMachineId: string,
  childIp: string,
  kind: LanHostKind,
): LanHostIdentity => {
  const octet = Number(childIp.split('.')[3]);
  return {
    machineId: computeDeepGatewayId(parentMachineId, octet),
    baseFs:
      kind === 'switch'
        ? buildDeepSwitchBaseFs(parentMachineId, octet)
        : buildDeepGatewayBaseFs(parentMachineId, octet),
  };
};

/** The reverse of `resolveLanHostIdentity`: the seeded base FS of the host on the
 *  player's OWN LAN whose machine_id equals `machineId` (inner gateway or NPC), or
 *  null when none matches. The write path (L2) and the client read-back rebuild a
 *  journal-backed box this way — a session carries only a machine_id, so the tree it
 *  replays its journal over is recovered by regenerating the LAN.
 *
 *  The `.1` is EXCLUDED: the AP gateway belongs to the access point, not to the
 *  viewer, so it must resolve through the shared server-side path like any other
 *  contested box. Matching it here would let each occupant rebuild it from their own
 *  regeneration and never see another occupant's writes to it. */
export const lanBaseFsForMachineId = (essid: string, machineId: string): Directory | null => {
  const host = generateHomeLan(essid).hosts.find(
    (candidate) =>
      lanHostOctet(candidate) !== 1 && machineIdForLanHost(candidate, essid) === machineId,
  );
  return host === undefined ? null : baseFsForLanHost(host, essid);
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
 *  workstation. A vantage is any gateway in the home's deep chain — an L1 inner gateway
 *  (router or switch) on the home LAN, or any deep child gateway reached down the chain.
 *  Each L1 inner gateway's chain is walked down to its seeded depth, and the matched
 *  vantage carries whether the layer it fronts hangs a child — so on a depth-1 network the
 *  inner gateway fronts a terminal layer, while a deeper one keeps fronting child-bearing
 *  layers until the depth bound. The machine_id-keyed counterpart of `innerGatewayAt` (a
 *  session carries an id, not an address); a pivot scan reads the vantage to resolve the
 *  downstream segment. */
export const pivotVantageForMachineId = (
  essid: string,
  machineId: string,
): PivotVantage | null => {
  const match = chainGatewayVantageForMachineId(essid, machineId);
  return match === null ? null : { machineId: match.machineId, kind: match.kind, hangsChild: match.hangsChild };
};

/** A pivot vantage PLUS the gateway's seeded base FS — everything the deep scan trace
 *  needs from one chain walk: the vantage to regenerate the layer, and the base tree
 *  to replay a switch's journal for its `acl.conf`. */
export type ChainGatewayVantage = PivotVantage & { readonly baseFs: Directory };

/** One chain gateway's seeded base FS. A Layer-1 inner gateway builds from the home
 *  LAN it stands on; a deep child builds from the parent it hangs behind, which is
 *  what keeps two children at the same octet under different gateways apart.
 *
 *  Built per link ON DEMAND rather than during the walk, so resolving one gateway out
 *  of a chain does not generate a filesystem for every other gateway in it. */
const chainGatewayBaseFs = (essid: string, link: ChainLink): Directory =>
  link.parentMachineId === null
    ? baseFsForLanHost(link.host, essid)
    : resolveDeepGatewayIdentity(link.parentMachineId, link.host.ip, link.host.kind).baseFs;

/** The full chain gateway (vantage + base FS) whose machine_id matches — an L1 inner
 *  gateway or a deep child gateway below it — or null when none matches. The single
 *  walk both `pivotVantageForMachineId` and `chainGatewayBaseFsForMachineId` project
 *  from, so a caller that needs BOTH (the deep scan trace) resolves them together and
 *  can't land in a half-resolved state. */
export const chainGatewayVantageForMachineId = (
  essid: string,
  machineId: string,
): ChainGatewayVantage | null => {
  const link = chainLinks(essid).find((candidate) => candidate.machineId === machineId);
  return link === undefined
    ? null
    : {
        machineId,
        kind: link.host.kind,
        hangsChild: link.hangsChild,
        baseFs: chainGatewayBaseFs(essid, link),
      };
};

/** The seeded base FS of a gateway in the network's deep chain whose machine_id matches —
 *  an L1 inner gateway or a deep child gateway below it. The L2 write path resolves a deep
 *  gateway this way so a player who roots a chain door (`ssh root@<inner>:<fwd>`) can
 *  configure ITS forwards (`nano rules.v4`), the same as the edge or an inner gateway. Any
 *  occupant that roots the door resolves the same tree, so the forwards one of them writes
 *  are the forwards the next one reads. Returns null when no chain gateway matches. */
export const chainGatewayBaseFsForMachineId = (
  essid: string,
  machineId: string,
): Directory | null => {
  const match = chainGatewayVantageForMachineId(essid, machineId);
  return match === null ? null : match.baseFs;
};

/** The seeded base FS of a DEEP NPC in the network's chain whose coordinate machine_id
 *  matches — the single reachable host on each deep layer (`buildDeepHostFs`, `sshd`
 *  guaranteed up). Walks every fronting gateway in the chain and regenerates the layer it
 *  fronts; the layer's NPC is byte-stable, so the matched host rebuilds the same tree the
 *  deep reach/scan traces were written onto. Returns null when no deep NPC matches. */
const deepHostBaseFsForMachineId = (essid: string, machineId: string): Directory | null => {
  for (const gateway of chainLinks(essid)) {
    // Only the layer's NPC is needed, and it is byte-stable whether or not the layer
    // hangs a child — so the `hangsChild` option is irrelevant here and left at default.
    const layer = generateDeepLayer(essid, {
      machineId: gateway.machineId,
      kind: gateway.host.kind,
    });
    if (hostMachineId(layer.host, essid) === machineId) {
      return buildDeepHostFs(essid, layer.host);
    }
  }
  return null;
};

/** The seeded base FS of ANY machine the NETWORK generates — a home-LAN host (edge router,
 *  inner gateway, switch, NPC sibling), a deep child gateway down the chain, or a deep NPC
 *  behind a gateway — recovered from its machine_id alone. The single "is this a box this
 *  network makes, and what is its tree?" resolver: the FS dispatch builds a generated
 *  machine's tree from it, and the cross-player check treats a non-null result as generated
 *  (so it is never served an empty foreign tree). Returns null only for an id this network
 *  does not generate — in practice another PLAYER's workstation, which is the one kind of
 *  box that is genuinely somebody's. */
export const generatedBaseFsForMachineId = (
  essid: string,
  machineId: string,
): Directory | null =>
  lanBaseFsForMachineId(essid, machineId) ??
  chainGatewayBaseFsForMachineId(essid, machineId) ??
  deepHostBaseFsForMachineId(essid, machineId);
