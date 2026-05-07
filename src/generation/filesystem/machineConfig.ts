import type { Prng } from '../prng';
import type { GeneratedMachine, MachineRole, MissionObjective, NatForwarding } from '../types';
import type { FileNode } from '../../filesystem/types';
import type { GeneratedUser } from '../types';
import type { MachineFileSystemConfig, UserConfig } from '../../filesystem/fileSystemFactory';
import {
  configTemplatesByRole,
  noiseFiles,
  redHerringFiles,
  webContentTemplatesByRole,
} from '../pools';
import { wrapInBinaryNoise } from '../binary';
import { buildInitialDpkgStatus } from '../../network/dpkgStatus';
import { firmwareTemplates } from '../pools/routerFirmware';
import { formatVersion } from '../pools/serviceTemplates';
import { SYSTEM_LIBRARIES, systemLibraryTemplates } from '../pools/systemLibraryTemplates';
import {
  createBinaryEntries,
  createLibraryEntries,
  SYSTEM_UTILITY_NAMES,
  SBIN_UTILITY_NAMES,
} from '../../commands/availability';
import { SSH_PID_FILE_NAME, createSshdPidFileNode } from '../../commands/sshd';
import { FTP_PID_FILE_NAME, createVsftpdPidFileNode } from '../../commands/vsftpd';
import { mkFile, mkScript, mkDir, fillTemplate, findLeafDir, buildNestedDirs } from './helpers';
import { generateIptablesContent, generateAclContent } from './networkConfig';
import {
  generateDatabase,
  type DbEnrichment,
  type GenerateDatabaseResult,
} from '../generateDatabase';
import { generateRedisData } from '../generateRedisData';
import { generateFtpVirtualUsers, formatVirtualUsersConf } from '../ftpCredentials';
import type { SameLayerCredential } from './sameLayerCredentials';
import { buildInfrastructurePidFiles } from './infraPidFiles';
import {
  placeCredentialLeak,
  placeCrossMachineCredentialLeak,
  placeWebCredentials,
  placeHttpEntryCredentials,
} from './credentialPlacement';
import { generateLogsByFile } from './logGeneration';

// Precomputed once at module load. Every machine shares the same day-zero
// library versions + library file entries, so we avoid paying the cost
// per-machine inside the hot generation path.
const INITIAL_LIBRARY_VERSIONS: Readonly<Record<string, string>> = Object.fromEntries(
  SYSTEM_LIBRARIES.map((lib) => [
    lib,
    formatVersion(systemLibraryTemplates[lib], systemLibraryTemplates[lib].startTuple),
  ]),
);

const INITIAL_LIBRARY_CONTENT = createLibraryEntries(SYSTEM_LIBRARIES);

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
  readonly isFtpEntry?: boolean;
  readonly downstreamSubnet?: string;
  readonly dbEnrichment?: DbEnrichment;
  readonly sameLayerCredentials?: readonly SameLayerCredential[];
};

