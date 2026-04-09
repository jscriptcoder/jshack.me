import type { Prng } from '../prng';
import type {
  CredentialMap,
  Difficulty,
  EntryVariant,
  GeneratedMachine,
  MissionObjective,
  NatForwarding,
  SubnetLayer,
} from '../types';
import type { FileNode } from '../../filesystem/types';
import type { RemoteUser } from '../../network/types';
import {
  createFileSystem,
  mergeFileNodeChildren,
  type MachineFileSystemConfig,
} from '../../filesystem/fileSystemFactory';
import { wrapInBinaryNoise } from '../binary';
import { mkFile, mkDir, buildNestedDirs } from './helpers';
import {
  generateSnmpConfig,
  generateSwitchSnmpConfig,
  generateBasicSnmpConfig,
  generateBasicRwSnmpConfig,
  generateDnsZoneContent,
  generateDnsNamedConf,
} from './networkConfig';
import { generateForensicsEvidence } from './forensicsEvidence';
import type { DbEnrichment } from '../generateDatabase';
import { buildMachineConfig } from './machineConfig';
import { buildSameLayerCredentials } from './sameLayerCredentials';

export type { BuildMachineConfigOptions } from './machineConfig';
export { buildMachineConfig } from './machineConfig';

type FilesystemInput = {
  readonly prng: Prng;
  readonly machines: readonly GeneratedMachine[];
  readonly usersByMachine: Readonly<Record<string, readonly RemoteUser[]>>;
  readonly credentials: CredentialMap;
  readonly objective: MissionObjective;
  readonly routerMachine?: GeneratedMachine;
  readonly natForwarding?: NatForwarding;
  readonly entryVariant?: EntryVariant;
  readonly entryPoint?: string;
  readonly difficulty?: Difficulty;
  readonly layers?: readonly SubnetLayer[];
  readonly dbEnrichment?: DbEnrichment;
};

// Builds the key file directory tree for encrypted objectives.
// Returns the top-level directory name and FileNode, or null if no key placement.
const buildKeyFileTree = (
  prng: Prng,
  objective: MissionObjective,
): { readonly topDir: string; readonly node: FileNode } | null => {
  if (!objective.keyPlacement) return null;

  const { filePath, fileContent, binary } = objective.keyPlacement;
  const segments = filePath.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] ?? 'key.txt';
  const content = binary ? wrapInBinaryNoise(prng, fileContent) : fileContent;
  // Key files under /home/ should be readable by the user whose directory they're in
  const owner = filePath.startsWith('/home/') ? 'user' : 'root';
  const file = mkFile(fileName, content, owner);
  const topDir = segments[0] ?? 'root';

  return { topDir, node: buildNestedDirs(segments, file) };
};

// Merges key file directories into an existing config's extraDirectories.
const mergeKeyPlacement = (
  config: MachineFileSystemConfig,
  keyTree: { readonly topDir: string; readonly node: FileNode } | null,
): MachineFileSystemConfig => {
  if (!keyTree) return config;
  return {
    ...config,
    extraDirectories: mergeFileNodeChildren(config.extraDirectories ?? {}, {
      [keyTree.topDir]: keyTree.node,
    }),
  };
};

