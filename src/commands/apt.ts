import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { FileNode, FilePermissions } from '../filesystem/types';
import type { PermissionResult } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import type { RemoteMachine } from '../network/types';
import { APT_PACKAGES, APT_INSTALLABLE, BINARY_STUB, RESTRICTED_EXECUTE } from './availability';
import { createCancellationToken, jitter } from '../utils/asyncCommand';
import { findVulnForService, defaultServiceVersion } from '../generation/pools/vulnerabilities';
import { serviceVersionOverlayPath } from '../network/applyVersionOverlay';

type AptContext = {
  readonly getMachine: () => string;
  readonly getCurrentMachine?: () => RemoteMachine | undefined;
  readonly getNode: (path: string) => FileNode | null;
  readonly createFile: (
    path: string,
    content: string,
    userType: UserType,
    permissions?: FilePermissions,
  ) => PermissionResult;
  readonly writeFile?: (path: string, content: string, userType: UserType) => PermissionResult;
  readonly getUserType: () => UserType;
  readonly isWifiConnected: () => boolean;
};

const formatInstalledStatus = (
  name: string,
  getNode: (path: string) => FileNode | null,
): string => {
  const pkg = APT_PACKAGES.find((p) => p.name === name);
  const firstBinary = pkg?.binaries?.[0] ?? name;
  return getNode(`/usr/bin/${firstBinary}`) !== null ? '[installed]' : '[not installed]';
};

const handleList = (
  getNode: (path: string) => FileNode | null,
  args: readonly unknown[],
): string => {
  const showInstalled = args[0] === '--installed' || args[0] === '-i';

  const lines = APT_PACKAGES.map((pkg) => {
    const status = formatInstalledStatus(pkg.name, getNode);
    return `  ${pkg.name.padEnd(12)} ${pkg.version.padEnd(10)} ${status.padEnd(16)} ${pkg.description}`;
  });

  if (showInstalled) {
    const installedLines = APT_PACKAGES.filter(
      (pkg) => formatInstalledStatus(pkg.name, getNode) === '[installed]',
    ).map(
      (pkg) =>
        `  ${pkg.name.padEnd(12)} ${pkg.version.padEnd(10)} ${'[installed]'.padEnd(16)} ${pkg.description}`,
    );
    return ['Listing installed packages...', '', ...installedLines].join('\n');
  }

  return ['Listing all packages...', '', ...lines].join('\n');
};

const handleInstall = (packageName: string, context: AptContext): AsyncOutput | string => {
  const { getMachine, getNode, createFile, getUserType, isWifiConnected } = context;
  const machine = getMachine();

  if (machine === 'localhost' && !isWifiConnected()) {
    throw new Error('E: Failed to fetch http://archive.ubuntu.com — network is unreachable');
  }

  if (getUserType() !== 'root') {
    throw new Error('E: Could not open lock file /var/lib/dpkg/lock-frontend — are you root?');
  }

  if (!APT_INSTALLABLE.has(packageName)) {
    throw new Error(`E: Unable to locate package ${packageName}`);
  }

  const pkg = APT_PACKAGES.find((p) => p.name === packageName);
  const allBinaries = pkg?.binaries ?? [packageName];

  // Only install binaries/extra files that don't already exist
  const binaries = allBinaries.filter((b) => getNode(`/usr/bin/${b}`) === null);
  const extraFiles = (pkg?.extraFiles ?? []).filter((f) => getNode(f.path) === null);

  if (binaries.length === 0 && extraFiles.length === 0) {
    const version = pkg?.version ?? '1.0.0';
    return `${packageName} is already the newest version (${version}).\n0 upgraded, 0 newly installed, 0 to remove.`;
  }
  const version = pkg?.version ?? '1.0.0';
  const sizeKb = Math.floor(Math.random() * 3000) + 500;

  const token = createCancellationToken();

  return {
    __type: 'async',
    start: (onLine, onComplete) => {
      const lines = [
        'Reading package lists... Done',
        'Building dependency tree... Done',
        `The following NEW packages will be installed:`,
        `  ${packageName}`,
        `0 upgraded, 1 newly installed, 0 to remove`,
        `Get:1 http://archive.ubuntu.com/ubuntu ${packageName} ${version} [${sizeKb.toLocaleString()} kB]`,
        `Fetched ${sizeKb.toLocaleString()} kB in 2s (${Math.floor(sizeKb / 2).toLocaleString()} kB/s)`,
        `Setting up ${packageName} (${version}) ...`,
        `Processing triggers for man-db ...`,
      ];

      let delay = 0;

      lines.forEach((line, i) => {
        delay += jitter(200);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine(line);

          if (i === lines.length - 1) {
            for (const binary of binaries) {
              const binaryPermissions: FilePermissions = {
                read: ['root', 'user', 'guest'],
                write: ['root'],
                execute: RESTRICTED_EXECUTE[binary] ?? ['root', 'user', 'guest'],
              };
              createFile(`/usr/bin/${binary}`, BINARY_STUB, 'root', binaryPermissions);
            }

            const extraFilePermissions: FilePermissions = {
              read: ['root', 'user', 'guest'],
              write: ['root'],
              execute: [],
            };
            for (const extra of extraFiles) {
              createFile(extra.path, extra.content, 'root', extraFilePermissions);
            }

            onComplete();
          }
        }, delay);
      });
    },
    cancel: token.cancel,
  };
};

// --- apt upgrade ---

// Overlay files are root-owned and world-readable. Matches real Linux
// /var/lib/dpkg/status and similar package-metadata file permissions.
const OVERLAY_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: [],
};

const OVERLAY_DELAY_MS = 250;

