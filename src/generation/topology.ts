import type { Prng } from './prng';
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
} from './pools';

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

const allRoles: readonly MachineRole[] = ['webserver', 'database', 'fileserver', 'workstation'];

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
  template: readonly { readonly port: number; readonly service: string; readonly open: boolean }[],
): readonly Port[] =>
  template.map((t) => ({
    port: t.port,
    service: t.service,
    open: t.open,
  }));

// Generates a public IP in the 45.x.x.x range for the router
const generatePublicIp = (prng: Prng): string => {
  const o2 = prng.nextInt(1, 254);
  const o3 = prng.nextInt(1, 254);
  const o4 = prng.nextInt(2, 254);
  return `45.${o2}.${o3}.${o4}`;
};

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
  readonly entryVariantOverride?: import('./types').EntryVariant;
  readonly forwardedOverride?: boolean;
};

export const generateTopology = (
  prng: Prng,
  difficulty: Difficulty,
  overrides: TopologyOverrides = {},
): TopologyResult => {
  const [minMachines, maxMachines] = machineCountByDifficulty[difficulty];
  const machineCount = prng.nextInt(minMachines, maxMachines);

  // Internal subnet for mission machines
  const octet2 = prng.nextInt(1, 254);
  const octet3 = prng.nextInt(1, 254);
  const subnet = `10.${octet2}.${octet3}`;
  const internalGateway = `${subnet}.1`;

  // Router public IP
  const routerPublicIp = generatePublicIp(prng);

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

  const machines: readonly GeneratedMachine[] = roles.map((role, i) => {
    const ip = `${subnet}.${10 + i}`;
    const hostname = prng.pick(hostnamesByRole[role]);
    const isEntry = i === 0;
    const ports = isEntry ? buildPortsFromTemplate(entryTemplate.ports) : buildPorts(role);

    return {
      ip,
      hostname,
      role,
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

  const routerMachine: GeneratedMachine = {
    ip: routerPublicIp,
    hostname: routerHostname,
    role: 'router',
    remoteMachine: {
      ip: routerPublicIp,
      hostname: routerHostname,
      ports: routerPorts,
      users: [],
    },
  };

  // NAT forwarding config (forwarded mode only)
  const natForwarding: NatForwarding | undefined = forwarded
    ? { publicIp: routerPublicIp, internalIp: entryIp }
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