// Merges script_auto data files into a machine's filesystem config.
// Local flavor: places JSON data file on the target machine.
// Remote flavor: places API JSON at /var/www/api/<endpoint>.json on the API machine.
const mergeScriptAutoData = (
  machine: GeneratedMachine,
  objective: MissionObjective,
  config: MachineFileSystemConfig,
): MachineFileSystemConfig => {
  if (objective.type !== 'script_auto') return config;

  const { scriptAutoFlavor, scriptAutoDataPath, scriptAutoDataContent, scriptAutoApiMachine } =
    objective;
  if (!scriptAutoDataPath || !scriptAutoDataContent) return config;

  // Local: place data file on the target machine
  if (scriptAutoFlavor === 'local' && machine.ip === objective.targetMachine) {
    const segments = scriptAutoDataPath.split('/').filter(Boolean);
    const fileName = segments[segments.length - 1] ?? 'data.json';
    const dataFile = mkFile(fileName, scriptAutoDataContent, 'guest');
    const topDir = segments[0] ?? 'root';
    const existing = config.extraDirectories ?? {};
    const newDir = buildNestedDirs(segments, dataFile);

    // Merge with existing extraDirectories entry for the same top-level dir
    // (e.g., script at /etc/cron.d/ and data at /etc/ssl/ both share 'etc' top dir)
    const existingDir = existing[topDir];
    if (existingDir?.type === 'directory' && newDir.type === 'directory') {
      const merged = {
        ...existingDir,
        children: { ...existingDir.children, ...newDir.children },
      };
      return { ...config, extraDirectories: { ...existing, [topDir]: merged } };
    }

    return {
      ...config,
      extraDirectories: { ...existing, [topDir]: newDir },
    };
  }

  // Remote: place API JSON on the API machine at /var/www/api/<endpoint>.json
  if (scriptAutoFlavor === 'remote' && machine.ip === scriptAutoApiMachine) {
    const apiFileName = `${scriptAutoDataPath}.json`;
    const apiFile = mkFile(apiFileName, scriptAutoDataContent, 'guest');

    const existing = config.extraDirectories ?? {};
    const existingVar = existing['var'];

    // If var/www already exists (machine has HTTP port), merge the api/ dir into it
    if (existingVar?.type === 'directory' && existingVar.children?.['www']) {
      const www = existingVar.children['www'] as FileNode;
      const wwwChildren = { ...(www.children ?? {}) };
      wwwChildren['api'] = mkDir('api', { [apiFileName]: apiFile }, 'root', true);
      const newWww = mkDir('www', wwwChildren, 'root', true);
      const newVar = mkDir('var', { ...(existingVar.children ?? {}), www: newWww }, 'root', true);
      return { ...config, extraDirectories: { ...existing, var: newVar } };
    }

    // No existing var/www — create the full structure
    const varDir = mkDir(
      'var',
      {
        www: mkDir(
          'www',
          {
            api: mkDir('api', { [apiFileName]: apiFile }, 'root', true),
          },
          'root',
          true,
        ),
      },
      'root',
      true,
    );
    return { ...config, extraDirectories: { ...existing, var: varDir } };
  }

  return config;
};

type FilesystemResult = {
  readonly fileSystems: Readonly<Record<string, FileNode>>;
  readonly basicSnmpGatewayIps: ReadonlySet<string>;
};

