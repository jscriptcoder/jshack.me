/**
 * `buildDeepLayerPortResolver` — the server-side `resolveTargetPorts` the single
 * `scanResult` total function injects when it scans an inner gateway from the
 * upstream (`external`) vantage. For a NAT forward's `internalIp`, it answers "what
 * ports is the host behind that forward serving?" for the one machine on the deep
 * layer.
 *
 * The deep-layer counterpart of `buildWorkstationPortResolver`: where the home NAT
 * has the player's workstation behind the edge router, an inner gateway has two
 * reachable boxes behind it — the terminal deep NPC and (when the gateway fronts a
 * deeper layer) the CHILD GATEWAY that is the door to the next layer down. Both sit
 * at deterministic addresses `generateDeepLayer(...)` issues, so the resolver matches
 * either — a forward to anything else is dead (empty) — and reads the matched box's
 * open ports off its materialized tree. It is the LIVENESS GATE a forward passes only
 * while its target serves the internal port (`scanResult` drops a forward whose
 * `internalPort` isn't in the returned ports).
 *
 * Pure: the deep boxes are regenerated once and the closure reads their ports, keeping
 * `core/` free of any async materialization wiring.
 */

import {
  generateDeepLayer,
  buildDeepHostFs,
  seedNetworkDepth,
  type FrontingGateway,
} from '../generation/generateDeepLayer';
import { resolveDeepGatewayIdentity } from '../generation/lanHostIdentity';
import { readOpenPorts, type OpenPort } from '../services/pidfile';

export const buildDeepLayerPortResolver = (args: {
  readonly seedPubkeyHex: string;
  readonly essid: string;
  readonly frontingGateway: FrontingGateway;
}): ((internalIp: string) => readonly OpenPort[]) => {
  // The inner gateway is chain position 1: its layer surfaces a child gateway forward
  // only when the home is seeded at least 2 deep — a depth-1 home fronts a terminal layer.
  const deep = generateDeepLayer(args.seedPubkeyHex, args.essid, args.frontingGateway, {
    hangsChild: 1 < seedNetworkDepth(args.seedPubkeyHex, args.essid),
  });
  const deepHostFs = buildDeepHostFs(args.seedPubkeyHex, args.essid, deep.host);
  // The child gateway is a deep router seeded off the fronting gateway as its parent
  // (so its credentials never alias the NPC's); regenerate its base FS once for the
  // liveness read. A switch-fronted layer has no child, so there is nothing to match.
  const child =
    deep.childGateway === null
      ? null
      : {
          ip: deep.childGateway.ip,
          fs: resolveDeepGatewayIdentity(
            args.seedPubkeyHex,
            args.frontingGateway.machineId,
            deep.childGateway.ip,
          ).baseFs,
        };
  return (internalIp) => {
    if (internalIp === deep.host.ip) return readOpenPorts(deepHostFs);
    if (child !== null && internalIp === child.ip) return readOpenPorts(child.fs);
    return [];
  };
};
