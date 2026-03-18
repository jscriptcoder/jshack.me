import type { Prng } from './prng';
import type {
  CredentialMap,
  EntryVariant,
  GeneratedMachine,
  MissionObjective,
  NatForwarding,
} from './types';
import type { FileNode } from '../filesystem/types';
import type { RemoteUser } from '../network/types';
import {
  createFileSystem,
  type MachineFileSystemConfig,
  type UserConfig,
} from '../filesystem/fileSystemFactory';
import {
  configTemplatesByRole,
  credentialLeakTemplates,
  logTemplates,
  noiseFiles,
  redHerringFiles,
  snmpRwCommunities,
  webContentTemplatesByRole,
} from './pools';
import { wrapInBinaryNoise } from './binary';
import { createBinaryEntries, SYSTEM_UTILITY_NAMES, SBIN_UTILITY_NAMES } from '../commands/availability';

type FilesystemInput = {
  readonly prng: Prng;
  readonly machines: readonly GeneratedMachine[];
  readonly usersByMachine: Readonly<Record<string, readonly RemoteUser[]>>;
  readonly credentials: CredentialMap;
  readonly objective: MissionObjective;
  readonly routerMachine?: GeneratedMachine;
  readonly natForwarding?: NatForwarding;
  readonly entryVariant?: EntryVariant;
};

const mkFile = (
  name: string,
  content: string,
  owner: 'root' | 'user' | 'guest' = 'root',
): FileNode => ({
  name,
  type: 'file',
  owner,
  permissions: {
    read: owner === 'guest' ? ['root', 'user', 'guest'] : ['root', owner],
    write: owner === 'guest' ? ['root', 'guest'] : ['root', owner],
    execute: ['root'],
  },
  content,
});

// Script files have variable permissions based on owner:
// user-owned: anyone can read/write/execute (easier — no privilege escalation needed)
// root-owned: anyone can read, but only root can write/execute (must su first)
const mkScript = (name: string, content: string, owner: 'root' | 'user' = 'user'): FileNode => ({
  name,
  type: 'file',
  owner,
  permissions: {
    read: ['root', 'user', 'guest'],
    write: owner === 'user' ? ['root', 'user', 'guest'] : ['root'],
    execute: owner === 'user' ? ['root', 'user', 'guest'] : ['root'],
  },
  content,
});

// worldReadable: system directories (/var, /tmp, /etc, /srv, /opt, /home, /usr) should
// be traversable by all users. Home subdirs remain owner-scoped via the default.
const mkDir = (
  name: string,
  children: Readonly<Record<string, FileNode>>,
  owner: 'root' | 'user' | 'guest' = 'root',
  worldReadable: boolean = false,
): FileNode => ({
  name,
  type: 'directory',
  owner,
  permissions: {
    read: worldReadable || owner === 'guest' ? ['root', 'user', 'guest'] : ['root', owner],
    write: ['root', owner],
    execute: worldReadable || owner === 'guest' ? ['root', 'user', 'guest'] : ['root', owner],
  },
  children,
});

const fillTemplate = (template: string, vars: Readonly<Record<string, string>>): string =>
  Object.entries(vars).reduce(
    (result, [key, value]) => result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value),
    template,
  );

const CREDENTIAL_LEAK_CHANCE = 0.3;

