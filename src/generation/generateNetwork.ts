// Shared network generation pipeline used by both mission and home network generators.
// Handles: topology → users → enrichment → port closures → config update → base filesystems.
// Callers layer on their own specifics (objectives for missions, .1 aliases for home).

import type { Prng } from './prng';
import { generateTopology, type TopologyOverrides } from './topology';
import { generateUsers } from './users';
import { enrichMachineWithUsers, applyPortClosures } from './enrichment';
import {
  buildMachineConfig,
  generateSnmpConfig,
  generateSwitchSnmpConfig,
  mkFile,
  mkDir,
} from './filesystem';
import { createFileSystem, type MachineFileSystemConfig } from '../filesystem/fileSystemFactory';
import type {
  CredentialMap,
  Difficulty,
  EntryVariant,
  GeneratedMachine,
  MissionObjectiveType,
  NatForwarding,
  SubnetLayer,
} from './types';
import type { MachineNetworkConfig, NetworkConfig, RemoteUser } from '../network/types';
import type { FileNode } from '../filesystem/types';

export type GeneratedNetwork = {
  readonly topology: {
    readonly routerPublicIp: string;
    readonly entryPoint: string;
    readonly entryVariant: EntryVariant;
    readonly natForwarding?: NatForwarding;
    readonly layers: readonly SubnetLayer[];
    readonly networkConfig: NetworkConfig;
  };
  readonly machines: readonly GeneratedMachine[];
  readonly routerMachine: GeneratedMachine;
  readonly usersByMachine: Readonly<Record<string, readonly RemoteUser[]>>;
  readonly credentials: CredentialMap;
  readonly updatedNetworkConfig: NetworkConfig;
  readonly fileSystems: Readonly<Record<string, FileNode>>;
};

export type GenerateNetworkOptions = {
  readonly prng: Prng;
  readonly difficulty: Difficulty;
  readonly topologyOverrides?: TopologyOverrides;
  // When provided, port closures respect objective constraints (e.g. script_fix needs SSH)
  readonly objectiveType?: MissionObjectiveType;
  // When true, skip base filesystem generation (caller will generate custom filesystems)
  readonly skipFileSystems?: boolean;
};

