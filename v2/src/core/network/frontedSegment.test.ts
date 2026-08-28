import { describe, expect, it } from 'vitest';
import { frontedSegment } from './frontedSegment';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { generateDeepLayer, seedNetworkDepth } from '../generation/generateDeepLayer';
import { computeApGatewayId, computeDeepGatewayId } from '../identity/router';
import { machineIdForLanHost } from '../generation/lanHostIdentity';
import { crackableEssidPool } from '../generation/generateWifi';

/**
 * Which `/24` a device's forwards may point INTO.
 *
 * A NAT forward names a box on the network the device FRONTS, and that is a different
 * network for every device that has one: the access point's gateway fronts the LAN its
 * own address sits on, while an inner gateway fronts the hidden layer BEHIND it and
 * nothing on the LAN it stands on.
 *
 * Asked of the address a player TYPED instead of the device reached, the answer is right
 * for the edge and wrong for everything deeper — which is how a forward that can never
 * route gets accepted while the only one that could is refused.
 *
 * Keyed by the device's machine id, exactly as the layer itself is, so this bound and the
 * chain walk that later resolves the forward cannot come to disagree about where the
 * boxes behind a device actually stand.
 */

/** The real pool the world draws from, walked rather than sampled: the chain depth and
 *  every device roll are seeded per network, so a hand-picked ESSID would tie this suite
 *  to one coin flip. */
const ESSID = crackableEssidPool[0];

const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

const segmentOf = (address: string): string => address.split('.').slice(0, 3).join('.');

const isInnerRouter = (host: LanHost): boolean => host.kind === 'router' && octetOf(host) !== 1;

const hostOn = (essid: string, matches: (host: LanHost) => boolean): LanHost | undefined =>
  generateHomeLan(essid).hosts.find(matches);

const edgeOn = (essid: string): LanHost => {
  const edge = hostOn(essid, (host) => octetOf(host) === 1);
  if (edge === undefined) throw new Error('no access point gateway on this LAN');
  return edge;
};

const innerRouterOn = (essid: string): LanHost => {
  const gateway = hostOn(essid, isInnerRouter);
  if (gateway === undefined) throw new Error('no inner router on this LAN');
  return gateway;
};

/** A world whose chain is at least two gateways long, so there is a DEEPER gateway to
 *  ask about — a device that is itself reached through a forward and fronts a layer of
 *  its own. */
const chainedWorld = (): { readonly essid: string; readonly gateway: LanHost } => {
  for (const essid of crackableEssidPool) {
    const gateway = hostOn(essid, isInnerRouter);
    if (gateway !== undefined && seedNetworkDepth(essid) >= 2) return { essid, gateway };
  }
  throw new Error('no candidate world has a gateway chain two deep');
};

describe('the segment a device fronts', () => {
  it('is the LAN itself for the access point gateway', () => {
    // The edge `.1` forwards INTO the network it stands on, so here — and only here —
    // the device's own segment and the segment it fronts are the same answer. This is
    // the case the bound already got right, and it must not move.
    const edge = edgeOn(ESSID);

    expect(
      frontedSegment({ essid: ESSID, machineId: computeApGatewayId(ESSID), kind: edge.kind }),
    ).toBe(segmentOf(edge.ip));
  });

  it('is the hidden layer for an inner gateway, never the LAN it stands on', () => {
    // The whole correction in one assertion: an inner gateway's forwards reach its deep
    // layer, so a destination on the LAN is a dark DNAT target and a destination on the
    // deep layer is the only kind that can route.
    const gateway = innerRouterOn(ESSID);
    const machineId = machineIdForLanHost(gateway, ESSID);

    const fronted = frontedSegment({ essid: ESSID, machineId, kind: gateway.kind });

    expect(fronted).not.toBe(segmentOf(gateway.ip));
    // Proved against where the boxes actually ARE, rather than against a second copy of
    // the same derivation: the NPC the layer generates has to stand on the segment this
    // says the device fronts, or the bound would accept an address nothing answers at.
    expect(segmentOf(generateDeepLayer(ESSID, { machineId, kind: gateway.kind }).host.ip)).toBe(
      fronted,
    );
  });

  it('follows the device down the chain rather than staying with the one on the LAN', () => {
    // A gateway reached THROUGH a forward fronts a layer of its own, one deeper. Keyed
    // by the device's machine id, so the answer moves with the device — a bound that
    // stopped at the LAN gateway would judge a deep router's forwards against a segment
    // two hops above the boxes it can actually reach.
    const { essid, gateway } = chainedWorld();
    const parentMachineId = machineIdForLanHost(gateway, essid);
    const child = generateDeepLayer(essid, {
      machineId: parentMachineId,
      kind: gateway.kind,
    }).childGateway;
    if (child === null) throw new Error('a chained world must hang a child gateway');
    const childMachineId = computeDeepGatewayId(parentMachineId, octetOf(child));

    const childFronted = frontedSegment({ essid, machineId: childMachineId, kind: child.kind });

    expect(childFronted).not.toBe(
      frontedSegment({ essid, machineId: parentMachineId, kind: gateway.kind }),
    );
    expect(
      segmentOf(
        generateDeepLayer(essid, { machineId: childMachineId, kind: child.kind }).host.ip,
      ),
    ).toBe(childFronted);
  });
});
