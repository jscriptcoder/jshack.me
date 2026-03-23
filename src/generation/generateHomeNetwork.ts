import type { Prng } from './prng';
import { createPrng } from './prng';
import type { FileNode } from '../filesystem/types';
import type {
  DnsRecord,
  MachineNetworkConfig,
  NetworkConfig,
  NetworkInterface,
  Port,
  RemoteMachine,
} from '../network/types';
import type { MachineRole } from './types';
import {
  createFileSystem,
  type MachineFileSystemConfig,
  type UserConfig,
} from '../filesystem/fileSystemFactory';
import {
  hostnamesByRole,
  portTemplatesByRole,
  configTemplatesByRole,
  logTemplates,
  noiseFiles,
  passwords,
  webContentTemplatesByRole,
} from './pools';
import {
  createBinaryEntries,
  SYSTEM_UTILITY_NAMES,
  SBIN_UTILITY_NAMES,
} from '../commands/availability';
import { md5 } from '../utils/md5';

export type HomeNetwork = {
  readonly essid: string;
  readonly subnet: string;
  readonly localhostIp: string;
  readonly router: {
    readonly publicIp: string;
    readonly hostname: string;
    readonly internalIp: string;
  };
  readonly machines: readonly HomeNetworkMachine[];
  readonly networkConfig: NetworkConfig;
  readonly fileSystems: Readonly<Record<string, FileNode>>;
};

type HomeNetworkMachine = {
  readonly ip: string;
  readonly hostname: string;
  readonly role: MachineRole;
  readonly remoteMachine: RemoteMachine;
};

const allRoles: readonly MachineRole[] = [
  'webserver',
  'database',
  'fileserver',
  'workstation',
  'mailserver',
  'iot',
];

const generateMac = (prng: Prng): string => {
  const hex = () => prng.nextInt(0, 255).toString(16).padStart(2, '0');
  return `02:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`;
};

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

const generatePrivateSubnet = (prng: Prng): string => {
  const rangeType = prng.nextInt(0, 2);
  if (rangeType === 0) return `10.${prng.nextInt(1, 254)}.${prng.nextInt(1, 254)}`;
  if (rangeType === 1) return `172.${prng.nextInt(16, 31)}.${prng.nextInt(1, 254)}`;
  return `192.168.${prng.nextInt(2, 254)}`;
};

const publicFirstOctets: readonly number[] = [
  45, 51, 62, 78, 91, 103, 138, 162, 185, 198, 203, 212,
];

const generatePublicIp = (prng: Prng): string => {
  const o1 = prng.pick(publicFirstOctets);
  return `${o1}.${prng.nextInt(1, 254)}.${prng.nextInt(1, 254)}.${prng.nextInt(2, 254)}`;
};

const buildPorts = (role: MachineRole): readonly Port[] =>
  portTemplatesByRole[role].map((t) => ({ port: t.port, service: t.service, open: t.open }));