export const generateFileSystems = (input: FilesystemInput): FilesystemResult => {
  const {
    prng,
    machines,
    usersByMachine,
    credentials,
    objective,
    routerMachine,
    natForwarding,
    entryVariant,
    entryPoint,
    difficulty,
    layers,
    dbEnrichment,
  } = input;

  // Build maps from inner gateway IP → downstream layer info (machines, NAT, subnet).
  // Gateways need downstream machines for /etc/hosts, NAT forwarding for iptables,
  // and downstream subnet for switch ACL rules.
  const gatewayDownstreamMap = new Map<string, readonly GeneratedMachine[]>();
  const gatewayNatMap = new Map<string, NatForwarding | undefined>();
  const gatewaySubnetMap = new Map<string, string>();
  if (layers && layers.length > 1) {
    layers.slice(1).forEach((layer, i) => {
      const downstreamIps = new Set(layer.machines.map((m) => m.ip));
      const downstreamMachines = machines.filter((m) => downstreamIps.has(m.ip));
      // Include the next layer's gateway (dual-homed in this subnet) so it
      // appears in /etc/hosts and is reachable via nmap from this layer.
      const nextLayer = layers[i + 2]; // i is offset by 1 from slice(1)
      const nextGateway = nextLayer
        ? machines.find((m) => m.ip === nextLayer.gateway.ip)
        : undefined;
      const allDownstream = nextGateway ? [...downstreamMachines, nextGateway] : downstreamMachines;
      gatewayDownstreamMap.set(layer.gateway.ip, allDownstream);
      gatewayNatMap.set(layer.gateway.ip, layer.natForwarding);
      gatewaySubnetMap.set(layer.gateway.ip, layer.subnet);
    });
  }

  // Pre-generate SNMP configs for inner gateways. Three tiers:
  // 1. Full SNMP-variant: rw community, credential leaks, firewall/ACL OIDs
  // 2. Basic read-write: rw community + firewall/ACL OIDs, no credential leaks (~30% of basic)
  // 3. Basic read-only: rocommunity public, interface OIDs only (~70% of basic)
  // Non-SNMP gateways get a PRNG roll for basic SNMP. Within basic, a second roll
  // decides read-only vs read-write. All rolls are always consumed for PRNG stability.
  const basicSnmpThreshold = difficulty === 'easy' ? 0.8 : difficulty === 'medium' ? 0.6 : 0.4;
  const BASIC_RW_CHANCE = 0.3;
  const gatewaySnmpConfigs = new Map<string, string>();
  const basicSnmpGatewayIps = new Set<string>();
  if (layers && layers.length > 1) {
    layers.slice(1).forEach((layer) => {
      const basicSnmpRoll = prng.next();
      const basicRwRoll = prng.next();
      const secondaryIp = `${layer.subnet}.1`;
      if (layer.gateway.accessVariant === 'snmp') {
        const gatewayCreds = credentials[layer.gateway.ip] ?? [];
        const snmpConfigFn =
          layer.gatewayType === 'switch' ? generateSwitchSnmpConfig : generateSnmpConfig;
        gatewaySnmpConfigs.set(
          layer.gateway.ip,
          snmpConfigFn(prng, layer.gateway, gatewayCreds, secondaryIp),
        );
      } else if (basicSnmpRoll < basicSnmpThreshold) {
        const isSwitch = layer.gatewayType === 'switch';
        if (basicRwRoll < BASIC_RW_CHANCE) {
          // Basic read-write: rw community + firewall/ACL OIDs, no credential leaks
          gatewaySnmpConfigs.set(
            layer.gateway.ip,
            generateBasicRwSnmpConfig(
              prng,
              layer.gateway.hostname,
              layer.gateway.ip,
              secondaryIp,
              isSwitch,
            ),
          );
        } else {
          // Basic read-only: interface discovery only
          gatewaySnmpConfigs.set(
            layer.gateway.ip,
            generateBasicSnmpConfig(
              layer.gateway.hostname,
              layer.gateway.ip,
              secondaryIp,
              isSwitch,
            ),
          );
        }
        basicSnmpGatewayIps.add(layer.gateway.ip);
      }
    });
  }

  // Pre-generate DNS zone configs for dns-role machines. Each DNS machine gets
  // zone records for its own layer + all downstream layers (cross-layer recon).
  // AXFR probability: easy 80%, medium 60%, hard 40% — same pattern as basic SNMP.
  const axfrThreshold = difficulty === 'easy' ? 0.8 : difficulty === 'medium' ? 0.6 : 0.4;
  const dnsConfigs = new Map<
    string,
    { readonly zoneContent: string; readonly namedConf: string }
  >();
  if (layers) {
    const machineLayerIndex = new Map<string, number>();
    layers.forEach((layer, i) => {
      layer.machines.forEach((m) => machineLayerIndex.set(m.ip, i));
      if (i > 0) machineLayerIndex.set(layer.gateway.ip, i - 1);
    });

    machines.forEach((machine) => {
      if (machine.role !== 'dns') return;

      const layerIdx = machineLayerIndex.get(machine.ip) ?? 0;
      const zoneRecords = layers.flatMap((layer, i) => {
        if (i < layerIdx) return [];
        const records = layer.machines.map((m) => ({
          domain: `${m.hostname}.mission`,
          ip: m.ip,
          type: 'A' as const,
        }));
        if (i > layerIdx) {
          records.push({
            domain: `${layer.gateway.hostname}.mission`,
            ip: layer.gateway.ip,
            type: 'A' as const,
          });
        }
        return records;
      });

      const upstreamGatewayIp = `${layers[layerIdx]!.subnet}.1`;
      const upstreamGateway = layerIdx === 0 ? routerMachine : layers[layerIdx]!.gateway;
      if (upstreamGateway && !zoneRecords.some((r) => r.ip === upstreamGateway.ip)) {
        zoneRecords.push({
          domain: `${upstreamGateway.hostname}.mission`,
          ip: upstreamGatewayIp,
          type: 'A' as const,
        });
      }

      const axfrRoll = prng.next();
      const allowAxfr = axfrRoll < axfrThreshold;

      dnsConfigs.set(machine.ip, {
        zoneContent: generateDnsZoneContent(machine.hostname, zoneRecords),
        namedConf: generateDnsNamedConf('mission', allowAxfr),
      });
    });
  }

  // Pre-generate forensics evidence (log files + calling card) before machine loop
  const forensicsEvidence = generateForensicsEvidence(prng, machines, objective, difficulty);

  // Build same-layer credential map for cross-machine credential leaks.
  // Each machine gets a list of peer credentials from its own subnet layer.
  const sameLayerCredsMap = layers ? buildSameLayerCredentials(layers, credentials) : new Map();

  const entries = machines.map((machine) => {
    const users = usersByMachine[machine.ip] ?? [];
    const machineCreds = credentials[machine.ip] ?? [];
    const isTarget = machine.ip === objective.targetMachine;
    const isHttpEntry = entryVariant === 'http' && machine.ip === entryPoint;
    const isFtpEntry = entryVariant === 'ftp' && machine.ip === entryPoint;

    // Inner gateways get downstream machines for /etc/hosts, NAT/ACL rules, and subnet info
    const downstreamMachines = gatewayDownstreamMap.get(machine.ip);
    const gatewayNat = gatewayNatMap.get(machine.ip);
    const downstreamSubnet = gatewaySubnetMap.get(machine.ip);
    const baseConfig = buildMachineConfig(prng, machine, users, machineCreds, {
      isTarget,
      objective,
      internalMachines: downstreamMachines,
      natForwarding: gatewayNat,
      isHttpEntry,
      isFtpEntry,
      downstreamSubnet,
      dbEnrichment: isTarget ? dbEnrichment : undefined,
      sameLayerCredentials: sameLayerCredsMap.get(machine.ip),
    });

    // SNMP variant: add /etc/snmp/snmpd.conf for inner gateways with SNMP access variant
    const snmpContent = gatewaySnmpConfigs.get(machine.ip);
    const configWithSnmp = snmpContent
      ? {
          ...baseConfig,
          etcExtraContent: {
            ...baseConfig.etcExtraContent,
            snmp: mkDir('snmp', { 'snmpd.conf': mkFile('snmpd.conf', snmpContent) }, 'root', true),
          },
        }
      : baseConfig;

    // DNS role: add /etc/bind/ with named.conf and zone file
    const dnsConfig = dnsConfigs.get(machine.ip);
    const configWithDns = dnsConfig
      ? {
          ...configWithSnmp,
          etcExtraContent: {
            ...configWithSnmp.etcExtraContent,
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
        }
      : configWithSnmp;

    // Place encryption key file on the key machine (if this is that machine)
    const keyTree =
      objective.keyPlacement?.machineIp === machine.ip ? buildKeyFileTree(prng, objective) : null;
    const configWithKey = mergeKeyPlacement(configWithDns, keyTree);

    // Merge forensics evidence (log files, calling card) if present for this machine
    const evidence = forensicsEvidence[machine.ip];
    const configWithEvidence = evidence
      ? {
          ...configWithKey,
          extraDirectories: mergeFileNodeChildren(configWithKey.extraDirectories ?? {}, evidence),
        }
      : configWithKey;

    // script_auto: place data file on target (local) or API JSON on API machine (remote)
    const config = mergeScriptAutoData(machine, objective, configWithEvidence);

    const fileSystem = createFileSystem(config);

    return [machine.ip, fileSystem] as const;
  });

  // Generate router filesystem with hints about internal machines
  // Border router only sees layer 0 machines + the first inner gateway (not all layers)
  if (routerMachine) {
    const routerUsers = usersByMachine[routerMachine.ip] ?? [];
    const routerCreds = credentials[routerMachine.ip] ?? [];

    const routerVisibleMachines =
      layers && layers.length > 0
        ? [
            ...machines.filter((m) => layers[0]!.machines.some((lm) => lm.ip === m.ip)),
            ...(layers.length > 1 ? machines.filter((m) => m.ip === layers[1]!.gateway.ip) : []),
          ]
        : machines;

    const baseRouterConfig = buildMachineConfig(prng, routerMachine, routerUsers, routerCreds, {
      objective,
      internalMachines: routerVisibleMachines,
      natForwarding,
    });

    // Place encryption key on router if it's the key machine
    const routerKeyTree =
      objective.keyPlacement?.machineIp === routerMachine.ip
        ? buildKeyFileTree(prng, objective)
        : null;
    const routerConfigWithKey = mergeKeyPlacement(baseRouterConfig, routerKeyTree);

    // SNMP variant: add /etc/snmp/snmpd.conf with community strings, OIDs, credentials
    const routerSecondaryIp = layers?.[0] ? `${layers[0].subnet}.1` : undefined;
    const routerConfig =
      entryVariant === 'snmp'
        ? {
            ...routerConfigWithKey,
            etcExtraContent: {
              ...routerConfigWithKey.etcExtraContent,
              snmp: mkDir(
                'snmp',
                {
                  'snmpd.conf': mkFile(
                    'snmpd.conf',
                    generateSnmpConfig(prng, routerMachine, routerCreds, routerSecondaryIp),
                  ),
                },
                'root',
                true,
              ),
            },
          }
        : routerConfigWithKey;

    const routerFs = createFileSystem(routerConfig);
    const allEntries: (readonly [string, FileNode])[] = [...entries, [routerMachine.ip, routerFs]];

    // Alias gateway filesystems under their downstream .1 IPs so commands like
    // curl can read from gateways when addressed by their internal subnet IP.
    // Border router: layer 0's .1 → router filesystem.
    // Inner gateways: each layer's .1 → that layer's gateway filesystem.
    if (layers && layers.length > 0) {
      const routerAliasIp = `${layers[0]!.subnet}.1`;
      allEntries.push([routerAliasIp, routerFs]);

      layers.slice(1).forEach((layer) => {
        const gatewayFs = allEntries.find(([ip]) => ip === layer.gateway.ip)?.[1];
        if (gatewayFs) {
          allEntries.push([`${layer.subnet}.1`, gatewayFs]);
        }
      });
    }

    return {
      fileSystems: Object.fromEntries(allEntries),
      basicSnmpGatewayIps,
    };
  }

  return { fileSystems: Object.fromEntries(entries), basicSnmpGatewayIps };
};
