import { findLatestSafeVersion } from './walker';

// Phase 3 PR B: procedural per-service version timelines drive `apt upgrade`.
// Each service has a VersionTemplate in pools/serviceTemplates.ts; the
// walker in ./walker.ts walks forward from the starting tuple, bumping
// (weighted random patch/minor/major) and accumulating randomized day-gaps
// to produce publishedAt values. At any game time, `apt upgrade` picks the
// latest version whose CVE has not yet published — giving the player the
// longest breathing window until the next forced upgrade.
//
// Cadence: CVE_TIMING_CONFIG below. Tuned for ~40 CVEs per year per
// service, giving roughly one new CVE every 12-14 hours across a typical
// set of ~15 running services — enough churn that a single play session
// sees real treadmill pressure. Retune to change pace.

type CveTimingConfig = {
  readonly minSafeWindowDays: number;
  readonly maxSafeWindowDays: number;
  readonly minPatchDelayDays: number;
  readonly maxPatchDelayDays: number;
  readonly bumpWeights: { readonly major: number; readonly minor: number; readonly patch: number };
};

export const CVE_TIMING_CONFIG = {
  // Shortest gap (in game days) between one CVE publishing and the next
  // for the same service. A smaller number makes the treadmill faster.
  // Held strictly above maxPatchDelayDays so every fix has a guaranteed
  // positive safe window (see assertCveTimingInvariants).
  minSafeWindowDays: 3,
  // Longest gap. Average = (min + max) / 2 = ~8.5 days per CVE per service
  // with the current values, giving roughly 43 bumps per year per service.
  maxSafeWindowDays: 14,
  // Patch delay: days between a CVE publishing and its fix (the next version)
  // becoming available via `apt upgrade`. Randomized per-CVE in the
  // [min, max] range. During the gap, the affected service is vulnerable
  // and no fix exists — players must defend by other means.
  minPatchDelayDays: 1,
  maxPatchDelayDays: 2,
  // Distribution weights for procedural version bumping. ~80% patch bumps,
  // ~15% minor, ~5% major. Over years of play this produces realistic
  // progression like Apache/2.4.60 → 2.4.72 → 2.5.0 → 2.5.8 → 3.0.0.
  bumpWeights: { major: 5, minor: 15, patch: 80 },
} as const;

// Module-load invariant: the worst-case patch delay must stay strictly
// below the minimum gap between CVEs. If maxPatchDelayDays >= minSafeWindowDays,
// a fix could be released at (or after) the next version's own CVE drops,
// leaving the player no safe window at all. Throws on import when violated.
export const assertCveTimingInvariants = (config: CveTimingConfig): void => {
  if (config.maxPatchDelayDays >= config.minSafeWindowDays) {
    throw new Error(
      `CVE_TIMING_CONFIG: maxPatchDelayDays (${config.maxPatchDelayDays}) must be strictly less than minSafeWindowDays (${config.minSafeWindowDays}) to guarantee a positive safe window after every fix.`,
    );
  }
};

assertCveTimingInvariants(CVE_TIMING_CONFIG);

// Fallback sentinel used by apt upgrade when a service has no version
// template registered. Guaranteed not to match any CVE in the hand-authored
// vulnerabilityTemplates table.
export const DEFAULT_LATEST_VERSION = 'latest';

// Public entry point: returns the "currently latest safe" version for a
// service at the given game time, with CVE_TIMING_CONFIG bound as timing.
// Falls back to DEFAULT_LATEST_VERSION for services without a template.
export const getLatestSafeVersion = (service: string, gameTime: number): string => {
  return findLatestSafeVersion(service, gameTime, CVE_TIMING_CONFIG) ?? DEFAULT_LATEST_VERSION;
};
