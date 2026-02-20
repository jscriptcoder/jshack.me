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
  configTemplatesByRole,
  entryCredentialHintTemplates,
  logTemplates,
  noiseFiles,
  redHerringFiles,
} from './pools';

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
      children[fileName] = mkFile(fileName, p.fileContent, 'user');
    }
  });

  return children;
};

// Places the target file at the dynamic path from objective.targetPath.
// Target paths use /srv/ or /opt/ prefixes (via extraDirectories) to avoid
// conflicting with factory-managed directories (/var/, /home/, /etc/).
const placeTargetFile = (
  objective: MissionObjective,
  rootContent: Record<string, FileNode>,
  extraDirectories: Record<string, FileNode>,
): void => {
  const segments = objective.targetPath.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] ?? 'flag.txt';
  const file = mkFile(fileName, objective.targetContent);
  const topDir = segments[0] ?? 'root';

  if (topDir === 'root') {
    rootContent[fileName] = file;
    return;
  }

  // /srv/, /opt/, etc. — build nested directory tree in extraDirectories
  extraDirectories[topDir] = buildNestedDirs(segments, file);
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

  const etcExtraContent: Record<string, FileNode> = {
    hostname: mkFile('hostname', machine.hostname),
  };

  const serviceConfigName =
    machine.role === 'webserver'
      ? 'httpd.conf'
      : machine.role === 'database'
        ? 'mysql.cnf'
        : machine.role === 'fileserver'
          ? 'vsftpd.conf'
          : 'ssh_config';

  etcExtraContent[serviceConfigName] = mkFile(serviceConfigName, configContent);

  const etcPlacements = placements.filter((p) => p.filePath.startsWith('/etc/'));
  etcPlacements.forEach((p) => {
    const fileName = p.filePath.split('/').pop() ?? 'config';
    etcExtraContent[fileName] = mkFile(fileName, p.fileContent);
  });

  const logContent = generateLogContent(prng, machine, users);
  const varLogContent: Record<string, FileNode> = {
    'auth.log': mkFile('auth.log', logContent),
  };

  const logPlacements = placements.filter((p) => p.filePath.startsWith('/var/log/'));
  logPlacements.forEach((p) => {
    const fileName = p.filePath.split('/').pop() ?? 'log';
    varLogContent[fileName] = mkFile(fileName, p.fileContent);
  });

  const tmpPlacements = placements.filter((p) => p.filePath.startsWith('/tmp/'));
  const extraDirectories: Record<string, FileNode> = {};

  const rootContent: Record<string, FileNode> = {};
  if (isTarget) {
    placeTargetFile(objective, rootContent, extraDirectories);
  }

  if (tmpPlacements.length > 0) {
    const tmpChildren: Record<string, FileNode> = {};
    tmpPlacements.forEach((p) => {
      const fileName = p.filePath.split('/').pop() ?? 'file';
      tmpChildren[fileName] = mkFile(fileName, p.fileContent, 'user');
    });
    extraDirectories['tmp'] = mkDir('tmp', tmpChildren);
  }

  return {
    users: userConfigs,
    rootContent,
    varLogContent,
    etcExtraContent,
    extraDirectories: Object.keys(extraDirectories).length > 0 ? extraDirectories : undefined,
    passwdReadableBy: ['root', 'user'],
  };
};

const buildEntryCredentialPlacement = (
  prng: Prng,
  machine: GeneratedMachine,
  users: readonly RemoteUser[],
  entryVariant: EntryVariant,
  machineCredentials: readonly { readonly username: string; readonly password: string }[],
): CredentialPlacement | null => {
  if (entryVariant === 'ssh') return null;

  const sshUser = users.find((u) => u.userType === 'user');
  if (!sshUser) return null;

  const sshCred = machineCredentials.find((c) => c.username === sshUser.username);
  if (!sshCred) return null;

  const hintTemplate = prng.pick(entryCredentialHintTemplates);
  const localUser = sshUser.username;
  // NC and exploit variants both use restricted shells as a guest user
  const ownerUser =
    entryVariant === 'nc' || entryVariant === 'exploit'
      ? (users.find((u) => u.userType === 'guest')?.username ?? 'guest')
      : localUser;

  const filePath =
    entryVariant === 'ftp'
      ? hintTemplate.ftpPath.replace('{{localUser}}', localUser)
      : entryVariant === 'exploit'
        ? hintTemplate.exploitPath.replace('{{owner}}', ownerUser)
        : hintTemplate.ncPath.replace('{{owner}}', ownerUser);

  const fileContent = fillTemplate(hintTemplate.template, {
    hostname: machine.hostname,
    user: sshCred.username,
    password: sshCred.password,
    owner: ownerUser,
  });

  return {
    machineIp: machine.ip,
    filePath,
    fileContent,
    username: sshCred.username,
    password: sshCred.password,
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
  } = input;

  const entries = machines.map((machine) => {
    const users = usersByMachine[machine.ip] ?? [];
    const isEntry = machine.ip === entryPoint;
    const basePlacements = credentialPlacements.filter((p) => p.machineIp === machine.ip);
    const machineCreds = credentials[machine.ip] ?? [];

    const entryHint = isEntry
      ? buildEntryCredentialPlacement(prng, machine, users, entryVariant, machineCreds)
      : null;
    const placements = entryHint ? [...basePlacements, entryHint] : basePlacements;

    const isTarget = machine.ip === objective.targetMachine;

    const config = buildMachineConfig(prng, machine, users, placements, isTarget, objective);
    const fileSystem = createFileSystem(config);

    return [machine.ip, fileSystem] as const;
  });

  return Object.fromEntries(entries);
};
