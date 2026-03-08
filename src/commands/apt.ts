import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { FileNode, FilePermissions } from '../filesystem/types';
import type { PermissionResult } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import { APT_PACKAGES, APT_INSTALLABLE, BINARY_STUB, RESTRICTED_EXECUTE } from './availability';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type AptContext = {
  readonly getMachine: () => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly createFile: (
    path: string,
    content: string,
    userType: UserType,
    permissions?: FilePermissions,
  ) => PermissionResult;
  readonly getUserType: () => UserType;
};

const formatInstalledStatus = (
  name: string,
  getNode: (path: string) => FileNode | null,
  machine: string,
): string => {
  if (machine === 'localhost') return '[installed]';
  return getNode(`/usr/bin/${name}`) !== null ? '[installed]' : '[not installed]';
};

const handleList = (
  getNode: (path: string) => FileNode | null,
  machine: string,
  args: readonly unknown[],
): string => {
  const showInstalled = args[0] === '--installed' || args[0] === '-i';

  const lines = APT_PACKAGES.map((pkg) => {
    const status = formatInstalledStatus(pkg.name, getNode, machine);
    return `  ${pkg.name.padEnd(12)} ${pkg.version.padEnd(10)} ${status.padEnd(16)} ${pkg.description}`;
  });

  if (showInstalled) {
    const installedLines = APT_PACKAGES.filter(
      (pkg) => formatInstalledStatus(pkg.name, getNode, machine) === '[installed]',
    ).map(
      (pkg) =>
        `  ${pkg.name.padEnd(12)} ${pkg.version.padEnd(10)} ${'[installed]'.padEnd(16)} ${pkg.description}`,
    );
    return ['Listing installed packages...', '', ...installedLines].join('\n');
  }

  return ['Listing all packages...', '', ...lines].join('\n');
};

const handleInstall = (packageName: string, context: AptContext): AsyncOutput | string => {
  const { getMachine, getNode, createFile, getUserType } = context;
  const machine = getMachine();

  if (machine === 'localhost') {
    return 'All packages are pre-installed on localhost.';
  }

  if (getUserType() !== 'root') {
    throw new Error('E: Could not open lock file /var/lib/dpkg/lock-frontend — are you root?');
  }

  if (!APT_INSTALLABLE.has(packageName)) {
    throw new Error(`E: Unable to locate package ${packageName}`);
  }

  if (getNode(`/usr/bin/${packageName}`) !== null) {
    const pkg = APT_PACKAGES.find((p) => p.name === packageName);
    const version = pkg?.version ?? '1.0.0';
    return `${packageName} is already the newest version (${version}).\n0 upgraded, 0 newly installed, 0 to remove.`;
  }

  const pkg = APT_PACKAGES.find((p) => p.name === packageName);
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

      lines.forEach((line, i) => {
        token.schedule(
          () => {
            if (token.isCancelled()) return;
            onLine(line);

            if (i === lines.length - 1) {
              const binaryPermissions: FilePermissions = {
                read: ['root', 'user', 'guest'],
                write: ['root'],
                execute: RESTRICTED_EXECUTE[packageName] ?? ['root', 'user', 'guest'],
              };
              createFile(`/usr/bin/${packageName}`, BINARY_STUB, 'root', binaryPermissions);
              onComplete();
            }
          },
          jitter((i + 1) * 200),
        );
      });
    },
    cancel: token.cancel,
  };
};

export const createAptCommand = (context: AptContext): Command => ({
  name: 'apt',
  description: 'Package manager — install tools on remote machines',
  manual: {
    synopsis: "apt('install', packageName) | apt('list', ['-i'])",
    description:
      'Advanced package tool for installing hacking utilities on remote machines. ' +
      'On localhost, all tools are pre-installed. On remote machines, tools like nmap, ' +
      'john, nc, and ftp must be installed before use. Requires root privileges to install.',
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
      return [
        'Usage: apt(subcommand, [args])',
        '',
        'Subcommands:',
        "  apt('install', '<package>')   Install a package",
        "  apt('list')                   List available packages",
        "  apt('list', '-i')             List installed packages",
      ].join('\n');
    }

    if (subcommand === 'list') {
      return handleList(context.getNode, context.getMachine(), args.slice(1));
    }

    if (subcommand === 'install') {
      const packageName = args[1] as string | undefined;
      if (!packageName) {
        throw new Error("E: No package name specified. Usage: apt('install', '<package>')");
      }
      return handleInstall(packageName, context);
    }

    throw new Error(
      `E: Invalid operation '${subcommand}'. Usage: apt('install', '<package>') or apt('list')`,
    );
  },
});
