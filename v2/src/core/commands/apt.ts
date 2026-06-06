/**
 * apt — package manager. `install <pkg>` writes the package's binary stub(s)
 * into `/usr/bin` so a previously not-found command becomes reachable (the
 * binary-availability wrapper resolves `/usr/bin/<name>` at run time).
 *
 * Gates, in apt's own order: root first (real apt can't even take the dpkg lock
 * as a normal user), then connectivity (no repo fetch offline), then the package
 * lookup. Each gate refuses BEFORE any write, so a refused install never touches
 * the filesystem.
 *
 * Installed binaries are stamped WORLD-EXECUTABLE via the `permissions` override
 * on `patches.write`: the default file perms are root-only-executable, which the
 * user-tier player could never run — and apt-installed tools must be runnable by
 * the player, not just root. This mirrors the system-binary perm shape.
 *
 * Slice 1 ships `install` only; `list` lands in a later slice (unknown ops fall
 * through to the apt-style "Invalid operation" error).
 */

import { asAbsPath } from '../types';
import type { FilePermissions } from '../filesystem/types';
import type { Command, CommandEnv, CommandResult, PatchResult } from './types';
import { BINARY_STUB } from '../generation/binaries';
import { LIBRARY_PERMS } from '../generation/libraries';
import type { SystemLibrary } from '../generation/libraries';
import { APT_PACKAGES } from './aptPackages';
import { libraryDeps } from './libraryDeps';
import { binaryExists } from './availability';

const USAGE = [
  'apt: usage:',
  '  apt install <package>   Install a package',
  '  apt list [--installed]  List packages (optionally only installed ones)',
];

/** Apt's exit code for a failed operation (permission, fetch, locate, …). */
const APT_ERROR = 100;

/** World-executable binary perms — readable + runnable by every tier, writable
 *  only by root. Matches the system-binary shape so an installed tool behaves
 *  exactly like a pre-installed one. */
const INSTALLED_BINARY_PERMS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root', 'user', 'guest'],
};

const errorResult = (lines: readonly string[]): CommandResult => ({
  kind: 'sync',
  lines: lines.map((content) => ({ kind: 'error', content })),
  exitCode: APT_ERROR,
});

const okResult = (lines: readonly string[]): CommandResult => ({
  kind: 'sync',
  lines: lines.map((content) => ({ kind: 'text', content })),
  exitCode: 0,
});

/** The apt-style failure for a rejected write during install (binary or lib),
 *  so both write paths report the same shape. */
const installFailure = (packageName: string, error: string): CommandResult =>
  errorResult([`E: Failed to install ${packageName} (${error})`]);

/** The apt-style "no network" failure, shared by `install` and `list` (both are
 *  online-gated). */
const offlineError = (): CommandResult =>
  errorResult([
    "Err: http://deb.debian.org/debian Temporary failure resolving 'deb.debian.org'",
    'E: Failed to fetch — are you connected to a network?',
  ]);

/** The binaries a package ships, or undefined if the package isn't in the
 *  catalog. A package whose `binaries` is omitted ships a single binary that
 *  matches its name. */
const binariesFor = (packageName: string): readonly string[] | undefined => {
  const pkg = APT_PACKAGES.find((candidate) => candidate.name === packageName);
  if (pkg === undefined) return undefined;
  return pkg.binaries ?? [pkg.name];
};

/**
 * Install the shared libraries a package's binaries link (`libraryDeps`) that
 * are MISSING on the current machine — each as a `/lib/<lib>.so` stub with
 * library perms (linked, never executed). Present libraries are left untouched;
 * the first write failure stops and is returned.
 *
 * `deps` defaults to the real `libraryDeps` and is injectable so the missing/
 * present/perms logic is testable against a lib-incomplete fixture. No apt
 * package's binaries map to a library yet, so this is a no-op against the real
 * catalog today — it goes live once lib-bearing tools and lib-incomplete remote
 * machines exist (installing a tool there fills in the libs it needs to link).
 */
