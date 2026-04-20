import { createPrng, type Prng } from '../prng';
import { serviceTemplates, formatVersion, type VersionTemplate } from '../pools/serviceTemplates';

// Procedural version timeline walker.
//
// Walks forward from a service's starting tuple, bumping the tuple at each
// step (weighted random patch/minor/major) and accumulating randomized
// day-gaps to produce a publishedAt for each version. Everything is
// deterministic: the PRNG is seeded on the service name, so the same game
// always produces the same timeline for a given service. No persistence
// needed — we recompute on demand.

export type GeneratedVersion = {
  readonly version: string;
  readonly tuple: readonly number[];
  readonly index: number;
  readonly publishedAt: number;
  // Days between this version's CVE publishing and the *next* version
  // becoming available as an upgrade target. Drawn once per CVE from the
  // configured [minPatchDelayDays, maxPatchDelayDays] range using a
  // side-PRNG so the main walk's gap/bump stream stays stable.
  readonly patchDelay: number;
};

export type TimelineTiming = {
  readonly minSafeWindowDays: number;
  readonly maxSafeWindowDays: number;
  readonly minPatchDelayDays: number;
  readonly maxPatchDelayDays: number;
};

// Weighted random version-bumping. 80% of new releases are patch bumps,
// 15% are minor (new feature releases), 5% are major (big rewrites).
// Matches roughly how real open-source software moves over time.
const BUMP_WEIGHTS = { major: 5, minor: 15, patch: 80 } as const;

// Safety cap so the timeline walker can't run away if the timing config
// is misconfigured (e.g., minSafeWindowDays = 0).
const MAX_WALK_STEPS = 10_000;

type BumpType = 'patch' | 'minor' | 'major';

const pickBumpType = (prng: Prng): BumpType => {
  const roll = prng.nextInt(0, 99);
  if (roll < BUMP_WEIGHTS.major) return 'major';
  if (roll < BUMP_WEIGHTS.major + BUMP_WEIGHTS.minor) return 'minor';
  return 'patch';
};

// Pure bump on a version tuple. Never mutates the input.
export const bumpTuple = (tuple: readonly number[], bumpType: BumpType): readonly number[] => {
  const result = [...tuple];
  if (bumpType === 'major') {
    result[0] = (result[0] ?? 0) + 1;
    if (result.length > 1) result[1] = 0;
    if (result.length > 2) result[2] = 0;
  } else if (bumpType === 'minor' && result.length > 1) {
    result[1] = (result[1] ?? 0) + 1;
    if (result.length > 2) result[2] = 0;
  } else {
    // patch (or minor on a 1-element tuple — just bump the last)
    const last = result.length - 1;
    result[last] = (result[last] ?? 0) + 1;
  }
  return result;
};

// Generic walker: build a procedural timeline for any VersionTemplate + PRNG
// seed key. Walks forward from the template's starting tuple, accumulating
// randomized day-gaps until the most recent version's publishedAt exceeds
// `upToPublishedAt`. Determinism comes from the caller-supplied prngKey.
//
// This is the building block used by both service timelines and router
// firmware timelines — pass the relevant template record and a key that
// uniquely identifies the entity being walked.
export const buildTimelineFromTemplate = (
  template: VersionTemplate,
  prngKey: string,
  upToPublishedAt: number,
  timing: TimelineTiming,
): readonly GeneratedVersion[] => {
  const prng = createPrng(prngKey);
  // Side-PRNG for patch-delay draws. Keyed off the same prngKey but distinct,
  // so adding patchDelay leaves the main walk's gap/bump stream untouched.
  const patchDelayPrng = createPrng(`${prngKey}:patchDelay`);
  const result: GeneratedVersion[] = [];
  let tuple: readonly number[] = template.startTuple;
  let publishedAt = 0;
  let index = 0;

  while (publishedAt <= upToPublishedAt && index < MAX_WALK_STEPS) {
    const gap = prng.nextInt(timing.minSafeWindowDays, timing.maxSafeWindowDays);
    publishedAt += gap;
    const patchDelay = patchDelayPrng.nextInt(timing.minPatchDelayDays, timing.maxPatchDelayDays);

    result.push({
      version: formatVersion(template, tuple),
      tuple: [...tuple],
      index,
      publishedAt,
      patchDelay,
    });

    tuple = bumpTuple(tuple, pickBumpType(prng));
    index++;
  }

  return result;
};

// Service-specific wrapper around buildTimelineFromTemplate. Resolves the
// template via the serviceTemplates pool and seeds with `timeline:${service}`.
// Returns an empty timeline for services with no registered template.
export const buildTimeline = (
  service: string,
  upToPublishedAt: number,
  timing: TimelineTiming,
): readonly GeneratedVersion[] => {
  const template = serviceTemplates[service];
  if (!template) return [];
  return buildTimelineFromTemplate(template, `timeline:${service}`, upToPublishedAt, timing);
};

// Returns the newest procedurally-generated version whose CVE has not yet
// been "published" at the given gameTime AND whose release has occurred.
// A fix (the next entry after a vulnerable one) is only released once the
// patch delay has elapsed: `prev.publishedAt + prev.patchDelay <= gameTime`.
// During the gap, no fix is available — the function returns undefined.
//
// apt upgrade uses this to pick its upgrade target; undefined signals that
// the service is in its patch-delay gap and must be defended by other means.
export const findLatestSafeVersion = (
  service: string,
  gameTime: number,
  timing: TimelineTiming,
): string | undefined => {
  const template = serviceTemplates[service];
  if (!template) return undefined;

  const timeline = buildTimeline(service, gameTime, timing);
  const i = timeline.findIndex((e) => e.publishedAt > gameTime);
  if (i === -1) return undefined;
  const entry = timeline[i]!;
  if (i === 0) return entry.version;
  const prev = timeline[i - 1]!;
  if (prev.publishedAt + prev.patchDelay <= gameTime) return entry.version;
  return undefined;
};

// Walks the procedural timeline looking for a specific version string.
// Returns the matching entry if found within a reasonable walk budget,
// or undefined. Used by findVulnForService's layer-2 lookup.
export const findGeneratedVersion = (
  service: string,
  version: string,
  gameTime: number,
  timing: TimelineTiming,
): GeneratedVersion | undefined => {
  // Walk up to ~2x the max safe window past the current game time. That's
  // enough to catch any version the player could currently have installed
  // via a prior apt upgrade, without walking forever into the future.
  const walkCap = gameTime + timing.maxSafeWindowDays * 2;
  const timeline = buildTimeline(service, walkCap, timing);
  return timeline.find((e) => e.version === version);
};
