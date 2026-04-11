import { describe, it, expect } from 'vitest';
import {
  getLatestSafeVersion,
  CVE_TIMING_CONFIG,
  DEFAULT_LATEST_VERSION,
} from './versionTimelines';
import { findVulnForService } from './vulnerabilities';
import { serviceTemplates } from './versionGenerator';

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
    expect(version).toBeDefined();
    // Should start with the service template prefix
    expect(version).toMatch(/^Apache\//);
  });

  it('returns DEFAULT_LATEST_VERSION for services with no template', () => {
    const version = getLatestSafeVersion('no-such-service', 0);
    expect(version).toBe(DEFAULT_LATEST_VERSION);
  });

  it('returns a version whose CVE is not yet published at the given gameTime', () => {
    const gameTime = 0;
    const version = getLatestSafeVersion('http', gameTime);
    expect(version).toBeDefined();
    // findVulnForService should return undefined for a currently-safe version
    expect(findVulnForService('http', version!, gameTime)).toBeUndefined();
  });

  it('eventually returns a different version as game time advances', () => {
    // At day 0 and day 1000, the "latest safe" should differ for http
    // because the treadmill has advanced.
    const day0 = getLatestSafeVersion('http', 0);
    const day1000 = getLatestSafeVersion('http', 1000);
    expect(day0).toBeDefined();
    expect(day1000).toBeDefined();
    expect(day0).not.toBe(day1000);
  });

  it('is deterministic for the same service and gameTime', () => {
    const a = getLatestSafeVersion('http', 100);
    const b = getLatestSafeVersion('http', 100);
    expect(a).toBe(b);
  });

  it('produces different versions for different services', () => {
    const http = getLatestSafeVersion('http', 0);
    const mysql = getLatestSafeVersion('mysql', 0);
    // Different services must have different templates → different version strings
    expect(http).not.toBe(mysql);
  });
});

describe('serviceTemplates', () => {
  it('has a template for every service that has a hand-authored CVE', () => {
    // Spot check: every service referenced in the historical CVE table
    // should also have a template so the player can upgrade beyond its
    // hand-authored entries.
    const importantServices = [
      'http',
      'mysql',
      'ftp',
      'redis',
      'smtp',
      'imap',
      'pop3',
      'mongodb',
      'smb',
      'rsync',
    ];
    for (const service of importantServices) {
      expect(serviceTemplates[service], `missing template for ${service}`).toBeDefined();
    }
  });

  it('every template has a non-empty prefix and starting tuple', () => {
    for (const [service, template] of Object.entries(serviceTemplates)) {
      expect(template.prefix.length, `empty prefix for ${service}`).toBeGreaterThan(0);
      expect(template.startTuple.length, `empty tuple for ${service}`).toBeGreaterThan(0);
    }
  });
});
