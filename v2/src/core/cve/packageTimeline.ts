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
import { formatVersion, PACKAGE_TEMPLATES } from '../packages/packageVersions';

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

export type TimelineEntry = {
  /** The bare tuple a manifest records, `9.7.0`. */
  readonly version: string;
  readonly tuple: readonly number[];
  /** Position in the walk. Seeds the severity and the effect, so it must never be
   *  derived from anything but the order releases actually happened in. */
  readonly index: number;
  /** Game day this version's CVE publishes. Before it, this version is genuinely
   *  clean; after it, a box sitting here is exposed until it MOVES. */
  readonly publishedAt: number;
  /** Days from this version's CVE publishing to the NEXT version being installable.
   *  The window in which a defender is told the truth and can do nothing about it. */
  readonly patchDelay: number;
};

/** Which component the next release bumps. Major and minor are the leading two; a
 *  patch is always the last, whatever the tuple's length. */
const releasedComponent = (prng: Prng, tuple: readonly number[]): number => {
  const roll = prng.nextInt(0, 99);
  if (roll < BUMP_WEIGHTS.major) return 0;
  if (roll < BUMP_WEIGHTS.major + BUMP_WEIGHTS.minor) return 1;
  return tuple.length - 1;
};

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

  // Two streams. The releases stream draws a gap and then a bump per step, so its
  // first draw is the day entry 0 publishes and always will be. The fixes stream is
  // separate for the same reason: when the patch delay was added, the gaps and bumps
  // already published could not be allowed to shift under it.
  const releases = createPrng(`timeline:${key}`);
  const fixes = createPrng(`timeline:${key}:patchDelay`);

  const entries: TimelineEntry[] = [];
  let tuple: readonly number[] = template.startTuple;
  let publishedAt = 0;

  while (publishedAt <= throughDay && entries.length < MAX_TIMELINE_ENTRIES) {
    publishedAt += releases.nextInt(CVE_TIMING.minSafeWindowDays, CVE_TIMING.maxSafeWindowDays);
    entries.push({
      version: formatVersion(tuple),
      tuple,
      index: entries.length,
      publishedAt,
      patchDelay: fixes.nextInt(CVE_TIMING.minPatchDelayDays, CVE_TIMING.maxPatchDelayDays),
    });
    tuple = bumped(tuple, releasedComponent(releases, tuple));
  }

  return entries;
};
