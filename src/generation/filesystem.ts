import type { Prng } from './prng';
import type { CredentialPlacement, GeneratedMachine, MissionObjective } from './types';
import type { FileNode } from '../filesystem/types';
import type { RemoteUser } from '../network/types';
import {
  createFileSystem,
  type MachineFileSystemConfig,
  type UserConfig,
} from '../filesystem/fileSystemFactory';
import { configTemplatesByRole, logTemplates, noiseFiles, redHerringFiles } from './pools';

type FilesystemInput = {
  readonly prng: Prng;
  readonly machines: readonly GeneratedMachine[];
  readonly usersByMachine: Readonly<Record<string, readonly RemoteUser[]>>;
  readonly credentialPlacements: readonly CredentialPlacement[];
  readonly objective: MissionObjective;
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

  const rootContent: Record<string, FileNode> = {};
  if (isTarget) {
    rootContent['flag.txt'] = mkFile('flag.txt', objective.flag);
  }

  const tmpPlacements = placements.filter((p) => p.filePath.startsWith('/tmp/'));
  const extraDirectories: Record<string, FileNode> = {};

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

export const generateFileSystems = (input: FilesystemInput): Readonly<Record<string, FileNode>> => {
  const { prng, machines, usersByMachine, credentialPlacements, objective } = input;

  const entries = machines.map((machine) => {
    const users = usersByMachine[machine.ip] ?? [];
    const placements = credentialPlacements.filter((p) => p.machineIp === machine.ip);
    const isTarget = machine.ip === objective.targetMachine;

    const config = buildMachineConfig(prng, machine, users, placements, isTarget, objective);
    const fileSystem = createFileSystem(config);

    return [machine.ip, fileSystem] as const;
  });

  return Object.fromEntries(entries);
};
