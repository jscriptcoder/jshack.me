import type { Prng } from './prng';
import { generatePrivateSubnet, generatePublicIp } from './ip';
import type {
  Difficulty,
  GeneratedMachine,
  MachineRole,
  NatForwarding,
  SubnetLayer,
} from './types';
import type {
  DnsRecord,
  MachineNetworkConfig,
  NetworkConfig,
  NetworkInterface,
  Port,
  RemoteMachine,
} from '../network/types';
import type { EntryVariant } from './types';
import {
  hostnamesByRole,
  portTemplatesByRole,
  entryPortTemplates,
  routerEntryPortTemplates,
  backdoorPorts,
} from './pools';
import { vulnerabilityTemplates } from './pools';

const allVariants: readonly EntryVariant[] = ['ssh', 'ftp', 'nc', 'exploit', 'http', 'snmp'];

// Builds ports for a machine by combining role-based ports with access variant extras.
// SSH variant: role ports unchanged. FTP: ensures port 21 open. NC: adds backdoor port.
// Exploit: ensures a vulnerable port is open. HTTP: ensures port 80 open.
const buildVariantPorts = (
  prng: Prng,
  role: MachineRole,
  variant: EntryVariant,
): readonly Port[] => {
  const rolePorts = buildPorts(role);

  // Always consume one PRNG call for NC backdoor port selection (sequence stability)
  const backdoorPort = prng.pick(backdoorPorts);

  // SNMP variant on internal machines behaves like SSH (no extra ports)
  if (variant === 'ssh' || variant === 'snmp') return rolePorts;

  if (variant === 'ftp') {
    const hasFtp = rolePorts.some((p) => p.port === 21);
    if (hasFtp) {
      return rolePorts.map((p) => (p.port === 21 ? { ...p, open: true } : p));
    }
    return [...rolePorts, { port: 21, service: 'ftp', open: true }];
  }

  if (variant === 'nc') {
    return [...rolePorts, { port: backdoorPort, service: 'elite', open: true }];
  }

  if (variant === 'exploit') {
    // Find an existing open port that matches a vulnerability template
    const existingVuln = rolePorts.find(
      (p) => p.open && vulnerabilityTemplates.some((v) => v.port === p.port),
    );
    if (existingVuln) return rolePorts;

    // No matching open port — find a closed role port with a vuln template and open it
    const closedVuln = rolePorts.find(
      (p) => !p.open && vulnerabilityTemplates.some((v) => v.port === p.port),
    );
    if (closedVuln) {
      return rolePorts.map((p) => (p.port === closedVuln.port ? { ...p, open: true } : p));
    }

    // No role port matches — add port 80 (http) which has a vulnerability template
    return [...rolePorts, { port: 80, service: 'http', open: true }];
  }

  // HTTP variant
  const hasHttp = rolePorts.some((p) => p.port === 80);
  if (hasHttp) {
    return rolePorts.map((p) => (p.port === 80 ? { ...p, open: true } : p));
  }
  return [...rolePorts, { port: 80, service: 'http', open: true }];
};

export type TopologyResult = {
  readonly machines: readonly GeneratedMachine[];
  readonly routerMachine: GeneratedMachine;
  readonly routerPublicIp: string;
  readonly natForwarding?: NatForwarding;
  readonly networkConfig: NetworkConfig;
  readonly entryPoint: string;
  readonly entryVariant: EntryVariant;
  readonly externalDnsRecords: readonly DnsRecord[];
  readonly layers: readonly SubnetLayer[];
};

export type SubnetLayerConfig = {
  readonly minMachines: number;
  readonly maxMachines: number;
  readonly difficulty: Difficulty;
  readonly usedSubnets: ReadonlySet<string>;
  readonly usedHostnames: Record<string, Set<string>>;
  readonly entryVariantOverride?: EntryVariant;
  readonly forwardedOverride?: boolean;
};

export type SubnetLayerResult = {
  readonly subnet: string;
  readonly machines: readonly GeneratedMachine[];
  readonly entryPoint: string;
  readonly entryVariant: EntryVariant;
  readonly internalEntryVariant: EntryVariant;
  readonly isForwarded: boolean;
  readonly gatewayPorts: readonly Port[];
};

const machineCountByDifficulty: Readonly<Record<Difficulty, readonly [number, number]>> = {
  easy: [2, 2],
  medium: [3, 4],
  hard: [4, 6],
};

const allRoles: readonly MachineRole[] = [
  'webserver',
  'database',
  'fileserver',
  'workstation',
  'mailserver',
  'iot',
];

const entryRoles: readonly MachineRole[] = ['webserver', 'workstation'];

const createInterface = (
  name: string,
  inet: string,
  netmask: string,
  gateway: string,
  mac: string,
): NetworkInterface => ({
  name,
  flags: ['UP', 'BROADCAST', 'RUNNING', 'MULTICAST'],
  inet,
  netmask,
  gateway,
  mac,
});

