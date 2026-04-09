import type { CredentialMap, SubnetLayer } from '../types';

export type SameLayerCredential = {
  readonly ip: string;
  readonly username: string;
  readonly password: string;
};

// Extracts eligible (non-root, non-guest) credentials for a machine IP.
const peerCredentials = (
  credentials: CredentialMap,
  peerIp: string,
): readonly SameLayerCredential[] =>
  (credentials[peerIp] ?? [])
    .filter((c) => c.username !== 'root' && c.username !== 'guest')
    .map((c) => ({ ip: peerIp, username: c.username, password: c.password }));

// Builds a map from each machine IP to the credentials of other machines in the same layer.
// Used for cross-machine credential leak placement — a machine can reference any
// peer in its own subnet (realistic: same admin, same network segment).
export const buildSameLayerCredentials = (
  layers: readonly SubnetLayer[],
  credentials: CredentialMap,
): ReadonlyMap<string, readonly SameLayerCredential[]> =>
  new Map(
    layers
      .flatMap((layer) => {
        const ips = layer.machines.map((m) => m.ip);
        return ips.map((ip) => {
          const peers = ips
            .filter((peerIp) => peerIp !== ip)
            .flatMap((peerIp) => peerCredentials(credentials, peerIp));
          return [ip, peers] as const;
        });
      })
      .filter(([, peers]) => peers.length > 0),
  );
