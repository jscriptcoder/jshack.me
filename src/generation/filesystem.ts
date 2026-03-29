import type { Prng } from './prng';
import type {
  CredentialMap,
  EntryVariant,
  GeneratedMachine,
  MachineRole,
  MissionObjective,
  NatForwarding,
  SubnetLayer,
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
  httpEntryCredentialTemplates,
  logTemplates,
  noiseFiles,
  redHerringFiles,
  snmpRwCommunities,
  webContentTemplatesByRole,
} from './pools';
import { wrapInBinaryNoise } from './binary';
import {
  createBinaryEntries,
  SYSTEM_UTILITY_NAMES,
  SBIN_UTILITY_NAMES,
} from '../commands/availability';
import { SSH_PID_FILE_NAME, createSshdPidFileNode } from '../commands/sshd';
import { FTP_PID_FILE_NAME, createVsftpdPidFileNode } from '../commands/vsftpd';
import {
  formatSshAccepted,
  formatSshFailed,
  formatSuSuccess,
  formatFtpConnect,
  formatFtpLoginOk,
  formatFtpLoginFailed,
  formatAccessLog,
} from '../logging/formatters';
import type { ForensicsLogType } from './pools';
import {
  forensicsCallingCardTemplates,
  forensicsLogTypes,
  forensicsNoiseCount,
  forensicsNoiseHttpPaths,
  forensicsNoiseIps,
  forensicsNoiseUsers,
} from './pools';
import type { Difficulty } from './types';

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
};

