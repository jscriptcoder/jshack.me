import { describe, it, expect } from 'vitest';
import {
  getLatestSafeVersion,
  CVE_TIMING_CONFIG,
  DEFAULT_LATEST_VERSION,
  assertCveTimingInvariants,
} from './config';
import { findVulnForService } from '../vulnerabilityLookup';

describe('CVE_TIMING_CONFIG', () => {
  it('exposes tuning knobs with sane defaults', () => {
    expect(CVE_TIMING_CONFIG.minSafeWindowDays).toBeGreaterThan(0);
    expect(CVE_TIMING_CONFIG.maxSafeWindowDays).toBeGreaterThan(
      CVE_TIMING_CONFIG.minSafeWindowDays,
    );
    expect(CVE_TIMING_CONFIG.bumpWeights.major).toBeGreaterThan(0);
    expect(CVE_TIMING_CONFIG.bumpWeights.minor).toBeGreaterThan(
      CVE_TIMING_CONFIG.bumpWeights.major,
    );
    expect(CVE_TIMING_CONFIG.bumpWeights.patch).toBeGreaterThan(
      CVE_TIMING_CONFIG.bumpWeights.minor,
    );
  });

  it('exposes patch-delay knobs with sane defaults', () => {
    expect(CVE_TIMING_CONFIG.minPatchDelayDays).toBeGreaterThanOrEqual(1);
    expect(CVE_TIMING_CONFIG.maxPatchDelayDays).toBeGreaterThanOrEqual(
      CVE_TIMING_CONFIG.minPatchDelayDays,
    );
  });

  it('satisfies the invariant: minSafeWindowDays > maxPatchDelayDays', () => {
    // If a CVE's patch delay could meet or exceed the minimum gap between
    // consecutive CVEs, a service's next version would be released at (or
    // after) the time that version itself becomes vulnerable — leaving the
    // player with no safe window at all. The invariant guards against it.
    expect(() => assertCveTimingInvariants(CVE_TIMING_CONFIG)).not.toThrow();
  });

  it('targets a fast-enough cadence to feel in a single session', () => {
    // Average gap = (min + max) / 2. ~365 days / avg gap ≈ bumps per year.
    // Tuned for ~40 bumps per year per service so a typical 15-service
    // network sees multiple CVEs land per real day.
    const avgGap = (CVE_TIMING_CONFIG.minSafeWindowDays + CVE_TIMING_CONFIG.maxSafeWindowDays) / 2;
    const bumpsPerYear = 365 / avgGap;
    expect(bumpsPerYear).toBeGreaterThan(20);
    expect(bumpsPerYear).toBeLessThan(100);
  });
});

describe('assertCveTimingInvariants', () => {
  const validConfig = {
    minSafeWindowDays: 3,
    maxSafeWindowDays: 14,
    minPatchDelayDays: 1,
    maxPatchDelayDays: 2,
    bumpWeights: { major: 5, minor: 15, patch: 80 },
  } as const;

  it('accepts a valid config', () => {
    expect(() => assertCveTimingInvariants(validConfig)).not.toThrow();
  });

  it('throws when maxPatchDelayDays equals minSafeWindowDays (no guaranteed safe window)', () => {
    expect(() => assertCveTimingInvariants({ ...validConfig, maxPatchDelayDays: 3 })).toThrow(
      /safe window/i,
    );
  });

  it('throws when maxPatchDelayDays exceeds minSafeWindowDays', () => {
    expect(() => assertCveTimingInvariants({ ...validConfig, maxPatchDelayDays: 5 })).toThrow(
      /safe window/i,
    );
  });
});

describe('getLatestSafeVersion', () => {
  it('returns a procedural version for services with a template', () => {
    const version = getLatestSafeVersion('http', 0);
    expect(version).toMatch(/^Apache\//);
  });

  it('returns DEFAULT_LATEST_VERSION for services with no template', () => {
    const version = getLatestSafeVersion('no-such-service', 0);
    expect(version).toBe(DEFAULT_LATEST_VERSION);
  });

  it('returns a version whose CVE is not yet published at the given gameTime', () => {
    const gameTime = 0;
    const version = getLatestSafeVersion('http', gameTime);
    expect(findVulnForService('http', version, gameTime)).toBeUndefined();
  });

  it('eventually returns a different version as game time advances', () => {
    const day0 = getLatestSafeVersion('http', 0);
    const day1000 = getLatestSafeVersion('http', 1000);
    expect(day0).not.toBe(day1000);
  });

  it('is deterministic for the same service and gameTime', () => {
    expect(getLatestSafeVersion('http', 100)).toBe(getLatestSafeVersion('http', 100));
  });

  it('produces different versions for different services', () => {
    expect(getLatestSafeVersion('http', 0)).not.toBe(getLatestSafeVersion('mysql', 0));
  });
});
