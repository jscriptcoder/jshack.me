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
 * Reaching the repo STREAMS its steps (see `streaming.ts`) so the player watches
 * apt work rather than reading a report of work already done. Where a gate
 * refuses decides its shape: root and connectivity are checked BEFORE the repo
 * is touched, so they refuse sync with no preamble, while an unknown package is
 * only discoverable by reading the lists — so it reports beneath the preamble,
 * as real apt does.
 */

import { asAbsPath, type AbsPath } from '../types';
import type { FilePermissions } from '../filesystem/types';
import type { Command, CommandEnv, CommandResult, PatchResult, TerminalLine } from './types';
import { BINARY_STUB } from '../generation/binaries';
import { LIBRARY_PERMS } from '../generation/libraries';
import type { SystemLibrary } from '../generation/libraries';
import { APT_PACKAGES, type AptExtraFile } from './aptPackages';
import { libraryDeps } from './libraryDeps';
import { binaryExists } from './availability';
import { errorLine, streamedResult, text } from './streaming';

/** Beat between apt's steps, so reaching the repo takes visible time even when
 *  the writes behind it return instantly. */
const STEP_DELAY_MS = 300;

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

/** The apt-style failure for a rejected write during install (binary or lib),
 *  so both write paths report the same shape. */
const installFailureLine = (packageName: string, error: string): TerminalLine =>
  errorLine(`E: Failed to install ${packageName} (${error})`);

/** The apt-style "no network" failure, shared by `install` and `list` (both are
 *  online-gated). */
const offlineError = (): CommandResult =>
  errorResult([
    "Err: http://deb.debian.org/debian Temporary failure resolving 'deb.debian.org'",
    'E: Failed to fetch — are you connected to a network?',
  ]);

/** What a package installs, or undefined if it isn't in the catalog. A package
 *  whose `binaries` is omitted ships a single binary matching its name; one whose
 *  `extraFiles` is omitted ships no data files. Resolved in ONE lookup so the
 *  caller cannot end up asking about a package it has already failed to find. */
const contentsOf = (
  packageName: string,
):
  | { readonly binaries: readonly string[]; readonly extraFiles: readonly AptExtraFile[] }
  | undefined => {
  const pkg = APT_PACKAGES.find((candidate) => candidate.name === packageName);
  if (pkg === undefined) return undefined;
  return { binaries: pkg.binaries ?? [pkg.name], extraFiles: pkg.extraFiles ?? [] };
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

/** The ancestor directories of `path`, outermost first — `/usr/share/wordlists/x`
 *  yields `/usr`, `/usr/share`, `/usr/share/wordlists`. */
const ancestorsOf = (path: AbsPath): readonly AbsPath[] => {
  const segments = path.split('/').filter((segment) => segment !== '');
  return segments
    .slice(0, -1)
    .map((_, index) => asAbsPath(`/${segments.slice(0, index + 1).join('/')}`));
};

/**
 * Install a package's data files. Each one's MISSING containing directories are
 * created first, because a write into a directory that does not exist is REFUSED
 * — the permission walker has no container to gate the create against — and
 * nothing on a fresh workstation creates `/usr/share`. Directories that already
 * exist are left alone: every mkdir is a persisted journal row, and one that
 * recreates `/usr` would sit on the player's box forever doing nothing.
 *
 * Announced before each write: a file that appears with no line explaining it
 * reads as something the game did behind the player's back.
 *
 * Takes the files rather than a package name — like `installPackageLibraries`
 * takes its dep map — so the multi-file and rejected-write paths are exercisable
 * against a fixture. No catalog package ships two data files today, and inventing
 * one to reach those paths would be content written for a test.
 */
export async function* installExtraFiles(
  env: CommandEnv,
  extraFiles: readonly AptExtraFile[],
): AsyncGenerator<TerminalLine, PatchResult> {
  for (const extraFile of extraFiles) {
    for (const ancestor of ancestorsOf(extraFile.path)) {
      if (env.fs.stat(ancestor) !== null) continue;
      const result = await env.patches.mkdir(ancestor);
      if (!result.ok) return result;
    }
    yield text(`Installing ${extraFile.path} ...`);
    const result = await env.patches.write(extraFile.path, extraFile.content, {
      isNew: true,
      permissions: extraFile.permissions,
    });
    if (!result.ok) return result;
  }
  return { ok: true };
}

/** A package is "installed" when its first binary is present on the machine —
 *  the same proxy legacy used (a multi-binary package is judged by its lead
 *  binary). */
const packageInstalled = (env: CommandEnv, pkg: (typeof APT_PACKAGES)[number]): boolean =>
  binaryExists(env, pkg.binaries?.[0] ?? pkg.name);

async function* listPackages(
  env: CommandEnv,
  flags: ReadonlyMap<string, string | true>,
): AsyncGenerator<TerminalLine, number> {
  yield text('Listing...');
  await env.sleep(STEP_DELAY_MS);

  const installedOnly = flags.has('--installed') || flags.has('-i');
  yield* APT_PACKAGES.flatMap((pkg) => {
    const installed = packageInstalled(env, pkg);
    if (installedOnly && !installed) return [];
    return [text(`  ${pkg.name}${installed ? ' [installed]' : ''}`)];
  });
  return 0;
}

/** The repo half of `install`, once the caller has cleared the root and
 *  connectivity gates. Every step is announced before it happens; a failure
 *  lands beneath the announcements the player has already seen rather than
 *  replacing them. */
async function* installPackage(
  env: CommandEnv,
  packageName: string,
): AsyncGenerator<TerminalLine, number> {
  yield text('Reading package lists...');
  await env.sleep(STEP_DELAY_MS);
  yield text('Building dependency tree...');
  await env.sleep(STEP_DELAY_MS);

  const contents = contentsOf(packageName);
  if (contents === undefined) {
    yield errorLine(`E: Unable to locate package ${packageName}`);
    return APT_ERROR;
  }
  const { binaries, extraFiles } = contents;

  yield text('The following NEW packages will be installed:');
  yield text(`  ${packageName}`);
  await env.sleep(STEP_DELAY_MS);
  yield text(`Setting up ${packageName} ...`);

  for (const binary of binaries) {
    const result = await env.patches.write(asAbsPath(`/usr/bin/${binary}`), BINARY_STUB, {
      isNew: true,
      permissions: INSTALLED_BINARY_PERMS,
    });
    if (!result.ok) {
      yield installFailureLine(packageName, result.error);
      return APT_ERROR;
    }
  }

  const libResult = await installPackageLibraries(env, binaries);
  if (!libResult.ok) {
    yield installFailureLine(packageName, libResult.error);
    return APT_ERROR;
  }

  const extraResult = yield* installExtraFiles(env, extraFiles);
  if (!extraResult.ok) {
    yield installFailureLine(packageName, extraResult.error);
    return APT_ERROR;
  }

  return 0;
}

const handleList = (env: CommandEnv, flags: ReadonlyMap<string, string | true>): CommandResult => {
  if (!env.network.isOnline()) {
    return offlineError();
  }
  return streamedResult(listPackages(env, flags));
};

const handleInstall = (env: CommandEnv, packageName: string | undefined): CommandResult => {
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
  return streamedResult(installPackage(env, packageName));
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
      {
        name: 'operation',
        description: '"install" or "list"',
        required: true,
        values: ['install', 'list'],
      },
      { name: 'package', description: 'The package to install (for "install")' },
    ],
    examples: [
      { command: 'apt install nmap', description: 'Install the nmap network scanner' },
      { command: 'apt list --installed', description: 'List the packages already installed' },
    ],
  },
  execute,
};