export const mkFile = (
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
export const mkDir = (
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

// Places SSH credentials in /var/www/html/ for HTTP entry variant missions.
// PRNG picks a template: body-based (creds in file content) or header-based
// (creds in .headers sidecar, discoverable via curl -i).
// Files are root-owned — curl serves them (reads as root), but users can't cat them locally.
const placeHttpEntryCredentials = (
  prng: Prng,
  machineCreds: readonly { readonly username: string; readonly password: string }[],
  htmlChildren: Record<string, FileNode>,
): void => {
  const userCred = machineCreds.find((c) => c.username !== 'root' && c.username !== 'guest');
  if (!userCred) return;

  const template = prng.pick(httpEntryCredentialTemplates);
  const credString = `${userCred.username}:${userCred.password}`;

  if (template.sidecarHeader) {
    // Header-based: create .headers sidecar file with credential header.
    // For 'index.html', the body already exists — only add the sidecar.
    // For other paths, create both the body file and its sidecar.
    const sidecarContent = `${template.sidecarHeader}: ${credString}`;
    const segments = template.webPath.split('/');
    const fileName = segments[segments.length - 1] as string;
    const sidecarName = `${fileName}.headers`;

    if (segments.length === 1) {
      // Top-level path (e.g., 'index.html', 'status')
      if (template.content) {
        htmlChildren[fileName] = mkFile(fileName, template.content);
      }
      htmlChildren[sidecarName] = mkFile(sidecarName, sidecarContent);
    } else {
      // Nested path (e.g., 'admin/debug.html')
      const dirName = segments[0] as string;
      const dirChildren: Record<string, FileNode> = {
        ...(template.content ? { [fileName]: mkFile(fileName, template.content) } : {}),
        [sidecarName]: mkFile(sidecarName, sidecarContent),
      };
      htmlChildren[dirName] = mkDir(dirName, dirChildren, 'root', true);
    }
  } else {
    // Body-based: credentials are in the file content itself
    const content = fillTemplate(template.content, {
      username: userCred.username,
      password: userCred.password,
    });
    const segments = template.webPath.split('/');
    const fileName = segments[segments.length - 1] as string;

    if (segments.length === 1) {
      htmlChildren[fileName] = mkFile(fileName, content);
    } else {
      const dirName = segments[0] as string;
      htmlChildren[dirName] = mkDir(
        dirName,
        { [fileName]: mkFile(fileName, content) },
        'root',
        true,
      );
    }
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

  // script_fix / script_auto: use mkScript with user permissions, no binary wrapping
  // (player has root access via briefing, so user-owned scripts are always accessible)
  const file =
    objective.type === 'script_fix' || objective.type === 'script_auto'
      ? mkScript(fileName, objective.targetContent, 'user')
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

// Generates the content for /etc/switch/acl.conf on managed switches.
// Deny rules block SSH and HTTP traffic to the downstream subnet.
// Players must clear these rules (via nano or snmpset) to access downstream machines.
const generateAclContent = (downstreamSubnet: string): string => {
  const lines = [
    '# Access Control List',
    '# Syntax: <action> <proto> any <subnet> port <port>',
    `deny tcp any ${downstreamSubnet}.0/24 port 22`,
    `deny tcp any ${downstreamSubnet}.0/24 port 80`,
  ];
  return lines.join('\n');
};

// Generates the content for /etc/iptables/rules.v4 on the router.
// Forwarded mode: pre-populated with forward rules matching NAT config.
// Router-first mode (no NAT): only comments and an empty template.
const generateIptablesContent = (natForwarding?: NatForwarding): string => {
  const lines = [
    '# Port Forwarding Rules',
    '# forward <public_port> to <internal_ip>:<port>',
    ...(natForwarding
      ? natForwarding.rules.map(
          (rule) => `forward ${rule.publicPort} to ${rule.internalIp}:${rule.internalPort}`,
        )
      : []),
  ];

  return lines.join('\n');
};

// Generates /etc/snmp/snmpd.conf content for SNMP-variant routers.
// Contains community strings, system OIDs, interface data, extend script args
// with leaked credentials, and firewall OIDs (initially deny).
export const generateSnmpConfig = (
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

// Generates /etc/snmp/snmpd.conf content for SNMP-variant managed switches.
// Contains community strings, system OIDs, interface data, extend script args
// with leaked credentials, and ACL OIDs (initially deny).
export const generateSwitchSnmpConfig = (
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
    `sysDescr Cisco IOS L3 Switch ${machine.hostname} 15.2(4)E`,
    `sysName ${machine.hostname}`,
    `sysContact netadmin@corp.local`,
    '',
    '# Interfaces',
    'ifDescr.1 GigabitEthernet0/1',
    'ifDescr.2 GigabitEthernet0/2',
    `ifAddr.1 ${machine.ip}`,
    '',
    '# Extend scripts',
    ...(userCred
      ? [`nsExtendArgs.backup --user ${userCred.username} --pass ${userCred.password}`]
      : []),
    '',
    '# ACL OIDs',
    'aclSSH deny',
    'aclHTTP deny',
  ];

  return lines.join('\n');
};

export type BuildMachineConfigOptions = {
  readonly isTarget?: boolean;
  readonly objective?: MissionObjective;
  readonly internalMachines?: readonly GeneratedMachine[];
  readonly natForwarding?: NatForwarding;
  readonly isHttpEntry?: boolean;
  readonly downstreamSubnet?: string;
};

export const buildMachineConfig = (
  prng: Prng,
  machine: GeneratedMachine,
  users: readonly RemoteUser[],
  machineCreds: readonly { readonly username: string; readonly password: string }[],
  options: BuildMachineConfigOptions = {},
): MachineFileSystemConfig => {
  const { isTarget = false, objective, internalMachines, natForwarding, isHttpEntry } = options;
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

  const serviceConfigNames: Readonly<Record<MachineRole, string>> = {
    webserver: 'httpd.conf',
    database: 'mysql.cnf',
    fileserver: 'vsftpd.conf',
    mailserver: 'postfix.conf',
    iot: 'device.conf',
    router: 'iptables.conf',
    switch: 'switch.conf',
    workstation: 'ssh_config',
  };
  const serviceConfigName = serviceConfigNames[machine.role];

  // System config files in /etc/ are world-readable (guest-owned)
  etcExtraContent[serviceConfigName] = mkFile(serviceConfigName, configContent, 'guest');

  // Log files in /var/log/ are world-readable (guest-owned)
  const logContent = generateLogContent(prng, machine, users);
  const varLogContent: Record<string, FileNode> = {
    'auth.log': mkFile('auth.log', logContent, 'guest'),
  };

  // Gateway machines (routers and switches) get traffic logs
  if (machine.role === 'router') {
    const fwLines = Array.from({ length: prng.nextInt(6, 12) }, () => {
      const srcIp = `10.${prng.nextInt(1, 254)}.${prng.nextInt(1, 254)}.${prng.nextInt(10, 20)}`;
      const dstPort = prng.pick([22, 80, 443, 3306, 8080]);
      const action = prng.pick(['ACCEPT', 'ACCEPT', 'DROP']);
      return `Jan ${prng.nextInt(1, 28)} ${prng.nextInt(0, 23).toString().padStart(2, '0')}:${prng.nextInt(0, 59).toString().padStart(2, '0')}:${prng.nextInt(0, 59).toString().padStart(2, '0')} kernel: [iptables] ${action} IN=eth0 OUT=eth1 SRC=${srcIp} DST=${machine.ip} PROTO=TCP DPT=${dstPort}`;
    });
    varLogContent['firewall.log'] = mkFile('firewall.log', fwLines.join('\n'), 'guest');
  }
  if (machine.role === 'switch') {
    const aclLines = Array.from({ length: prng.nextInt(6, 12) }, () => {
      const srcIp = `10.${prng.nextInt(1, 254)}.${prng.nextInt(1, 254)}.${prng.nextInt(10, 20)}`;
      const dstPort = prng.pick([22, 80, 443, 3306, 8080]);
      const action = prng.pick(['ALLOW', 'ALLOW', 'DENY']);
      return `Jan ${prng.nextInt(1, 28)} ${prng.nextInt(0, 23).toString().padStart(2, '0')}:${prng.nextInt(0, 59).toString().padStart(2, '0')}:${prng.nextInt(0, 59).toString().padStart(2, '0')} kernel: [ACL] ${action} IN=Gi0/1 OUT=Gi0/2 SRC=${srcIp} DST=${machine.ip} PROTO=TCP DPT=${dstPort}`;
    });
    varLogContent['acl.log'] = mkFile('acl.log', aclLines.join('\n'), 'guest');
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

  // Switch ACL rules file: deny rules block traffic to the downstream subnet.
  // Players must clear these via nano or snmpset to access downstream machines.
  if (machine.role === 'switch' && options.downstreamSubnet) {
    const aclContent = generateAclContent(options.downstreamSubnet);
    etcExtraContent['switch'] = mkDir(
      'switch',
      { 'acl.conf': mkFile('acl.conf', aclContent) },
      'root',
      true,
    );
  }

  // Gateway /etc/hosts contains hints about internal machines
  if (
    (machine.role === 'router' || machine.role === 'switch') &&
    internalMachines &&
    internalMachines.length > 0
  ) {
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
  if (isTarget && objective) {
    placeTargetFile(prng, objective, rootContent, extraDirectories);

    // Place corrupted hint file on the target machine (same machine as the script)
    if (
      objective?.type === 'script_fix' &&
      objective?.scriptBugType === 'corrupted' &&
      objective?.scriptHintPath &&
      objective?.scriptHintContent
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

    // HTTP entry variant: place credential files in /var/www/html/ for discovery via curl.
    if (isHttpEntry) {
      placeHttpEntryCredentials(prng, machineCreds, htmlChildren);
    }

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

  // Machines with SSH/FTP ports open have daemons already running — include pid files
  const hasSshOpen = machine.remoteMachine.ports.some((p) => p.service === 'ssh' && p.open);
  const hasFtpOpen = machine.remoteMachine.ports.some((p) => p.service === 'ftp' && p.open);
  const varRunContent =
    hasSshOpen || hasFtpOpen
      ? {
          ...(hasSshOpen ? { [SSH_PID_FILE_NAME]: createSshdPidFileNode() } : {}),
          ...(hasFtpOpen ? { [FTP_PID_FILE_NAME]: createVsftpdPidFileNode() } : {}),
        }
      : undefined;

  return {
    users: userConfigs,
    rootContent,
    varLogContent,
    varRunContent,
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

// Generates SSH log lines (auth.log) for a forensics attack hop
const generateSshLogLines = (
  prng: Prng,
  baseDate: Date,
  minuteOffset: number,
  hostname: string,
  sourceIp: string,
): { readonly lines: readonly string[]; readonly minutesUsed: number } => {
  const pid = prng.nextInt(1000, 9999);
  const lines: string[] = [];
  let offset = 0;

  const failedAttempts = prng.nextInt(1, 3);
  const failedLines = Array.from({ length: failedAttempts }, (_, f) => {
    const date = new Date(baseDate.getTime() + (minuteOffset + offset + f) * 60000);
    const port = prng.nextInt(30000, 60000);
    return formatSshFailed(date, hostname, pid, 'root', sourceIp, port);
  });
  lines.push(...failedLines);
  offset += failedAttempts;

  const successDate = new Date(baseDate.getTime() + (minuteOffset + offset) * 60000);
  const successPort = prng.nextInt(30000, 60000);
  lines.push(formatSshAccepted(successDate, hostname, pid, 'root', sourceIp, successPort));
  offset += 2;

  return { lines, minutesUsed: offset };
};

// Generates FTP log lines (vsftpd.log) for a forensics attack hop
const generateFtpLogLines = (
  prng: Prng,
  baseDate: Date,
  minuteOffset: number,
  sourceIp: string,
): { readonly lines: readonly string[]; readonly minutesUsed: number } => {
  const lines: string[] = [];
  let offset = 0;

  const connectDate = new Date(baseDate.getTime() + (minuteOffset + offset) * 60000);
  lines.push(formatFtpConnect(connectDate, sourceIp));
  offset += 1;

  const failedAttempts = prng.nextInt(1, 2);
  const failedLines = Array.from({ length: failedAttempts }, (_, f) => {
    const date = new Date(baseDate.getTime() + (minuteOffset + offset + f) * 60000);
    return formatFtpLoginFailed(date, sourceIp, 'admin');
  });
  lines.push(...failedLines);
  offset += failedAttempts;

  const successDate = new Date(baseDate.getTime() + (minuteOffset + offset) * 60000);
  lines.push(formatFtpLoginOk(successDate, sourceIp, 'root'));
  offset += 2;

  return { lines, minutesUsed: offset };
};

// Generates HTTP log lines (access.log) for a forensics attack hop
const generateHttpLogLines = (
  prng: Prng,
  baseDate: Date,
  minuteOffset: number,
  sourceIp: string,
): { readonly lines: readonly string[]; readonly minutesUsed: number } => {
  const lines: string[] = [];
  let offset = 0;

  // Reconnaissance requests
  const recon = ['/robots.txt', '/admin', '/login', '/.env', '/api/config'];
  const reconCount = prng.nextInt(2, 4);
  const reconLines = Array.from({ length: reconCount }, (_, r) => {
    const date = new Date(baseDate.getTime() + (minuteOffset + offset + r) * 60000);
    const path = prng.pick(recon);
    const status = path === '/admin' || path === '/login' ? 200 : 404;
    return formatAccessLog(date, sourceIp, 'GET', path, status, prng.nextInt(200, 5000));
  });
  lines.push(...reconLines);
  offset += reconCount;

  // Successful exploit/auth
  const successDate = new Date(baseDate.getTime() + (minuteOffset + offset) * 60000);
  lines.push(formatAccessLog(successDate, sourceIp, 'POST', '/admin/login', 302, 0));
  offset += 1;

  const shellDate = new Date(baseDate.getTime() + (minuteOffset + offset) * 60000);
  lines.push(
    formatAccessLog(shellDate, sourceIp, 'POST', '/admin/shell', 200, prng.nextInt(100, 2000)),
  );
  offset += 2;

  return { lines, minutesUsed: offset };
};

// Maps a log type to its filename and line generator
const generateLogForType = (
  logType: ForensicsLogType,
  prng: Prng,
  baseDate: Date,
  minuteOffset: number,
  hostname: string,
  sourceIp: string,
): {
  readonly fileName: string;
  readonly lines: readonly string[];
  readonly minutesUsed: number;
} => {
  if (logType === 'ftp') {
    const { lines, minutesUsed } = generateFtpLogLines(prng, baseDate, minuteOffset, sourceIp);
    return { fileName: 'vsftpd.log', lines, minutesUsed };
  }
  if (logType === 'http') {
    const { lines, minutesUsed } = generateHttpLogLines(prng, baseDate, minuteOffset, sourceIp);
    return { fileName: 'access.log', lines, minutesUsed };
  }
  const { lines, minutesUsed } = generateSshLogLines(
    prng,
    baseDate,
    minuteOffset,
    hostname,
    sourceIp,
  );
  return { fileName: 'auth.log', lines, minutesUsed };
};

// Generates red herring noise log lines for a given log type and difficulty
const generateNoiseLines = (
  prng: Prng,
  logType: ForensicsLogType,
  baseDate: Date,
  minuteOffset: number,
  hostname: string,
  difficulty: Difficulty,
): readonly string[] => {
  const [min, max] = forensicsNoiseCount[difficulty];
  const count = prng.nextInt(min, max);

  return Array.from({ length: count }, () => {
    // Noise happens at random times before/around the attack
    const offsetMinutes = prng.nextInt(-60, 120);
    const date = new Date(baseDate.getTime() + (minuteOffset + offsetMinutes) * 60000);
    const noiseIp = prng.pick(forensicsNoiseIps);
    const noiseUser = prng.pick(forensicsNoiseUsers);

    if (logType === 'ssh') {
      const port = prng.nextInt(30000, 60000);
      const pid = prng.nextInt(1000, 9999);
      return prng.next() < 0.7
        ? formatSshAccepted(date, hostname, pid, noiseUser, noiseIp, port)
        : formatSshFailed(date, hostname, pid, noiseUser, noiseIp, port);
    }
    if (logType === 'ftp') {
      return prng.next() < 0.7
        ? formatFtpLoginOk(date, noiseIp, noiseUser)
        : formatFtpLoginFailed(date, noiseIp, noiseUser);
    }
    const path = prng.pick(forensicsNoiseHttpPaths);
    return formatAccessLog(date, noiseIp, 'GET', path, 200, prng.nextInt(200, 5000));
  });
};

// Generates pre-populated log entries and calling card for forensics objectives.
// Returns a map of machineIp → extra files to merge into the filesystem.
const generateForensicsEvidence = (
  prng: Prng,
  machines: readonly GeneratedMachine[],
  objective: MissionObjective,
  difficulty: Difficulty = 'medium',
): Readonly<Record<string, Readonly<Record<string, FileNode>>>> => {
  if (objective.type !== 'forensics' || !objective.attackerHandle || !objective.attackerIp) {
    return {};
  }

  const { attackerHandle, attackerIp } = objective;
  const result: Record<string, Record<string, FileNode>> = {};

  // Base date for the attack timeline (a few days ago)
  const baseDate = new Date('2026-03-20T02:30:00Z');
  let minuteOffset = 0;

  for (let i = 0; i < machines.length; i++) {
    const machine = machines[i] as GeneratedMachine;
    const sourceIp = i === 0 ? attackerIp : (machines[i - 1] as GeneratedMachine).ip;

    // Pick a log type for this machine
    const logType = prng.pick(forensicsLogTypes);
    const { fileName, lines, minutesUsed } = generateLogForType(
      logType,
      prng,
      baseDate,
      minuteOffset,
      machine.hostname,
      sourceIp,
    );
    minuteOffset += minutesUsed;

    // su to root on non-entry machines (50% chance, only for SSH logs)
    const attackerLines =
      i > 0 && logType === 'ssh' && prng.next() < 0.5
        ? [
            ...lines,
            formatSuSuccess(
              new Date(baseDate.getTime() + minuteOffset++ * 60000),
              machine.hostname,
              prng.nextInt(1000, 9999),
              'root',
              'operator',
            ),
          ]
        : [...lines];

    // Add red herring noise entries from other IPs
    const noiseLines = generateNoiseLines(
      prng,
      logType,
      baseDate,
      minuteOffset,
      machine.hostname,
      difficulty,
    );

    // Interleave noise before and after attacker lines
    const allLines = [
      ...noiseLines.slice(0, Math.ceil(noiseLines.length / 2)),
      ...attackerLines,
      ...noiseLines.slice(Math.ceil(noiseLines.length / 2)),
    ];

    const logFile = mkFile(fileName, allLines.join('\n'));
    const varLog = mkDir('log', { [fileName]: logFile }, 'root', true);
    const varDir = mkDir('var', { log: varLog }, 'root', true);

    result[machine.ip] = { var: varDir };

    // Place calling card on the deepest machine
    if (i === machines.length - 1) {
      const template = prng.pick(forensicsCallingCardTemplates);
      const cardPath = template.path.replace(/\{\{handle\}\}/g, attackerHandle);
      const cardContent = template.content.replace(/\{\{handle\}\}/g, attackerHandle);
      const segments = cardPath.split('/').filter(Boolean);
      const fileName = segments[segments.length - 1] ?? `.${attackerHandle}`;
      const cardFile = mkFile(fileName, cardContent);
      const topDir = segments[0] ?? 'tmp';
      result[machine.ip] = {
        ...result[machine.ip],
        [topDir]: buildNestedDirs(segments, cardFile),
      };
    }
  }

  return result;
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
    entryPoint,
    difficulty,
    layers,
  } = input;

  // Build maps from inner gateway IP → downstream layer info (machines, NAT, subnet).
  // Gateways need downstream machines for /etc/hosts, NAT forwarding for iptables,
  // and downstream subnet for switch ACL rules.
  const gatewayDownstreamMap = new Map<string, readonly GeneratedMachine[]>();
  const gatewayNatMap = new Map<string, NatForwarding | undefined>();
  const gatewaySubnetMap = new Map<string, string>();
  if (layers && layers.length > 1) {
    layers.slice(1).forEach((layer) => {
      const downstreamIps = new Set(layer.machines.map((m) => m.ip));
      const downstreamMachines = machines.filter((m) => downstreamIps.has(m.ip));
      gatewayDownstreamMap.set(layer.gateway.ip, downstreamMachines);
      gatewayNatMap.set(layer.gateway.ip, layer.natForwarding);
      gatewaySubnetMap.set(layer.gateway.ip, layer.subnet);
    });
  }

  // Pre-generate SNMP configs for inner gateways with SNMP access variant.
  // Done before the machine loop to keep PRNG sequence stable for other machines.
  // Switches use ACL OIDs (aclSSH/aclHTTP), routers use firewall OIDs (firewallSSH/firewallHTTP).
  const gatewaySnmpConfigs = new Map<string, string>();
  if (layers && layers.length > 1) {
    layers.slice(1).forEach((layer) => {
      if (layer.gateway.accessVariant === 'snmp') {
        const gatewayCreds = credentials[layer.gateway.ip] ?? [];
        const snmpConfigFn =
          layer.gatewayType === 'switch' ? generateSwitchSnmpConfig : generateSnmpConfig;
        gatewaySnmpConfigs.set(layer.gateway.ip, snmpConfigFn(prng, layer.gateway, gatewayCreds));
      }
    });
  }

  // Pre-generate forensics evidence (log files + calling card) before machine loop
  const forensicsEvidence = generateForensicsEvidence(prng, machines, objective, difficulty);

  const entries = machines.map((machine) => {
    const users = usersByMachine[machine.ip] ?? [];
    const machineCreds = credentials[machine.ip] ?? [];
    const isTarget = machine.ip === objective.targetMachine;
    const isHttpEntry = entryVariant === 'http' && machine.ip === entryPoint;

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
      downstreamSubnet,
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

    // Place encryption key file on the key machine (if this is that machine)
    const keyTree =
      objective.keyPlacement?.machineIp === machine.ip ? buildKeyFileTree(prng, objective) : null;
    const configWithKey = mergeKeyPlacement(configWithSnmp, keyTree);

    // Merge forensics evidence (log files, calling card) if present for this machine
    const evidence = forensicsEvidence[machine.ip];
    const configWithEvidence = evidence
      ? {
          ...configWithKey,
          extraDirectories: { ...(configWithKey.extraDirectories ?? {}), ...evidence },
        }
      : configWithKey;

    // script_auto: place data file on target (local) or API JSON on API machine (remote)
    const config = mergeScriptAutoData(machine, objective, configWithEvidence);

    const fileSystem = createFileSystem(config);

    return [machine.ip, fileSystem] as const;
  });

  // Generate router filesystem with hints about internal machines
  if (routerMachine) {
    const routerUsers = usersByMachine[routerMachine.ip] ?? [];
    const routerCreds = credentials[routerMachine.ip] ?? [];

    const baseRouterConfig = buildMachineConfig(prng, routerMachine, routerUsers, routerCreds, {
      objective,
      internalMachines: machines,
      natForwarding,
    });

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
