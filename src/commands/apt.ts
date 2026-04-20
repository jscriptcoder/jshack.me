import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { FileNode, FilePermissions } from '../filesystem/types';
import type { PermissionResult } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import type { RemoteMachine } from '../network/types';
import { APT_PACKAGES, APT_INSTALLABLE, BINARY_STUB, RESTRICTED_EXECUTE } from './availability';
import { createCancellationToken, jitter } from '../utils/asyncCommand';
import { findVulnForService, findPinnableServiceVersion } from '../generation/vulnerabilityLookup';
import {
  findFirmwareCve,
  findLatestSafeFirmware,
  findPinnableFirmwareVersion,
} from '../generation/firmwareLookup';
import { firmwareTemplates, type FirmwareVendor } from '../generation/pools/routerFirmware';
import { serviceTemplates } from '../generation/pools/serviceTemplates';
import {
  CVE_TIMING_CONFIG,
  DEFAULT_LATEST_VERSION,
  findLatestSafeVersion,
} from '../generation/timeline';
import { DPKG_STATUS_PATH, setDpkgVersion } from '../network/dpkgStatus';

type AptContext = {
  readonly getMachine: () => string;
  readonly getCurrentMachine?: () => RemoteMachine | undefined;
  readonly getNode: (path: string) => FileNode | null;
  readonly readFile?: (path: string) => string | null;
  readonly createFile: (
    path: string,
    content: string,
    userType: UserType,
    permissions?: FilePermissions,
  ) => PermissionResult;
  readonly writeFile?: (path: string, content: string, userType: UserType) => PermissionResult;
  readonly getUserType: () => UserType;
  readonly isWifiConnected: () => boolean;
  readonly getGameTime?: () => number;
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

// Matches real Linux /var/lib/dpkg/status permissions: root-owned, world
// readable, no execute.
const DPKG_STATUS_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: [],
};

const OVERLAY_DELAY_MS = 250;

// Average patch delay in days, displayed to the player as an ETA hint
// when a service is in its patch-delay gap. Uses the config midpoint so
// the value is stable regardless of which specific CVE is involved.
const AVG_PATCH_DELAY_DAYS = Math.round(
  (CVE_TIMING_CONFIG.minPatchDelayDays + CVE_TIMING_CONFIG.maxPatchDelayDays) / 2,
);

// Upgrade target resolution for a single vulnerable service/firmware:
//   - target: a concrete version string is available, proceed with upgrade
//   - no-fix-yet: the service is vulnerable but its fix is still inside the
//     patch-delay gap; we emit a warning line instead of upgrading
//   - no-template: the service has no procedural template (unknown to the
//     pool). Falls back to the DEFAULT_LATEST_VERSION sentinel — preserves
//     prior behaviour so apt still writes a dpkg entry for such packages.
type UpgradeTarget =
  | { readonly kind: 'target'; readonly version: string }
  | { readonly kind: 'no-fix-yet' }
  | { readonly kind: 'no-template' };

const pickServiceUpgradeTarget = (service: string, gameTime: number): UpgradeTarget => {
  if (!serviceTemplates[service]) return { kind: 'no-template' };
  const version = findLatestSafeVersion(service, gameTime, CVE_TIMING_CONFIG);
  if (version === undefined) return { kind: 'no-fix-yet' };
  return { kind: 'target', version };
};

const pickFirmwareUpgradeTarget = (vendor: FirmwareVendor, gameTime: number): UpgradeTarget => {
  if (!firmwareTemplates[vendor]) return { kind: 'no-template' };
  const version = findLatestSafeFirmware(vendor, gameTime);
  if (version === undefined) return { kind: 'no-fix-yet' };
  return { kind: 'target', version };
};

const isVulnerable = (service: string, version: string, gameTime: number): boolean =>
  findVulnForService(service, version, gameTime) !== undefined;

// A candidate row produced by collectUpgradeCandidates. 'target' rows feed
// the normal upgrade flow; 'no-fix-yet' rows become warning lines.
type UpgradeCandidate =
  | { readonly kind: 'target'; readonly service: string; readonly targetVersion: string }
  | { readonly kind: 'no-fix-yet'; readonly service: string };

const FIRMWARE_PACKAGE = 'firmware';

const resolveServiceCandidate = (service: string, gameTime: number): UpgradeCandidate => {
  const resolved = pickServiceUpgradeTarget(service, gameTime);
  if (resolved.kind === 'no-fix-yet') return { kind: 'no-fix-yet', service };
  const targetVersion = resolved.kind === 'target' ? resolved.version : DEFAULT_LATEST_VERSION;
  return { kind: 'target', service, targetVersion };
};

// Firmware counterpart to resolveServiceCandidate. Note: the 'no-template'
// fallback here is the currently-installed version rather than a sentinel —
// preserves the prior "stay on current firmware" behaviour for unknown vendors.
const resolveFirmwareCandidate = (
  vendor: FirmwareVendor,
  currentVersion: string,
  gameTime: number,
): UpgradeCandidate => {
  const resolved = pickFirmwareUpgradeTarget(vendor, gameTime);
  if (resolved.kind === 'no-fix-yet') return { kind: 'no-fix-yet', service: FIRMWARE_PACKAGE };
  const targetVersion = resolved.kind === 'target' ? resolved.version : currentVersion;
  return { kind: 'target', service: FIRMWARE_PACKAGE, targetVersion };
};