export const buildMachineConfig = (
  prng: Prng,
  machine: GeneratedMachine,
  users: readonly GeneratedUser[],
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
  const logsByFile = generateLogsByFile(prng, machine, users);
  const varLogContent: Record<string, FileNode> = Object.fromEntries(
    Object.entries(logsByFile).map(([filename, content]) => [
      filename,
      mkFile(filename, content, 'guest'),
    ]),
  );

  // Routers get iptables-format lines appended to kern.log (matches real Linux
  // behaviour where netfilter LOG target writes to kern.log). This augments
  // the generic kernel lines that generateLogsByFile already seeded.
  if (machine.role === 'router') {
    const fwLines = Array.from({ length: prng.nextInt(6, 12) }, () => {
      const srcIp = `10.${prng.nextInt(1, 254)}.${prng.nextInt(1, 254)}.${prng.nextInt(10, 20)}`;
      const dstPort = prng.pick([22, 80, 443, 3306, 8080]);
      const action = prng.pick(['ACCEPT', 'ACCEPT', 'DROP']);
      return `Jan ${prng.nextInt(1, 28)} ${prng.nextInt(0, 23).toString().padStart(2, '0')}:${prng.nextInt(0, 59).toString().padStart(2, '0')}:${prng.nextInt(0, 59).toString().padStart(2, '0')} kernel: [iptables] ${action} IN=eth0 OUT=eth1 SRC=${srcIp} DST=${machine.ip} PROTO=TCP DPT=${dstPort}`;
    });
    const existingKern = logsByFile['kern.log'] ?? '';
    const combined = existingKern ? `${existingKern}\n${fwLines.join('\n')}` : fwLines.join('\n');
    varLogContent['kern.log'] = mkFile('kern.log', combined, 'guest');
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

  // ~30% chance to place a cross-machine credential leak referencing a same-layer peer.
  // Not placed on target machines (target shouldn't leak credentials for other machines).
  const ownerUser = users.find((u) => u.userType === 'user');
  placeCrossMachineCredentialLeak(
    prng,
    isTarget ? [] : (options.sameLayerCredentials ?? []),
    ownerUser?.username ?? 'user',
    extraDirectories,
    etcExtraContent,
  );

  // FTP virtual users: separate FTP credentials stored in /etc/vsftpd/virtual_users.conf.
  // FTP-entry machines always get virtual users. Other machines with FTP open get
  // them ~40% of the time. Always consume the PRNG roll for sequence stability.
  const hasFtpOpen = machine.remoteMachine.ports.some(
    (p) => p.open && p.port === 21 && p.service === 'ftp',
  );
  const ftpVirtualRoll = prng.next();
  if (hasFtpOpen && (options.isFtpEntry || ftpVirtualRoll < 0.4)) {
    const ftpVirtualUsers = generateFtpVirtualUsers(prng, users);
    const confContent = formatVirtualUsersConf(ftpVirtualUsers);
    etcExtraContent['vsftpd'] = mkDir(
      'vsftpd',
      { 'virtual_users.conf': mkFile('virtual_users.conf', confContent, 'root') },
      'root',
      true,
    );
  }

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
    // Non-entry web machines: ~30% chance to expose same-machine credentials via curl/gobuster.
    if (isHttpEntry) {
      placeHttpEntryCredentials(prng, machineCreds, htmlChildren);
    } else {
      placeWebCredentials(prng, machineCreds, htmlChildren);
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
  // Only create PID files for ports that are actually open — closed ports
  // (from applyPortClosures) should not have running daemons.
  const hasSshPort = machine.remoteMachine.ports.some((p) => p.service === 'ssh' && p.open);
  const hasFtpPort = machine.remoteMachine.ports.some((p) => p.service === 'ftp' && p.open);
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

  // Seed /var/lib/dpkg/status with one entry per unique running service.
  // Real Debian/Ubuntu machines have this file tracking installed package
  // versions; in the game it also acts as the overlay source read by
  // applyVersionOverlay so nmap/msfconsole see any upgrades the player
  // performs via `apt upgrade`.
  //
  // Placed LAST in the machineConfig flow so it survives earlier /var
  // overwrites (web content at ~L803 wholesale-replaces extraDirectories['var']
  // for webservers; MySQL/Redis data paths do similar).
  // Routers get an additional `firmware` package seeded with the vendor's
  // starting-tuple version. Non-routers pass undefined and the helper omits
  // the firmware entry entirely.
  const vendor = machine.remoteMachine.firmwareVendor;
  const initialFirmwareVersion =
    vendor && firmwareTemplates[vendor]
      ? formatVersion(firmwareTemplates[vendor], firmwareTemplates[vendor].startTuple)
      : undefined;
  // Every machine starts with every system library at its template's
  // startTuple version — uniform day-zero state per the patch-delay design.
  const initialLibraryVersions = INITIAL_LIBRARY_VERSIONS;
  const dpkgStatusContent = buildInitialDpkgStatus(
    machine.remoteMachine.ports,
    initialFirmwareVersion,
    initialLibraryVersions,
  );
  if (dpkgStatusContent.length > 0) {
    const statusFile = mkFile('status', dpkgStatusContent, 'guest');
    const existingVar = extraDirectories['var'];
    if (existingVar && existingVar.type === 'directory' && existingVar.children) {
      const varChildren = existingVar.children as Record<string, FileNode>;
      const existingLib = varChildren['lib'];
      if (existingLib && existingLib.type === 'directory' && existingLib.children) {
        // Merge into existing /var/lib/
        const libChildren = existingLib.children as Record<string, FileNode>;
        const existingDpkg = libChildren['dpkg'];
        if (existingDpkg && existingDpkg.type === 'directory' && existingDpkg.children) {
          (existingDpkg.children as Record<string, FileNode>)['status'] = statusFile;
        } else {
          libChildren['dpkg'] = mkDir('dpkg', { status: statusFile }, 'root', true);
        }
      } else {
        varChildren['lib'] = mkDir(
          'lib',
          { dpkg: mkDir('dpkg', { status: statusFile }, 'root', true) },
          'root',
          true,
        );
      }
    } else {
      extraDirectories['var'] = buildNestedDirs(['var', 'lib', 'dpkg', 'status'], statusFile);
    }
  }

  return {
    users: userConfigs,
    rootContent,
    varLogContent,
    varRunContent,
    etcExtraContent,
    extraDirectories: Object.keys(extraDirectories).length > 0 ? extraDirectories : undefined,
    binContent: createBinaryEntries(SYSTEM_UTILITY_NAMES),
    usrSbinContent: createBinaryEntries(SBIN_UTILITY_NAMES),
    libContent: INITIAL_LIBRARY_CONTENT,
    passwdReadableBy: ['root', 'user'],
  };
};
