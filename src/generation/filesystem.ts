import type { Prng } from './prng';
import type {
  CredentialPlacement,
  EntryVariant,
  GeneratedMachine,
  MissionObjective,
} from './types';
import type { FileNode } from '../filesystem/types';
import type { RemoteUser } from '../network/types';
import {
  createFileSystem,
  type MachineFileSystemConfig,
  type UserConfig,
} from '../filesystem/fileSystemFactory';
import {
  binaryEntryCredentialHintTemplates,
  configTemplatesByRole,
  entryCredentialHintTemplates,
  logTemplates,
  noiseFiles,
  redHerringFiles,
  webContentTemplates,
} from './pools';
import { binaryCredentialPaths, wrapInBinaryNoise } from './binary';
import { createBinaryEntries, SYSTEM_UTILITY_NAMES } from '../commands/availability';

type FilesystemInput = {
  readonly prng: Prng;
  readonly machines: readonly GeneratedMachine[];
  readonly usersByMachine: Readonly<Record<string, readonly RemoteUser[]>>;
  readonly credentialPlacements: readonly CredentialPlacement[];
  readonly credentials: Readonly<
    Record<string, readonly { readonly username: string; readonly password: string }[]>
  >;
  readonly objective: MissionObjective;
  readonly entryPoint: string;
  readonly entryVariant: EntryVariant;
  readonly routerMachine?: GeneratedMachine;
  readonly networkMode: 'forwarded' | 'router-first';
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
    read: owner === 'root' ? ['root'] : ['root', 'user', 'guest'],
    write: [owner === 'guest' ? 'guest' : 'root'],
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

const mkDir = (
  name: string,
  children: Readonly<Record<string, FileNode>>,
  owner: 'root' | 'user' | 'guest' = 'root',
): FileNode => ({
  name,
  type: 'directory',
  owner,
  permissions: {
    read: ['root', 'user', 'guest'],
    write: [owner],
    execute: ['root', 'user', 'guest'],
  },
  children,
});

const fillTemplate = (template: string, vars: Readonly<Record<string, string>>): string =>
  Object.entries(vars).reduce(
    (result, [key, value]) => result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value),
    template,
  );

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
  placements: readonly CredentialPlacement[],
): Readonly<Record<string, FileNode>> => {
  const children: Record<string, FileNode> = {};

  const selectedNoise = prng.pickN(noiseFiles, prng.nextInt(1, 3));
  selectedNoise.forEach((noise) => {
    children[noise.name] = mkFile(noise.name, noise.content, 'user');
  });

  if (prng.next() < 0.3) {
    const herring = prng.pick(redHerringFiles);
    children[herring.name] = mkFile(herring.name, herring.content, 'user');
  }

  placements.forEach((p) => {
    const parts = p.filePath.split('/');
    const fileName = parts[parts.length - 1] ?? 'credentials.txt';
    if (p.filePath.startsWith('/home/')) {
      const content = p.binary ? wrapInBinaryNoise(prng, p.fileContent) : p.fileContent;
      children[fileName] = mkFile(fileName, content, 'user');
    }
  });

  return children;
};