// Simple filesystem for home network machines — configs, logs, noise files
const buildMachineFilesystem = (
  prng: Prng,
  hostname: string,
  ip: string,
  role: MachineRole,
  users: readonly UserConfig[],
): FileNode => {
  const configTemplates = configTemplatesByRole[role];
  const configContent = prng
    .pick(configTemplates)
    .replace(/\{\{hostname\}\}/g, hostname)
    .replace(/\{\{port\}\}/g, String(portTemplatesByRole[role][0]?.port ?? 22))
    .replace(/\{\{user\}\}/g, users.find((u) => u.userType === 'user')?.username ?? 'admin');

  const logContent = prng
    .pickN(logTemplates, 4)
    .map((t) =>
      t
        .replace(/\{\{date\}\}/g, 'Mar 15 03:14:22')
        .replace(/\{\{pid\}\}/g, String(prng.nextInt(1000, 9999)))
        .replace(/\{\{user\}\}/g, users.find((u) => u.userType === 'user')?.username ?? 'admin')
        .replace(/\{\{ip\}\}/g, ip)
        .replace(/\{\{srcport\}\}/g, String(prng.nextInt(32768, 65535)))
        .replace(/\{\{service\}\}/g, hostname)
        .replace(/\{\{uptime\}\}/g, `${prng.nextInt(100, 99999)}.${prng.nextInt(10, 99)}`),
    )
    .join('\n');

  const noise = prng.pickN(noiseFiles, 2);
  const userHomeContent: Readonly<Record<string, FileNode>> = Object.fromEntries(
    noise.map((f) => [
      f.name,
      {
        name: f.name,
        type: 'file' as const,
        owner: 'user' as const,
        permissions: {
          read: ['root' as const, 'user' as const],
          write: ['root' as const, 'user' as const],
          execute: ['root' as const],
        },
        content: f.content,
      },
    ]),
  );

  const usersWithHome = users.map((u) =>
    u.userType === 'user' ? { ...u, homeContent: userHomeContent } : u,
  );

  // Generate web content for machines with open HTTP ports
  const ports = portTemplatesByRole[role];
  const hasOpenHttpPort = ports.some(
    (p) => p.open && (p.service === 'http' || p.service === 'https' || p.service === 'http-alt'),
  );

  const webDirectory: Readonly<Record<string, FileNode>> = hasOpenHttpPort
    ? (() => {
        const template = prng.pick(webContentTemplatesByRole[role]);
        const indexContent = template.content
          .replace(/\{\{hostname\}\}/g, hostname)
          .replace(/\{\{ip\}\}/g, ip);
        return {
          var: {
            name: 'var',
            type: 'directory' as const,
            owner: 'root' as const,
            permissions: {
              read: ['root' as const, 'user' as const, 'guest' as const],
              write: ['root' as const],
              execute: ['root' as const, 'user' as const, 'guest' as const],
            },
            children: {
              www: {
                name: 'www',
                type: 'directory' as const,
                owner: 'root' as const,
                permissions: {
                  read: ['root' as const, 'user' as const, 'guest' as const],
                  write: ['root' as const],
                  execute: ['root' as const, 'user' as const, 'guest' as const],
                },
                children: {
                  html: {
                    name: 'html',
                    type: 'directory' as const,
                    owner: 'root' as const,
                    permissions: {
                      read: ['root' as const, 'user' as const, 'guest' as const],
                      write: ['root' as const],
                      execute: ['root' as const, 'user' as const, 'guest' as const],
                    },
                    children: {
                      'index.html': {
                        name: 'index.html',
                        type: 'file' as const,
                        owner: 'root' as const,
                        permissions: {
                          read: ['root' as const, 'user' as const, 'guest' as const],
                          write: ['root' as const],
                          execute: ['root' as const],
                        },
                        content: indexContent,
                      },
                    },
                  },
                },
              },
            },
          },
        };
      })()
    : {};

  const config: MachineFileSystemConfig = {
    users: usersWithHome,
    etcExtraContent: {
      hostname: {
        name: 'hostname',
        type: 'file',
        owner: 'root',
        permissions: {
          read: ['root', 'user', 'guest'],
          write: ['root'],
          execute: ['root'],
        },
        content: `${hostname}\n`,
      },
    },
    varLogContent: {
      syslog: {
        name: 'syslog',
        type: 'file',
        owner: 'root',
        permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
        content: logContent,
      },
    },
    extraDirectories: {
      ...webDirectory,
      opt: {
        name: 'opt',
        type: 'directory',
        owner: 'root',
        permissions: {
          read: ['root', 'user', 'guest'],
          write: ['root'],
          execute: ['root', 'user', 'guest'],
        },
        children: {
          'config.txt': {
            name: 'config.txt',
            type: 'file',
            owner: 'root',
            permissions: {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: ['root'],
            },
            content: configContent,
          },
        },
      },
    },
    binContent: createBinaryEntries(SYSTEM_UTILITY_NAMES),
    usrBinContent: {},
    usrSbinContent: createBinaryEntries(SBIN_UTILITY_NAMES),
    passwdReadableBy: ['root', 'user'],
  };

  return createFileSystem(config);
};