// Places a credential leak file on a machine ~30% of the time.
// Leaks a user-type account's credentials in a guest-readable location.
// Always consumes 2 PRNG calls for sequence stability.
const placeCredentialLeak = (
  prng: Prng,
  machineCreds: readonly { readonly username: string; readonly password: string }[],
  extraDirectories: Record<string, FileNode>,
  etcExtraContent: Record<string, FileNode>,
): void => {
  const roll = prng.next();
  const template = prng.pick(credentialLeakTemplates);

  // Only user-type credentials (never root or guest)
  const userCred = machineCreds.find((c) => c.username !== 'root' && c.username !== 'guest');
  if (roll >= CREDENTIAL_LEAK_CHANCE || !userCred) return;

  const content = fillTemplate(template.content, {
    username: userCred.username,
    password: userCred.password,
  });

  const segments = template.path.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] ?? 'config';
  const fileContent = template.binary ? wrapInBinaryNoise(prng, content) : content;

  // Guest-readable: use 'guest' owner so all users can read
  const file = mkFile(fileName, fileContent, 'guest');

  const topDir = segments[0] ?? 'etc';

  // /etc/ files go into etcExtraContent (merged into the /etc/ directory by the factory)
  if (topDir === 'etc') {
    // For nested /etc/ paths like /etc/crontab, place directly in etcExtraContent
    if (segments.length === 2) {
      etcExtraContent[fileName] = file;
    } else {
      // Deeper paths like /etc/foo/bar — build nested dirs
      const subSegments = segments.slice(1);
      etcExtraContent[subSegments[0] as string] = buildNestedDirs(subSegments, file);
    }
    return;
  }

  // Other paths (/tmp/, /srv/, /opt/, /var/, /usr/) go into extraDirectories.
  // If the top-level directory already exists (e.g., /var/ from web content),
  // merge the leak file into the existing tree's deepest directory.
  const existingDir = extraDirectories[topDir];
  if (existingDir) {
    const leafDir = findLeafDir(existingDir);
    if (leafDir?.children) {
      (leafDir.children as Record<string, FileNode>)[fileName] = file;
    }
  } else {
    extraDirectories[topDir] = buildNestedDirs(segments, file);
  }
};

const generateLogContent = (
  prng: Prng,
  machine: GeneratedMachine,
  users: readonly RemoteUser[],
): string => {
  const lineCount = prng.nextInt(5, 15);
  const usernames = users.map((u) => u.username);

  return Array.from({ length: lineCount }, () => {
    const template = prng.pick(logTemplates);
    return fillTemplate(template, {
      date: `Jan ${prng.nextInt(1, 28)} ${prng.nextInt(0, 23).toString().padStart(2, '0')}:${prng.nextInt(0, 59).toString().padStart(2, '0')}:${prng.nextInt(0, 59).toString().padStart(2, '0')}`,
      pid: String(prng.nextInt(1000, 9999)),
      user: prng.pick(usernames),
      ip: machine.ip,
      srcport: String(prng.nextInt(40000, 65535)),
      service: prng.pick(['sshd', 'nginx', 'mysql', 'cron']),
      uptime: `${prng.nextInt(100, 99999)}.${prng.nextInt(100, 999)}`,
    });
  }).join('\n');
};

const generateHomeContent = (
  prng: Prng,
  owner: 'user' | 'guest',
): Readonly<Record<string, FileNode>> => {
  const children: Record<string, FileNode> = {};

  const selectedNoise = prng.pickN(noiseFiles, prng.nextInt(1, 3));
  selectedNoise.forEach((noise) => {
    children[noise.name] = mkFile(noise.name, noise.content, owner);
  });

  if (prng.next() < 0.3) {
    const herring = prng.pick(redHerringFiles);
    children[herring.name] = mkFile(herring.name, herring.content, owner);
  }

  return children;
};

// Places the target file at the dynamic path from objective.targetPath.
// Target paths use /srv/ or /opt/ prefixes (via extraDirectories) to avoid
// conflicting with factory-managed directories (/var/, /home/, /etc/).
// Skipped for credential_theft and sabotage objectives (no target file to place).
const placeTargetFile = (
  prng: Prng,
  objective: MissionObjective,
  rootContent: Record<string, FileNode>,
  extraDirectories: Record<string, FileNode>,
): void => {
  if (objective.type === 'credential_theft' || objective.type === 'sabotage') return;

  const segments = objective.targetPath.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] ?? 'flag.txt';

  // script_fix: use mkScript with variable permissions, no binary wrapping
  const file =
    objective.type === 'script_fix'
      ? mkScript(fileName, objective.targetContent, objective.scriptOwner ?? 'user')
      : mkFile(
          fileName,
          objective.binary
            ? wrapInBinaryNoise(prng, objective.targetContent)
            : objective.targetContent,
        );

  const topDir = segments[0] ?? 'root';

  if (topDir === 'root') {
    rootContent[fileName] = file;
    return;
  }

  // /srv/, /opt/, etc. — build nested directory tree in extraDirectories
  extraDirectories[topDir] = buildNestedDirs(segments, file);
};

