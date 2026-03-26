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

type DifficultyConfig = {
  readonly layerCount: number;
  readonly machinesPerLayer: readonly [number, number];
};

const difficultyConfig: Readonly<Record<Difficulty, DifficultyConfig>> = {
  easy: { layerCount: 1, machinesPerLayer: [2, 2] },
  medium: { layerCount: 2, machinesPerLayer: [2, 3] },
  hard: { layerCount: 3, machinesPerLayer: [2, 3] },
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

// Picks a unique hostname for a machine role, tracking used hostnames to prevent
// duplicates across all layers and gateways. Mutates usedHostnames.
const pickUniqueHostname = (
  prng: Prng,
  role: MachineRole,
  usedHostnames: Record<string, Set<string>>,
): string => {
  const used = usedHostnames[role] ?? new Set<string>();
  const available = hostnamesByRole[role].filter((h) => !used.has(h));
  const hostname =
    available.length > 0
      ? prng.pick(available)
      : `${prng.pick(hostnamesByRole[role])}-${used.size}`;
  usedHostnames[role] = new Set([...used, hostname]);
  return hostname;
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
    const hostname = pickUniqueHostname(prng, role, usedHostnames);
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
  const { layerCount, machinesPerLayer } = difficultyConfig[difficulty];
  const [minMachines, maxMachines] = machinesPerLayer;
  const usedHostnames: Record<string, Set<string>> = {};
  const usedSubnets = new Set<string>();

  // 1. Generate all subnet layers
  const layerResults: readonly SubnetLayerResult[] = Array.from({ length: layerCount }, (_, i) => {
    const layer = generateSubnetLayer(prng, {
      minMachines,
      maxMachines,
      difficulty,
      usedSubnets,
      usedHostnames,
      // Only outermost layer gets user overrides
      entryVariantOverride: i === 0 ? overrides.entryVariantOverride : undefined,
      forwardedOverride: i === 0 ? overrides.forwardedOverride : undefined,
    });
    usedSubnets.add(layer.subnet);
    return layer;
  });

  const outerLayer = layerResults[0]!;

  // 2. Generate outer router
  const routerPublicIp = generatePublicIp(prng, overrides.usedIps);
  const routerHostname = pickUniqueHostname(prng, 'router', usedHostnames);
  const routerAccessVariant: EntryVariant = outerLayer.isForwarded
    ? 'ssh'
    : outerLayer.entryVariant;

  const routerMachine: GeneratedMachine = {
    ip: routerPublicIp,
    hostname: routerHostname,
    role: 'router',
    accessVariant: routerAccessVariant,
    remoteMachine: {
      ip: routerPublicIp,
      hostname: routerHostname,
      ports: outerLayer.gatewayPorts,
      users: [],
    },
  };

  // 3. Build gateway machines between adjacent layers
  const gatewayMachines: readonly GeneratedMachine[] = Array.from(
    { length: layerCount - 1 },
    (_, i) => {
      const upstreamLayer = layerResults[i]!;
      const downstreamLayer = layerResults[i + 1]!;

      // Pick unused octet on upstream subnet for gateway IP
      const usedOctets = new Set(upstreamLayer.machines.map((m) => Number(m.ip.split('.')[3])));
      let gatewayOctet: number;
      do {
        gatewayOctet = prng.nextInt(2, 254);
      } while (usedOctets.has(gatewayOctet));

      const gatewayUpstreamIp = `${upstreamLayer.subnet}.${gatewayOctet}`;
      const gatewayHostname = pickUniqueHostname(prng, 'router', usedHostnames);
      const gatewayAccessVariant: EntryVariant = downstreamLayer.isForwarded
        ? 'ssh'
        : downstreamLayer.entryVariant;

      return {
        ip: gatewayUpstreamIp,
        hostname: gatewayHostname,
        role: 'router' as const,
        accessVariant: gatewayAccessVariant,
        remoteMachine: {
          ip: gatewayUpstreamIp,
          hostname: gatewayHostname,
          ports: downstreamLayer.gatewayPorts,
          users: [],
        },
      };
    },
  );

  // 4. Flatten machines: all layer machines + inner gateway machines
  const allMachines: readonly GeneratedMachine[] = [
    ...layerResults.flatMap((l) => l.machines),
    ...gatewayMachines,
  ];

  // 5. NAT forwarding (outermost layer only)
  const natForwarding: NatForwarding | undefined = outerLayer.isForwarded
    ? {
        publicIp: routerPublicIp,
        rules:
          outerLayer.machines[0]?.remoteMachine.ports
            .filter((p) => p.open)
            .map((p) => ({
              publicPort: p.port,
              internalIp: outerLayer.entryPoint,
              internalPort: p.port,
            })) ?? [],
      }
    : undefined;

  // 6. Build network config per machine — subnet isolation
  const machineConfigs: Record<string, MachineNetworkConfig> = {};

  for (let layerIdx = 0; layerIdx < layerCount; layerIdx++) {
    const layer = layerResults[layerIdx]!;
    const { subnet, machines } = layer;
    const internalGatewayIp = `${subnet}.1`;

    // The gateway INTO this layer (at .1)
    const upstreamGatewayHostname =
      layerIdx === 0 ? routerHostname : gatewayMachines[layerIdx - 1]!.hostname;
    const upstreamGatewayPorts = layer.gatewayPorts;
    const upstreamGatewayRemote: RemoteMachine = {
      ip: internalGatewayIp,
      hostname: upstreamGatewayHostname,
      ports: upstreamGatewayPorts,
      users: [],
    };

    // The gateway OUT of this layer (to next layer), if any
    const outboundGateway = layerIdx < layerCount - 1 ? gatewayMachines[layerIdx]! : null;

    // Per-layer DNS records
    const layerDnsRecords: readonly DnsRecord[] = [
      ...machines.map((m) => ({
        domain: `${m.hostname}.mission`,
        ip: m.ip,
        type: 'A' as const,
      })),
      {
        domain: `${upstreamGatewayHostname}.mission`,
        ip: internalGatewayIp,
        type: 'A' as const,
      },
      ...(outboundGateway
        ? [
            {
              domain: `${outboundGateway.hostname}.mission`,
              ip: outboundGateway.ip,
              type: 'A' as const,
            },
          ]
        : []),
    ];

    // Each machine sees: layer peers + upstream gateway (.1) + outbound gateway (if any)
    machines.forEach((machine) => {
      const peers: readonly RemoteMachine[] = [
        ...machines.filter((m) => m.ip !== machine.ip).map((m) => m.remoteMachine),
        upstreamGatewayRemote,
        ...(outboundGateway ? [outboundGateway.remoteMachine] : []),
      ];

      machineConfigs[machine.ip] = {
        interfaces: [
          createInterface(
            'eth0',
            machine.ip,
            '255.255.255.0',
            internalGatewayIp,
            generateMac(prng),
          ),
        ],
        machines: peers,
        dnsRecords: layerDnsRecords,
      };
    });
  }

  // 7. Inner gateway configs — dual interfaces, see both adjacent layers
  for (let i = 0; i < gatewayMachines.length; i++) {
    const gateway = gatewayMachines[i]!;
    const upstreamLayer = layerResults[i]!;
    const downstreamLayer = layerResults[i + 1]!;
    const upstreamGatewayIp = `${upstreamLayer.subnet}.1`;
    const downstreamGatewayIp = `${downstreamLayer.subnet}.1`;

    // Upstream: layer i machines + upstream gateway (router or previous gateway)
    const upstreamGatewayHostname = i === 0 ? routerHostname : gatewayMachines[i - 1]!.hostname;
    const upstreamGatewayRemote: RemoteMachine = {
      ip: upstreamGatewayIp,
      hostname: upstreamGatewayHostname,
      ports: upstreamLayer.gatewayPorts,
      users: [],
    };

    // Next gateway (if any)
    const nextGateway = i + 1 < gatewayMachines.length ? gatewayMachines[i + 1]! : null;

    const visibleMachines: readonly RemoteMachine[] = [
      ...upstreamLayer.machines.map((m) => m.remoteMachine),
      upstreamGatewayRemote,
      ...downstreamLayer.machines.map((m) => m.remoteMachine),
      ...(nextGateway ? [nextGateway.remoteMachine] : []),
    ];

    const gatewayDnsRecords: readonly DnsRecord[] = [
      ...upstreamLayer.machines.map((m) => ({
        domain: `${m.hostname}.mission`,
        ip: m.ip,
        type: 'A' as const,
      })),
      ...downstreamLayer.machines.map((m) => ({
        domain: `${m.hostname}.mission`,
        ip: m.ip,
        type: 'A' as const,
      })),
    ];

    machineConfigs[gateway.ip] = {
      interfaces: [
        createInterface('eth0', gateway.ip, '255.255.255.0', upstreamGatewayIp, generateMac(prng)),
        createInterface('eth1', downstreamGatewayIp, '255.255.255.0', '0.0.0.0', generateMac(prng)),
      ],
      machines: visibleMachines,
      dnsRecords: gatewayDnsRecords,
    };
  }

  // 8. Outer router config — sees layer 0 machines + first gateway
  const outerGatewayIp = `${outerLayer.subnet}.1`;
  const routerVisibleMachines: readonly RemoteMachine[] = [
    ...outerLayer.machines.map((m) => m.remoteMachine),
    ...(gatewayMachines.length > 0 ? [gatewayMachines[0]!.remoteMachine] : []),
  ];
  const outerDnsRecords: readonly DnsRecord[] = [
    ...outerLayer.machines.map((m) => ({
      domain: `${m.hostname}.mission`,
      ip: m.ip,
      type: 'A' as const,
    })),
    {
      domain: `${routerHostname}.mission`,
      ip: outerGatewayIp,
      type: 'A' as const,
    },
    ...gatewayMachines.slice(0, 1).map((gw) => ({
      domain: `${gw.hostname}.mission`,
      ip: gw.ip,
      type: 'A' as const,
    })),
  ];

  machineConfigs[routerPublicIp] = {
    interfaces: [
      createInterface('eth0', routerPublicIp, '255.255.255.0', '0.0.0.0', generateMac(prng)),
      createInterface('eth1', outerGatewayIp, '255.255.255.0', '0.0.0.0', generateMac(prng)),
    ],
    machines: routerVisibleMachines,
    dnsRecords: outerDnsRecords,
  };

  // External DNS: only the router's public IP
  const externalDnsRecords: readonly DnsRecord[] = [
    {
      domain: `${routerHostname}.mission`,
      ip: routerPublicIp,
      type: 'A' as const,
    },
  ];

  // 9. Build SubnetLayer objects — inner forwarded layers get NAT forwarding rules
  const layers: readonly SubnetLayer[] = layerResults.map((l, i) => {
    if (i === 0) {
      return {
        subnet: l.subnet,
        gateway: routerMachine,
        entryVariant: l.entryVariant,
        machines: l.machines,
        isForwarded: l.isForwarded,
        natForwarding,
      };
    }

    const gateway = gatewayMachines[i - 1]!;
    const innerNat: NatForwarding | undefined = l.isForwarded
      ? {
          publicIp: gateway.ip,
          rules:
            l.machines[0]?.remoteMachine.ports
              .filter((p) => p.open)
              .map((p) => ({
                publicPort: p.port,
                internalIp: l.entryPoint,
                internalPort: p.port,
              })) ?? [],
        }
      : undefined;

    return {
      subnet: l.subnet,
      gateway,
      entryVariant: l.entryVariant,
      machines: l.machines,
      isForwarded: l.isForwarded,
      natForwarding: innerNat,
    };
  });

  return {
    machines: allMachines,
    routerMachine,
    routerPublicIp,
    natForwarding,
    networkConfig: { machineConfigs },
    entryPoint: outerLayer.entryPoint,
    entryVariant: outerLayer.entryVariant,
    externalDnsRecords,
    layers,
  };
};
