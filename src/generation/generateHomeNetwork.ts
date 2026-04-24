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

// Derives difficulty from PRNG. Consumes 1 PRNG call.
const deriveDifficulty = (prng: { readonly next: () => number }): Difficulty => {
  const roll = prng.next();
  if (roll < 0.33) return 'easy';
  if (roll < 0.66) return 'medium';
  return 'hard';
};

export const generateHomeNetwork = async (
  gameSeed: string,
  wifiIndex: number,
  essid: string,
  usedIps?: ReadonlySet<string>,
): Promise<HomeNetwork> => {
  const prng = createPrng(`home-${gameSeed}-${wifiIndex}`);
  const difficulty = deriveDifficulty(prng);

  // ~40% chance inner gateways are managed switches instead of routers.
  // Only affects multi-layer networks (medium/hard difficulty).
  const switchGateway = prng.next() < 0.4;

  // Shared pipeline: topology → users → enrichment → port closures → configs → filesystems
  const network = await generateNetwork({
    prng,
    difficulty,
    topologyOverrides: { usedIps, switchGateway },
  });

  const { topology, machines, routerMachine } = network;
  const layer0 = topology.layers[0]!;
  const routerInternalIp = `${layer0.subnet}.1`;
  const localhostIp = `${layer0.subnet}.100`;

  // Alias gateway configs under their internal .1 IPs so players can SSH
  // into gateways from inside the network (they see the .1 address, not the
  // upstream IP or public IP).
  const machineConfigs: Record<string, MachineNetworkConfig> = {
    ...network.updatedNetworkConfig.machineConfigs,
  };
  const fileSystems: Record<string, FileNode> = { ...network.fileSystems };

  // Router: alias public IP config/filesystem under internal .1 IP
  const routerPublicConfig = machineConfigs[topology.routerPublicIp];
  if (routerPublicConfig) {
    machineConfigs[routerInternalIp] = routerPublicConfig;
  }
  const routerPublicFs = fileSystems[topology.routerPublicIp];
  if (routerPublicFs) {
    fileSystems[routerInternalIp] = routerPublicFs;
  }

  // Inner gateways: alias downstream .1 IPs
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
