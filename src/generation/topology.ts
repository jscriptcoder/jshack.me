import type { Prng } from './prng';
import type { Difficulty, GeneratedMachine, MachineRole } from './types';
import type {
  DnsRecord,
  MachineNetworkConfig,
  NetworkConfig,
  NetworkInterface,
  Port,
  RemoteMachine,
} from '../network/types';
import type { EntryVariant } from './types';
import { hostnamesByRole, portTemplatesByRole, entryPortTemplates } from './pools';

type TopologyResult = {
  readonly machines: readonly GeneratedMachine[];
  readonly networkConfig: NetworkConfig;
  readonly entryPoint: string;
  readonly entryVariant: EntryVariant;
};

const machineCountByDifficulty: Readonly<Record<Difficulty, readonly [number, number]>> = {
  easy: [2, 2],
  medium: [3, 4],
  hard: [4, 6],
};

const allRoles: readonly MachineRole[] = ['webserver', 'database', 'fileserver', 'workstation'];

const entryRoles: readonly MachineRole[] = ['webserver', 'workstation'];

const createEth0 = (
  inet: string,
  netmask: string,
  gateway: string,
  mac: string,
): NetworkInterface => ({
  name: 'eth0',
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

export const generateTopology = (prng: Prng, difficulty: Difficulty): TopologyResult => {
  const [minMachines, maxMachines] = machineCountByDifficulty[difficulty];
  const machineCount = prng.nextInt(minMachines, maxMachines);

  const octet2 = prng.nextInt(1, 254);
  const octet3 = prng.nextInt(1, 254);
  const subnet = `10.${octet2}.${octet3}`;
  const gateway = `${subnet}.1`;

  const entryRole = prng.pick(entryRoles);
  const remainingRoles = Array.from({ length: machineCount - 1 }, () => prng.pick(allRoles));
  const roles: readonly MachineRole[] = [entryRole, ...remainingRoles];

  const entryTemplate = prng.pick(entryPortTemplates);
  const entryVariant = entryTemplate.variant;

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

  const dnsRecords: readonly DnsRecord[] = machines.map((m) => ({
    domain: `${m.hostname}.mission`,
    ip: m.ip,
    type: 'A' as const,
  }));

  const machineConfigs: Record<string, MachineNetworkConfig> = {};

  machines.forEach((machine) => {
    const otherMachines: readonly RemoteMachine[] = machines
      .filter((m) => m.ip !== machine.ip)
      .map((m) => m.remoteMachine);

    machineConfigs[machine.ip] = {
      interfaces: [createEth0(machine.ip, '255.255.255.0', gateway, generateMac(prng))],
      machines: otherMachines,
      dnsRecords,
    };
  });

  return {
    machines,
    networkConfig: { machineConfigs },
    entryPoint: machines[0]?.ip ?? gateway,
    entryVariant,
  };
};
