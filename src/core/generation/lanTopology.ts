/**
 * lanTopology — who is on a network and how it is wired, with nothing about what
 * any box HOLDS.
 *
 * The filesystem-free half of `lanHostIdentity`, which pairs with it: this module
 * answers which hosts are gateways, what machine_id each host has, and the shape of
 * the deep chain hanging behind the Layer-1 gateways; that one turns any of those
 * answers into a seeded tree.
 *
 * Split apart because the two have different appetites. A caller that needs only the
 * network's SHAPE — the zone a name server is authoritative for, say — would
 * otherwise pull every filesystem generator in behind it, and one of those generators
 * needs the shape back: an import cycle through `buildRemoteHostFs`. Nothing here
 * imports a tree builder, so nothing here can close that loop.
 */

import {
  computeApGatewayId,
  computeDeepGatewayId,
  computeInnerGatewayId,
} from '../identity/router';
import { hostMachineId } from './remoteHostId';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { generateDeepLayer, seedNetworkDepth } from './generateDeepLayer';

/** A LAN or deep host's final octet — the discriminator every identity below is
 *  keyed on, and the one thing an address is read for here. */
export const lanHostOctet = (host: LanHost): number => Number(host.ip.split('.')[3]);

/** Whether a LAN host is an INNER GATEWAY — a `router` OR a `switch` deeper than the
 *  edge `.1` (both are reachable gateway devices a hop can land on). Its scan + ssh
 *  route SERVER-side (the gateway's config lives on its journal, not the client's
 *  static world); the edge `.1` and ordinary siblings stay client-side. The one rule
 *  the scan gate, the ssh-reach gate, and the `nmap`/`ssh` client branches all share,
 *  so they can't drift on what counts as a gateway. */
export const isInnerGateway = (host: LanHost): boolean =>
  (host.kind === 'router' || host.kind === 'switch') && lanHostOctet(host) !== 1;

/** A LAN host's storage machine_id — without building its FS (the cheap half, used
 *  by the reverse lookup to match an id against the regenerated LAN). Every kind is
 *  keyed by the ESSID: each of these boxes stands on the access point's LAN, so all
 *  its occupants must resolve one machine record rather than a private copy each. */
export const machineIdForLanHost = (host: LanHost, essid: string): string => {
  const octet = lanHostOctet(host);
  if (host.kind === 'router') {
    return octet === 1 ? computeApGatewayId(essid) : computeInnerGatewayId(essid, octet);
  }
  if (host.kind === 'switch') {
    return computeInnerGatewayId(essid, octet);
  }
  return hostMachineId(host, essid);
};

/** One gateway in a network's chain: which machine_id keys it, the host it is (its
 *  address, hostname and device kind), which gateway it hangs behind — null for a
 *  Layer-1 inner gateway, which hangs off the home LAN itself — and whether the layer
 *  it fronts hangs a child, so the chain continues, or is terminal at the depth
 *  bound.
 *
 *  `parentMachineId` is what lets a caller rebuild the link's tree without the walk
 *  having built one: a Layer-1 gateway's comes from the home LAN, a deep child's from
 *  the parent it hangs behind. */
export type ChainLink = {
  readonly machineId: string;
  readonly host: LanHost;
  readonly parentMachineId: string | null;
  readonly hangsChild: boolean;
};

/** Unfold the chain of gateways fronted from `gateway` (at 1-based `position`)
 *  downward, stopping at the first layer that hangs no child — a terminal layer
 *  (`position >= depth`) or a switch (which forwards nothing). `hangsChild = position
 *  < depth` keys each layer, so behind a router the chain is exactly `depth` gateways
 *  long; the recursion is bounded by `depth` because the position strictly increases
 *  each level. */
const linksFrom = (
  essid: string,
  gateway: Omit<ChainLink, 'hangsChild'>,
  position: number,
  depth: number,
): readonly ChainLink[] => {
  const hangsChild = position < depth;
  const here: ChainLink = { ...gateway, hangsChild };
  const child = generateDeepLayer(
    essid,
    { machineId: gateway.machineId, kind: gateway.host.kind },
    { hangsChild },
  ).childGateway;
  if (child === null) {
    return [here];
  }
  return [
    here,
    ...linksFrom(
      essid,
      {
        machineId: computeDeepGatewayId(gateway.machineId, lanHostOctet(child)),
        host: child,
        parentMachineId: gateway.machineId,
      },
      position + 1,
      depth,
    ),
  ];
};

/** Every gateway in the NETWORK's deep chain — each Layer-1 inner gateway (router or
 *  switch) and every deep child gateway below a router, walked to the seeded depth.
 *  ONE walk with several consumers: the pivot vantage a scan resolves its downstream
 *  segment from, the deep-gateway base FS an L2 write targets, and the address plan a
 *  zone describes. A second traversal anywhere would be a second opinion about the
 *  shape of the network.
 *
 *  Nothing here takes an identity: the chain descends from gateways the access point
 *  owns, so it is the same chain for every occupant. */
export const chainLinks = (essid: string): readonly ChainLink[] => {
  const depth = seedNetworkDepth(essid);
  return generateHomeLan(essid)
    .hosts.filter(isInnerGateway)
    .flatMap((gateway) =>
      linksFrom(
        essid,
        {
          machineId: machineIdForLanHost(gateway, essid),
          host: gateway,
          parentMachineId: null,
        },
        1,
        depth,
      ),
    );
};
