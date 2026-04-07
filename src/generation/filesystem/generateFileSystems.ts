import type { Prng } from '../prng';
import type {
  CredentialMap,
  Difficulty,
  EntryVariant,
  GeneratedMachine,
  MachineRole,
  MissionObjective,
  NatForwarding,
  SubnetLayer,
} from '../types';
import type { FileNode } from '../../filesystem/types';
import type { RemoteUser } from '../../network/types';
import {
  createFileSystem,
  mergeFileNodeChildren,
  type MachineFileSystemConfig,
  type UserConfig,
} from '../../filesystem/fileSystemFactory';
import {
  configTemplatesByRole,
  credentialLeakTemplates,
  httpEntryCredentialTemplates,
  logTemplates,
  noiseFiles,
  redHerringFiles,
  webContentTemplatesByRole,
} from '../pools';
import { wrapInBinaryNoise } from '../binary';
import {
  createBinaryEntries,
  SYSTEM_UTILITY_NAMES,
  SBIN_UTILITY_NAMES,
} from '../../commands/availability';
import { SSH_PID_FILE_NAME, createSshdPidFileNode } from '../../commands/sshd';
import { FTP_PID_FILE_NAME, createVsftpdPidFileNode } from '../../commands/vsftpd';
import { mkFile, mkScript, mkDir, fillTemplate, findLeafDir, buildNestedDirs } from './helpers';
import {
  generateAclContent,
  generateIptablesContent,
  generateSnmpConfig,
  generateSwitchSnmpConfig,
  generateBasicSnmpConfig,
  generateBasicRwSnmpConfig,
  generateDnsZoneContent,
  generateDnsNamedConf,
} from './networkConfig';
import { generateForensicsEvidence } from './forensicsEvidence';
import {
  generateDatabase,
  type DbEnrichment,
  type GenerateDatabaseResult,
} from '../generateDatabase';
import { generateRedisData } from '../generateRedisData';

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
  readonly dbEnrichment?: DbEnrichment;
};

// Infrastructure service PID file definitions. Maps service names to their
// daemon binary, PID file name, and run user. SSH/FTP are handled separately
// by their own PID file factories; NC backdoors are dynamic (player-created).
type InfraPidConfig = {
  readonly pidFile: string;
  readonly binary: string;
  readonly user: string;
};

const INFRA_PID_CONFIGS: Readonly<Record<string, InfraPidConfig>> = {
  http: { pidFile: 'nginx.pid', binary: '/usr/sbin/nginx', user: 'www-data' },
  https: { pidFile: 'nginx.pid', binary: '/usr/sbin/nginx', user: 'www-data' },
  'http-alt': { pidFile: 'nginx.pid', binary: '/usr/sbin/nginx', user: 'www-data' },
  mysql: { pidFile: 'mysqld.pid', binary: '/usr/sbin/mysqld', user: 'mysql' },
  postgresql: { pidFile: 'postgres.pid', binary: '/usr/sbin/postgres', user: 'postgres' },
  redis: { pidFile: 'redis.pid', binary: '/usr/sbin/redis-server', user: 'redis' },
  mongodb: { pidFile: 'mongod.pid', binary: '/usr/sbin/mongod', user: 'mongodb' },
  smtp: { pidFile: 'postfix.pid', binary: '/usr/sbin/postfix', user: 'postfix' },
  imap: { pidFile: 'dovecot.pid', binary: '/usr/sbin/dovecot', user: 'dovecot' },
  imaps: { pidFile: 'dovecot.pid', binary: '/usr/sbin/dovecot', user: 'dovecot' },
  pop3: { pidFile: 'dovecot.pid', binary: '/usr/sbin/dovecot', user: 'dovecot' },
  mqtt: { pidFile: 'mosquitto.pid', binary: '/usr/sbin/mosquitto', user: 'mosquitto' },
  dns: { pidFile: 'named.pid', binary: '/usr/sbin/named', user: 'bind' },
  snmp: { pidFile: 'snmpd.pid', binary: '/usr/sbin/snmpd', user: 'snmp' },
  smb: { pidFile: 'smbd.pid', binary: '/usr/sbin/smbd', user: 'root' },
  modbus: { pidFile: 'modbusd.pid', binary: '/usr/sbin/modbusd', user: 'root' },
  openvpn: { pidFile: 'openvpn.pid', binary: '/usr/sbin/openvpn', user: 'root' },
  vnc: { pidFile: 'vncserver.pid', binary: '/usr/sbin/Xvnc', user: 'root' },
  rsync: { pidFile: 'rsyncd.pid', binary: '/usr/sbin/rsyncd', user: 'root' },
};