export const generateHomeNetwork = (
  gameSeed: string,
  wifiIndex: number,
  essid: string,
): HomeNetwork => {
  const prng = createPrng(`home-${gameSeed}-${wifiIndex}`);

  const subnet = generatePrivateSubnet(prng);
  const gateway = `${subnet}.1`;
  const localhostIp = `${subnet}.100`;
  const routerPublicIp = generatePublicIp(prng);

  // 2-4 machines per network
  const machineCount = prng.nextInt(2, 4);
  const roles = Array.from({ length: machineCount }, () => prng.pick(allRoles));

  const usedHostnames: Record<string, Set<string>> = {};
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

  // Unique IPs
  const usedOctets = new Set<number>();
  const lastOctets = roles.map(() => {
    let octet: number;
    do {
      octet = prng.nextInt(2, 99);
    } while (usedOctets.has(octet));
    usedOctets.add(octet);
    return octet;
  });

  // Build machines
  const machines: readonly HomeNetworkMachine[] = roles.map((role, i) => {
    const ip = `${subnet}.${lastOctets[i]}`;
    const hostname = pickUniqueHostname(role);
    const ports = buildPorts(role);

    const rootPassword = prng.pick(passwords);
    const userPassword = prng.pick(passwords);
    const guestPassword = prng.pick(passwords);

    const users: readonly {
      readonly username: string;
      readonly passwordHash: string;
      readonly userType: 'root' | 'user' | 'guest';
    }[] = [
      { username: 'root', passwordHash: md5(rootPassword), userType: 'root' },
      {
        username: prng.pick(['admin', 'user', 'operator', 'sysadmin', 'tech']),
        passwordHash: md5(userPassword),
        userType: 'user',
      },
      { username: 'guest', passwordHash: md5(guestPassword), userType: 'guest' },
    ];

    return {
      ip,
      hostname,
      role,
      remoteMachine: {
        ip,
        hostname,
        ports: [...ports],
        users,
      },
    };
  });

  // Router
  const routerHostname = prng.pick(hostnamesByRole.router);
  const routerPorts = buildPorts('router');

  // Network configs
  const machineConfigs: Record<string, MachineNetworkConfig> = {};

  const routerInternalRemote: RemoteMachine = {
    ip: gateway,
    hostname: routerHostname,
    ports: [...routerPorts],
    users: [],
  };

  // DNS records
  const dnsRecords: readonly DnsRecord[] = [
    ...machines.map((m) => ({ domain: `${m.hostname}.local`, ip: m.ip, type: 'A' as const })),
    { domain: `${routerHostname}.local`, ip: gateway, type: 'A' as const },
  ];

  machines.forEach((machine) => {
    const otherMachines: readonly RemoteMachine[] = [
      ...machines.filter((m) => m.ip !== machine.ip).map((m) => m.remoteMachine),
      routerInternalRemote,
    ];

    machineConfigs[machine.ip] = {
      interfaces: [
        createInterface('eth0', machine.ip, '255.255.255.0', gateway, generateMac(prng)),
      ],
      machines: otherMachines,
      dnsRecords,
    };
  });

  // Router config
  machineConfigs[routerPublicIp] = {
    interfaces: [
      createInterface('eth0', routerPublicIp, '255.255.255.0', '0.0.0.0', generateMac(prng)),
      createInterface('eth1', gateway, '255.255.255.0', '0.0.0.0', generateMac(prng)),
    ],
    machines: machines.map((m) => m.remoteMachine),
    dnsRecords,
  };

  // Filesystems
  const fileSystems: Record<string, FileNode> = {};

  machines.forEach((machine) => {
    const users: readonly UserConfig[] = machine.remoteMachine.users.map((u, idx) => ({
      username: u.username,
      passwordHash: u.passwordHash,
      userType: u.userType,
      uid: idx === 0 ? 0 : 1000 + idx,
    }));

    fileSystems[machine.ip] = buildMachineFilesystem(
      prng,
      machine.hostname,
      machine.ip,
      machine.role,
      users,
    );
  });

  // Router filesystem (minimal)
  const routerUsers: readonly UserConfig[] = [
    { username: 'root', passwordHash: md5(prng.pick(passwords)), userType: 'root', uid: 0 },
    {
      username: 'admin',
      passwordHash: md5(prng.pick(passwords)),
      userType: 'user',
      uid: 1001,
    },
  ];

  fileSystems[routerPublicIp] = buildMachineFilesystem(
    prng,
    routerHostname,
    routerPublicIp,
    'router',
    routerUsers,
  );

  return {
    essid,
    subnet,
    localhostIp,
    router: {
      publicIp: routerPublicIp,
      hostname: routerHostname,
      internalIp: gateway,
    },
    machines,
    networkConfig: { machineConfigs },
    fileSystems,
  };
};
