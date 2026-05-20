import type { HomeNetwork } from '../generation/generateHomeNetwork';
import type { OccupantSummary } from '../homeNetworks/types';

// Single entry in the foreign-LAN occupant lookup. Workstation_id is the
// canonical machine_id storage key for the occupant's patches; the
// network_id and layer0_subnet are kept so downstream consumers (write
// path, read path) can sanity-check membership and assemble logs.
export type ForeignLanOccupantEntry = {
  readonly workstationId: string;
  readonly networkId: string;
  readonly layer0Subnet: string;
};

// Builds a foreign-LAN occupant lookup: (full IP) → entry. Empty result
// when either input is empty or no occupants match any loaded network's
// layer-0 subnet.
//
// Key shape: `${layer0Subnet}${lan_ip}` — `lan_ip` already carries its
// leading dot (e.g. `.42`) so concatenation yields a full IPv4 address.
// Subnet prefix means colliding host octets across different LANs map to
// distinct keys, which is what makes this safe to merge into the
// existing same-LAN occupant resolver.
//
// Pure: no React, no side effects. Consumers memoize at the call site —
// every call returns a fresh Map, so unmemoized use will leak references.
export const buildForeignLanOccupantMap = (
  foreignNetworks: readonly HomeNetwork[],
  foreignLanOccupants: readonly OccupantSummary[],
): ReadonlyMap<string, ForeignLanOccupantEntry> => {
  const subnetByNetworkId = new Map<string, string>();
  for (const network of foreignNetworks) {
    const subnet = network.layers[0]?.subnet;
    if (subnet) subnetByNetworkId.set(network.router.publicIp, subnet);
  }

  const map = new Map<string, ForeignLanOccupantEntry>();
  for (const occupant of foreignLanOccupants) {
    const subnet = subnetByNetworkId.get(occupant.network_id);
    if (!subnet) continue;
    map.set(`${subnet}${occupant.lan_ip}`, {
      workstationId: occupant.hostname,
      networkId: occupant.network_id,
      layer0Subnet: subnet,
    });
  }
  return map;
};
