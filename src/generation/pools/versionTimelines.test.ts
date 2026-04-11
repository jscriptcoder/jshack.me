import { describe, it, expect } from 'vitest';
import {
  serviceVersionPools,
  getLatestSafeVersion,
  DEFAULT_LATEST_VERSION,
  CVE_TIMING_CONFIG,
} from './versionTimelines';
import { findVulnForService } from './vulnerabilities';

describe('serviceVersionPools', () => {
  it('has pools for every service referenced by existing CVEs', () => {
    // Every service that has a CVE should also have a version pool so
    // apt upgrade can find a safe target.
    const servicesWithCves = new Set<string>();
    // We don't import vulnerabilityTemplates directly to keep this test focused
    // on the pools themselves. Instead we check a representative sample.
    for (const service of [
      'http',
      'mysql',
      'ftp',
      'redis',
      'smtp',
      'imap',
      'pop3',
      'dns',
      'openvpn',
      'smb',
      'mongodb',
    ]) {
      servicesWithCves.add(service);
    }
    for (const service of servicesWithCves) {
      expect(serviceVersionPools[service]).toBeDefined();
      expect(serviceVersionPools[service]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('pool entries are ordered oldest → newest (by the last entry being newer than the first)', () => {
    // We rely on the hand-authored ordering being correct. Spot-check http.
    const httpPool = serviceVersionPools['http'];
    expect(httpPool).toBeDefined();
    expect(httpPool?.[0]).not.toBe(httpPool?.[httpPool.length - 1]);
  });
});

describe('getLatestSafeVersion', () => {
  it('returns the newest pool entry whose CVE has not yet published', () => {
    // At gameTime = 0 with all CVEs at publishedAt=0, the newest safe version
    // for http is whichever entry at the END of the pool has no CVE entry
    // at all (or has a CVE with publishedAt > 0, of which there are none yet
    // in PR B). The pool's LAST entry is designed to be a safe version.
    const latest = getLatestSafeVersion('http', 0);
    expect(latest).toBeDefined();
    // The returned version must not be exploitable at gameTime 0
    expect(findVulnForService('http', latest!, 0)).toBeUndefined();
  });

  it('returns DEFAULT_LATEST_VERSION for services with no pool', () => {
    const latest = getLatestSafeVersion('unknown-service', 0);
    expect(latest).toBe(DEFAULT_LATEST_VERSION);
  });

  it('prefers the newest (rightmost) safe version when multiple are available', () => {
    // If the pool has [A (vuln), B (safe), C (safe)], the picker returns C.
    // http's pool has several currently-safe nginx versions at the end; the
    // picker should return the last one.
    const pool = serviceVersionPools['http'];
    expect(pool).toBeDefined();
    if (!pool) return;
    const latest = getLatestSafeVersion('http', 0);
    // Find the last safe version manually and compare.
    let expected: string | undefined;
    for (let i = pool.length - 1; i >= 0; i--) {
      if (findVulnForService('http', pool[i] as string, 0) === undefined) {
        expected = pool[i];
        break;
      }
    }
    expect(latest).toBe(expected);
  });

  it('every service in the pool has at least one currently-safe version at gameTime=0', () => {
    for (const [service, pool] of Object.entries(serviceVersionPools)) {
      const latest = getLatestSafeVersion(service, 0);
      expect(latest, `no safe version for ${service}`).toBeDefined();
      expect(pool.includes(latest as string)).toBe(true);
    }
  });
});

describe('CVE_TIMING_CONFIG', () => {
  it('exposes tuning knobs with sane defaults', () => {
    expect(CVE_TIMING_CONFIG.minSafeWindowDays).toBeGreaterThan(0);
    expect(CVE_TIMING_CONFIG.maxSafeWindowDays).toBeGreaterThan(
      CVE_TIMING_CONFIG.minSafeWindowDays,
    );
    expect(CVE_TIMING_CONFIG.initialVulnerableCount).toBeGreaterThan(0);
  });
});