// Walks a nested directory tree to find the deepest directory node.
// Used to merge sibling files into an existing directory structure
// (e.g., adding a hint file alongside a script in /srv/scripts/).
const findLeafDir = (node: FileNode): FileNode | undefined => {
  if (node.type !== 'directory' || !node.children) return undefined;
  const childDirs = Object.values(node.children).filter((c) => c.type === 'directory');
  if (childDirs.length === 0) return node;
  return findLeafDir(childDirs[0] as FileNode) ?? node;
};

// Builds a nested directory tree from path segments, placing the file at the leaf.
// e.g., ['srv', 'records', 'file.csv'] → mkDir('srv', { records: mkDir('records', { 'file.csv': file }) })
// All intermediate directories are world-readable (system paths like /srv/, /opt/, /usr/).
const buildNestedDirs = (segments: readonly string[], file: FileNode): FileNode => {
  if (segments.length <= 1) return file;

  const dirName = segments[0] as string;
  const child = buildNestedDirs(segments.slice(1), file);
  const childName = segments[1] as string;

  return mkDir(dirName, { [childName]: child }, 'root', true);
};

// Generates the content for /etc/iptables/rules.v4 on the router.
// Forwarded mode: pre-populated with forward rules matching NAT config.
// Router-first mode (no NAT): only comments and an empty template.
const generateIptablesContent = (natForwarding?: NatForwarding): string => {
  const lines = ['# Port Forwarding Rules', '# forward <public_port> to <internal_ip>:<port>'];

  if (natForwarding) {
    for (const rule of natForwarding.rules) {
      lines.push(`forward ${rule.publicPort} to ${rule.internalIp}:${rule.internalPort}`);
    }
  }

  return lines.join('\n');
};

// Generates /etc/snmp/snmpd.conf content for SNMP-variant routers.
// Contains community strings, system OIDs, interface data, extend script args
// with leaked credentials, and firewall OIDs (initially deny).
const generateSnmpConfig = (
  prng: Prng,
  machine: GeneratedMachine,
  machineCreds: readonly { readonly username: string; readonly password: string }[],
): string => {
  const rwCommunity = prng.pick(snmpRwCommunities);
  const userCred = machineCreds.find((c) => c.username !== 'root') ?? machineCreds[0];

  const lines = [
    '# SNMP Daemon Configuration',
    '# net-snmp 5.9.1',
    '',
    '# Community strings',
    'rocommunity public',
    `rwcommunity ${rwCommunity}`,
    '',
    '# System information',
    `sysDescr Linux ${machine.hostname} 5.4.0-generic #1 SMP`,
    `sysName ${machine.hostname}`,
    `sysContact netops@corp.local`,
    '',
    '# Interfaces',
    'ifDescr.1 eth0',
    'ifDescr.2 eth1',
    `ifAddr.1 ${machine.ip}`,
    '',
    '# Extend scripts',
    ...(userCred
      ? [`nsExtendArgs.backup --user ${userCred.username} --pass ${userCred.password}`]
      : []),
    '',
    '# Firewall OIDs',
    'firewallSSH deny',
    'firewallHTTP deny',
  ];

  return lines.join('\n');
};

