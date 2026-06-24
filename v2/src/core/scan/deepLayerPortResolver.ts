/**
 * `buildDeepLayerPortResolver` — the server-side `resolveTargetPorts` the single
 * `scanResult` total function injects when it scans an inner gateway from the
 * upstream (`external`) vantage. For a NAT forward's `internalIp`, it answers "what
 * ports is the host behind that forward serving?" for the one machine on the deep
 * layer.
 *
 * The deep-layer counterpart of `buildWorkstationPortResolver`: where the home NAT
 * has the player's workstation behind the edge router, an inner gateway has one
 * deep-layer NPC behind it, at the deterministic address `generateDeepLayer(...)`
 * issues. So the resolver matches that one address — a forward to anything else is
 * dead (empty) — and reads the deep host's open ports off its materialized tree.
 * It is the LIVENESS GATE a forward passes only while its target serves the
 * internal port (`scanResult` drops a forward whose `internalPort` isn't in the
 * returned ports).
 *
 * Pure: the deep host is regenerated once and the closure reads its ports, keeping
 * `core/` free of any async materialization wiring.
 */

import {
  generateDeepLayer,
  buildDeepHostFs,
  type FrontingGateway,
} from '../generation/generateDeepLayer';
import { readOpenPorts, type OpenPort } from '../services/pidfile';

export const buildDeepLayerPortResolver = (args: {
  readonly seedPubkeyHex: string;
  readonly essid: string;
  readonly frontingGateway: FrontingGateway;
}): ((internalIp: string) => readonly OpenPort[]) => {
  const deep = generateDeepLayer(args.seedPubkeyHex, args.essid, args.frontingGateway);
  const deepHostFs = buildDeepHostFs(args.seedPubkeyHex, args.essid, deep.host);
  return (internalIp) => (internalIp === deep.host.ip ? readOpenPorts(deepHostFs) : []);
};
