/**
 * The versions a package moves through, and the day each one's vulnerability lands.
 *
 * Every generated box sits on entry 0 and has never had a way to leave it, so until
 * `apt upgrade` exists this walk is only ever read at its first step. That first step
 * is deliberately the FIRST draw of the package's own stream, which is what lets the
 * walk grow forward without moving a single CVE that players already have written
 * down in their log files.
 *
 * Seeded on the package alone, so every box in the world running it moves along the
 * same timeline and is exposed on the same days — which is what a CVE is, and what
 * lets recon compound: learn a version's vulnerability once and you know it
 * everywhere. Nothing is stored; the client walks this to render an upgrade and the
 * server walks it again to authorize one.
 */

import { createPrng, type Prng } from '../generation/prng';
import {
  formatVersion,
  PACKAGE_TEMPLATES,
  type VersionTemplate,
} from '../packages/packageVersions';
import { WORLD_EPOCH } from './worldClock';

const DAY_MS = 86_400_000;

/** How many serials each package owns. The package number takes the leading
 *  digits and the scattered part takes the trailing five, so two packages can
 *  never mint the same id however many CVEs either accumulates. */
const SERIAL_SPACE = 100_000;

export type CveSeverity = 'critical' | 'high' | 'medium' | 'low';

/** Severity as a comparable rank, low to critical. The order every axis's winner-pick
 *  reads — the library reduce over a command's linked libraries, and the resolver's
 *  contest between a box's service hole and its firmware one — so what a scan forecasts
 *  and what an exploit lands can never disagree about which hole is worse. */
export const severityRank: Readonly<Record<CveSeverity, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/**
 * How fast the treadmill turns, and how far each step moves. Every number that
 * paces the world is here, so retuning after playtest is a one-line change rather
 * than a hunt — the pair of files legacy split these across let the release weights
 * drift into two copies.
 *
 * On a box running two or three services plus the eight libraries, an 8.5-day
 * average gap is a new CVE roughly every 0.8 days — often enough that daily
 * attention is the price of safety, rare enough that a clean box is a real state
 * rather than a theoretical one.
 */
type CveTiming = {
  readonly minSafeWindowDays: number;
  readonly maxSafeWindowDays: number;
  readonly minPatchDelayDays: number;
  readonly maxPatchDelayDays: number;
};

export const CVE_TIMING = {
  /** Shortest gap in game days between one CVE for a package and the next. */
  minSafeWindowDays: 3,
  /** Longest such gap. */
  maxSafeWindowDays: 14,
  /** Days between a CVE publishing and its fix becoming installable. Consumed by
   *  the upgrade resolver; the window is the reason nobody is ever immune. */
  minPatchDelayDays: 1,
  maxPatchDelayDays: 2,
} as const;

/**
 * The worst-case wait for a fix must stay strictly shorter than the shortest gap
 * to the next CVE, or a fix could arrive at or after the next version's own
 * vulnerability and a player would have no safe window at all — the treadmill
 * would be unwinnable rather than demanding. Throws at module load, because a
 * config that cannot be defended against should never reach a player.
 */
export const assertCveTimingInvariants = (timing: CveTiming): void => {
  if (timing.maxPatchDelayDays >= timing.minSafeWindowDays) {
    throw new Error(
      `CVE_TIMING: maxPatchDelayDays (${timing.maxPatchDelayDays}) must be strictly less than ` +
        `minSafeWindowDays (${timing.minSafeWindowDays}) to guarantee a safe window after a fix.`,
    );
  }
};

assertCveTimingInvariants(CVE_TIMING);

/**
 * How real software moves: most releases are patches, some add features, a few break
 * things. Over a year of play this reads as `1.26.0 → 1.26.7 → 1.27.0 → 2.0.0` rather
 * than as a counter. A patch takes whatever weight these two leave.
 */
const BUMP_WEIGHTS = { major: 5, minor: 15 } as const;

/** A bound on the walk, not on the world. `gameDayAt` floors at zero and has no
 *  ceiling, so a clock set to the wrong century would otherwise ask for a walk
 *  nobody wants to wait for. At the configured cadence this covers roughly two
 *  centuries of play. */
export const MAX_TIMELINE_ENTRIES = 10_000;

/**
 * Severity, which forecasts the privilege an exploit would land — critical
 * reaches root, high reaches a user, and the weak ones reach a guest. Coupling
 * the two gives the field a job: a player reads the severity and knows what the
 * door is worth before spending a move on it, while the draw stays random enough
 * that a rich target is a find rather than a routine.
 *
 * 10% critical, 50% high, 30% medium, 10% low. Split from the draw so the bands
 * can be pinned at their exact boundaries: no package in the world happens to roll
 * a 10, a 60 or a 90, so nothing else would notice a band shifting by one.
 */