const buildMachineConfig = (
  prng: Prng,
  machine: GeneratedMachine,
  users: readonly RemoteUser[],
  machineCreds: readonly { readonly username: string; readonly password: string }[],
  isTarget: boolean,
  objective: MissionObjective,
  internalMachines?: readonly GeneratedMachine[],
  natForwarding?: NatForwarding,
): MachineFileSystemConfig => {
  const userConfigs: readonly UserConfig[] = users.map((u, i) => ({
    username: u.username,
    passwordHash: u.passwordHash,
    userType: u.userType,
    uid: u.userType === 'root' ? 0 : 1000 + i,
    homeContent:
      u.userType === 'root'
        ? undefined
        : generateHomeContent(prng, u.userType === 'guest' ? 'guest' : 'user'),
  }));

  const configTemplates = configTemplatesByRole[machine.role];
  const configContent = fillTemplate(prng.pick(configTemplates), {
    port: String(machine.remoteMachine.ports[0]?.port ?? 22),
    hostname: machine.hostname,
    user: users.find((u) => u.userType === 'user')?.username ?? 'admin',
  });

  // /etc/ system files are world-readable on real Linux (644)
  const etcExtraContent: Record<string, FileNode> = {
    hostname: mkFile('hostname', machine.hostname, 'guest'),
  };

  const serviceConfigName =
    machine.role === 'webserver'
      ? 'httpd.conf'
      : machine.role === 'database'
        ? 'mysql.cnf'
        : machine.role === 'fileserver'
          ? 'vsftpd.conf'
          : machine.role === 'router'
            ? 'iptables.conf'
            : 'ssh_config';

  // System config files in /etc/ are world-readable (guest-owned)
  etcExtraContent[serviceConfigName] = mkFile(serviceConfigName, configContent, 'guest');

  // Log files in /var/log/ are world-readable (guest-owned)
  const logContent = generateLogContent(prng, machine, users);
  const varLogContent: Record<string, FileNode> = {
    'auth.log': mkFile('auth.log', logContent, 'guest'),
  };

  // Router machines get a firewall log with hints about internal network traffic
  if (machine.role === 'router') {
    const fwLines = Array.from({ length: prng.nextInt(6, 12) }, () => {
      const srcIp = `10.${prng.nextInt(1, 254)}.${prng.nextInt(1, 254)}.${prng.nextInt(10, 20)}`;
      const dstPort = prng.pick([22, 80, 443, 3306, 8080]);
      const action = prng.pick(['ACCEPT', 'ACCEPT', 'DROP']);
      return `Jan ${prng.nextInt(1, 28)} ${prng.nextInt(0, 23).toString().padStart(2, '0')}:${prng.nextInt(0, 59).toString().padStart(2, '0')}:${prng.nextInt(0, 59).toString().padStart(2, '0')} kernel: [iptables] ${action} IN=eth0 OUT=eth1 SRC=${srcIp} DST=${machine.ip} PROTO=TCP DPT=${dstPort}`;
    });
    varLogContent['firewall.log'] = mkFile('firewall.log', fwLines.join('\n'), 'guest');
  }

  // Router iptables rules file: forwarded mode has pre-populated rules,
  // router-first mode has an empty template for the player to fill in.
  if (machine.role === 'router') {
    const iptablesContent = generateIptablesContent(natForwarding);
    if (!etcExtraContent['iptables']) {
      etcExtraContent['iptables'] = mkDir('iptables', {}, 'root', true);
    }
    const iptablesDir = etcExtraContent['iptables'];
    if (iptablesDir.type === 'directory' && iptablesDir.children) {
      (iptablesDir.children as Record<string, FileNode>)['rules.v4'] = mkFile(
        'rules.v4',
        iptablesContent,
      );
    }
  }

  // Router /etc/hosts contains hints about internal machines
  if (machine.role === 'router' && internalMachines && internalMachines.length > 0) {
    const hostsLines = [
      '127.0.0.1\tlocalhost',
      `${machine.ip}\t${machine.hostname}`,
      '',
      '# Internal network hosts',
      ...internalMachines.map((m) => `${m.ip}\t${m.hostname}`),
    ];
    etcExtraContent['hosts'] = mkFile('hosts', hostsLines.join('\n'), 'guest');

    // Routing table hint
    const routeTable = [
      'Kernel IP routing table',
      'Destination     Gateway         Genmask         Iface',
      `0.0.0.0         0.0.0.0         0.0.0.0         eth0`,
      ...internalMachines.map((m) => `${m.ip}        0.0.0.0         255.255.255.255 eth1`),
    ];
    etcExtraContent['route.conf'] = mkFile('route.conf', routeTable.join('\n'), 'guest');
  }

  const extraDirectories: Record<string, FileNode> = {};

  const rootContent: Record<string, FileNode> = {};
  if (isTarget) {
    placeTargetFile(prng, objective, rootContent, extraDirectories);

    // Place corrupted hint file on the target machine (same machine as the script)
    if (
      objective.type === 'script_fix' &&
      objective.scriptBugType === 'corrupted' &&
      objective.scriptHintPath &&
      objective.scriptHintContent
    ) {
      const hintSegments = objective.scriptHintPath.split('/').filter(Boolean);
      const hintFileName = hintSegments[hintSegments.length - 1] ?? 'hint';
      const hintFile = mkFile(hintFileName, objective.scriptHintContent, 'user');
      const hintTopDir = hintSegments[0] ?? 'root';

      if (hintTopDir === 'root') {
        rootContent[hintFileName] = hintFile;
      } else {
        // Hint and script share the same parent directory (e.g., /srv/scripts/).
        // Merge the hint file into the existing leaf directory to avoid overwriting
        // the script file that was placed by placeTargetFile().
        const existingDir = extraDirectories[hintTopDir];
        if (existingDir) {
          const leafDir = findLeafDir(existingDir);
          if (leafDir?.children) {
            (leafDir.children as Record<string, FileNode>)[hintFileName] = hintFile;
          }
        } else {
          extraDirectories[hintTopDir] = buildNestedDirs(hintSegments, hintFile);
        }
      }
    }
  }

  // ~30% chance to place a careless user's credentials in a guest-readable location
  placeCredentialLeak(prng, machineCreds, extraDirectories, etcExtraContent);

  // Generate web content for any machine with an open HTTP port.
  // Uses role-appropriate templates: webservers get corporate portals,
  // routers get admin panels, others get default server pages.
  const hasOpenHttpPort = machine.remoteMachine.ports.some(
    (p) => p.open && (p.service === 'http' || p.service === 'https' || p.service === 'http-alt'),
  );
  if (hasOpenHttpPort) {
    const templates = webContentTemplatesByRole[machine.role];
    const webTemplate = prng.pick(templates);
    const indexContent = fillTemplate(webTemplate.content, {
      hostname: machine.hostname,
      ip: machine.ip,
    });

    const htmlChildren: Record<string, FileNode> = {
      'index.html': mkFile('index.html', indexContent, 'guest'),
    };

    extraDirectories['var'] = mkDir(
      'var',
      {
        www: mkDir(
          'www',
          {
            html: mkDir('html', htmlChildren, 'root', true),
          },
          'root',
          true,
        ),
      },
      'root',
      true,
    );
  }

  return {
    users: userConfigs,
    rootContent,
    varLogContent,
    etcExtraContent,
    extraDirectories: Object.keys(extraDirectories).length > 0 ? extraDirectories : undefined,
    binContent: createBinaryEntries(SYSTEM_UTILITY_NAMES),
    usrSbinContent: createBinaryEntries(SBIN_UTILITY_NAMES),
    passwdReadableBy: ['root', 'user'],
  };
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
  const existing = config.extraDirectories ?? {};
  return {
    ...config,
    extraDirectories: { ...existing, [keyTree.topDir]: keyTree.node },
  };
};