export const generateNetwork = (options: GenerateNetworkOptions): GeneratedNetwork => {
  const { prng, difficulty, topologyOverrides, objectiveType, skipFileSystems } = options;

  // 1. Generate layered topology
  const topology = generateTopology(prng, difficulty, topologyOverrides);

  // 2. Generate users for internal machines + router
  const { usersByMachine, credentials } = generateUsers(
    prng,
    topology.machines,
    topology.entryPoint,
  );
  const { usersByMachine: routerUsersByMachine, credentials: routerCredentials } = generateUsers(
    prng,
    [topology.routerMachine],
    '', // router is never the entry point for user generation
  );

  // 3. Merge user/credential maps, including .1 gateway IP aliases
  const routerInternalIp = `${topology.layers[0]!.subnet}.1`;
  const routerUsers = routerUsersByMachine[topology.routerPublicIp] ?? [];
  const routerCreds = routerCredentials[topology.routerPublicIp] ?? [];

  const gatewayLayers = topology.layers.slice(1);
  const gatewayInternalIpMap: Record<string, typeof routerUsers> = Object.fromEntries(
    gatewayLayers.map((layer) => [`${layer.subnet}.1`, usersByMachine[layer.gateway.ip] ?? []]),
  );
  const gatewayInternalCredMap: Record<string, typeof routerCreds> = Object.fromEntries(
    gatewayLayers.map((layer) => [`${layer.subnet}.1`, credentials[layer.gateway.ip] ?? []]),
  );

  const allUsersByMachine = {
    ...usersByMachine,
    ...routerUsersByMachine,
    [routerInternalIp]: routerUsers,
    ...gatewayInternalIpMap,
  };
  const allCredentials = {
    ...credentials,
    ...routerCredentials,
    [routerInternalIp]: routerCreds,
    ...gatewayInternalCredMap,
  };

  // 4. Enrich machines with variant-specific port data (owners, vulnerabilities)
  const machinesWithUsers: readonly GeneratedMachine[] = topology.machines.map((m) =>
    enrichMachineWithUsers(m, allUsersByMachine[m.ip] ?? [], prng),
  );
  const routerWithUsers = enrichMachineWithUsers(
    topology.routerMachine,
    allUsersByMachine[topology.routerPublicIp] ?? [],
    prng,
  );

  // 5. Apply port closures (~30% SSH, ~30% FTP, independent rolls)
  const machinesAfterClosures = applyPortClosures(
    prng,
    machinesWithUsers,
    topology.entryPoint,
    objectiveType,
  );

  // 6. Update network configs with populated users and port closures
  const updatedMachineConfigs: Record<string, MachineNetworkConfig> = Object.fromEntries(
    Object.entries(topology.networkConfig.machineConfigs).map(([ip, config]) => [
      ip,
      {
        ...config,
        machines: config.machines.map((rm) => {
          const updated = machinesAfterClosures.find((m) => m.ip === rm.ip);
          return {
            ...rm,
            users: allUsersByMachine[rm.ip] ?? [],
            ports: updated?.remoteMachine.ports ?? rm.ports,
          };
        }),
      },
    ]),
  );

  // 7. Generate base filesystems (configs, logs, credential leaks, web content, PID files)
  const fileSystems: Record<string, FileNode> = {};
  if (!skipFileSystems) {
    // Build maps from inner gateway IP → downstream info (for /etc/hosts, iptables, ACLs)
    const gatewayDownstreamMap = new Map<string, readonly GeneratedMachine[]>();
    const gatewayNatMap = new Map<string, NatForwarding | undefined>();
    const gatewaySubnetMap = new Map<string, string>();
    if (topology.layers.length > 1) {
      topology.layers.slice(1).forEach((layer) => {
        const downstreamIps = new Set(layer.machines.map((m) => m.ip));
        const downstreamMachines = machinesAfterClosures.filter((m) => downstreamIps.has(m.ip));
        gatewayDownstreamMap.set(layer.gateway.ip, downstreamMachines);
        gatewayNatMap.set(layer.gateway.ip, layer.natForwarding);
        gatewaySubnetMap.set(layer.gateway.ip, layer.subnet);
      });
    }

    // Pre-generate SNMP configs for inner gateways with SNMP access variant
    const gatewaySnmpConfigs = new Map<string, string>();
    if (topology.layers.length > 1) {
      topology.layers.slice(1).forEach((layer) => {
        if (layer.gateway.accessVariant === 'snmp') {
          const gatewayCreds = allCredentials[layer.gateway.ip] ?? [];
          // Use switch-specific SNMP config (ACL OIDs) for switch gateways
          const snmpConfigFn =
            layer.gatewayType === 'switch' ? generateSwitchSnmpConfig : generateSnmpConfig;
          gatewaySnmpConfigs.set(layer.gateway.ip, snmpConfigFn(prng, layer.gateway, gatewayCreds));
        }
      });
    }

    // Generate filesystem for each machine
    machinesAfterClosures.forEach((machine) => {
      const users = allUsersByMachine[machine.ip] ?? [];
      const machineCreds = allCredentials[machine.ip] ?? [];
      const isHttpEntry = topology.entryVariant === 'http' && machine.ip === topology.entryPoint;

      const downstreamMachines = gatewayDownstreamMap.get(machine.ip);
      const gatewayNat = gatewayNatMap.get(machine.ip);
      const downstreamSubnet = gatewaySubnetMap.get(machine.ip);
      const baseConfig = buildMachineConfig(prng, machine, users, machineCreds, {
        internalMachines: downstreamMachines,
        natForwarding: gatewayNat,
        isHttpEntry,
        downstreamSubnet,
      });

      // SNMP variant: add /etc/snmp/snmpd.conf for gateways
      const snmpContent = gatewaySnmpConfigs.get(machine.ip);
      const config: MachineFileSystemConfig = snmpContent
        ? {
            ...baseConfig,
            etcExtraContent: {
              ...baseConfig.etcExtraContent,
              snmp: mkDir(
                'snmp',
                { 'snmpd.conf': mkFile('snmpd.conf', snmpContent) },
                'root',
                true,
              ),
            },
          }
        : baseConfig;

      fileSystems[machine.ip] = createFileSystem(config);
    });

    // Router filesystem
    const routerUsersForFs = allUsersByMachine[routerWithUsers.ip] ?? [];
    const routerCredsForFs = allCredentials[routerWithUsers.ip] ?? [];
    const baseRouterConfig = buildMachineConfig(
      prng,
      routerWithUsers,
      routerUsersForFs,
      routerCredsForFs,
      {
        internalMachines: machinesAfterClosures,
        natForwarding: topology.natForwarding,
      },
    );

    // SNMP variant: add /etc/snmp/snmpd.conf for the border router
    const routerConfig: MachineFileSystemConfig =
      topology.entryVariant === 'snmp'
        ? {
            ...baseRouterConfig,
            etcExtraContent: {
              ...baseRouterConfig.etcExtraContent,
              snmp: mkDir(
                'snmp',
                {
                  'snmpd.conf': mkFile(
                    'snmpd.conf',
                    generateSnmpConfig(prng, routerWithUsers, routerCredsForFs),
                  ),
                },
                'root',
                true,
              ),
            },
          }
        : baseRouterConfig;

    fileSystems[routerWithUsers.ip] = createFileSystem(routerConfig);
  }

  return {
    topology: {
      routerPublicIp: topology.routerPublicIp,
      entryPoint: topology.entryPoint,
      entryVariant: topology.entryVariant,
      natForwarding: topology.natForwarding,
      layers: topology.layers,
      networkConfig: topology.networkConfig,
    },
    machines: machinesAfterClosures,
    routerMachine: routerWithUsers,
    usersByMachine: allUsersByMachine,
    credentials: allCredentials,
    updatedNetworkConfig: { machineConfigs: updatedMachineConfigs },
    fileSystems,
  };
};