export const severityForRoll = (roll: number): CveSeverity => {
  if (roll < 10) return 'critical';
  if (roll < 60) return 'high';
  if (roll < 90) return 'medium';
  return 'low';
};

/**
 * The id, built so it can never collide and never be renumbered.
 *
 * The year is the real calendar year the vulnerability published in, which only
 * starts varying once the walk reaches versions published a year or more out.
 *
 * The package's own permanent number takes the leading digits; the trailing five
 * are scattered per release rather than counting up from zero. That scatter is
 * load-bearing, not decoration: those last digits key the password a
 * `password_reset` leaves behind, and a serial that simply counted would end
 * every package's first CVE identically — one guess would then open most of the
 * world to somebody who never read a log, when reading the log is the entire
 * route back.
 */
const cveIdOf = (template: VersionTemplate, publishedAt: number, scattered: number): string => {
  const serial = template.cveNumber * SERIAL_SPACE + scattered;
  const year = new Date(WORLD_EPOCH + publishedAt * DAY_MS).getUTCFullYear();
  return `CVE-${year}-${String(serial).padStart(7, '0')}`;
};

export type TimelineEntry = {
  /** The bare tuple a manifest records, `9.7.0`. */
  readonly version: string;
  readonly tuple: readonly number[];
  /** Position in the walk. Seeds the severity and the effect, so it must never be
   *  derived from anything but the order releases actually happened in. */
  readonly index: number;
  /** `CVE-YYYY-NNNNNNN`, the id a scan prints and a defender's log records. */
  readonly cve: string;
  readonly severity: CveSeverity;
  /** Game day this version's CVE publishes. Before it, this version is genuinely
   *  clean; after it, a box sitting here is exposed until it MOVES. */
  readonly publishedAt: number;
  /** Days from this version's CVE publishing to the NEXT version being installable.
   *  The window in which a defender is told the truth and can do nothing about it. */
  readonly patchDelay: number;
};

export type ReleaseBump = 'major' | 'minor' | 'patch';

/** 5% major, 15% minor, 80% patch. Split from the draw for the reason `severityForRoll`
 *  is: the bands can then be pinned at their exact boundaries, where nothing that only
 *  walks a timeline would notice one shifting — or a weighting inverted outright. */
export const bumpForRoll = (roll: number): ReleaseBump => {
  if (roll < BUMP_WEIGHTS.major) return 'major';
  if (roll < BUMP_WEIGHTS.major + BUMP_WEIGHTS.minor) return 'minor';
  return 'patch';
};

/** Which component the next release bumps. Major and minor are the leading two; a
 *  patch is always the last, whatever the tuple's length. */
const releasedComponent = (prng: Prng, tuple: readonly number[]): number =>
  ({ major: 0, minor: 1, patch: tuple.length - 1 })[bumpForRoll(prng.nextInt(0, 99))];

/** Bump one component and zero everything below it — `1.26.4` minor-bumps to
 *  `1.27.0`, never to `1.27.4`. */
const bumped = (tuple: readonly number[], position: number): readonly number[] =>
  tuple.map((component, index) =>
    index < position ? component : index === position ? component + 1 : 0,
  );

/**
 * Every version of `key` up to and including the first one published AFTER
 * `throughDay`, or nothing at all for a package this world has no timeline for.
 *
 * It deliberately reaches one step past the day asked about: a box already on the
 * newest version has to have somewhere to go, or being fully patched would look like
 * the end of the line and `apt upgrade` would have nothing to offer.
 */