export const generateFileSystems = (input: FilesystemInput): Readonly<Record<string, FileNode>> => {
  const {
    prng,
    machines,
    usersByMachine,
    credentials,
    objective,
    routerMachine,
    natForwarding,
    entryVariant,
  } = input;

  const entries = machines.map((machine) => {
    const users = usersByMachine[machine.ip] ?? [];
    const machineCreds = credentials[machine.ip] ?? [];
    const isTarget = machine.ip === objective.targetMachine;

    const baseConfig = buildMachineConfig(prng, machine, users, machineCreds, isTarget, objective);

    // Place encryption key file on the key machine (if this is that machine)
    const keyTree =
      objective.keyPlacement?.machineIp === machine.ip ? buildKeyFileTree(prng, objective) : null;
    const config = mergeKeyPlacement(baseConfig, keyTree);

    const fileSystem = createFileSystem(config);

    return [machine.ip, fileSystem] as const;
  });

  // Generate router filesystem with hints about internal machines
  if (routerMachine) {
    const routerUsers = usersByMachine[routerMachine.ip] ?? [];
    const routerCreds = credentials[routerMachine.ip] ?? [];

    const baseRouterConfig = buildMachineConfig(
      prng,
      routerMachine,
      routerUsers,
      routerCreds,
      false,
      objective,
      machines,
      natForwarding,
    );

    // Place encryption key on router if it's the key machine
    const routerKeyTree =
      objective.keyPlacement?.machineIp === routerMachine.ip
        ? buildKeyFileTree(prng, objective)
        : null;
    const routerConfigWithKey = mergeKeyPlacement(baseRouterConfig, routerKeyTree);

    // SNMP variant: add /etc/snmp/snmpd.conf with community strings, OIDs, credentials
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
                    generateSnmpConfig(prng, routerMachine, routerCreds),
                  ),
                },
                'root',
                true,
              ),
            },
          }
        : routerConfigWithKey;

    const routerFs = createFileSystem(routerConfig);
    return Object.fromEntries([...entries, [routerMachine.ip, routerFs]]);
  }

  return Object.fromEntries(entries);
};