export const installPackageLibraries = async (
  env: CommandEnv,
  binaries: readonly string[],
  deps: Readonly<Record<string, readonly SystemLibrary[]>> = libraryDeps,
): Promise<PatchResult> => {
  const libraries = [...new Set(binaries.flatMap((binary) => deps[binary] ?? []))];
  for (const lib of libraries) {
    const path = asAbsPath(`/lib/${lib}.so`);
    const existing = env.fs.stat(path);
    if (existing !== null && existing.kind === 'file') continue;
    const result = await env.patches.write(path, BINARY_STUB, {
      isNew: true,
      permissions: LIBRARY_PERMS,
    });
    if (!result.ok) return result;
  }
  return { ok: true };
};

/** A package is "installed" when its first binary is present on the machine —
 *  the same proxy legacy used (a multi-binary package is judged by its lead
 *  binary). */
const packageInstalled = (env: CommandEnv, pkg: (typeof APT_PACKAGES)[number]): boolean =>
  binaryExists(env, pkg.binaries?.[0] ?? pkg.name);

const handleList = (
  env: CommandEnv,
  flags: ReadonlyMap<string, string | true>,
): CommandResult => {
  if (!env.network.isOnline()) {
    return offlineError();
  }
  const installedOnly = flags.has('--installed') || flags.has('-i');
  const rows = APT_PACKAGES.flatMap((pkg) => {
    const installed = packageInstalled(env, pkg);
    if (installedOnly && !installed) return [];
    return [`  ${pkg.name}${installed ? ' [installed]' : ''}`];
  });
  return okResult(['Listing...', ...rows]);
};

const handleInstall = async (
  env: CommandEnv,
  packageName: string | undefined,
): Promise<CommandResult> => {
  if (env.session.userType !== 'root') {
    return errorResult([
      'E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)',
      'E: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?',
    ]);
  }
  if (!env.network.isOnline()) {
    return offlineError();
  }
  if (packageName === undefined) {
    return errorResult(['E: No package specified.', ...USAGE]);
  }

  const binaries = binariesFor(packageName);
  if (binaries === undefined) {
    return errorResult([`E: Unable to locate package ${packageName}`]);
  }

  for (const binary of binaries) {
    const result = await env.patches.write(asAbsPath(`/usr/bin/${binary}`), BINARY_STUB, {
      isNew: true,
      permissions: INSTALLED_BINARY_PERMS,
    });
    if (!result.ok) {
      return installFailure(packageName, result.error);
    }
  }

  const libResult = await installPackageLibraries(env, binaries);
  if (!libResult.ok) {
    return installFailure(packageName, libResult.error);
  }

  return okResult([
    'Reading package lists... Done',
    'Building dependency tree... Done',
    'The following NEW packages will be installed:',
    `  ${packageName}`,
    `Setting up ${packageName} ...`,
  ]);
};

const execute: Command['execute'] = async (env, args, flags) => {
  const [subcommand, packageName] = args;
  if (subcommand === undefined) {
    return errorResult(USAGE);
  }
  if (subcommand === 'install') {
    return handleInstall(env, packageName);
  }
  if (subcommand === 'list') {
    return handleList(env, flags);
  }
  return errorResult([`E: Invalid operation ${subcommand}`]);
};

export const apt: Command = {
  name: 'apt',
  description: 'Install and manage packages',
  category: 'network',
  tier: 'root',
  availability: { kind: 'localhost-only' },
  flags: { '--installed': 'boolean', '-i': 'boolean' },
  manual: {
    synopsis: 'apt <install|list> [args]',
    description:
      'Advanced Package Tool. "install" downloads a package and places its binaries in /usr/bin, making the tool available to run (requires root — run "su" first). "list" shows the installable catalog; "list --installed" shows only the packages already present. Both need a network connection.',
    arguments: [
      { name: 'operation', description: '"install" or "list"', required: true },
      { name: 'package', description: 'The package to install (for "install")' },
    ],
    examples: [
      { command: 'apt install nmap', description: 'Install the nmap network scanner' },
      { command: 'apt list --installed', description: 'List the packages already installed' },
    ],
  },
  execute,
};