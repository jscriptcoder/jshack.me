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
 *
 * `upgrade` is the answer to what `list -u` shows, and takes `install`'s two gates for
 * the same reasons. It rewrites the versions of the exposed packages in that same
 * manifest — the file a scan reads and an exploit is keyed on — so a patch is one write
 * to one file. A package whose fix has not shipped yet is reported rather than moved:
 * the patch delay is the window nobody can buy their way out of.
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
import {
  buildEntry,
  DPKG_STATUS_OWNER,
  DPKG_STATUS_PATH,
  DPKG_STATUS_PERMISSIONS,
  parseDpkgVersions,
  readDpkgStatus,
  withPackageEntries,
  withPackageVersion,
} from '../packages/dpkgStatus';
import {
  movesForward,
  newestReleaseOn,
  repoHolds,
  upgradeStatusFor,
  type UpgradeStatus,
} from '../cve/packageTimeline';
import { gameDayAt } from '../cve/worldClock';
import { libraryDeps } from './libraryDeps';
import { binaryExists } from './availability';
import { errorLine, streamedResult, text } from './streaming';

/** Beat between apt's steps, so reaching the repo takes visible time even when
 *  the writes behind it return instantly. */
const STEP_DELAY_MS = 300;

const USAGE = [
  'apt: usage:',
  '  apt install <package>[=<version>]  Install a package, or roll one back to a release',
  '  apt upgrade [package]              Patch the packages on this box whose fixes have shipped',
  '  apt list [--installed]             List packages (optionally only installed ones)',
  '  apt list --upgradable              List the packages on this box with a vulnerability',
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

/** The apt-style "you are not root" failure, shared by the two operations that write:
 *  real apt cannot take the dpkg lock as a normal user, whichever of them was asked
 *  for. */
const lockError = (): CommandResult =>
  errorResult([
    'E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)',
    'E: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?',
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

/** A package inside its patch-delay gap, in the words `list -u` and `upgrade` both use —
 *  one phrase, so the two cannot disagree about when a fix ships. */
const noFixYet = (etaDays: number): string =>
  `vulnerable, no fix yet — ETA ~${etaDays} day${etaDays === 1 ? '' : 's'}`;

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
    return [text(`  ${pkg} ${version} [${noFixYet(status.etaDays)}]`)];
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

/** One package leaving the release it is on for the one that fixes it. */
type Upgrade = { readonly pkg: string; readonly from: string; readonly to: string };

/** The upgrade itself, once a preamble has been printed: every exposed package on the box
 *  the player is standing on — or only the one named — moved onto the release that fixes
 *  it, by rewriting its version in that box's manifest. Every package is unpacked before
 *  any is set up, as real apt orders it, and the manifest is written once between the two.
 *
 *  A package whose fix has not shipped cannot move, and says so last, where it is read:
 *  the count of what did not move adds up with what did to every row `list -u` shows.
 *
 *  Shared with `install`, which does this to a package the box already carries — one
 *  resolver behind both verbs, so they cannot disagree about what the repo holds. */
async function* applyUpgrades(
  env: CommandEnv,
  packageName: string | undefined,
): AsyncGenerator<TerminalLine, number> {
  const gameDay = gameDayAt(env.now());
  const manifest = readDpkgStatus(env.fs.root());
  const installed = parseDpkgVersions(manifest);
  // Only discoverable by reading the box's own manifest, so it reports beneath the
  // preamble — where an unknown package reports for `install`, and for the same reason.
  if (packageName !== undefined && !installed.has(packageName)) {
    yield errorLine(`E: Package '${packageName}' is not installed, so not upgraded`);
    return APT_ERROR;
  }
  const rows = Array.from(installed)
    .filter(([pkg]) => packageName === undefined || pkg === packageName)
    .map(([pkg, version]) => ({ pkg, version, status: upgradeStatusFor(pkg, version, gameDay) }));
  const upgrades = rows.flatMap(({ pkg, version, status }): readonly Upgrade[] =>
    status.kind === 'upgradable' ? [{ pkg, from: version, to: status.target }] : [],
  );
  const warnings = rows.flatMap(({ pkg, version, status }) =>
    status.kind === 'no-fix-yet'
      ? [errorLine(`W: ${pkg} ${version} is ${noFixYet(status.etaDays)}`)]
      : [],
  );

  if (upgrades.length > 0) {
    yield text('The following packages will be upgraded:');
    yield text(`  ${upgrades.map(({ pkg }) => pkg).join(' ')}`);
  }
  // Printed even when it is all zeroes: a box with nothing to do has to SAY nothing to
  // do, or the player cannot tell a clean box from a command that broke.
  yield text(
    `${upgrades.length} upgraded, 0 newly installed, 0 to remove and ${warnings.length} not upgraded.`,
  );
  if (upgrades.length === 0) {
    yield* warnings;
    return 0;
  }

  await env.sleep(STEP_DELAY_MS);
  yield* upgrades.map(({ pkg, from, to }) => text(`Unpacking ${pkg} (${to}) over (${from}) ...`));
  const written = await env.patches.write(
    asAbsPath(DPKG_STATUS_PATH),
    upgrades.reduce((content, { pkg, to }) => withPackageVersion(content, pkg, to), manifest),
    // Restated rather than left to the session: a rewrite at the session's defaults would
    // leave the manifest root-only, and hide it from every scan and every `list -u`.
    { owner: DPKG_STATUS_OWNER, permissions: DPKG_STATUS_PERMISSIONS },
  );
  // Nothing moved, so nothing may claim to have been set up — the manifest IS the
  // upgrade, and a box that reported one it never made would be lying about its own
  // exposure.
  if (!written.ok) {
    yield errorLine(`E: Failed to write ${DPKG_STATUS_PATH} (${written.error})`);
    return APT_ERROR;
  }
  yield* upgrades.map(({ pkg, to }) => text(`Setting up ${pkg} (${to}) ...`));
  yield* warnings;
  return 0;
}

/** The `upgrade` operation: apt's own preamble, then the work. */
async function* upgradePackages(
  env: CommandEnv,
  packageName: string | undefined,
): AsyncGenerator<TerminalLine, number> {
  yield text('Reading package lists...');
  await env.sleep(STEP_DELAY_MS);
  yield text('Building dependency tree...');
  await env.sleep(STEP_DELAY_MS);
  yield text('Calculating upgrade...');
  await env.sleep(STEP_DELAY_MS);
  return yield* applyUpgrades(env, packageName);
}

/** True when the repo holds nothing this box does not already have: a package that is not
 *  exposed at all, or one with no history to move along. Inside a patch delay it is
 *  FALSE — the hole is real, the warning says so, and calling that the newest version
 *  would be the reassuring half of the truth. */
const nothingNewerThan = (status: UpgradeStatus): boolean =>
  status.kind === 'up-to-date' || status.kind === 'no-timeline';

/** The repo half of `install`, once the caller has cleared the root and
 *  connectivity gates. Every step is announced before it happens; a failure
 *  lands beneath the announcements the player has already seen rather than
 *  replacing them. */
/** `redis=7.2.5` split into the package and the release it names; a bare `redis` names
 *  no release. Split on the FIRST `=` so a version containing one cannot swallow the
 *  package name. */
const splitPin = (spec: string): readonly [string, string | undefined] => {
  const at = spec.indexOf('=');
  return at === -1 ? [spec, undefined] : [spec.slice(0, at), spec.slice(at + 1)];
};

/**
 * Move a package to the release the player NAMED, rather than to the one the resolver
 * picks. The manifest is the whole of the move: a stub binary carries no version, so
 * the row IS the release this box is running, and the scan and the exploit that follow
 * both read it from there.
 *
 * Which is what makes rolling backwards worth doing — a box pinned to a release whose
 * hole is open is exposed again, and reads exactly like one that never patched.
 */
async function* pinVersion(
  env: CommandEnv,
  pin: {
    readonly packageName: string;
    readonly version: string;
    readonly manifest: string;
    readonly carried: ReadonlyMap<string, string>;
    readonly gameDay: number;
  },
): AsyncGenerator<TerminalLine, number> {
  const { packageName, version, manifest, carried, gameDay } = pin;
  const from = carried.get(packageName);
  // Only discoverable by reading the box's own manifest, so it reports beneath the
  // preamble — where `upgrade` reports the same thing, and for the same reason.
  if (from === undefined) {
    yield errorLine(`E: Package '${packageName}' is not installed, so not downgraded`);
    return APT_ERROR;
  }
  // A release the repo does not hold cannot be had by naming it. Without this the
  // manifest would accept any number at all, and the box would claim a version this
  // world never shipped — which every scan and exploit downstream would believe.
  if (!repoHolds(packageName, version, gameDay)) {
    yield errorLine(`E: Version '${version}' for '${packageName}' was not found`);
    return APT_ERROR;
  }
  // Pinning is how a box goes BACKWARDS. Moving forward is `upgrade`'s verb, and it
  // carries a rule this path does not — it may only land on a release whose own hole has
  // not opened yet — so allowing it here would be a second way forward that skips it.
  if (movesForward(packageName, { from, to: version, gameDay })) {
    yield errorLine(
      `E: Version '${version}' for '${packageName}' is newer than the installed '${from}' — use 'apt upgrade'`,
    );
    return APT_ERROR;
  }
  yield text(`Unpacking ${packageName} (${version}) over (${from}) ...`);
  const written = await env.patches.write(
    asAbsPath(DPKG_STATUS_PATH),
    withPackageVersion(manifest, packageName, version),
    { owner: DPKG_STATUS_OWNER, permissions: DPKG_STATUS_PERMISSIONS },
  );
  // Nothing moved, so nothing may claim to have been set up: the manifest IS the
  // downgrade, and a box reporting one it never made would lie about its own exposure.
  if (!written.ok) {
    yield errorLine(`E: Failed to write ${DPKG_STATUS_PATH} (${written.error})`);
    return APT_ERROR;
  }
  // Only a LANDED rollback is reported, which is why this sits below the write rather
  // than beside the announcement above it. The manifest IS the downgrade, so a report
  // raised any earlier would put a rollback in the box owner's log that their manifest
  // never took — evidence of an attack that did not happen. The command names only what
  // moved: which box, from which address and at what time are the caller's to supply.
  env.apt.recordDowngrade({ packageName, fromVersion: from, toVersion: version });
  yield text(`Setting up ${packageName} (${version}) ...`);
  return 0;
}

async function* installPackage(
  env: CommandEnv,
  packageName: string,
  pinnedVersion: string | undefined,
): AsyncGenerator<TerminalLine, number> {
  yield text('Reading package lists...');
  await env.sleep(STEP_DELAY_MS);
  yield text('Building dependency tree...');
  await env.sleep(STEP_DELAY_MS);

  const gameDay = gameDayAt(env.now());
  const manifest = readDpkgStatus(env.fs.root());
  const carried = parseDpkgVersions(manifest);

  // A named release answers the version question outright, so it runs ahead of every
  // resolver below: those all ask "where should this box move to", and the player has
  // already said.
  if (pinnedVersion !== undefined) {
    return yield* pinVersion(env, {
      packageName,
      version: pinnedVersion,
      manifest,
      carried,
      gameDay,
    });
  }

  // Shipped with the box, so there is nothing to lay down: no binary for software that
  // came with the image, no `.so` for a library everything already links. The VERSION is
  // still the resolver's to answer, and real apt upgrades a package it already has
  // rather than declining it — so this goes exactly where `apt upgrade` goes. Saying
  // "already the newest version" on a box `apt list -u` calls exposed would be apt
  // contradicting apt.
  if (BASE_IMAGE_PACKAGES.includes(packageName)) {
    const version = carried.get(packageName);
    if (version !== undefined && nothingNewerThan(upgradeStatusFor(packageName, version, gameDay))) {
      yield text(`${packageName} is already the newest version.`);
    }
    return yield* applyUpgrades(env, packageName);
  }

  const contents = packageContents(packageName);
  if (contents === undefined) {
    yield errorLine(`E: Unable to locate package ${packageName}`);
    return APT_ERROR;
  }
  const { packageNames, binaries, extraFiles } = contents;

  // Every package the install covers, not just the one that was asked for. A tool
  // that appears on the box with nothing on screen accounting for it reads as the
  // game doing something behind the player's back. Only the ones that are actually
  // new: on a reinstall nothing here is new, and the version half below says what
  // really happened.
  const arriving = packageNames.filter((name) => !carried.has(name));
  if (arriving.length > 0) {
    yield text('The following NEW packages will be installed:');
    yield text(`  ${arriving.join(' ')}`);
  }
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

  // The version half. A package the box already carried moves exactly as `apt upgrade`
  // moves it — one rule for everything apt touches, and a reinstall that stamped today's
  // release onto a box still running last year's binary would hand out a patch nobody
  // applied.
  if (carried.has(packageName)) {
    return yield* applyUpgrades(env, packageName);
  }
  // Anything genuinely new is BORN at what the repo holds today, in a manifest row of its
  // own. Without it a bought daemon has a binary and no version, and a scan of the box
  // that bought it sees a service with nothing behind it. A package this world keeps no
  // history for gets no row rather than an invented version.
  const born = packageNames.flatMap((name) => {
    const version = carried.has(name) ? undefined : newestReleaseOn(name, gameDay);
    return version === undefined ? [] : [buildEntry(name, version)];
  });
  if (born.length === 0) return 0;
  const recorded = await env.patches.write(
    asAbsPath(DPKG_STATUS_PATH),
    withPackageEntries(manifest, born),
    { owner: DPKG_STATUS_OWNER, permissions: DPKG_STATUS_PERMISSIONS },
  );
  if (!recorded.ok) {
    yield installFailureLine(packageName, recorded.error);
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

const handleInstall = (env: CommandEnv, spec: string | undefined): CommandResult => {
  if (env.session.userType !== 'root') {
    return lockError();
  }
  if (!env.network.isOnline()) {
    return offlineError();
  }
  if (spec === undefined) {
    return errorResult(['E: No package specified.', ...USAGE]);
  }
  // Only `install` takes a release: `upgrade` exists to answer where a box should move
  // NEXT, and a version handed to it would be the player answering its own question.
  const [packageName, pinnedVersion] = splitPin(spec);
  return streamedResult(installPackage(env, packageName, pinnedVersion));
};

/** `upgrade` takes the same two gates `install` does, in the same order and for the same
 *  reasons: the dpkg lock is root's, and a release cannot be fetched from a repo the box
 *  cannot reach. Both refuse before the repo is touched, so neither prints a preamble. */
const handleUpgrade = (env: CommandEnv, packageName: string | undefined): CommandResult => {
  if (env.session.userType !== 'root') {
    return lockError();
  }
  if (!env.network.isOnline()) {
    return offlineError();
  }
  return streamedResult(upgradePackages(env, packageName));
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
  if (subcommand === 'upgrade') {
    return handleUpgrade(env, packageName);
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
    synopsis: 'apt <install|list|upgrade> [--installed|--upgradable] [package[=<version>]]',
    description:
      'Advanced Package Tool. "install" downloads a package and places its binaries where they belong — tools in /usr/bin, service daemons in /usr/sbin — making them available to run (requires root — run "su" first). Naming a release as "<package>=<version>" installs that release instead of the newest: the repo hands over only releases it already holds, and only backwards — moving a box forward is what "upgrade" is for. "upgrade" closes the holes "list --upgradable" names: it moves every package on this box whose fix has been released onto that release, or only the package you name, and reports the ones whose fix has not shipped yet rather than moving them (requires root). "list" shows the installable catalog; "list --installed" shows only the packages already present. "list --upgradable" (or -u) reads this box\'s package manifest and names every package with a published vulnerability: the version that fixes it, or — while the fix has not been released yet — how many days until it is. It needs no root. All of them need a network connection.',
    arguments: [
      {
        name: 'operation',
        description: '"install", "list" or "upgrade"',
        required: true,
        values: ['install', 'list', 'upgrade'],
      },
      {
        name: 'package',
        description:
          'The package to install (for "install"), written as "<package>=<version>" to name a release rather than take the newest, or the single package to upgrade (for "upgrade", which otherwise covers them all)',
      },
      { name: '--installed', description: 'With "list": only the packages already present (-i)' },
      {
        name: '--upgradable',
        description: 'With "list": only the packages on this box that are vulnerable (-u)',
      },
    ],
    examples: [
      { command: 'apt install nmap', description: 'Install the nmap network scanner' },
      {
        command: 'apt install redis=7.2.5',
        description: 'Roll redis back to an older release the repo still holds',
      },
      {
        command: 'apt upgrade',
        description: 'Patch every package on this box whose fix has been released',
      },
      { command: 'apt list --installed', description: 'List the packages already installed' },
      {
        command: 'apt list --upgradable',
        description: 'See which packages on this box are exposed, and when their fixes land',
      },
    ],
  },
  execute,
};
