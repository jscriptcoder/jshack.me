import type { GeneratedMachine, SubnetLayer } from '../generation/types';

const subnetOf = (ip: string): string => ip.split('.').slice(0, 3).join('.');

// Returns the ordered chain of gateways that fronts `machineIp`, from its own
// layer's gateway (innermost) out to the border router (edge). Used to install
// NAT forward rules on every gateway an inbound connection must traverse.
//
// Ordering: innermost first, edge last. Callers that want to report the
// "public edge" to the player can take the last element.
//
// Returns an empty array when the machine isn't part of any mission layer
// (e.g., a home-network machine or an unknown IP) — that's the signal to
// skip forwarding.
export const findGatewayChainFor = (
  machineIp: string,
  layers: readonly SubnetLayer[] | undefined,
): readonly GeneratedMachine[] => {
  if (!layers || layers.length === 0) return [];
  const targetSubnet = subnetOf(machineIp);
  const layerIndex = layers.findIndex((l) => l.subnet === targetSubnet);
  if (layerIndex < 0) return [];
  return layers
    .slice(0, layerIndex + 1)
    .map((l) => l.gateway)
    .reverse();
};