// Builds PID files for open infrastructure ports. Deduplicates by pidFile name
// (e.g., http/https/http-alt all share nginx.pid; imap/imaps/pop3 share dovecot.pid).
const buildInfrastructurePidFiles = (
  ports: readonly { readonly port: number; readonly service: string; readonly open: boolean }[],
): Readonly<Record<string, FileNode>> => {
  const result: Record<string, FileNode> = {};
  for (const p of ports) {
    if (!p.open) continue;
    const config = INFRA_PID_CONFIGS[p.service];
    if (!config || result[config.pidFile]) continue;
    result[config.pidFile] = mkFile(config.pidFile, `${config.binary}:port=${p.port}`, 'guest');
  }
  return result;
};

const CREDENTIAL_LEAK_CHANCE = 0.3;

// Places a credential leak file on a machine ~30% of the time.
// Leaks a user-type account's credentials in a guest-readable location.
// DB-themed templates use MySQL credentials when available; others use system credentials.
// Always consumes 2 PRNG calls for sequence stability.
const placeCredentialLeak = (
  prng: Prng,
  machineCreds: readonly { readonly username: string; readonly password: string }[],
  mysqlCreds: readonly { readonly username: string; readonly password: string }[] | undefined,
  extraDirectories: Record<string, FileNode>,
  etcExtraContent: Record<string, FileNode>,
): void => {
  const roll = prng.next();
  const template = prng.pick(credentialLeakTemplates);

  // DB-themed templates use MySQL credentials; system-themed use system credentials
  const isDbTemplate = template.credentialType === 'mysql';
  const cred =
    isDbTemplate && mysqlCreds && mysqlCreds.length > 0
      ? (mysqlCreds.find((c) => c.username !== 'root' && c.username !== 'readonly') ??
        mysqlCreds[0])
      : machineCreds.find((c) => c.username !== 'root' && c.username !== 'guest');
  if (roll >= CREDENTIAL_LEAK_CHANCE || !cred) return;

  const content = fillTemplate(template.content, {
    username: cred.username,
    password: cred.password,
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

  // script_fix / script_auto: JS files with user permissions
  // malware: JS script (mkScript) or binary (wrapInBinaryNoise), root-owned
  const file =
    objective.type === 'script_fix' || objective.type === 'script_auto'
      ? mkScript(fileName, objective.targetContent, 'user')
      : objective.type === 'malware'
        ? objective.binary
          ? mkScript(fileName, wrapInBinaryNoise(prng, objective.targetContent), 'root')
          : mkScript(fileName, objective.targetContent, 'root')
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

export type BuildMachineConfigOptions = {
  readonly isTarget?: boolean;
  readonly objective?: MissionObjective;
  readonly internalMachines?: readonly GeneratedMachine[];
  readonly natForwarding?: NatForwarding;
  readonly isHttpEntry?: boolean;
  readonly downstreamSubnet?: string;
  readonly dbEnrichment?: DbEnrichment;
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
    dns: 'named.conf',
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

  // Pre-generate MySQL database for machines with an open MySQL port.
  // Done before credential leak placement so DB-themed leaks use MySQL credentials.
  const hasOpenMysqlPort = machine.remoteMachine.ports.some(
    (p) => p.open && p.port === 3306 && p.service === 'mysql',
  );
  let mysqlDb: GenerateDatabaseResult | undefined;
  if (hasOpenMysqlPort) {
    const dbUsernames = users.filter((u) => u.userType !== 'guest').map((u) => u.username);
    // For db_* mission targets, use the pre-enriched database from the objective builder
    if (isTarget && options.dbEnrichment) {
      mysqlDb = { database: options.dbEnrichment.database, plaintextCredentials: [] };
    } else {
      mysqlDb = generateDatabase(prng, dbUsernames);
    }
  }

  // ~30% chance to place a careless user's credentials in a guest-readable location.
  // DB-themed leak templates use MySQL credentials when available.
  const mysqlPlaintextCreds = mysqlDb?.plaintextCredentials;
  placeCredentialLeak(prng, machineCreds, mysqlPlaintextCreds, extraDirectories, etcExtraContent);

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

  // Write MySQL database file as /var/lib/mysql/data.json
  if (hasOpenMysqlPort && mysqlDb) {
    const mysqlDir = mkDir(
      'mysql',
      { 'data.json': mkFile('data.json', JSON.stringify(mysqlDb.database), 'root') },
      'root',
      false,
    );
    // Merge into /var/lib/ — avoid overwriting existing /var/ from web content
    if (extraDirectories['var']) {
      const varNode = extraDirectories['var'];
      if (varNode.type === 'directory' && varNode.children) {
        const libDir = mkDir('lib', { mysql: mysqlDir }, 'root', false);
        (varNode.children as Record<string, FileNode>)['lib'] = libDir;
      }
    } else {
      extraDirectories['var'] = mkDir(
        'var',
        { lib: mkDir('lib', { mysql: mysqlDir }, 'root', false) },
        'root',
        false,
      );
    }
  }

  // Write Redis data and config for machines with an open Redis port.
  const hasOpenRedisPort = machine.remoteMachine.ports.some(
    (p) => p.open && p.port === 6379 && p.service === 'redis',
  );
  if (hasOpenRedisPort) {
    const redisUsernames = users.filter((u) => u.userType !== 'guest').map((u) => u.username);
    const redisData = generateRedisData(prng, redisUsernames);

    // /var/lib/redis/data.json
    const redisDir = mkDir(
      'redis',
      { 'data.json': mkFile('data.json', JSON.stringify(redisData.keys), 'root') },
      'root',
      false,
    );
    if (extraDirectories['var']) {
      const varNode = extraDirectories['var'];
      if (varNode.type === 'directory' && varNode.children) {
        const existingLib = varNode.children['lib'];
        if (existingLib?.type === 'directory' && existingLib.children) {
          (existingLib.children as Record<string, FileNode>)['redis'] = redisDir;
        } else {
          (varNode.children as Record<string, FileNode>)['lib'] = mkDir(
            'lib',
            { redis: redisDir },
            'root',
            false,
          );
        }
      }
    } else {
      extraDirectories['var'] = mkDir(
        'var',
        { lib: mkDir('lib', { redis: redisDir }, 'root', false) },
        'root',
        false,
      );
    }

    // /etc/redis/redis.conf
    const redisConfLines = [
      '# Redis configuration file',
      'bind 0.0.0.0',
      'port 6379',
      'daemonize yes',
      'pidfile /var/run/redis.pid',
      'logfile /var/log/redis.log',
      'dir /var/lib/redis',
      ...(redisData.requirepass ? [`requirepass ${redisData.requirepass}`] : []),
    ];
    etcExtraContent['redis'] = mkDir(
      'redis',
      { 'redis.conf': mkFile('redis.conf', redisConfLines.join('\n'), 'root') },
      'root',
      true,
    );
  }

  // Daemon PID files for all services with ports on this machine.
  // SSH/FTP use their existing PID file factories. Infrastructure services
  // (nginx, mysql, etc.) get simple PID files so `ps` can show them as running.
  const hasSshPort = machine.remoteMachine.ports.some((p) => p.service === 'ssh');
  const hasFtpPort = machine.remoteMachine.ports.some((p) => p.service === 'ftp');
  const infraPidFiles = buildInfrastructurePidFiles(machine.remoteMachine.ports);

  // Malware PID file: placed on target machine so `ps` shows the malware process
  const malwarePidFile =
    isTarget && objective?.type === 'malware' && objective.malwarePidName && objective.targetPath
      ? {
          [objective.malwarePidName]: mkFile(
            objective.malwarePidName,
            `${objective.targetPath}:port=1`,
            'root',
          ),
        }
      : {};

  const hasPidFiles =
    hasSshPort ||
    hasFtpPort ||
    Object.keys(infraPidFiles).length > 0 ||
    Object.keys(malwarePidFile).length > 0;
  const varRunContent = hasPidFiles
    ? {
        ...(hasSshPort ? { [SSH_PID_FILE_NAME]: createSshdPidFileNode() } : {}),
        ...(hasFtpPort ? { [FTP_PID_FILE_NAME]: createVsftpdPidFileNode() } : {}),
        ...infraPidFiles,
        ...malwarePidFile,
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
  return {
    ...config,
    extraDirectories: mergeFileNodeChildren(config.extraDirectories ?? {}, {
      [keyTree.topDir]: keyTree.node,
    }),
  };
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

type FilesystemResult = {
  readonly fileSystems: Readonly<Record<string, FileNode>>;
  readonly basicSnmpGatewayIps: ReadonlySet<string>;
};

export const generateFileSystems = (input: FilesystemInput): FilesystemResult => {
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
    dbEnrichment,
  } = input;

  // Build maps from inner gateway IP → downstream layer info (machines, NAT, subnet).
  // Gateways need downstream machines for /etc/hosts, NAT forwarding for iptables,
  // and downstream subnet for switch ACL rules.
  const gatewayDownstreamMap = new Map<string, readonly GeneratedMachine[]>();
  const gatewayNatMap = new Map<string, NatForwarding | undefined>();
  const gatewaySubnetMap = new Map<string, string>();
  if (layers && layers.length > 1) {
    layers.slice(1).forEach((layer, i) => {
      const downstreamIps = new Set(layer.machines.map((m) => m.ip));
      const downstreamMachines = machines.filter((m) => downstreamIps.has(m.ip));
      // Include the next layer's gateway (dual-homed in this subnet) so it
      // appears in /etc/hosts and is reachable via nmap from this layer.
      const nextLayer = layers[i + 2]; // i is offset by 1 from slice(1)
      const nextGateway = nextLayer
        ? machines.find((m) => m.ip === nextLayer.gateway.ip)
        : undefined;
      const allDownstream = nextGateway ? [...downstreamMachines, nextGateway] : downstreamMachines;
      gatewayDownstreamMap.set(layer.gateway.ip, allDownstream);
      gatewayNatMap.set(layer.gateway.ip, layer.natForwarding);
      gatewaySubnetMap.set(layer.gateway.ip, layer.subnet);
    });
  }

  // Pre-generate SNMP configs for inner gateways. Three tiers:
  // 1. Full SNMP-variant: rw community, credential leaks, firewall/ACL OIDs
  // 2. Basic read-write: rw community + firewall/ACL OIDs, no credential leaks (~30% of basic)
  // 3. Basic read-only: rocommunity public, interface OIDs only (~70% of basic)
  // Non-SNMP gateways get a PRNG roll for basic SNMP. Within basic, a second roll
  // decides read-only vs read-write. All rolls are always consumed for PRNG stability.
  const basicSnmpThreshold = difficulty === 'easy' ? 0.8 : difficulty === 'medium' ? 0.6 : 0.4;
  const BASIC_RW_CHANCE = 0.3;
  const gatewaySnmpConfigs = new Map<string, string>();
  const basicSnmpGatewayIps = new Set<string>();
  if (layers && layers.length > 1) {
    layers.slice(1).forEach((layer) => {
      const basicSnmpRoll = prng.next();
      const basicRwRoll = prng.next();
      const secondaryIp = `${layer.subnet}.1`;
      if (layer.gateway.accessVariant === 'snmp') {
        const gatewayCreds = credentials[layer.gateway.ip] ?? [];
        const snmpConfigFn =
          layer.gatewayType === 'switch' ? generateSwitchSnmpConfig : generateSnmpConfig;
        gatewaySnmpConfigs.set(
          layer.gateway.ip,
          snmpConfigFn(prng, layer.gateway, gatewayCreds, secondaryIp),
        );
      } else if (basicSnmpRoll < basicSnmpThreshold) {
        const isSwitch = layer.gatewayType === 'switch';
        if (basicRwRoll < BASIC_RW_CHANCE) {
          // Basic read-write: rw community + firewall/ACL OIDs, no credential leaks
          gatewaySnmpConfigs.set(
            layer.gateway.ip,
            generateBasicRwSnmpConfig(
              prng,
              layer.gateway.hostname,
              layer.gateway.ip,
              secondaryIp,
              isSwitch,
            ),
          );
        } else {
          // Basic read-only: interface discovery only
          gatewaySnmpConfigs.set(
            layer.gateway.ip,
            generateBasicSnmpConfig(
              layer.gateway.hostname,
              layer.gateway.ip,
              secondaryIp,
              isSwitch,
            ),
          );
        }
        basicSnmpGatewayIps.add(layer.gateway.ip);
      }
    });
  }

  // Pre-generate DNS zone configs for dns-role machines. Each DNS machine gets
  // zone records for its own layer + all downstream layers (cross-layer recon).
  // AXFR probability: easy 80%, medium 60%, hard 40% — same pattern as basic SNMP.
  const axfrThreshold = difficulty === 'easy' ? 0.8 : difficulty === 'medium' ? 0.6 : 0.4;
  const dnsConfigs = new Map<
    string,
    { readonly zoneContent: string; readonly namedConf: string }
  >();
  if (layers) {
    const machineLayerIndex = new Map<string, number>();
    layers.forEach((layer, i) => {
      layer.machines.forEach((m) => machineLayerIndex.set(m.ip, i));
      if (i > 0) machineLayerIndex.set(layer.gateway.ip, i - 1);
    });

    machines.forEach((machine) => {
      if (machine.role !== 'dns') return;

      const layerIdx = machineLayerIndex.get(machine.ip) ?? 0;
      const zoneRecords = layers.flatMap((layer, i) => {
        if (i < layerIdx) return [];
        const records = layer.machines.map((m) => ({
          domain: `${m.hostname}.mission`,
          ip: m.ip,
          type: 'A' as const,
        }));
        if (i > layerIdx) {
          records.push({
            domain: `${layer.gateway.hostname}.mission`,
            ip: layer.gateway.ip,
            type: 'A' as const,
          });
        }
        return records;
      });

      const upstreamGatewayIp = `${layers[layerIdx]!.subnet}.1`;
      const upstreamGateway = layerIdx === 0 ? routerMachine : layers[layerIdx]!.gateway;
      if (upstreamGateway && !zoneRecords.some((r) => r.ip === upstreamGateway.ip)) {
        zoneRecords.push({
          domain: `${upstreamGateway.hostname}.mission`,
          ip: upstreamGatewayIp,
          type: 'A' as const,
        });
      }

      const axfrRoll = prng.next();
      const allowAxfr = axfrRoll < axfrThreshold;

      dnsConfigs.set(machine.ip, {
        zoneContent: generateDnsZoneContent(machine.hostname, zoneRecords),
        namedConf: generateDnsNamedConf('mission', allowAxfr),
      });
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
      dbEnrichment: isTarget ? dbEnrichment : undefined,
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

    // DNS role: add /etc/bind/ with named.conf and zone file
    const dnsConfig = dnsConfigs.get(machine.ip);
    const configWithDns = dnsConfig
      ? {
          ...configWithSnmp,
          etcExtraContent: {
            ...configWithSnmp.etcExtraContent,
            bind: mkDir(
              'bind',
              {
                'named.conf': mkFile('named.conf', dnsConfig.namedConf, 'root'),
                zones: mkDir(
                  'zones',
                  { 'db.mission': mkFile('db.mission', dnsConfig.zoneContent, 'root') },
                  'root',
                  true,
                ),
              },
              'root',
              true,
            ),
          },
        }
      : configWithSnmp;

    // Place encryption key file on the key machine (if this is that machine)
    const keyTree =
      objective.keyPlacement?.machineIp === machine.ip ? buildKeyFileTree(prng, objective) : null;
    const configWithKey = mergeKeyPlacement(configWithDns, keyTree);

    // Merge forensics evidence (log files, calling card) if present for this machine
    const evidence = forensicsEvidence[machine.ip];
    const configWithEvidence = evidence
      ? {
          ...configWithKey,
          extraDirectories: mergeFileNodeChildren(configWithKey.extraDirectories ?? {}, evidence),
        }
      : configWithKey;

    // script_auto: place data file on target (local) or API JSON on API machine (remote)
    const config = mergeScriptAutoData(machine, objective, configWithEvidence);

    const fileSystem = createFileSystem(config);

    return [machine.ip, fileSystem] as const;
  });

  // Generate router filesystem with hints about internal machines
  // Border router only sees layer 0 machines + the first inner gateway (not all layers)
  if (routerMachine) {
    const routerUsers = usersByMachine[routerMachine.ip] ?? [];
    const routerCreds = credentials[routerMachine.ip] ?? [];

    const routerVisibleMachines =
      layers && layers.length > 0
        ? [
            ...machines.filter((m) => layers[0]!.machines.some((lm) => lm.ip === m.ip)),
            ...(layers.length > 1 ? machines.filter((m) => m.ip === layers[1]!.gateway.ip) : []),
          ]
        : machines;

    const baseRouterConfig = buildMachineConfig(prng, routerMachine, routerUsers, routerCreds, {
      objective,
      internalMachines: routerVisibleMachines,
      natForwarding,
    });

    // Place encryption key on router if it's the key machine
    const routerKeyTree =
      objective.keyPlacement?.machineIp === routerMachine.ip
        ? buildKeyFileTree(prng, objective)
        : null;
    const routerConfigWithKey = mergeKeyPlacement(baseRouterConfig, routerKeyTree);

    // SNMP variant: add /etc/snmp/snmpd.conf with community strings, OIDs, credentials
    const routerSecondaryIp = layers?.[0] ? `${layers[0].subnet}.1` : undefined;
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
                    generateSnmpConfig(prng, routerMachine, routerCreds, routerSecondaryIp),
                  ),
                },
                'root',
                true,
              ),
            },
          }
        : routerConfigWithKey;

    const routerFs = createFileSystem(routerConfig);
    const allEntries: (readonly [string, FileNode])[] = [...entries, [routerMachine.ip, routerFs]];

    // Alias gateway filesystems under their downstream .1 IPs so commands like
    // curl can read from gateways when addressed by their internal subnet IP.
    // Border router: layer 0's .1 → router filesystem.
    // Inner gateways: each layer's .1 → that layer's gateway filesystem.
    if (layers && layers.length > 0) {
      const routerAliasIp = `${layers[0]!.subnet}.1`;
      allEntries.push([routerAliasIp, routerFs]);

      layers.slice(1).forEach((layer) => {
        const gatewayFs = allEntries.find(([ip]) => ip === layer.gateway.ip)?.[1];
        if (gatewayFs) {
          allEntries.push([`${layer.subnet}.1`, gatewayFs]);
        }
      });
    }

    return {
      fileSystems: Object.fromEntries(allEntries),
      basicSnmpGatewayIps,
    };
  }

  return { fileSystems: Object.fromEntries(entries), basicSnmpGatewayIps };
};
