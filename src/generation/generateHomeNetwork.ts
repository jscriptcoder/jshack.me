import { createPrng } from './prng';
import { generateNetwork } from './generateNetwork';
import type { FileNode } from '../filesystem/types';
import type { NetworkConfig, MachineNetworkConfig } from '../network/types';
import type {
  Difficulty,
  EntryVariant,
  GeneratedMachine,
  NatForwarding,
  SubnetLayer,
} from './types';

export type HomeNetwork = {
  readonly essid: string;
  readonly localhostIp: string;
  // Server-assigned hostname (`${prefix}-${suffix}`) when joining via the
  // Phase 5 occupant flow. Undefined for the single-player static-fallback
  // path where the workstation name is used directly.
  readonly hostname?: string;
  readonly router: {
    readonly publicIp: string;
    readonly hostname: string;
    readonly internalIp: string;
  };
  readonly routerMachine: GeneratedMachine;
  readonly entryPoint: string;
  readonly entryVariant: EntryVariant;
  readonly machines: readonly GeneratedMachine[];
  readonly layers: readonly SubnetLayer[];
  readonly networkConfig: NetworkConfig;
  readonly fileSystems: Readonly<Record<string, FileNode>>;
  readonly natForwarding?: NatForwarding;
  readonly difficulty: Difficulty;
};

// Seed format for single-player home networks: derived from gameSeed +
// wifiIndex so each (game, WiFi slot) pair generates a stable topology.
// Multiplayer callers derive their seed differently (`home-${publicIp}`)
// so a shared LAN has identical topology across all occupants.
export const homeNetworkSeed = (gameSeed: string, wifiIndex: number): string =>
  `home-${gameSeed}-${wifiIndex}`;

const deriveDifficulty = (prng: { readonly next: () => number }): Difficulty => {
  const roll = prng.next();
  if (roll < 0.33) return 'easy';
  if (roll < 0.66) return 'medium';
  return 'hard';
};

// Default host octet for localhost on a home network. Used when no
// server-allocated slot is supplied (single-player / test fallback).
// In multiplayer, the server picks a random host octet via pickRandomLanIp
// and supplies it as `slotIp`.
const DEFAULT_SLOT_IP = '.100';

export type GenerateHomeNetworkParams = {
  // PRNG seed driving topology. Single-player callers use
  // `homeNetworkSeed(gameSeed, wifiIndex)`; multiplayer callers use
  // `home-${publicIp}` so all players sharing a LAN see the same topology.
  readonly seed: string;
  readonly essid: string;
  // Pre-allocated host octet for localhost on this LAN (e.g. '.187').
  // Must include the leading dot — concatenated directly with the layer-0
  // subnet to form the full IP. Defaults to '.100' if omitted.
  readonly slotIp?: string;
  // Pre-assigned hostname for the player on this LAN (e.g. 'skylab-9k3').
  // Multiplayer-only; undefined for the single-player path.
  readonly hostname?: string;
  // Public IPs already taken by sibling networks in the same generation
  // pass — passed to topology so the router IP roll avoids collisions.
  // Multiplayer ignores this (the server allocator owns uniqueness).
  readonly usedIps?: ReadonlySet<string>;
  // Server-side IP allocator seam. When provided, the router IP comes
  // from the registry (`/api/allocate-ip` flow) instead of a local PRNG
  // roll. Used by the single-player generation pipeline that needs a
  // unique IP allocated at generation time.
  readonly allocateIp?: (kind: 'home_network') => Promise<string>;
  // Pre-allocated router public IP, supplied by the multiplayer join
  // handler (`/api/join-home-network` returns it as `result.public_ip`).
  // Takes precedence over `allocateIp` — the server has already done
  // the allocation and stored it in `home_networks.public_ip`. Without
  // this override the local PRNG would derive a different value than
  // the server's row, and any cross-player flow keyed on the public
  // IP (occupant lookups, WAN-side curl/nmap to the router) would
  // miss because clients query the wrong network_id.
  readonly routerPublicIp?: string;
};

export const generateHomeNetwork = async (
  params: GenerateHomeNetworkParams,
): Promise<HomeNetwork> => {
  const { seed, essid, slotIp, hostname, usedIps, allocateIp } = params;
  const prng = createPrng(seed);
  const difficulty = deriveDifficulty(prng);

  // ~40% chance inner gateways are managed switches instead of routers.
  // Only affects multi-layer networks (medium/hard difficulty).
  const switchGateway = prng.next() < 0.4;

  // Resolution order: explicit override (multiplayer — server already
  // allocated) > allocateIp callback (single-player generation pipeline)
  // > undefined (PRNG rolls one inside generateNetwork).
  const routerPublicIp =
    params.routerPublicIp ?? (allocateIp ? await allocateIp('home_network') : undefined);

  const network = await generateNetwork({
    prng,
    difficulty,
    topologyOverrides: { usedIps, switchGateway, routerPublicIp },
  });

  const { topology, machines, routerMachine } = network;
  const layer0 = topology.layers[0]!;
  const routerInternalIp = `${layer0.subnet}.1`;
  const localhostIp = `${layer0.subnet}${slotIp ?? DEFAULT_SLOT_IP}`;

  // Alias gateway configs under their internal .1 IPs so players can SSH
  // into gateways from inside the network (they see the .1 address, not
  // the upstream IP or public IP).
  const machineConfigs: Record<string, MachineNetworkConfig> = {
    ...network.updatedNetworkConfig.machineConfigs,
  };
  const fileSystems: Record<string, FileNode> = { ...network.fileSystems };

  const routerPublicConfig = machineConfigs[topology.routerPublicIp];
  if (routerPublicConfig) {
    machineConfigs[routerInternalIp] = routerPublicConfig;
  }
  const routerPublicFs = fileSystems[topology.routerPublicIp];
  if (routerPublicFs) {
    fileSystems[routerInternalIp] = routerPublicFs;
  }

  topology.layers.slice(1).forEach((layer) => {
    const downstreamGatewayIp = `${layer.subnet}.1`;
    const gatewayConfig = machineConfigs[layer.gateway.ip];
    if (gatewayConfig) {
      machineConfigs[downstreamGatewayIp] = gatewayConfig;
    }
    const gatewayFs = fileSystems[layer.gateway.ip];
    if (gatewayFs) {
      fileSystems[downstreamGatewayIp] = gatewayFs;
    }
  });

  return {
    essid,
    localhostIp,
    ...(hostname !== undefined && { hostname }),
    router: {
      publicIp: topology.routerPublicIp,
      hostname: routerMachine.hostname,
      internalIp: routerInternalIp,
    },
    routerMachine,
    entryPoint: topology.entryPoint,
    entryVariant: topology.entryVariant,
    machines,
    layers: topology.layers,
    networkConfig: { machineConfigs },
    fileSystems,
    natForwarding: topology.natForwarding,
    difficulty,
  };
};
