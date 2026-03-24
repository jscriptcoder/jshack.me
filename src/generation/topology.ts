import type { Prng } from './prng';
import { generatePrivateSubnet, generatePublicIp } from './ip';
import type { Difficulty, GeneratedMachine, MachineRole, NatForwarding } from './types';
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
  const machineCount = prng.nextInt(minMachines, maxMachines);

  // Internal subnet — PRNG picks from RFC 1918 private ranges:
  // 10.x.x.0/24, 172.{16-31}.x.0/24, 192.168.{2-254}.0/24 (avoids 192.168.1.x static network)
  const subnet = generatePrivateSubnet(prng);
  const internalGateway = `${subnet}.1`;

  const routerPublicIp = generatePublicIp(prng, overrides.usedIps);

  // Forwarding mode decision
  const forwarded = isForwardedMode(prng, difficulty, overrides.forwardedOverride);

  // Select entry variant for the entry/DMZ machine.
  // Always consume PRNG picks to preserve sequence, then apply override if set.
  const prngEntryTemplate = prng.pick(entryPortTemplates);
  const entryTemplate = overrides.entryVariantOverride
    ? (entryPortTemplates.find((t) => t.variant === overrides.entryVariantOverride) ??
      prngEntryTemplate)
    : prngEntryTemplate;
  const internalEntryVariant = entryTemplate.variant;

  // In router-first mode, the player-facing entry variant applies to the router.
  // Always consume PRNG pick for router template to preserve sequence.
  const prngRouterTemplate = forwarded ? null : prng.pick(routerEntryPortTemplates);
  const routerTemplate = forwarded
    ? null
    : overrides.entryVariantOverride
      ? (routerEntryPortTemplates.find((t) => t.variant === overrides.entryVariantOverride) ??
        prngRouterTemplate)
      : prngRouterTemplate;
  const entryVariant = forwarded ? internalEntryVariant : (routerTemplate?.variant ?? 'ssh');

  // Build internal machines (entry + others)
  const entryRole = prng.pick(entryRoles);
  const remainingRoles = Array.from({ length: machineCount - 1 }, () => prng.pick(allRoles));
  const roles: readonly MachineRole[] = [entryRole, ...remainingRoles];

  // Track used hostnames to prevent duplicates across same-role machines
  const usedHostnames: Record<string, Set<string>> = {};

  const pickUniqueHostname = (role: MachineRole): string => {
    const used = usedHostnames[role] ?? new Set<string>();
    const available = hostnamesByRole[role].filter((h) => !used.has(h));
    // Always consume one PRNG call; fall back to suffix if pool exhausted
    const hostname =
      available.length > 0
        ? prng.pick(available)
        : `${prng.pick(hostnamesByRole[role])}-${used.size}`;
    usedHostnames[role] = new Set([...used, hostname]);
    return hostname;
  };

  // Generate unique random last octets for internal machine IPs (2-254, avoiding .1 gateway)
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
    // Entry machine gets the internal entry variant; non-entry machines get PRNG-picked variants
    const accessVariant = isEntry ? internalEntryVariant : prng.pick(allVariants);

    // In forwarded mode, entry machine gets the entry template ports (player connects directly).
    // All other machines get variant-specific ports (role base + access variant extras).
    const ports =
      isEntry && forwarded
        ? buildPortsFromTemplate(entryTemplate.ports)
        : buildVariantPorts(prng, role, accessVariant);

    return {
      ip,
      hostname,
      role,
      accessVariant,
      remoteMachine: {
        ip,
        hostname,
        ports,
        users: [],
      },
    };
  });

  const entryIp = machines[0]?.ip ?? internalGateway;

  // Build router machine
  const routerHostname = prng.pick(hostnamesByRole.router);
  const routerPorts = routerTemplate
    ? buildPortsFromTemplate(routerTemplate.ports)
    : buildPorts('router');

  // Router access variant: in router-first mode, uses the entry variant (player hacks router).
  // In forwarded mode, router is accessed via SSH (player pivots through it).
  const routerAccessVariant: EntryVariant = forwarded ? 'ssh' : entryVariant;

  const routerMachine: GeneratedMachine = {
    ip: routerPublicIp,
    hostname: routerHostname,
    role: 'router',
    accessVariant: routerAccessVariant,
    remoteMachine: {
      ip: routerPublicIp,
      hostname: routerHostname,
      ports: routerPorts,
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
    ports: routerPorts,
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

  return {
    machines,
    routerMachine,
    routerPublicIp,
    natForwarding,
    networkConfig: { machineConfigs },
    entryPoint: entryIp,
    entryVariant,
    externalDnsRecords,
  };
};
