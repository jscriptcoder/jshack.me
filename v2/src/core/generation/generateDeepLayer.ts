/**
 * generateDeepLayer — the deeper-layer counterpart of `generateHomeLan`. Behind an
 * inner gateway hangs a hidden `10.x.y.0/24` segment carrying one reachable NPC
 * machine; the player exposes it by forwarding a port on the gateway.
 *
 * Pure + deterministic from `(essid, frontingGateway)`, so the same world re-rolls
 * identically every reload — and identically for EVERY OCCUPANT, since neither of
 * those is keyed by a player. Two people walking down from one inner gateway find
 * the same chain.
 *
 * The `10.x` addressing is deliberately disjoint from the home `192.168.x` LAN (and
 * varies per fronting gateway), so a deep host's address can never be confused with
 * a Layer-1 one — the dual-homed inner gateway sits at `.1` of this subnet (the
 * downstream interface a later pivot scans).
 *
 * A router-fronted layer hangs a CHILD GATEWAY (the door to the next layer down)
 * UNLESS the layer is terminal (`hangsChild: false`) — the bound that keeps a chain
 * finite. The NPC is drawn from the same PRNG stream regardless, so flipping a layer
 * terminal never re-rolls its reachable host.
 *
 * This module answers what a layer IS, never what a box on it holds — the deep
 * host's tree is `deepHostFs`'s, and keeping it there is what leaves this one free
 * of filesystem imports. Anything that needs only the network's SHAPE can then walk
 * the chain without dragging a filesystem generator in behind it.
 */

import { createPrng } from './prng';
import { ROUTER_HOSTNAMES } from './routerFs';
import { machineRole } from './machineRole';
import { HOSTNAME_PREFIXES } from './pools/hostnames';
import type { LanHost, LanHostKind } from './generateHomeLan';

/** The gateway that FRONTS a deep layer — the seed for that layer's `/24`. Its
 *  `machineId` keys the layer (so every gateway in a chain fronts a distinct
 *  segment), and its `kind` decides whether the layer hangs a child gateway: a
 *  router forwards to a deeper layer, a switch forwards nothing so fronts none. */
export type FrontingGateway = {
  readonly machineId: string;
  readonly kind: LanHostKind;
};

/** A generated deeper layer: its `/24` prefix, the one NPC machine on it, and —
 *  when fronted by a router — the CHILD GATEWAY that fronts the next layer down (the
 *  chain door). The fronting gateway's downstream interface is `${subnet}.1` by
 *  convention (consumed by the pivot, not here), so it is derived rather than stored. */
export type DeepLayer = {
  /** The `10.x.y` prefix the deep hosts sit on. */
  readonly subnet: string;
  /** The single reachable NPC on the deep layer (`kind: 'machine'`). */
  readonly host: LanHost;
  /** The gateway fronting the NEXT layer down, or null when the chain stops here
   *  (the fronting gateway is a switch, which forwards nothing). */
  readonly childGateway: LanHost | null;
};

/** How a fronting gateway extends the chain. `hangsChild: false` makes the layer
 *  TERMINAL — no child gateway even behind a router — the bound that caps depth (a
 *  deep gateway fronts a terminal layer). Defaults to hanging a child, the shipped
 *  behavior for a layer fronted directly by an inner gateway. */
type DeepLayerOptions = {
  readonly hangsChild: boolean;
};

/** How many deep layers hang behind an access point's inner gateway, seeded
 *  deterministically from the ESSID (the `network-depth-` namespace, reload-stable).
 *  Every network gets at least one deep layer (so no access point is playground-less);
 *  the 1–3 range gives variety — some chains are a single terminal layer, some run three
 *  gateways deep. A gateway at chain position P fronts a child-bearing layer iff
 *  P < depth, so the inner gateway (position 1) hangs a child only when depth ≥ 2.
 *
 *  Seeded by the network rather than by a player because the chain descends from the
 *  inner gateway, which the access point owns: two occupants walking down from one door
 *  have to find a chain of one length, or they are not in the same place. */
export const seedNetworkDepth = (essid: string): number =>
  createPrng(`network-depth-${essid}`).nextInt(1, 3);

/** The fraction of deep child gateways that are SWITCHES rather than routers. A
 *  switch forwards nothing, so it is a chain leaf — the rest are routers that
 *  continue the chain. Tuned low enough that deep router chains stay common while a
 *  meaningful minority of layers are switch-capped. */
const DEEP_SWITCH_PROBABILITY = 0.33;

/** A deep child gateway's device kind, seeded from its PARENT gateway's machine_id AND
 *  its octet (the `deep-gw-kind-` namespace — SEPARATE from every existing deep-gateway
 *  seed, so adding it leaves the router topology byte-stable). A switch caps the chain
 *  here; a router continues it. Keying on the parent + octet keeps two deep gateways at
 *  the same octet behind different parents independent, the same discriminator the deep
 *  id + admin password already use. */
const seedDeepGatewayKind = (
  parentMachineId: string,
  octet: number,
): Extract<LanHostKind, 'router' | 'switch'> =>
  createPrng(`deep-gw-kind-${parentMachineId}:${octet}`).next() < DEEP_SWITCH_PROBABILITY
    ? 'switch'
    : 'router';

export const generateDeepLayer = (
  essid: string,
  frontingGateway: FrontingGateway,
  options: DeepLayerOptions = { hangsChild: true },
): DeepLayer => {
  const prng = createPrng(`deep-layer-${essid}-${frontingGateway.machineId}`);
  const subnet = `10.${prng.nextInt(0, 255)}.${prng.nextInt(0, 255)}`;
  // .1 is the fronting gateway's downstream interface; the hosts avoid it (and
  // .0/.255). A single `pickN` keeps the NPC and child-gateway octets distinct, and
  // is drawn unconditionally so a terminal layer's NPC stays byte-stable.
  const usableOctets = Array.from({ length: 253 }, (_unused, index) => index + 2);
  const [hostOctet, childOctet] = prng.pickN(usableOctets, 2);
  // Seeded by the LAYER as well as the address: two layers can draw the same 10.x.y
  // subnet, so an address alone would give them the same box twice. Its own stream,
  // as on the home LAN, so the octets already drawn above do not move.
  const hostIp = `${subnet}.${hostOctet}`;
  const hostRole = machineRole(`${essid}-${frontingGateway.machineId}`, hostIp);
  const host: LanHost = {
    ip: hostIp,
    hostname: `${prng.pick(HOSTNAME_PREFIXES[hostRole])}-${hostOctet}`,
    kind: 'machine',
  };
  // A router fronts a deeper layer, so a child gateway hangs here — dual-homed at the
  // next layer's `.1` — unless the layer is terminal (the chain's depth bound). A
  // switch forwards nothing, so it never hangs a child.
  const childGateway: LanHost | null =
    frontingGateway.kind === 'router' && options.hangsChild
      ? {
          ip: `${subnet}.${childOctet}`,
          hostname: `${prng.pick(ROUTER_HOSTNAMES)}-${childOctet}`,
          kind: seedDeepGatewayKind(frontingGateway.machineId, childOctet),
        }
      : null;
  return { subnet, host, childGateway };
};
