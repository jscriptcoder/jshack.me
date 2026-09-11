/**
 * apt — package manager. `install <pkg>` writes the package's binary stub(s)
 * into `/usr/bin` — or `/usr/sbin` for the daemons a package ships — so a
 * previously not-found command becomes reachable (the binary-availability
 * wrapper searches all three binary directories at run time).
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
 *
 * `list -u` is the defender's view of the manifest a version scan reads: which
 * packages on this box are exposed, and whether the release that fixes each has
 * shipped yet. It writes nothing and the manifest is world-readable, so it needs no
 * root — only the network, like `list` beside it.
 */

import { asAbsPath, type AbsPath } from '../types';
import type { FilePermissions } from '../filesystem/types';
import type { Command, CommandEnv, CommandResult, PatchResult, TerminalLine } from './types';
import { BINARY_STUB } from '../generation/binaries';
import { LIBRARY_PERMS } from '../generation/libraries';
import type { SystemLibrary } from '../generation/libraries';
import {
  APT_PACKAGES,
  BASE_IMAGE_PACKAGES,
  packageContents,
  type AptExtraFile,
} from '../packages/aptPackages';
import { parseDpkgVersions, readDpkgStatus } from '../packages/dpkgStatus';
import { upgradeStatusFor, type UpgradeStatus } from '../cve/packageTimeline';
import { gameDayAt } from '../cve/worldClock';
import { libraryDeps } from './libraryDeps';
import { binaryExists } from './availability';
import { errorLine, streamedResult, text } from './streaming';

/** Beat between apt's steps, so reaching the repo takes visible time even when
 *  the writes behind it return instantly. */
const STEP_DELAY_MS = 300;

const USAGE = [
  'apt: usage:',
  '  apt install <package>     Install a package',
  '  apt list [--installed]    List packages (optionally only installed ones)',
  '  apt list --upgradable     List the packages on this box with a vulnerability',
];

/** Apt's exit code for a failed operation (permission, fetch, locate, …). */
const APT_ERROR = 100;

/** Where an installed binary lands. A tool you run goes to `/usr/bin`; a DAEMON
 *  you run to bring a service up goes to `/usr/sbin`, beside the `sshd` and
 *  `vsftpd` every machine already ships.
 *
 *  Cosmetic to resolution — `binaryExists` searches both, plus `/bin` — and that
 *  is the point: it is what the player sees when they list a directory, and a
 *  world where every daemon is in one place has one fewer exception to learn. */
const TOOL_DIR = '/usr/bin';
const DAEMON_DIR = '/usr/sbin';

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
 * Install a package's data files, WITHOUT overwriting one that is already there
 * — a shipped data file becomes the player's the moment it lands, and the
 * wordlist in particular is a thing they curate. Absent files are still written,
 * so reinstalling remains the way to get a deleted one back.
 *
 * Each installed file's MISSING containing directories are
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
    // A data file that is already there belongs to the PLAYER now, not to the
    // package. The wordlist is the clearest case: growing it by hand is the
    // credential layer's whole progression, so rewriting it on a reinstall would
    // destroy every harvested password with nothing on screen to say so.
    //
    // Per-file rather than a package-level "already installed, do nothing",
    // because `hydra` and `john` both tell a player with no wordlist to reinstall
    // hydra to get one back — that recovery has to keep working.
    if (env.fs.stat(extraFile.path) !== null) {
      yield text(`${extraFile.path} already exists, keeping your copy`);
      continue;
    }
    for (const ancestor of ancestorsOf(extraFile.path)) {
      if (env.fs.stat(ancestor) !== null) continue;
      const result = await env.patches.mkdir(ancestor);
      if (!result.ok) return result;
    }
    yield text(`Installing ${extraFile.path} ...`);
    const result = await env.patches.write(extraFile.path, extraFile.content(env), {
      isNew: true,
      permissions: extraFile.permissions,
    });
    if (!result.ok) return result;
    // After the write, and only after it: a note about a file that failed to land, or
    // about the copy a player already had, would describe a box that does not exist.
    for (const note of extraFile.noteOnInstall?.(env) ?? []) {
      yield text(note);
    }
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
  // Installed on every box, whatever /usr/bin holds: half of them are libraries, which
  // have no binary to look for, and the rest arrived with the box rather than with apt.
  yield* BASE_IMAGE_PACKAGES.map((name) => text(`  ${name} [installed]`));
  return 0;
}