const collectUpgradeCandidates = (
  machine: RemoteMachine,
  serviceFilter: string | undefined,
  gameTime: number,
): readonly UpgradeCandidate[] => {
  const seen = new Set<string>();
  const candidates: UpgradeCandidate[] = [];
  for (const port of machine.ports) {
    if (seen.has(port.service)) continue;
    if (serviceFilter !== undefined && port.service !== serviceFilter) continue;
    if (!isVulnerable(port.service, port.serviceVersion, gameTime)) continue;
    seen.add(port.service);
    candidates.push(resolveServiceCandidate(port.service, gameTime));
  }

  // Router firmware is treated like a package named `firmware`. It's a
  // candidate only when the machine actually has a firmware vendor AND its
  // current firmware version has a live CVE.
  const includeFirmware = serviceFilter === undefined || serviceFilter === FIRMWARE_PACKAGE;
  if (
    includeFirmware &&
    machine.firmwareVendor &&
    machine.firmwareVersion &&
    findFirmwareCve(machine.firmwareVendor as FirmwareVendor, machine.firmwareVersion, gameTime)
  ) {
    candidates.push(
      resolveFirmwareCandidate(
        machine.firmwareVendor as FirmwareVendor,
        machine.firmwareVersion,
        gameTime,
      ),
    );
  }

  return candidates;
};

const formatNoFixWarning = (service: string): string =>
  `W: ${service} is vulnerable but no fix has been released (ETA ~${AVG_PATCH_DELAY_DAYS} day${AVG_PATCH_DELAY_DAYS === 1 ? '' : 's'})`;

// Returns the set of packages currently installed on the machine. Includes
// one entry per unique service across all ports, plus `firmware` if the
// machine is a router. Used by `apt upgrade <package>` to decide whether
// the named package exists before computing upgrade candidates.
const installedPackages = (machine: RemoteMachine): ReadonlySet<string> => {
  const packages = new Set(machine.ports.map((p) => p.service));
  if (machine.firmwareVendor) packages.add(FIRMWARE_PACKAGE);
  return packages;
};

// Writes (or creates) /var/lib/dpkg/status with the given content. Uses the
// existing readFile helper to decide create-vs-write, since createFile rejects
// existing files.
const writeDpkgStatus = (content: string, context: AptContext): void => {
  const { readFile, createFile, writeFile } = context;
  const existing = readFile ? readFile(DPKG_STATUS_PATH) : null;
  if (existing === null) {
    createFile(DPKG_STATUS_PATH, content, 'root', DPKG_STATUS_PERMISSIONS);
  } else if (writeFile) {
    writeFile(DPKG_STATUS_PATH, content, 'root');
  } else {
    // No writeFile available (test contexts may omit it). Fall back to
    // recreating via createFile — harmless in tests that track created files.
    createFile(DPKG_STATUS_PATH, content, 'root', DPKG_STATUS_PERMISSIONS);
  }
};

const handleUpgrade = (
  serviceFilter: string | undefined,
  context: AptContext,
): AsyncOutput | string => {
  const { getMachine, getCurrentMachine, readFile, getUserType, isWifiConnected } = context;
  const gameTime = context.getGameTime?.() ?? 0;
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

  if (serviceFilter !== undefined && !installedPackages(machine).has(serviceFilter)) {
    throw new Error(`E: Package '${serviceFilter}' is not installed on this machine`);
  }

  const allCandidates = collectUpgradeCandidates(machine, serviceFilter, gameTime);
  const targets = allCandidates.filter(
    (c): c is Extract<UpgradeCandidate, { kind: 'target' }> => c.kind === 'target',
  );
  const noFixYet = allCandidates.filter((c) => c.kind === 'no-fix-yet');

  const prelude = [
    'Reading package lists... Done',
    'Building dependency tree... Done',
    'Calculating upgrade... Done',
  ];
  const warnings = noFixYet.map((c) => formatNoFixWarning(c.service));

  if (targets.length === 0) {
    return [...prelude, ...warnings, '0 upgraded, 0 newly installed, 0 to remove.'].join('\n');
  }

  const token = createCancellationToken();

  return {
    __type: 'async',
    start: (onLine, onComplete) => {
      const headerLines = [
        ...prelude,
        ...warnings,
        'The following packages will be upgraded:',
        `  ${targets.map((c) => c.service).join(' ')}`,
        `${targets.length} upgraded, 0 newly installed, 0 to remove.`,
      ];
      const setupLines = targets.flatMap((c) => [
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
            // Read current /var/lib/dpkg/status, fold in all upgraded
            // services, then write the whole file back in one shot.
            const currentContent = readFile ? (readFile(DPKG_STATUS_PATH) ?? '') : '';
            const updatedContent = targets.reduce(
              (content, candidate) =>
                setDpkgVersion(content, candidate.service, candidate.targetVersion),
              currentContent,
            );
            writeDpkgStatus(updatedContent, context);
            onComplete();
          }
        }, delay);
      });
    },
    cancel: token.cancel,
  };
};

