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
  systemLibraryTemplates,
  SYSTEM_LIBRARIES,
  LIBRARY_META_PACKAGES,
  LIBRARY_META_PACKAGE_NAMES,
  type SystemLibrary,
  type LibraryMetaPackage,
} from '../generation/pools/systemLibraryTemplates';
import {
  findLibraryCve,
  findLatestSafeLibrary,
  findPinnableLibraryVersion,
} from '../generation/systemLibraryLookup';
import {
  CVE_TIMING_CONFIG,
  DEFAULT_LATEST_VERSION,
  findLatestSafeVersion,
} from '../generation/timeline';
import {
  DPKG_STATUS_PATH,
  parseDpkgVersions,
  setDpkgVersion,
  formatDpkgStatus,
  parseDpkgStatus,
} from '../network/dpkgStatus';

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
  readonly deleteFile?: (path: string, userType: UserType) => PermissionResult;
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

const renderUpgradableLine = (name: string, version: string, status: string): string =>
  `  ${name.padEnd(12)} ${version.padEnd(24)} ${status}`;

const handleList = (context: AptContext, args: readonly unknown[]): string => {
  const { getNode } = context;
  const flag = args[0];
  const showInstalled = flag === '--installed' || flag === '-i';
  const showUpgradable = flag === '--upgradable' || flag === '-u';

  if (showUpgradable) {
    return renderUpgradableList(context);
  }

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

const pickLibraryUpgradeTarget = (library: SystemLibrary, gameTime: number): UpgradeTarget => {
  if (!systemLibraryTemplates[library]) return { kind: 'no-template' };
  const version = findLatestSafeLibrary(library, gameTime);
  if (version === undefined) return { kind: 'no-fix-yet' };
  return { kind: 'target', version };
};

const isSystemLibrary = (name: string): name is SystemLibrary =>
  Object.prototype.hasOwnProperty.call(systemLibraryTemplates, name);

const isLibraryMetaPackage = (name: string): name is LibraryMetaPackage =>
  Object.prototype.hasOwnProperty.call(LIBRARY_META_PACKAGES, name);

// Reads the current library version from /var/lib/dpkg/status. Falls back to
// the template's startTuple when the machine has no dpkg entry for the library.
const getLibraryVersion = (library: SystemLibrary, context: AptContext): string => {
  const content = context.readFile ? (context.readFile(DPKG_STATUS_PATH) ?? '') : '';
  const versions = parseDpkgVersions(content);
  const pinned = versions.get(library);
  if (pinned !== undefined) return pinned;
  const template = systemLibraryTemplates[library];
  return `${template.prefix}${template.startTuple.join(template.separator)}`;
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

// Library counterpart to resolveServiceCandidate. 'no-template' falls back
// to the currently-installed version (same as firmware), leaving the dpkg
// entry unchanged rather than writing a sentinel.
const resolveLibraryCandidate = (
  library: SystemLibrary,
  currentVersion: string,
  gameTime: number,
): UpgradeCandidate => {
  const resolved = pickLibraryUpgradeTarget(library, gameTime);
  if (resolved.kind === 'no-fix-yet') return { kind: 'no-fix-yet', service: library };
  const targetVersion = resolved.kind === 'target' ? resolved.version : currentVersion;
  return { kind: 'target', service: library, targetVersion };
};

// Determines which system libraries the filter name targets. A bare
// `apt upgrade` (filter undefined) includes every library. A single-library
// filter (`apt upgrade libpam`) targets just that one. A meta-package
// filter (`apt upgrade auth-libs`) expands to the bundle's libraries.
// Services/firmware/unknown names → empty list.
const librariesForFilter = (filter: string | undefined): readonly SystemLibrary[] => {
  if (filter === undefined) return SYSTEM_LIBRARIES;
  if (isSystemLibrary(filter)) return [filter];
  if (isLibraryMetaPackage(filter)) return LIBRARY_META_PACKAGES[filter];
  return [];
};

const collectUpgradeCandidates = (
  machine: RemoteMachine,
  serviceFilter: string | undefined,
  gameTime: number,
  context: AptContext,
): readonly UpgradeCandidate[] => {
  const libraryScope = librariesForFilter(serviceFilter);
  const considerServices =
    serviceFilter === undefined ||
    (!isSystemLibrary(serviceFilter) && !isLibraryMetaPackage(serviceFilter));

  // Services — filter by name (when set) + vulnerability, then dedupe by
  // service name so two ports running the same service don't double-count.
  const serviceCandidates: readonly UpgradeCandidate[] = considerServices
    ? machine.ports
        .filter((port) => serviceFilter === undefined || port.service === serviceFilter)
        .filter((port) => isVulnerable(port.service, port.serviceVersion, gameTime))
        .filter((port, index, all) => all.findIndex((p) => p.service === port.service) === index)
        .map((port) => resolveServiceCandidate(port.service, gameTime))
    : [];

  // Router firmware is treated like a package named `firmware`. At most one
  // candidate, and only when the machine has a vendor AND its current firmware
  // version has a live CVE.
  const includeFirmware = serviceFilter === undefined || serviceFilter === FIRMWARE_PACKAGE;
  const firmwareCandidates: readonly UpgradeCandidate[] =
    includeFirmware &&
    machine.firmwareVendor &&
    machine.firmwareVersion &&
    findFirmwareCve(machine.firmwareVendor, machine.firmwareVersion, gameTime)
      ? [resolveFirmwareCandidate(machine.firmwareVendor, machine.firmwareVersion, gameTime)]
      : [];

  // System libraries. Scope is determined by the filter: bare upgrade hits
  // every library, a single library name targets just that one, and a
  // meta-package expands to its bundle. Only libraries with a live CVE survive.
  const libraryCandidates: readonly UpgradeCandidate[] = libraryScope.flatMap((lib) => {
    const version = getLibraryVersion(lib, context);
    if (!findLibraryCve(lib, version, gameTime)) return [];
    return [resolveLibraryCandidate(lib, version, gameTime)];
  });

  return [...serviceCandidates, ...firmwareCandidates, ...libraryCandidates];
};

const AVG_PATCH_DELAY_LABEL = `${AVG_PATCH_DELAY_DAYS} day${AVG_PATCH_DELAY_DAYS === 1 ? '' : 's'}`;

const formatNoFixWarning = (service: string): string =>
  `W: ${service} is vulnerable but no fix has been released (ETA ~${AVG_PATCH_DELAY_LABEL})`;

const NO_FIX_STATUS = `[vulnerable, no fix yet — ETA ~${AVG_PATCH_DELAY_LABEL}]`;

// Per-service status for `apt list --upgradable`. An entry is 'up to date'
// when no CVE (hand-authored or procedural) is live at gameTime. Otherwise
// the resolution mirrors apt upgrade: a released fix → 'upgradable → X',
// a fix still inside the patch-delay gap → the shared NO_FIX_STATUS string.
const serviceUpgradableStatus = (service: string, version: string, gameTime: number): string => {
  if (!isVulnerable(service, version, gameTime)) return '[up to date]';
  const target = pickServiceUpgradeTarget(service, gameTime);
  if (target.kind === 'no-fix-yet') return NO_FIX_STATUS;
  const v = target.kind === 'target' ? target.version : DEFAULT_LATEST_VERSION;
  return `[upgradable → ${v}]`;
};

const firmwareUpgradableStatus = (
  vendor: FirmwareVendor,
  version: string,
  gameTime: number,
): string => {
  if (!findFirmwareCve(vendor, version, gameTime)) return '[up to date]';
  const target = pickFirmwareUpgradeTarget(vendor, gameTime);
  if (target.kind === 'no-fix-yet') return NO_FIX_STATUS;
  const v = target.kind === 'target' ? target.version : version;
  return `[upgradable → ${v}]`;
};

const libraryUpgradableStatus = (
  library: SystemLibrary,
  version: string,
  gameTime: number,
): string => {
  if (!findLibraryCve(library, version, gameTime)) return '[up to date]';
  const target = pickLibraryUpgradeTarget(library, gameTime);
  if (target.kind === 'no-fix-yet') return NO_FIX_STATUS;
  const v = target.kind === 'target' ? target.version : version;
  return `[upgradable → ${v}]`;
};

// Meta-package status aggregates over its children. "Worst status wins"
// so the player's attention is drawn to the most pressing bundle: any
// child in-gap → no-fix-yet; any child upgradable → upgradable; else up-to-date.
// The version column shows the bundle's member count as a compact summary.
const metaPackageUpgradableStatus = (
  meta: LibraryMetaPackage,
  context: AptContext,
  gameTime: number,
): string => {
  const children = LIBRARY_META_PACKAGES[meta];
  const statuses = children.map((lib) =>
    libraryUpgradableStatus(lib, getLibraryVersion(lib, context), gameTime),
  );
  if (statuses.some((s) => s === NO_FIX_STATUS)) return NO_FIX_STATUS;
  const upgradable = statuses.filter((s) => s.startsWith('[upgradable'));
  if (upgradable.length > 0)
    return `[upgradable — ${upgradable.length}/${children.length} libraries]`;
  return '[up to date]';
};

const NO_SERVICES_MESSAGE = '  (no services on this machine)';

const renderUpgradableList = (context: AptContext): string => {
  const machine = context.getCurrentMachine?.();
  const gameTime = context.getGameTime?.() ?? 0;
  // Localhost has no RemoteMachine entry (it's the player's workstation, not
  // a remote target), so getCurrentMachine returns undefined. We still emit
  // a listing-shaped response so the player understands the command ran.
  if (!machine) {
    return ['Listing upgradable packages...', '', NO_SERVICES_MESSAGE].join('\n');
  }

  const seen = new Set<string>();
  const serviceLines = machine.ports.flatMap((port) => {
    if (seen.has(port.service)) return [];
    seen.add(port.service);
    const status = serviceUpgradableStatus(port.service, port.serviceVersion, gameTime);
    return [renderUpgradableLine(port.service, port.serviceVersion, status)];
  });

  const firmwareLines =
    machine.firmwareVendor && machine.firmwareVersion
      ? [
          renderUpgradableLine(
            FIRMWARE_PACKAGE,
            machine.firmwareVersion,
            firmwareUpgradableStatus(machine.firmwareVendor, machine.firmwareVersion, gameTime),
          ),
        ]
      : [];

  // One row per system library, version from dpkg status.
  const libraryLines = SYSTEM_LIBRARIES.map((lib) => {
    const version = getLibraryVersion(lib, context);
    return renderUpgradableLine(lib, version, libraryUpgradableStatus(lib, version, gameTime));
  });

  // One row per meta-package — aggregated status across the bundle. Version
  // column shows a short descriptor since meta-packages don't have their own
  // version string.
  const metaLines = LIBRARY_META_PACKAGE_NAMES.map((meta) => {
    const memberCount = LIBRARY_META_PACKAGES[meta].length;
    const descriptor = `(${memberCount} libraries)`;
    return renderUpgradableLine(
      meta,
      descriptor,
      metaPackageUpgradableStatus(meta, context, gameTime),
    );
  });

  const rows = [...serviceLines, ...firmwareLines, ...libraryLines, ...metaLines];
  const body = rows.length > 0 ? rows : [NO_SERVICES_MESSAGE];
  return ['Listing upgradable packages...', '', ...body].join('\n');
};

// Returns the set of packages currently installed on the machine. Includes
// one entry per unique service across all ports, plus `firmware` if the
// machine is a router, plus every system library, plus the four
// library meta-packages. Used by `apt upgrade <package>` and
// `apt install <package>=<version>` to validate the named package exists
// before computing upgrade candidates.
const installedPackages = (machine: RemoteMachine): ReadonlySet<string> => {
  const packages = new Set<string>(machine.ports.map((p) => p.service));
  if (machine.firmwareVendor) packages.add(FIRMWARE_PACKAGE);
  for (const lib of SYSTEM_LIBRARIES) packages.add(lib);
  for (const meta of LIBRARY_META_PACKAGE_NAMES) packages.add(meta);
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

  const allCandidates = collectUpgradeCandidates(machine, serviceFilter, gameTime, context);
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

      // Apply state changes eagerly (dpkg status rewrite) — decoupled from
      // line-by-line animation so the write happens even if the caller
      // doesn't advance timers all the way to the last scheduled line.
      const currentContent = readFile ? (readFile(DPKG_STATUS_PATH) ?? '') : '';
      const updatedContent = targets.reduce(
        (content, candidate) => setDpkgVersion(content, candidate.service, candidate.targetVersion),
        currentContent,
      );
      writeDpkgStatus(updatedContent, context);

      let delay = 0;
      lines.forEach((line, i) => {
        delay += jitter(OVERLAY_DELAY_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine(line);
          if (i === lines.length - 1) {
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
  const pinnable = isSystemLibrary(pkg)
    ? findPinnableLibraryVersion(pkg, pinnedVersion, gameTime)
    : pkg === FIRMWARE_PACKAGE
      ? machine.firmwareVendor !== undefined &&
        findPinnableFirmwareVersion(machine.firmwareVendor, pinnedVersion, gameTime)
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

// --- apt remove <library> ---

// Deletes a system library: removes /lib/<lib>.so and strips the library's
// dpkg status entry. Every command that links the removed library will fail
// its runtime library check on next invocation (see wrapWithLibraryCheck).
//
// v1 scope: only system libraries can be removed. Removing a service or
// firmware package isn't meaningful in the current game model (services
// live in ports, not a filesystem entry) and meta-packages expand to
// multiple children — supporting either later is a straightforward
// extension but not needed for v1.
const handleRemove = (pkg: string, context: AptContext): AsyncOutput | string => {
  const { getMachine, getCurrentMachine, readFile, getUserType, isWifiConnected } = context;

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

  if (!isSystemLibrary(pkg)) {
    throw new Error(
      `E: apt remove currently supports system libraries only ('${pkg}' is not a library)`,
    );
  }

  const libPath = `/lib/${pkg}.so`;

  // Delete the .so file (if present). Missing file is tolerated — matches
  // real apt's behaviour of succeeding when the package is already gone.
  if (context.deleteFile) {
    context.deleteFile(libPath, 'root');
  }

  // Strip the library's dpkg status entry by parsing + re-serialising
  // without the removed package.
  const currentContent = readFile ? (readFile(DPKG_STATUS_PATH) ?? '') : '';
  const entries = Array.from(parseDpkgStatus(currentContent).values()).filter(
    (entry) => entry.pkg !== pkg,
  );
  writeDpkgStatus(formatDpkgStatus(entries), context);

  return [
    'Reading package lists... Done',
    'Building dependency tree... Done',
    `The following packages will be REMOVED:`,
    `  ${pkg}`,
    `0 upgraded, 0 newly installed, 1 to remove.`,
    `Removing ${pkg} ...`,
  ].join('\n');
};

export const createAptCommand = (context: AptContext): Command => ({
  name: 'apt',
  category: 'general',
  description: 'Package manager — install hacking tools',
  manual: {
    synopsis: 'apt <subcommand> [package] [-i | -u]',
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
      {
        name: '-u',
        description: 'With "list": show services on this machine with upgrade status',
        required: false,
      },
      {
        name: '--upgradable',
        description: 'Alias for -u (per-service upgrade status)',
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
      {
        command: 'apt list -u',
        description: 'Show services on this machine needing upgrade',
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
          '  apt list -u            List services on this machine with upgrade status',
        ].join('\n'),
      );
    }

    if (subcommand === 'list') {
      return handleList(context, args.slice(1));
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

    if (subcommand === 'remove') {
      const packageName = args[1] as string | undefined;
      if (!packageName) {
        throw new Error('E: No package name specified. Usage: apt remove <library>');
      }
      return handleRemove(packageName, context);
    }

    throw new Error(
      `E: Invalid operation '${subcommand}'. Usage: apt install <package>, apt upgrade, apt remove <library>, or apt list`,
    );
  },
});