export const packageTimeline = (key: string, throughDay: number): readonly TimelineEntry[] => {
  const template = PACKAGE_TEMPLATES[key];
  if (template === undefined) return [];

  // Three streams, each separate so that adding one never shifted the others. The
  // releases stream draws a gap and then a bump per step, so its first draw is the
  // day entry 0 publishes and always will be. The serials stream is WALKED rather
  // than re-seeded per release, for the same reason: entry 0's scatter is its first
  // draw, and re-seeding would renumber every CVE already written into a log file.
  const releases = createPrng(`timeline:${key}`);
  const fixes = createPrng(`timeline:${key}:patchDelay`);
  const serials = createPrng(`cve-id:${key}`);

  const entries: TimelineEntry[] = [];
  let tuple: readonly number[] = template.startTuple;
  let publishedAt = 0;

  while (publishedAt <= throughDay && entries.length < MAX_TIMELINE_ENTRIES) {
    publishedAt += releases.nextInt(CVE_TIMING.minSafeWindowDays, CVE_TIMING.maxSafeWindowDays);
    const index = entries.length;
    entries.push({
      version: formatVersion(tuple),
      tuple,
      index,
      cve: cveIdOf(template, publishedAt, serials.nextInt(0, SERIAL_SPACE - 1)),
      // Re-seeded per release where the serial is walked, because THIS seed already
      // carries the index — entry 0's severity is `cve:<package>:0` either way.
      severity: severityForRoll(createPrng(`cve:${key}:${index}`).nextInt(0, 99)),
      publishedAt,
      patchDelay: fixes.nextInt(CVE_TIMING.minPatchDelayDays, CVE_TIMING.maxPatchDelayDays),
    });
    tuple = bumped(tuple, releasedComponent(releases, tuple));
  }

  return entries;
};

/** A version string as a tuple, or undefined when it is not a version at all — which
 *  a root-writable manifest makes a thing a player can type. Strict on purpose:
 *  `9.9.9-never-shipped` and `v9.7.0` are not versions this world has a history for,
 *  and reading past the parts that do not parse would be inventing one. */
const VERSION_TUPLE = /^\d+(?:\.\d+)*$/;

const parsedTuple = (version: string): readonly number[] | undefined =>
  VERSION_TUPLE.test(version) ? version.split('.').map(Number) : undefined;

/** Component-wise order over tuples of any length, a missing component counting as
 *  zero — `9.7` and `9.7.0` are one release written two ways. */
const compareTuples = (left: readonly number[], right: readonly number[]): number =>
  Array.from(
    { length: Math.max(left.length, right.length) },
    (_, index) => (left[index] ?? 0) - (right[index] ?? 0),
  ).find((difference) => difference !== 0) ?? 0;

/**
 * Which release a box claiming `version` is ACTUALLY running.
 *
 * The manifest is the version authority and it is root-writable, so the string here
 * is whatever a player last wrote. A version this world published is taken at its
 * word. A version it never published resolves DOWN to the newest release at or below
 * it, so typing a high number buys exactly what being fully patched buys and nothing
 * more — the lie is pointless rather than punished, and the treadmill cannot be
 * stepped off with one line in one file. Anything that is not a version at all, or
 * one below the release the package was born on, falls back to that first release:
 * nonsense in the file costs rather than protects.
 *
 * One rule, total, no carve-out — which is also what keeps a DOWNGRADE honest. Pinning
 * a box back to a release whose hole is open is a backdoor that looks like nothing,
 * and it works here because that release is a real entry that resolves to itself.
 */
export const installedRelease = (
  key: string,
  version: string,
  gameDay: number,
): TimelineEntry | undefined => {
  const timeline = packageTimeline(key, gameDay);
  const typed = parsedTuple(version);
  const resolved =
    typed === undefined
      ? undefined
      : timeline.findLast((entry) => compareTuples(entry.tuple, typed) <= 0);
  return resolved ?? timeline[0];
};

/** Whether a release's hole has landed by `gameDay` — from its publication day on, and
 *  for good: a CVE never expires, so a box sitting here stays exposed until it MOVES.
 *  The one definition of "exposed", so a scan, the exploit that follows it and apt's
 *  own advice can never disagree about whether a box is open. */
const hasLanded = (release: TimelineEntry, gameDay: number): boolean =>
  release.publishedAt <= gameDay;

/** The release a box is running, but only once its hole has actually landed. */
export const liveRelease = (
  key: string,
  version: string,
  gameDay: number,
): TimelineEntry | undefined => {
  const release = installedRelease(key, version, gameDay);
  return release !== undefined && hasLanded(release, gameDay) ? release : undefined;
};

/**
 * Where a package's history stands on `gameDay`: the newest release whose hole has
 * LANDED, the release that fixes that one, and how many days until the fix reaches the
 * repo — zero once it is there.
 *
 * The single walk both of apt's version questions are answered from: what a fresh
 * install lands on, and where an installed box can move to. `exposed` is undefined only
 * while a package has published nothing at all, when every box alive is still on the
 * release it was born with.
 */
const frontierOn = (key: string, gameDay: number) => {
  const timeline = packageTimeline(key, gameDay);
  const exposed = timeline.findLast((entry) => hasLanded(entry, gameDay));
  const fix = exposed === undefined ? undefined : timeline[exposed.index + 1];
  return {
    timeline,
    exposed,
    fix,
    etaDays:
      exposed === undefined
        ? 0
        : Math.max(exposed.publishedAt + exposed.patchDelay - gameDay, 0),
  };
};