// --- apt install <pkg>=<version> (version pinning) ---

// Writes a specific version of an existing package into /var/lib/dpkg/status.
// Used for both services (e.g., `http=Apache/2.4.49`) and router firmware
// (e.g., `firmware=MikroTik RouterOS 7.14.3`). Pinning a vulnerable version
// is allowed — players can deliberately downgrade.
const handleInstallPin = (
  pkg: string,
  pinnedVersion: string,
  context: AptContext,
): AsyncOutput | string => {
  const { getMachine, getCurrentMachine, readFile, getUserType, isWifiConnected } = context;
  const gameTime = context.getGameTime?.() ?? 0;

  if (getMachine() === 'localhost' && !isWifiConnected()) {
    throw new Error('E: Failed to fetch http://archive.ubuntu.com — network is unreachable');
  }

  if (getUserType() !== 'root') {
    throw new Error('E: Could not open lock file /var/lib/dpkg/lock-frontend — are you root?');
  }

  const machine = getCurrentMachine?.();
  if (!machine) {
    throw new Error(`E: Package '${pkg}' is not installed on this machine`);
  }

  if (!installedPackages(machine).has(pkg)) {
    throw new Error(`E: Package '${pkg}' is not installed on this machine`);
  }

  // Validate the pinned version is reachable for the package.
  const pinnable =
    pkg === FIRMWARE_PACKAGE
      ? machine.firmwareVendor !== undefined &&
        findPinnableFirmwareVersion(
          machine.firmwareVendor as FirmwareVendor,
          pinnedVersion,
          gameTime,
        )
      : findPinnableServiceVersion(pkg, pinnedVersion, gameTime);

  if (!pinnable) {
    throw new Error(
      `E: Package '${pkg}' has no installation candidate for version '${pinnedVersion}'`,
    );
  }

  const token = createCancellationToken();

  return {
    __type: 'async',
    start: (onLine, onComplete) => {
      const lines = [
        'Reading package lists... Done',
        'Building dependency tree... Done',
        `The following packages will be DOWNGRADED:`,
        `  ${pkg}`,
        `0 upgraded, 0 newly installed, 1 downgraded, 0 to remove.`,
        `Get: ${pkg} ${pinnedVersion}`,
        `Setting up ${pkg} (${pinnedVersion}) ...`,
      ];

      let delay = 0;
      lines.forEach((line, i) => {
        delay += jitter(OVERLAY_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine(line);
          if (i === lines.length - 1) {
            const currentContent = readFile ? (readFile(DPKG_STATUS_PATH) ?? '') : '';
            const updatedContent = setDpkgVersion(currentContent, pkg, pinnedVersion);
            writeDpkgStatus(updatedContent, context);
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
    synopsis: 'apt <subcommand> [package] [-i]',
    description:
      'Advanced package tool for installing hacking utilities. ' +
      'Tools like nmap, john, hydra, and nc must be installed before use. ' +
      'Requires root privileges and network connectivity to install.',
    arguments: [
      {
        name: 'subcommand',
        description: "'install', 'list', or 'upgrade'",
        required: true,
        values: ['install', 'list', 'upgrade'],
      },
      {
        name: 'package',
        description: 'Package name (required for install subcommand)',
        required: false,
      },
      {
        name: '-i',
        description: 'With "list": show only installed packages',
        required: false,
      },
      {
        name: '--installed',
        description: 'Alias for -i (list installed packages only)',
        required: false,
      },
    ],
    examples: [
      { command: 'apt install nmap', description: 'Install nmap on the current machine' },
      { command: 'apt list', description: 'List all available packages' },
      {
        command: 'apt list -i',
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
          'Usage: apt <install|list|upgrade> [package]',
          '',
          'Subcommands:',
          '  apt install <package>  Install a package',
          '  apt list               List available packages',
          '  apt list -i            List installed packages',
        ].join('\n'),
      );
    }

    if (subcommand === 'list') {
      return handleList(context.getNode, args.slice(1));
    }

    if (subcommand === 'install') {
      const packageName = args[1] as string | undefined;
      if (!packageName) {
        throw new Error('E: No package name specified. Usage: apt install <package>');
      }
      // `pkg=version` → version-pin install (service or firmware). Otherwise
      // fall through to the binary-tool install path.
      const equalsIndex = packageName.indexOf('=');
      if (equalsIndex > 0) {
        const pkg = packageName.slice(0, equalsIndex);
        const version = packageName.slice(equalsIndex + 1);
        return handleInstallPin(pkg, version, context);
      }
      return handleInstall(packageName, context);
    }

    if (subcommand === 'upgrade') {
      const serviceFilter = args[1] as string | undefined;
      return handleUpgrade(serviceFilter, context);
    }

    throw new Error(
      `E: Invalid operation '${subcommand}'. Usage: apt install <package>, apt upgrade, or apt list`,
    );
  },
});