// In Phase 3 PR A (no version timeline yet), every upgrade targets the
// default "safe" sentinel version. Phase 3 PR B replaces this with
// timeline-based selection of the latest version whose CVE is still
// future-dated relative to the current gameTime.
const pickUpgradeTarget = (service: string): string => defaultServiceVersion(service);

const isVulnerable = (service: string, version: string): boolean =>
  findVulnForService(service, version) !== undefined;

type UpgradeCandidate = {
  readonly service: string;
  readonly targetVersion: string;
};

const collectUpgradeCandidates = (
  machine: RemoteMachine,
  serviceFilter: string | undefined,
): readonly UpgradeCandidate[] => {
  const seen = new Set<string>();
  const candidates: UpgradeCandidate[] = [];
  for (const port of machine.ports) {
    if (seen.has(port.service)) continue;
    if (serviceFilter !== undefined && port.service !== serviceFilter) continue;
    if (!isVulnerable(port.service, port.serviceVersion)) continue;
    seen.add(port.service);
    candidates.push({ service: port.service, targetVersion: pickUpgradeTarget(port.service) });
  }
  return candidates;
};

// Returns the set of services currently running on the machine (one entry per
// unique service across all ports). Used by `apt upgrade <service>` to decide
// whether the named service exists before computing upgrade candidates.
const runningServices = (machine: RemoteMachine): ReadonlySet<string> =>
  new Set(machine.ports.map((p) => p.service));

const handleUpgrade = (
  serviceFilter: string | undefined,
  context: AptContext,
): AsyncOutput | string => {
  const { getMachine, getCurrentMachine, createFile, getUserType, isWifiConnected } = context;
  const machineId = getMachine();

  if (machineId === 'localhost' && !isWifiConnected()) {
    throw new Error('E: Failed to fetch http://archive.ubuntu.com — network is unreachable');
  }

  if (getUserType() !== 'root') {
    throw new Error('E: Could not open lock file /var/lib/dpkg/lock-frontend — are you root?');
  }

  const machine = getCurrentMachine?.();
  if (!machine) {
    // No machine data available — nothing to upgrade.
    return '0 upgraded, 0 newly installed, 0 to remove.';
  }

  if (serviceFilter !== undefined && !runningServices(machine).has(serviceFilter)) {
    throw new Error(`E: Service '${serviceFilter}' is not running on this machine`);
  }

  const candidates = collectUpgradeCandidates(machine, serviceFilter);

  if (candidates.length === 0) {
    return [
      'Reading package lists... Done',
      'Building dependency tree... Done',
      'Calculating upgrade... Done',
      '0 upgraded, 0 newly installed, 0 to remove.',
    ].join('\n');
  }

  const token = createCancellationToken();

  return {
    __type: 'async',
    start: (onLine, onComplete) => {
      const headerLines = [
        'Reading package lists... Done',
        'Building dependency tree... Done',
        'Calculating upgrade... Done',
        'The following packages will be upgraded:',
        `  ${candidates.map((c) => c.service).join(' ')}`,
        `${candidates.length} upgraded, 0 newly installed, 0 to remove.`,
      ];
      const setupLines = candidates.flatMap((c) => [
        `Get: ${c.service} ${c.targetVersion}`,
        `Setting up ${c.service} (${c.targetVersion}) ...`,
      ]);
      const lines = [...headerLines, ...setupLines];

      let delay = 0;
      lines.forEach((line, i) => {
        delay += jitter(OVERLAY_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine(line);
          if (i === lines.length - 1) {
            // Write the overlay files for every candidate at completion.
            for (const candidate of candidates) {
              createFile(
                serviceVersionOverlayPath(candidate.service),
                candidate.targetVersion,
                'root',
                OVERLAY_PERMISSIONS,
              );
            }
            onComplete();
          }
        }, delay);
      });
    },
    cancel: token.cancel,
  };
};

export const createAptCommand = (context: AptContext): Command => ({
  name: 'apt',
  category: 'general',
  description: 'Package manager — install hacking tools',
  manual: {
    synopsis: "apt('install', packageName) | apt('list', ['-i'])",
    description:
      'Advanced package tool for installing hacking utilities. ' +
      'Tools like nmap, john, hydra, and nc must be installed before use. ' +
      'Requires root privileges and network connectivity to install.',
    arguments: [
      { name: 'subcommand', description: "'install' or 'list'", required: true },
      {
        name: 'package/flag',
        description: "Package name for install, or '-i'/'--installed' for list",
        required: false,
      },
    ],
    examples: [
      { command: "apt('install', 'nmap')", description: 'Install nmap on the current machine' },
      { command: "apt('list')", description: 'List all available packages' },
      {
        command: "apt('list', '-i')",
        description: 'List only installed packages',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput | string => {
    const subcommand = args[0] as string | undefined;

    if (!subcommand) {
      throw new Error(
        [
          'apt: missing subcommand',
          'Usage: apt(subcommand, [args])',
          '',
          'Subcommands:',
          "  apt('install', '<package>')  Install a package",
          "  apt('list')                  List available packages",
          "  apt('list', '-i')            List installed packages",
        ].join('\n'),
      );
    }

    if (subcommand === 'list') {
      return handleList(context.getNode, args.slice(1));
    }

    if (subcommand === 'install') {
      const packageName = args[1] as string | undefined;
      if (!packageName) {
        throw new Error("E: No package name specified. Usage: apt('install', '<package>')");
      }
      return handleInstall(packageName, context);
    }

    if (subcommand === 'upgrade') {
      const serviceFilter = args[1] as string | undefined;
      return handleUpgrade(serviceFilter, context);
    }

    throw new Error(
      `E: Invalid operation '${subcommand}'. Usage: apt('install', '<package>'), apt('upgrade'), or apt('list')`,
    );
  },
});
