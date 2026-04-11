import { getLatestSafeVersion as generatorLatestSafeVersion } from './versionGenerator';

// Phase 3 PR B: procedural per-service version timelines drive `apt upgrade`.
// Each service has a VersionTemplate in versionGenerator.ts; the generator
// walks forward from the starting tuple, bumping (weighted random patch/
// minor/major) and accumulating randomized day-gaps to produce publishedAt
// values. At any game time, `apt upgrade` picks the latest version whose
// CVE has not yet published — giving the player the longest breathing
// window until the next forced upgrade.
//
// Cadence: CVE_TIMING_CONFIG below. Tuned for ~10-12 CVEs per year per
// service, giving ~one new CVE every 1.5-2 days across a typical set of
// ~15 running services. Retune these numbers to change treadmill pace.

export const CVE_TIMING_CONFIG = {
  // Shortest gap (in game days) between one CVE publishing and the next
  // for the same service. A smaller number makes the treadmill faster.
  minSafeWindowDays: 14,
  // Longest gap. Average = (min + max) / 2 = ~37 days per CVE per service
  // with the current values, giving roughly 10 bumps per year per service.
  maxSafeWindowDays: 60,
  // Distribution weights for procedural version bumping. ~80% patch bumps,
  // ~15% minor, ~5% major. Over years of play this produces realistic
  // progression like Apache/2.4.60 → 2.4.72 → 2.5.0 → 2.5.8 → 3.0.0.
  bumpWeights: { major: 5, minor: 15, patch: 80 },
} as const;

// Fallback sentinel used by apt upgrade when a service has no version
// template registered in the generator. Guaranteed not to match any CVE
// in the hand-authored vulnerabilityTemplates table.
export const DEFAULT_LATEST_VERSION = 'latest';

// Returns the "currently latest safe" version for a service at the given
// game time, derived from the procedural timeline. For services without
// a template, returns DEFAULT_LATEST_VERSION.
export const getLatestSafeVersion = (service: string, gameTime: number): string | undefined => {
  const generated = generatorLatestSafeVersion(service, gameTime, CVE_TIMING_CONFIG);
  return generated ?? DEFAULT_LATEST_VERSION;
};