// Places the target file at the dynamic path from objective.targetPath.
// Target paths use /srv/ or /opt/ prefixes (via extraDirectories) to avoid
// conflicting with factory-managed directories (/var/, /home/, /etc/).
// Skipped for credential_theft objectives (no target file to place).
const placeTargetFile = (
  prng: Prng,
  objective: MissionObjective,
  rootContent: Record<string, FileNode>,
  extraDirectories: Record<string, FileNode>,
): void => {
  if (objective.type === 'credential_theft') return;

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
const buildNestedDirs = (segments: readonly string[], file: FileNode): FileNode => {
  if (segments.length <= 1) return file;

  const dirName = segments[0] as string;
  const child = buildNestedDirs(segments.slice(1), file);
  const childName = segments[1] as string;

  return mkDir(dirName, { [childName]: child });
};

const buildMachineConfig = (
  prng: Prng,
  machine: GeneratedMachine,
  users: readonly RemoteUser[],
  placements: readonly CredentialPlacement[],
  isTarget: boolean,
  objective: MissionObjective,
  internalMachines?: readonly GeneratedMachine[],
): MachineFileSystemConfig => {
  const userConfigs: readonly UserConfig[] = users.map((u, i) => ({
    username: u.username,
    passwordHash: u.passwordHash,
    userType: u.userType,
    uid: u.userType === 'root' ? 0 : 1000 + i,
    homeContent:
      u.userType === 'root'
        ? undefined
        : generateHomeContent(
            prng,
            placements.filter((p) => p.filePath.startsWith(`/home/${u.username}/`)),
          ),
  }));

  const configTemplates = configTemplatesByRole[machine.role];
  const configContent = fillTemplate(prng.pick(configTemplates), {
    port: String(machine.remoteMachine.ports[0]?.port ?? 22),
    hostname: machine.hostname,
    user: users.find((u) => u.userType === 'user')?.username ?? 'admin',
  });

  // /etc/ system files are world-readable on real Linux (644)
  const etcExtraContent: Record<string, FileNode> = {
    hostname: mkFile('hostname', machine.hostname, 'user'),
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

  etcExtraContent[serviceConfigName] = mkFile(serviceConfigName, configContent, 'user');

  const etcPlacements = placements.filter((p) => p.filePath.startsWith('/etc/'));
  etcPlacements.forEach((p) => {
    const fileName = p.filePath.split('/').pop() ?? 'config';
    etcExtraContent[fileName] = mkFile(fileName, p.fileContent, 'user');
  });

  const logContent = generateLogContent(prng, machine, users);
  const varLogContent: Record<string, FileNode> = {
    'auth.log': mkFile('auth.log', logContent, 'user'),
  };

  // Router machines get a firewall log with hints about internal network traffic
  if (machine.role === 'router') {
    const fwLines = Array.from({ length: prng.nextInt(6, 12) }, () => {
      const srcIp = `10.${prng.nextInt(1, 254)}.${prng.nextInt(1, 254)}.${prng.nextInt(10, 20)}`;
      const dstPort = prng.pick([22, 80, 443, 3306, 8080]);
      const action = prng.pick(['ACCEPT', 'ACCEPT', 'DROP']);
      return `Jan ${prng.nextInt(1, 28)} ${prng.nextInt(0, 23).toString().padStart(2, '0')}:${prng.nextInt(0, 59).toString().padStart(2, '0')}:${prng.nextInt(0, 59).toString().padStart(2, '0')} kernel: [iptables] ${action} IN=eth0 OUT=eth1 SRC=${srcIp} DST=${machine.ip} PROTO=TCP DPT=${dstPort}`;
    });
    varLogContent['firewall.log'] = mkFile('firewall.log', fwLines.join('\n'), 'user');
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
    etcExtraContent['hosts'] = mkFile('hosts', hostsLines.join('\n'), 'user');

    // Routing table hint
    const routeTable = [
      'Kernel IP routing table',
      'Destination     Gateway         Genmask         Iface',
      `0.0.0.0         0.0.0.0         0.0.0.0         eth0`,
      ...internalMachines.map((m) => `${m.ip}        0.0.0.0         255.255.255.255 eth1`),
    ];
    etcExtraContent['route.conf'] = mkFile('route.conf', routeTable.join('\n'), 'user');
  }

  const logPlacements = placements.filter((p) => p.filePath.startsWith('/var/log/'));
  logPlacements.forEach((p) => {
    const fileName = p.filePath.split('/').pop() ?? 'log';
    const content = p.binary ? wrapInBinaryNoise(prng, p.fileContent) : p.fileContent;
    varLogContent[fileName] = mkFile(fileName, content, 'user');
  });

  const tmpPlacements = placements.filter((p) => p.filePath.startsWith('/tmp/'));
  // Web content placements (curl-based credential discovery)
  const webPlacements = placements.filter((p) => p.filePath.startsWith('/var/www/'));
  // Binary credential placements use deep paths like /usr/local/bin/, /opt/lib/, /var/cache/
  const binaryDeepPlacements = placements.filter(
    (p) =>
      p.binary &&
      !p.filePath.startsWith('/home/') &&
      !p.filePath.startsWith('/var/log/') &&
      !p.filePath.startsWith('/tmp/') &&
      !p.filePath.startsWith('/var/www/') &&
      !p.filePath.startsWith('/etc/'),
  );
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

  if (tmpPlacements.length > 0) {
    const tmpChildren: Record<string, FileNode> = {};
    tmpPlacements.forEach((p) => {
      const fileName = p.filePath.split('/').pop() ?? 'file';
      const content = p.binary ? wrapInBinaryNoise(prng, p.fileContent) : p.fileContent;
      tmpChildren[fileName] = mkFile(fileName, content, 'user');
    });
    extraDirectories['tmp'] = mkDir('tmp', tmpChildren);
  }

  // Generate web content for webserver machines (index.html + any credential placements)
  if (machine.role === 'webserver' || webPlacements.length > 0) {
    const webTemplate = prng.pick(webContentTemplates);
    const indexContent = fillTemplate(webTemplate.content, {
      hostname: machine.hostname,
      ip: machine.ip,
    });

    // Build /var/www/html/ directory tree with index.html + credential placement files
    const htmlChildren: Record<string, FileNode> = {
      'index.html': mkFile('index.html', indexContent),
    };

    // Place credential files at their web paths (under /var/www/html/)
    webPlacements.forEach((p) => {
      const relPath = p.filePath.replace('/var/www/html/', '');
      const segments = relPath.split('/');
      if (segments.length === 1) {
        htmlChildren[relPath] = mkFile(relPath, p.fileContent);
      } else {
        // Nested path (e.g., admin/config.json) — build nested dirs under html/
        const fullSegments = p.filePath.split('/').filter(Boolean);
        // segments: ['var', 'www', 'html', 'admin', 'config.json']
        const htmlRelSegments = fullSegments.slice(3);
        const topChild = htmlRelSegments[0] as string;
        htmlChildren[topChild] = buildNestedDirs(
          htmlRelSegments,
          mkFile(htmlRelSegments[htmlRelSegments.length - 1] as string, p.fileContent),
        );
      }
    });

    extraDirectories['var'] = mkDir('var', {
      www: mkDir('www', {
        html: mkDir('html', htmlChildren),
      }),
    });
  }

  // Place binary credential files at deep paths (e.g., /usr/local/bin/monitor_agent)
  binaryDeepPlacements.forEach((p) => {
    const segments = p.filePath.split('/').filter(Boolean);
    const fileName = segments[segments.length - 1] ?? 'data.bin';
    const content = wrapInBinaryNoise(prng, p.fileContent);
    const file = mkFile(fileName, content);
    const topDir = segments[0] ?? 'usr';
    extraDirectories[topDir] = buildNestedDirs(segments, file);
  });

  return {
    users: userConfigs,
    rootContent,
    varLogContent,
    etcExtraContent,
    extraDirectories: Object.keys(extraDirectories).length > 0 ? extraDirectories : undefined,
    binContent: createBinaryEntries(SYSTEM_UTILITY_NAMES),
    passwdReadableBy: ['root', 'user'],
  };
};

const buildEntryCredentialPlacement = (
  prng: Prng,
  machine: GeneratedMachine,
  users: readonly RemoteUser[],
  entryVariant: EntryVariant,
  machineCredentials: readonly { readonly username: string; readonly password: string }[],
): readonly CredentialPlacement[] => {
  if (entryVariant === 'ssh') return [];

  const sshUser = users.find((u) => u.userType === 'user');
  if (!sshUser) return [];

  const sshCred = machineCredentials.find((c) => c.username === sshUser.username);
  if (!sshCred) return [];

  // HTTP entry variant: place SSH credentials in web content (+ optional .headers sidecar)
  if (entryVariant === 'http') {
    const hintTemplate = prng.pick(entryCredentialHintTemplates);
    const fileContent = fillTemplate(hintTemplate.template, {
      hostname: machine.hostname,
      user: sshCred.username,
      password: sshCred.password,
    });

    const placements: CredentialPlacement[] = [
      {
        machineIp: machine.ip,
        filePath: hintTemplate.httpPath,
        fileContent: hintTemplate.httpInHeader
          ? `<!-- internal auth configured via response headers -->\n<p>System status: OK</p>`
          : fileContent,
        username: sshCred.username,
        password: sshCred.password,
      },
    ];

    // When httpInHeader, place the actual credentials in a .headers sidecar
    if (hintTemplate.httpInHeader) {
      placements.push({
        machineIp: machine.ip,
        filePath: hintTemplate.httpHeadersPath,
        fileContent: `${hintTemplate.httpHeaderName}: ${sshCred.username}:${sshCred.password}`,
        username: sshCred.username,
        password: sshCred.password,
      });
    } else {
      // Body-based: overwrite with credential-containing content
      placements[0] = { ...placements[0], fileContent } as CredentialPlacement;
    }

    return placements;
  }

  // ~20% chance to wrap entry credential hint in a binary file
  const isBinary = prng.next() < 0.2;
  const hintTemplate = isBinary
    ? prng.pick(binaryEntryCredentialHintTemplates)
    : prng.pick(entryCredentialHintTemplates);
  const localUser = sshUser.username;
  // NC, exploit, and FTP variants derive owner from the machine's port owner (guest/user/root)
  const portOwner = machine.remoteMachine.ports.find((p) => p.owner)?.owner;
  const ownerUser =
    entryVariant === 'nc' || entryVariant === 'exploit' || entryVariant === 'ftp'
      ? (portOwner?.username ?? users.find((u) => u.userType === 'guest')?.username ?? 'guest')
      : localUser;

  // Binary entry credentials use a role-appropriate deep path
  if (isBinary) {
    const binaryPath = prng.pick(binaryCredentialPaths[machine.role]);
    const fileContent = fillTemplate(hintTemplate.template, {
      hostname: machine.hostname,
      user: sshCred.username,
      password: sshCred.password,
      owner: ownerUser,
    });

    // Guest owners can't read deep root-only binary paths — use /tmp/ instead
    // (/tmp/ placements use owner: 'user', which is readable by guest)
    const ownerIsGuest = portOwner?.userType === 'guest' || !portOwner;
    const fileName = binaryPath.split('/').pop() ?? 'data.bin';
    const filePath = ownerIsGuest ? `/tmp/${fileName}` : binaryPath;

    return [
      {
        machineIp: machine.ip,
        filePath,
        fileContent,
        username: sshCred.username,
        password: sshCred.password,
        binary: true,
      },
    ];
  }

  // Root's home is /root/, not /home/root/ — place hints in /tmp/ instead
  const ownerIsRoot = portOwner?.userType === 'root';
  const pathByVariant =
    entryVariant === 'ftp'
      ? hintTemplate.ftpPath
      : entryVariant === 'exploit'
        ? hintTemplate.exploitPath
        : hintTemplate.ncPath;
  const filePath = ownerIsRoot
    ? `/tmp/${pathByVariant.split('/').pop()}`
    : pathByVariant.replace('{{owner}}', ownerUser);

  const fileContent = fillTemplate(hintTemplate.template, {
    hostname: machine.hostname,
    user: sshCred.username,
    password: sshCred.password,
    owner: ownerUser,
  });

  return [
    {
      machineIp: machine.ip,
      filePath,
      fileContent,
      username: sshCred.username,
      password: sshCred.password,
    },
  ];
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
    credentialPlacements,
    credentials,
    objective,
    entryPoint,
    entryVariant,
    routerMachine,
    networkMode,
  } = input;

  const entries = machines.map((machine) => {
    const users = usersByMachine[machine.ip] ?? [];
    const isEntry = machine.ip === entryPoint;
    const basePlacements = credentialPlacements.filter((p) => p.machineIp === machine.ip);
    const machineCreds = credentials[machine.ip] ?? [];

    // In router-first mode, the entry variant applies to the router, not the
    // internal entry machine — skip entry hints here to avoid placing them
    // on a machine the player can't reach first.
    const entryHints =
      isEntry && networkMode === 'forwarded'
        ? buildEntryCredentialPlacement(prng, machine, users, entryVariant, machineCreds)
        : [];
    const placements = [...basePlacements, ...entryHints];

    const isTarget = machine.ip === objective.targetMachine;

    const baseConfig = buildMachineConfig(prng, machine, users, placements, isTarget, objective);

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
    const routerPlacements = credentialPlacements.filter((p) => p.machineIp === routerMachine.ip);

    // In router-first mode, the entry variant applies to the router —
    // generate entry credential hints (web content for HTTP, NC hints, etc.)
    const routerEntryHints =
      networkMode === 'router-first'
        ? buildEntryCredentialPlacement(
            prng,
            routerMachine,
            routerUsers,
            entryVariant,
            credentials[routerMachine.ip] ?? [],
          )
        : [];

    const allRouterPlacements = [...routerPlacements, ...routerEntryHints];
    const baseRouterConfig = buildMachineConfig(
      prng,
      routerMachine,
      routerUsers,
      allRouterPlacements,
      false,
      objective,
      machines,
    );

    // Place encryption key on router if it's the key machine
    const routerKeyTree =
      objective.keyPlacement?.machineIp === routerMachine.ip
        ? buildKeyFileTree(prng, objective)
        : null;
    const routerConfig = mergeKeyPlacement(baseRouterConfig, routerKeyTree);

    const routerFs = createFileSystem(routerConfig);
    return Object.fromEntries([...entries, [routerMachine.ip, routerFs]]);
  }

  return Object.fromEntries(entries);
};
