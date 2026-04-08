// Shared network generation pipeline used by both mission and home network generators.
// Handles: topology → users → enrichment → port closures → config update → base filesystems.
// Callers layer on their own specifics (objectives for missions, .1 aliases for home).

import type { Prng } from './prng';
import { generateTopology, type TopologyOverrides } from './topology';
import { generateUsers } from './users';
import { enrichMachineWithUsers, applyPortClosures, applyRedisPortOpening } from './enrichment';
import {
  buildMachineConfig,
  generateBasicSnmpConfig,
  generateSnmpConfig,
  generateSwitchSnmpConfig,
  generateDnsZoneContent,
  generateDnsNamedConf,
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
    { entryVariant: topology.entryVariant },
  );
  const { usersByMachine: routerUsersByMachine, credentials: routerCredentials } = generateUsers(
    prng,
    [topology.routerMachine],
    '', // router is never the entry point for user generation
    { entryVariant: topology.entryVariant },
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

  // 5b. Open Redis port 6379 on ~35% of database machines
  const machinesWithRedis = applyRedisPortOpening(prng, machinesAfterClosures);

  // 6. Update network configs with populated users and port closures
  const updatedMachineConfigs: Record<string, MachineNetworkConfig> = Object.fromEntries(
    Object.entries(topology.networkConfig.machineConfigs).map(([ip, config]) => [
      ip,
      {
        ...config,
        machines: config.machines.map((rm) => {
          const updated = machinesWithRedis.find((m) => m.ip === rm.ip);
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
        const downstreamMachines = machinesWithRedis.filter((m) => downstreamIps.has(m.ip));
        gatewayDownstreamMap.set(layer.gateway.ip, downstreamMachines);
        gatewayNatMap.set(layer.gateway.ip, layer.natForwarding);
        gatewaySubnetMap.set(layer.gateway.ip, layer.subnet);
      });
    }

    // Pre-generate SNMP configs for inner gateways. SNMP-variant gateways get full configs.
    // Non-SNMP gateways get a PRNG roll for basic read-only SNMP (interface discovery).
    // Roll is always consumed per gateway to keep PRNG sequence stable.
    const basicSnmpThreshold = difficulty === 'easy' ? 0.8 : difficulty === 'medium' ? 0.6 : 0.4;
    const gatewaySnmpConfigs = new Map<string, string>();
    const basicSnmpGatewayIps = new Set<string>();
    if (topology.layers.length > 1) {
      topology.layers.slice(1).forEach((layer) => {
        const basicSnmpRoll = prng.next();
        const secondaryIp = `${layer.subnet}.1`;
        if (layer.gateway.accessVariant === 'snmp') {
          const gatewayCreds = allCredentials[layer.gateway.ip] ?? [];
          const snmpConfigFn =
            layer.gatewayType === 'switch' ? generateSwitchSnmpConfig : generateSnmpConfig;
          gatewaySnmpConfigs.set(
            layer.gateway.ip,
            snmpConfigFn(prng, layer.gateway, gatewayCreds, secondaryIp),
          );
        } else if (basicSnmpRoll < basicSnmpThreshold) {
          const isSwitch = layer.gatewayType === 'switch';
          gatewaySnmpConfigs.set(
            layer.gateway.ip,
            generateBasicSnmpConfig(
              layer.gateway.hostname,
              layer.gateway.ip,
              secondaryIp,
              isSwitch,
            ),
          );
          basicSnmpGatewayIps.add(layer.gateway.ip);
        }
      });
    }

    // Pre-generate DNS zone configs for dns-role machines. Each DNS machine gets
    // zone records for its own layer + all downstream layers (cross-layer recon).
    // AXFR probability follows the same pattern as basic SNMP on gateways.
    const axfrThreshold = difficulty === 'easy' ? 0.8 : difficulty === 'medium' ? 0.6 : 0.4;
    const dnsConfigs = new Map<
      string,
      { readonly zoneContent: string; readonly namedConf: string }
    >();
    {
      // Build layer index: machine IP → layer index
      const machineLayerIndex = new Map<string, number>();
      topology.layers.forEach((layer, i) => {
        layer.machines.forEach((m) => machineLayerIndex.set(m.ip, i));
        if (i > 0) machineLayerIndex.set(layer.gateway.ip, i - 1);
      });

      machinesWithRedis.forEach((machine) => {
        if (machine.role !== 'dns') return;

        const layerIdx = machineLayerIndex.get(machine.ip) ?? 0;

        // Collect records: same layer + all downstream layers + gateways
        const zoneRecords = topology.layers.flatMap((layer, i) => {
          if (i < layerIdx) return [];
          const layerRecords = layer.machines.map((m) => ({
            domain: `${m.hostname}.mission`,
            ip: m.ip,
            type: 'A' as const,
          }));
          // Include downstream gateway (dual-homed, on upstream subnet)
          if (i > layerIdx) {
            layerRecords.push({
              domain: `${layer.gateway.hostname}.mission`,
              ip: layer.gateway.ip,
              type: 'A' as const,
            });
          }
          return layerRecords;
        });

        // Include upstream gateway (.1) for the DNS machine's own layer
        const upstreamGatewayIp = `${topology.layers[layerIdx]!.subnet}.1`;
        const upstreamGateway =
          layerIdx === 0 ? topology.routerMachine : topology.layers[layerIdx]!.gateway;
        const hasUpstreamInRecords = zoneRecords.some((r) => r.ip === upstreamGateway.ip);
        if (!hasUpstreamInRecords) {
          zoneRecords.push({
            domain: `${upstreamGateway.hostname}.mission`,
            ip: upstreamGatewayIp,
            type: 'A' as const,
          });
        }

        // AXFR probability roll — always consume for PRNG sequence stability
        const axfrRoll = prng.next();
        const allowAxfr = axfrRoll < axfrThreshold;

        dnsConfigs.set(machine.ip, {
          zoneContent: generateDnsZoneContent(machine.hostname, zoneRecords),
          namedConf: generateDnsNamedConf('mission', allowAxfr),
        });
      });
    }

    // Generate filesystem for each machine
    machinesWithRedis.forEach((machine) => {
      const users = allUsersByMachine[machine.ip] ?? [];
      const machineCreds = allCredentials[machine.ip] ?? [];
      const isHttpEntry = topology.entryVariant === 'http' && machine.ip === topology.entryPoint;
      const isFtpEntry = topology.entryVariant === 'ftp' && machine.ip === topology.entryPoint;

      const downstreamMachines = gatewayDownstreamMap.get(machine.ip);
      const gatewayNat = gatewayNatMap.get(machine.ip);
      const downstreamSubnet = gatewaySubnetMap.get(machine.ip);
      const baseConfig = buildMachineConfig(prng, machine, users, machineCreds, {
        internalMachines: downstreamMachines,
        natForwarding: gatewayNat,
        isHttpEntry,
        isFtpEntry,
        downstreamSubnet,
      });

      // SNMP variant: add /etc/snmp/snmpd.conf for gateways
      const snmpContent = gatewaySnmpConfigs.get(machine.ip);
      let config: MachineFileSystemConfig = snmpContent
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

      // DNS role: add /etc/bind/ with named.conf and zone file
      const dnsConfig = dnsConfigs.get(machine.ip);
      if (dnsConfig) {
        config = {
          ...config,
          etcExtraContent: {
            ...config.etcExtraContent,
            bind: mkDir(
              'bind',
              {
                'named.conf': mkFile('named.conf', dnsConfig.namedConf, 'root'),
                zones: mkDir(
                  'zones',
                  { 'db.mission': mkFile('db.mission', dnsConfig.zoneContent, 'root') },
                  'root',
                  true,
                ),
              },
              'root',
              true,
            ),
          },
        };
      }

      fileSystems[machine.ip] = createFileSystem(config);
    });

    // Router filesystem — border router only sees layer 0 machines + first inner gateway
    const routerUsersForFs = allUsersByMachine[routerWithUsers.ip] ?? [];
    const routerCredsForFs = allCredentials[routerWithUsers.ip] ?? [];
    const layer0Ips = new Set(topology.layers[0]!.machines.map((m) => m.ip));
    const firstGatewayIp = topology.layers.length > 1 ? topology.layers[1]!.gateway.ip : null;
    const routerVisibleMachines = machinesWithRedis.filter(
      (m) => layer0Ips.has(m.ip) || m.ip === firstGatewayIp,
    );
    const baseRouterConfig = buildMachineConfig(
      prng,
      routerWithUsers,
      routerUsersForFs,
      routerCredsForFs,
      {
        internalMachines: routerVisibleMachines,
        natForwarding: topology.natForwarding,
      },
    );

    // SNMP variant: add /etc/snmp/snmpd.conf for the border router
    const routerSecondaryIp = `${topology.layers[0]!.subnet}.1`;
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
                    generateSnmpConfig(prng, routerWithUsers, routerCredsForFs, routerSecondaryIp),
                  ),
                },
                'root',
                true,
              ),
            },
          }
        : baseRouterConfig;

    fileSystems[routerWithUsers.ip] = createFileSystem(routerConfig);

    // Add UDP port 161 to non-SNMP-variant gateways that got basic SNMP via PRNG roll
    if (basicSnmpGatewayIps.size > 0) {
      const snmpPort = { port: 161, service: 'snmp', open: true, protocol: 'udp' as const };
      const withSnmp = Object.fromEntries(
        Object.entries(updatedMachineConfigs).map(([ip, config]) => [
          ip,
          {
            ...config,
            machines: config.machines.map((rm) =>
              basicSnmpGatewayIps.has(rm.ip) ? { ...rm, ports: [...rm.ports, snmpPort] } : rm,
            ),
          },
        ]),
      );
      Object.assign(updatedMachineConfigs, withSnmp);
    }
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
    machines: machinesWithRedis,
    routerMachine: routerWithUsers,
    usersByMachine: allUsersByMachine,
    credentials: allCredentials,
    updatedNetworkConfig: { machineConfigs: updatedMachineConfigs },
    fileSystems,
  };
};
