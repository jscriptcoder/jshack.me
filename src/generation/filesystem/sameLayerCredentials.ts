import type { CredentialMap, SubnetLayer } from '../types';

export type SameLayerCredential = {
  readonly ip: string;
  readonly username: string;
  readonly password: string;
};

// Builds a map from each machine IP to the credentials of other machines in the same layer.
// Used for cross-machine credential leak placement — a machine can reference any
// peer in its own subnet (realistic: same admin, same network segment).
export const buildSameLayerCredentials = (
  layers: readonly SubnetLayer[],
  credentials: CredentialMap,
): ReadonlyMap<string, readonly SameLayerCredential[]> => {
  const result = new Map<string, readonly SameLayerCredential[]>();

  for (const layer of layers) {
    const machineIps = layer.machines.map((m) => m.ip);

    for (const ip of machineIps) {
      const peers = machineIps
        .filter((peerIp) => peerIp !== ip)
        .flatMap((peerIp) => {
          const peerCreds = credentials[peerIp] ?? [];
          // Only include non-root, non-guest credentials — realistic lateral movement targets
          return peerCreds
            .filter((c) => c.username !== 'root' && c.username !== 'guest')
            .map((c) => ({ ip: peerIp, username: c.username, password: c.password }));
        });

      if (peers.length > 0) {
        result.set(ip, peers);
      }
    }
  }

  return result;
};
