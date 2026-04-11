import { describe, it, expect } from 'vitest';
import { getLatestSafeVersion, CVE_TIMING_CONFIG, DEFAULT_LATEST_VERSION } from './config';
import { findVulnForService } from '../pools/vulnerabilities';

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