const generateMac = (prng: Prng): string => {
  const hex = () => prng.nextInt(0, 255).toString(16).padStart(2, '0');
  return `02:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`;
};

const buildPorts = (role: MachineRole): readonly Port[] =>
  portTemplatesByRole[role].map((t) => ({
    port: t.port,
    service: t.service,
    open: t.open,
  }));

const buildPortsFromTemplate = (
  template: readonly {
    readonly port: number;
    readonly service: string;
    readonly open: boolean;
    readonly protocol?: 'tcp' | 'udp';
  }[],
): readonly Port[] =>
  template.map((t) => ({
    port: t.port,
    service: t.service,
    open: t.open,
    ...(t.protocol ? { protocol: t.protocol } : {}),
  }));

// Determines whether the mission uses port forwarding (easier) or router-first (harder).
// Easy: 70% chance of forwarding. Medium: 50%. Hard: always router-first.
// Always consumes one PRNG call to preserve sequence regardless of override.
const isForwardedMode = (
  prng: Prng,
  difficulty: Difficulty,
  forwardedOverride?: boolean,
): boolean => {
  const threshold = difficulty === 'easy' ? 0.7 : difficulty === 'hard' ? 0 : 0.5;
  const prngResult = prng.next() < threshold;
  if (forwardedOverride !== undefined) return forwardedOverride;
  return prngResult;
};

// Generates a unique private subnet prefix, avoiding any in usedSubnets.
const pickSubnet = (prng: Prng, usedSubnets: ReadonlySet<string>): string => {
  let subnet: string;
  do {
    subnet = generatePrivateSubnet(prng);
  } while (usedSubnets.has(subnet));
  return subnet;
};

// Generates internal machines for a single subnet layer. The caller is responsible for
// building the gateway/router machine, NAT forwarding, DNS, and network config.
export const generateSubnetLayer = (prng: Prng, config: SubnetLayerConfig): SubnetLayerResult => {
  const { minMachines, maxMachines, difficulty, usedHostnames } = config;
  const machineCount = prng.nextInt(minMachines, maxMachines);

  const subnet = pickSubnet(prng, config.usedSubnets);
  const internalGateway = `${subnet}.1`;

  const forwarded = isForwardedMode(prng, difficulty, config.forwardedOverride);

  // Select entry variant for the entry/DMZ machine.
  // Always consume PRNG picks to preserve sequence, then apply override if set.
  const prngEntryTemplate = prng.pick(entryPortTemplates);
  const entryTemplate = config.entryVariantOverride
    ? (entryPortTemplates.find((t) => t.variant === config.entryVariantOverride) ??
      prngEntryTemplate)
    : prngEntryTemplate;
  const internalEntryVariant = entryTemplate.variant;

  // In router-first mode, the player-facing entry variant applies to the gateway.
  // Always consume PRNG pick for router/gateway template to preserve sequence.
  const prngRouterTemplate = forwarded ? null : prng.pick(routerEntryPortTemplates);
  const routerTemplate = forwarded
    ? null
    : config.entryVariantOverride
      ? (routerEntryPortTemplates.find((t) => t.variant === config.entryVariantOverride) ??
        prngRouterTemplate)
      : prngRouterTemplate;
  const entryVariant = forwarded ? internalEntryVariant : (routerTemplate?.variant ?? 'ssh');

  // Gateway ports: router-first uses the entry template, forwarded uses default router ports
  const gatewayPorts = routerTemplate
    ? buildPortsFromTemplate(routerTemplate.ports)
    : buildPorts('router');

  // Build internal machines (entry + others)
  const entryRole = prng.pick(entryRoles);
  const remainingRoles = Array.from({ length: machineCount - 1 }, () => prng.pick(allRoles));
  const roles: readonly MachineRole[] = [entryRole, ...remainingRoles];

  const pickUniqueHostname = (role: MachineRole): string => {
    const used = usedHostnames[role] ?? new Set<string>();
    const available = hostnamesByRole[role].filter((h) => !used.has(h));
    const hostname =
      available.length > 0
        ? prng.pick(available)
        : `${prng.pick(hostnamesByRole[role])}-${used.size}`;
    usedHostnames[role] = new Set([...used, hostname]);
    return hostname;
  };

  const usedOctets = new Set<number>();
  const lastOctets = roles.map(() => {
    let octet: number;
    do {
      octet = prng.nextInt(2, 254);
    } while (usedOctets.has(octet));
    usedOctets.add(octet);
    return octet;
  });

  const machines: readonly GeneratedMachine[] = roles.map((role, i) => {
    const ip = `${subnet}.${lastOctets[i]}`;
    const hostname = pickUniqueHostname(role);
    const isEntry = i === 0;
    const accessVariant = isEntry ? internalEntryVariant : prng.pick(allVariants);
    const ports =
      isEntry && forwarded
        ? buildPortsFromTemplate(entryTemplate.ports)
        : buildVariantPorts(prng, role, accessVariant);

    return {
      ip,
      hostname,
      role,
      accessVariant,
      remoteMachine: { ip, hostname, ports, users: [] },
    };
  });

  const entryPoint = machines[0]?.ip ?? internalGateway;

  return {
    subnet,
    machines,
    entryPoint,
    entryVariant,
    internalEntryVariant,
    isForwarded: forwarded,
    gatewayPorts,
  };
};