/** One package's row, or none. Only a package that needs a move is listed, as real
 *  `apt list --upgradable` does; a package with no timeline — a router's firmware —
 *  has nothing to offer and is left out rather than given a version it does not have.
 *  The version shown is the one the FILE claims, as a scan shows it, so a hand-edited
 *  manifest reads back exactly as its owner wrote it. */
const upgradableRow = (
  pkg: string,
  version: string,
  status: UpgradeStatus,
): readonly TerminalLine[] => {
  if (status.kind === 'upgradable') {
    return [text(`  ${pkg} ${version} [upgradable → ${status.target}]`)];
  }
  if (status.kind === 'no-fix-yet') {
    const days = `${status.etaDays} day${status.etaDays === 1 ? '' : 's'}`;
    return [text(`  ${pkg} ${version} [vulnerable, no fix yet — ETA ~${days}]`)];
  }
  return [];
};

/** Every package in the manifest of the box the player is STANDING on, against today's
 *  world. A clean box says so in one line: on a box of several services and eight
 *  libraries a row per package would be a wall of mostly-green noise, and "up to date"
 *  said plainly is the better reward. */
async function* listUpgradable(env: CommandEnv): AsyncGenerator<TerminalLine, number> {
  yield text('Listing...');
  await env.sleep(STEP_DELAY_MS);

  const gameDay = gameDayAt(env.now());
  const rows = Array.from(parseDpkgVersions(readDpkgStatus(env.fs.root())), ([pkg, version]) =>
    upgradableRow(pkg, version, upgradeStatusFor(pkg, version, gameDay)),
  ).flat();
  yield* rows.length > 0 ? rows : [text('All packages are up to date.')];
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

  // True on every box in the world, so it is not a fiction — and there is nothing to
  // write: no binary for software that came with the box, no `.so` for a library
  // everything already links.
  if (BASE_IMAGE_PACKAGES.includes(packageName)) {
    yield text(`${packageName} is already the newest version.`);
    return 0;
  }

  const contents = packageContents(packageName);
  if (contents === undefined) {
    yield errorLine(`E: Unable to locate package ${packageName}`);
    return APT_ERROR;
  }
  const { packageNames, binaries, extraFiles } = contents;

  yield text('The following NEW packages will be installed:');
  // Every package the install covers, not just the one that was asked for. A tool
  // that appears on the box with nothing on screen accounting for it reads as the
  // game doing something behind the player's back.
  yield text(`  ${packageNames.join(' ')}`);
  await env.sleep(STEP_DELAY_MS);
  yield text(`Setting up ${packageName} ...`);

  for (const { binary, isDaemon } of binaries) {
    const directory = isDaemon ? DAEMON_DIR : TOOL_DIR;
    const result = await env.patches.write(asAbsPath(`${directory}/${binary}`), BINARY_STUB, {
      isNew: true,
      permissions: INSTALLED_BINARY_PERMS,
    });
    if (!result.ok) {
      yield installFailureLine(packageName, result.error);
      return APT_ERROR;
    }
  }

  const libResult = await installPackageLibraries(
    env,
    binaries.map(({ binary }) => binary),
  );
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
  // Ahead of `--installed`, which it already implies: a package has to be on the box
  // before it can need upgrading.
  if (flags.has('--upgradable') || flags.has('-u')) {
    return streamedResult(listUpgradable(env));
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
  flags: { '--installed': 'boolean', '-i': 'boolean', '--upgradable': 'boolean', '-u': 'boolean' },
  manual: {
    synopsis: 'apt <install|list> [--installed|--upgradable] [package]',
    description:
      'Advanced Package Tool. "install" downloads a package and places its binaries where they belong — tools in /usr/bin, service daemons in /usr/sbin — making them available to run (requires root — run "su" first). "list" shows the installable catalog; "list --installed" shows only the packages already present. "list --upgradable" (or -u) reads this box\'s package manifest and names every package with a published vulnerability: the version that fixes it, or — while the fix has not been released yet — how many days until it is. It needs no root. All of them need a network connection.',
    arguments: [
      {
        name: 'operation',
        description: '"install" or "list"',
        required: true,
        values: ['install', 'list'],
      },
      { name: 'package', description: 'The package to install (for "install")' },
      { name: '--installed', description: 'With "list": only the packages already present (-i)' },
      {
        name: '--upgradable',
        description: 'With "list": only the packages on this box that are vulnerable (-u)',
      },
    ],
    examples: [
      { command: 'apt install nmap', description: 'Install the nmap network scanner' },
      { command: 'apt list --installed', description: 'List the packages already installed' },
      {
        command: 'apt list --upgradable',
        description: 'See which packages on this box are exposed, and when their fixes land',
      },
    ],
  },
  execute,
};