/**
 * The newest release of `key` the repo actually holds on `gameDay` — the version a fresh
 * install lands on, and the version an upgrade moves a box to.
 *
 * Before the package's first hole lands that is the release it was born on. Once one
 * has, it is the release that fixes it — but only after the patch delay, because until
 * then that fix does not exist. Inside the delay the newest thing the repo has is the
 * exposed release itself, so installing into a window leaves a box open exactly as every
 * box already standing is: nobody buys immunity by arriving late.
 *
 * Undefined for a package this world keeps no history for — nothing to install a version
 * of, rather than a version invented for it.
 */
export const newestReleaseOn = (key: string, gameDay: number): string | undefined => {
  const { timeline, exposed, fix, etaDays } = frontierOn(key, gameDay);
  if (exposed === undefined) return timeline[0]?.version;
  return fix !== undefined && etaDays === 0 ? fix.version : exposed.version;
};

/**
 * Whether the repo holds `version` of `key` on `gameDay`: a real release, at or below
 * the newest one installable today. The set a player may name outright.
 *
 * Deliberately NOT "its CVE has published". The release that FIXES the current hole is
 * installable the day that fix ships, and its own hole lands later — so a published-CVE
 * test would refuse the very version a fresh install lands on. What can be named is what
 * the repo can hand over, which is exactly what `newestReleaseOn` already answers the
 * top of.
 */
export const repoHolds = (key: string, version: string, gameDay: number): boolean => {
  const newest = newestReleaseOn(key, gameDay);
  const timeline = packageTimeline(key, gameDay);
  const named = timeline.findIndex((entry) => entry.version === version);
  return named !== -1 && named <= timeline.findIndex((entry) => entry.version === newest);
};

/**
 * Whether moving `key` between two versions walks FORWARD along its history on `gameDay`.
 *
 * Both ends resolve through `installedRelease`, so a manifest holding a version this
 * world never published is weighed as the release it actually behaves as, rather than as
 * the string somebody typed into it — the same reading a scan and an exploit take of it.
 */
export const movesForward = (
  key: string,
  move: { readonly from: string; readonly to: string; readonly gameDay: number },
): boolean => {
  const before = installedRelease(key, move.from, move.gameDay);
  const after = installedRelease(key, move.to, move.gameDay);
  return before !== undefined && after !== undefined && after.index > before.index;
};

/**
 * What apt can do for one package on a box.
 *
 * `up-to-date` means NOT EXPOSED rather than on the newest release: the treadmill only
 * asks a player to move once the hole in the release they are on has landed, which
 * keeps a quiet box quiet.
 */
export type UpgradeStatus =
  | { readonly kind: 'up-to-date' }
  /** Exposed, and a release whose own hole has not landed is installable now. */
  | { readonly kind: 'upgradable'; readonly target: string }
  /** Exposed, and the fix is still inside its patch delay. The days REMAINING until it
   *  ships — the timeline is deterministic and the client already walks it, so an
   *  average would be the game withholding a number it has already handed over. */
  | { readonly kind: 'no-fix-yet'; readonly etaDays: number }
  /** Nothing to move along: a package this world keeps no history for (a name typed
   *  into the root-writable manifest by hand), or a clock set past the last release
   *  the walk will reach. */
  | { readonly kind: 'no-timeline' };

/**
 * Where a box claiming `version` of `key` can move to on `gameDay`.
 *
 * The target is the newest release whose own hole has NOT landed, never merely the
 * step after the box's own: by the time anybody looks, that step is usually open too,
 * and an upgrade that lands on a live hole is not a fix. And it is only offered once
 * the fix has shipped — the patch delay is the window in which a defender is told the
 * truth and can do nothing about it, which is why nobody is ever immune.
 */
export const upgradeStatusFor = (key: string, version: string, gameDay: number): UpgradeStatus => {
  const release = installedRelease(key, version, gameDay);
  if (release === undefined) return { kind: 'no-timeline' };
  if (!hasLanded(release, gameDay)) return { kind: 'up-to-date' };
  // The box's own release has landed, so the frontier's exposed release is it or later.
  const { fix, etaDays } = frontierOn(key, gameDay);
  if (fix === undefined) return { kind: 'no-timeline' };
  return etaDays > 0
    ? { kind: 'no-fix-yet', etaDays }
    : { kind: 'upgradable', target: fix.version };
};