export type TopologyOverrides = {
  readonly entryVariantOverride?: EntryVariant;
  readonly forwardedOverride?: boolean;
  readonly usedIps?: ReadonlySet<string>;
};

export const generateTopology = (
  prng: Prng,
  difficulty: Difficulty,
  overrides: TopologyOverrides = {},
): TopologyResult => {
  const [minMachines, maxMachines] = machineCountByDifficulty[difficulty];
  const usedHostnames: Record<string, Set<string>> = {};

  const layer = generateSubnetLayer(prng, {
    minMachines,
    maxMachines,
    difficulty,
    usedSubnets: new Set<string>(),
    usedHostnames,
    entryVariantOverride: overrides.entryVariantOverride,
    forwardedOverride: overrides.forwardedOverride,
  });

  const { subnet, machines, entryPoint: entryIp, entryVariant, isForwarded: forwarded } = layer;
  const internalGateway = `${subnet}.1`;

  const routerPublicIp = generatePublicIp(prng, overrides.usedIps);

  // Build router machine
  const routerHostname = prng.pick(hostnamesByRole.router);
  const routerAccessVariant: EntryVariant = forwarded ? 'ssh' : entryVariant;

  const routerMachine: GeneratedMachine = {
    ip: routerPublicIp,
    hostname: routerHostname,
    role: 'router',
    accessVariant: routerAccessVariant,
    remoteMachine: {
      ip: routerPublicIp,
      hostname: routerHostname,
      ports: layer.gatewayPorts,
      users: [],
    },
  };

  // NAT forwarding config (forwarded mode only) — port-level rules from entry machine
  const natForwarding: NatForwarding | undefined = forwarded
    ? {
        publicIp: routerPublicIp,
        rules:
          machines[0]?.remoteMachine.ports
            .filter((p) => p.open)
            .map((p) => ({ publicPort: p.port, internalIp: entryIp, internalPort: p.port })) ?? [],
      }
    : undefined;

  // DNS: internal records for all mission machines + router internal IP
  const internalDnsRecords: readonly DnsRecord[] = [
    ...machines.map((m) => ({
      domain: `${m.hostname}.mission`,
      ip: m.ip,
      type: 'A' as const,
    })),
    {
      domain: `${routerHostname}.mission`,
      ip: internalGateway,
      type: 'A' as const,
    },
  ];

  // External DNS: only the router's public IP
  const externalDnsRecords: readonly DnsRecord[] = [
    {
      domain: `${routerHostname}.mission`,
      ip: routerPublicIp,
      type: 'A' as const,
    },
  ];

  const machineConfigs: Record<string, MachineNetworkConfig> = {};

  // Internal machines see each other + router's internal IP (not public)
  const routerInternalRemote: RemoteMachine = {
    ip: internalGateway,
    hostname: routerHostname,
    ports: layer.gatewayPorts,
    users: [],
  };

  machines.forEach((machine) => {
    const otherMachines: readonly RemoteMachine[] = [
      ...machines.filter((m) => m.ip !== machine.ip).map((m) => m.remoteMachine),
      routerInternalRemote,
    ];

    machineConfigs[machine.ip] = {
      interfaces: [
        createInterface('eth0', machine.ip, '255.255.255.0', internalGateway, generateMac(prng)),
      ],
      machines: otherMachines,
      dnsRecords: internalDnsRecords,
    };
  });

  // Router config: dual interfaces (public eth0 + internal eth1), sees all internal machines
  machineConfigs[routerPublicIp] = {
    interfaces: [
      createInterface('eth0', routerPublicIp, '255.255.255.0', '0.0.0.0', generateMac(prng)),
      createInterface('eth1', internalGateway, '255.255.255.0', '0.0.0.0', generateMac(prng)),
    ],
    machines: machines.map((m) => m.remoteMachine),
    dnsRecords: internalDnsRecords,
  };

  const layers: readonly SubnetLayer[] = [
    {
      subnet,
      gateway: routerMachine,
      entryVariant,
      machines,
      isForwarded: forwarded,
      natForwarding,
    },
  ];

  return {
    machines,
    routerMachine,
    routerPublicIp,
    natForwarding,
    networkConfig: { machineConfigs },
    entryPoint: entryIp,
    entryVariant,
    externalDnsRecords,
    layers,
  };
};
