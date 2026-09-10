/**
 * What vulnerability a package at a version has, on a given day of the world.
 *
 * ONE derivation over every axis. A daemon, a shared object and a router's
 * firmware image are all just a key with a version here, because
 * `/var/lib/dpkg/status` is one flat namespace in which they are
 * indistinguishable — so a scanner, `apt`, and the exploit that later reads this
 * cannot end up disagreeing about whether a box is exposed. What a CVE GRANTS
 * does differ by axis, and that is deliberately NOT decided here: a library's
 * privilege floor and a service's effect pool belong to the tools that fire an
 * exploit, not to the fact one exists.
 *
 * Everything is recomputed, never stored. The same key at the same game day
 * reconstructs the same CVE on the client (to render it) and on the server (to
 * authorize against it), which is what makes a forged client clock unable to
 * change anything a player actually GETS.
 *
 * The version comes from the box's own manifest rather than from the template
 * table, because a box will move off what it shipped with and a scan answering
 * from the table would keep pointing at a hole its owner had already closed.
 */

import { createPrng } from '../generation/prng';
import { PACKAGE_TEMPLATES, startingVersionOf, type VersionTemplate } from '../packages/packageVersions';
import { WORLD_EPOCH } from './worldClock';

const DAY_MS = 86_400_000;

/** How many serials each package owns. The package number takes the leading
 *  digits and the scattered part takes the trailing five, so two packages can
 *  never mint the same id however many CVEs either accumulates. */
const SERIAL_SPACE = 100_000;

/** Every generated box is frozen on the version it shipped with, so the only
 *  timeline entry anything can currently reach is the first one. Named rather
 *  than written as a bare `0` so the seeds that include it stay stable when
 *  later entries arrive with `apt upgrade`. */
const FIRST_INDEX = 0;

export type CveSeverity = 'critical' | 'high' | 'medium' | 'low';

export type LiveCve = {
  /** `CVE-YYYY-NNNNNNN`, where the year is the calendar year it published in. */
  readonly cve: string;
  readonly severity: CveSeverity;
  /** Game day it published on — before this, the package is genuinely clean. */
  readonly publishedAt: number;
};

/**
 * How fast the treadmill turns. All four numbers in one place so retuning after
 * playtest is a one-line change.
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
 * The day a package's first CVE publishes, seeded on the package alone so every
 * box in the world running it is exposed on the same day — which is what a CVE
 * is, and what lets recon compound: learn a version's vulnerability once and you
 * know it everywhere.
 *
 * This is deliberately the FIRST draw of the forward walk that later versions
 * will need, so extending it into a walk moves no already-published CVE.
 */
const publicationDayOf = (key: string): number =>
  createPrng(`timeline:${key}`).nextInt(CVE_TIMING.minSafeWindowDays, CVE_TIMING.maxSafeWindowDays);

/**
 * The id, built so it can never collide and never be renumbered.
 *
 * The year is the real calendar year the vulnerability published in. It cannot vary
 * yet — every publication day is inside the first safe window, so all of them land in
 * the epoch's own year — and it starts varying the moment the forward walk reaches
 * versions published a year or more out, which is when a year-crossing case is worth
 * pinning.
 *
 * The package's own permanent number takes the leading digits; the trailing five
 * are scattered per package rather than counting up from zero. That scatter is
 * load-bearing, not decoration: those last digits key the password a
 * `password_reset` leaves behind, and a serial that simply counted would end
 * every package's first CVE identically — one guess would then open most of the
 * world to somebody who never read a log, when reading the log is the entire
 * route back.
 */
const cveIdOf = (key: string, template: VersionTemplate, publishedAt: number): string => {
  const scattered = createPrng(`cve-id:${key}`).nextInt(0, SERIAL_SPACE - 1);
  const serial = template.cveNumber * SERIAL_SPACE + scattered;
  const year = new Date(WORLD_EPOCH + publishedAt * DAY_MS).getUTCFullYear();
  return `CVE-${year}-${String(serial).padStart(7, '0')}`;
};

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

const severityOf = (key: string): CveSeverity =>
  severityForRoll(createPrng(`cve:${key}:${FIRST_INDEX}`).nextInt(0, 99));

/**
 * The CVE live against `key` at `version` on `gameDay`, or undefined when there
 * is none — the package is still inside its safe window, or the version is one
 * this world never shipped.
 *
 * An unrecognised version reads as clean, which is reachable today: the manifest
 * is root-writable, so a player can type a version nothing has a timeline for.
 * Harmless while nothing is exploitable; the exploit and upgrade paths own
 * deciding whether that should stay a free defence.
 */
export const liveCve = (key: string, version: string, gameDay: number): LiveCve | undefined => {
  const template = PACKAGE_TEMPLATES[key];
  if (template === undefined || startingVersionOf(key) !== version) return undefined;
  const publishedAt = publicationDayOf(key);
  if (gameDay < publishedAt) return undefined;
  return { cve: cveIdOf(key, template, publishedAt), severity: severityOf(key), publishedAt };
};
