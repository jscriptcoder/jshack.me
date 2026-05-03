import { generateHomeNetwork } from '../generation/generateHomeNetwork';

// Server-side helper for slot allocation. Given a home network's seed +
// public IP, regenerates the network deterministically and returns the
// set of last-octets that NPC machines occupy on the LAN's /24 subnet.
//
// Used by the join handler's slot allocator to avoid putting a player
// onto an IP that's already taken by an NPC. Without this exclusion,
// the slot allocator picks `prng.nextInt(10, 250)` blind to topology
// state, and the topology generator picks NPC octets in the same range
// — so collisions land Player B onto e.g. `http-srv`'s IP, and the two
// players' rendered LAN views diverge (each renders locally, so the
// NPC shadows the occupant overlay or vice versa).
//
// Cost: ~50–100ms per join (one full home-network FS regen). Acceptable
// — joins are rare. If/when it shows in a flame graph, an obvious
// optimization is to memoize per (seed, publicIp) since the answer is
// invariant for that pair.

const lastOctet = (ip: string): number => {
  const parts = ip.split('.');
  return parseInt(parts[parts.length - 1] ?? '', 10);
};

export type GetReservedLanOctetsInput = {
  readonly seed: string;
  readonly publicIp: string;
};

export const getReservedLanOctets = async (
  input: GetReservedLanOctetsInput,
): Promise<ReadonlySet<number>> => {
  const network = await generateHomeNetwork({
    seed: input.seed,
    essid: 'reservation-lookup-only',
    routerPublicIp: input.publicIp,
  });

  // Layer 0 is the LAN players land on. Filter NPC machines to that
  // subnet — multi-layer networks (medium/hard) can have inner subnets
  // whose octets are unrelated to LAN slot allocation.
  const lanSubnet = network.layers[0]?.subnet;
  if (!lanSubnet) return new Set();

  const reserved = new Set<number>();
  for (const machine of network.machines) {
    if (!machine.ip.startsWith(`${lanSubnet}.`)) continue;
    const octet = lastOctet(machine.ip);
    if (Number.isFinite(octet)) reserved.add(octet);
  }
  // .1 is the gateway (router internal IP); always reserved. Also
  // outside [10, 250] anyway, but include for explicitness.
  reserved.add(1);
  return reserved;
};
