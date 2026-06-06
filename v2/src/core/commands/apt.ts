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

const USAGE = ['apt: usage:', '  apt install <package>   Install a package'];

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
    return errorResult([
      "Err: http://deb.debian.org/debian Temporary failure resolving 'deb.debian.org'",
      'E: Failed to fetch — are you connected to a network?',
    ]);
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

const execute: Command['execute'] = async (env, args) => {
  const [subcommand, packageName] = args;
  if (subcommand === undefined) {
    return errorResult(USAGE);
  }
  if (subcommand === 'install') {
    return handleInstall(env, packageName);
  }
  return errorResult([`E: Invalid operation ${subcommand}`]);
};

export const apt: Command = {
  name: 'apt',
  description: 'Install and manage packages',
  category: 'network',
  tier: 'root',
  availability: { kind: 'localhost-only' },
  manual: {
    synopsis: 'apt install <package>',
    description:
      'Advanced Package Tool. "install" downloads a package and places its binaries in /usr/bin, making the tool available to run. Requires root (run "su" first) and a network connection.',
    arguments: [
      { name: 'operation', description: 'Currently: "install"', required: true },
      { name: 'package', description: 'The package to install (e.g. nmap)' },
    ],
    examples: [
      { command: 'apt install nmap', description: 'Install the nmap network scanner' },
    ],
  },
  execute,
};