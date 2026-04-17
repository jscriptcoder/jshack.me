import { describe, it, expect } from 'vitest';
import { buildGeneratedVuln } from './generatedVuln';
import { describeEffect } from '../describeEffect';
import type { GeneratedVersion } from './walker';

describe('buildGeneratedVuln', () => {
  const mkEntry = (version: string, index: number, publishedAt: number): GeneratedVersion => ({
    version,
    tuple: [2, 4, 60 + index],
    index,
    publishedAt,
  });

  it('produces a Vulnerability with all required fields', () => {
    const vuln = buildGeneratedVuln('http', mkEntry('Apache/2.4.61', 1, 30));
    expect(vuln.cve).toMatch(/^CVE-\d{4}-\d{7}$/);
    expect(vuln.description).toContain('Apache/2.4.61');
    expect(vuln.serviceVersion).toBe('Apache/2.4.61');
    expect(vuln.attackPattern).toBeDefined();
    expect(['critical', 'high', 'medium', 'low']).toContain(vuln.severity);
    expect(vuln.publishedAt).toBe(30);
  });

  it('is deterministic for the same (service, index)', () => {
    const a = buildGeneratedVuln('http', mkEntry('Apache/2.4.61', 1, 30));
    const b = buildGeneratedVuln('http', mkEntry('Apache/2.4.61', 1, 30));
    expect(a).toEqual(b);
  });

  it('produces different CVEs for different indexes', () => {
    const a = buildGeneratedVuln('http', mkEntry('Apache/2.4.61', 1, 30));
    const b = buildGeneratedVuln('http', mkEntry('Apache/2.4.62', 2, 60));
    expect(a.cve).not.toBe(b.cve);
  });

  it('never produces info severity in Phase 3', () => {
    for (let index = 0; index < 50; index++) {
      const vuln = buildGeneratedVuln(
        'http',
        mkEntry(`Apache/2.4.${60 + index}`, index, 30 * (index + 1)),
      );
      expect(vuln.severity).not.toBe('info');
    }
  });

  it('falls back to syslog attack pattern for services with no template', () => {
    const vuln = buildGeneratedVuln('no-such-service', mkEntry('Something/1.0.0', 0, 30));
    expect(vuln.attackPattern.logFile).toBe('/var/log/syslog');
  });

  it('includes an effect field with a valid kind', () => {
    const vuln = buildGeneratedVuln('http', mkEntry('Apache/2.4.61', 1, 30));
    expect(vuln.effect).toBeDefined();
    expect(vuln.effect.kind).toBeDefined();
  });

  it('effect is deterministic for the same (service, index)', () => {
    const a = buildGeneratedVuln('http', mkEntry('Apache/2.4.61', 1, 30));
    const b = buildGeneratedVuln('http', mkEntry('Apache/2.4.61', 1, 30));
    expect(a.effect).toEqual(b.effect);
  });

  it('description is coherent with the effect kind (uses describeEffect)', () => {
    // Walk many (service, index) pairs; every generated description must
    // equal describeEffect(service, version, cve, effect). Catches any
    // regression where the template drifts from the effect.
    const services = ['ssh', 'http', 'ftp', 'mysql', 'redis', 'smb', 'mongodb', 'dns'];
    for (const service of services) {
      for (let index = 0; index < 20; index++) {
        const vuln = buildGeneratedVuln(
          service,
          mkEntry(`${service}/1.0.${index}`, index, 30 * (index + 1)),
        );
        expect(vuln.description).toBe(
          describeEffect(service, vuln.serviceVersion, vuln.cve, vuln.effect),
        );
      }
    }
  });

  it('produces unique CVE ids across services and indexes (no collisions)', () => {
    // Exhaustive check: walk every service template at many indexes and
    // confirm no two generated CVE ids collide. This is the core guarantee
    // — the player must never see two different vulns with the same CVE.
    const services = ['ssh', 'http', 'ftp', 'mysql', 'redis', 'smb', 'mongodb', 'dns'];
    const seen = new Set<string>();
    const collisions: string[] = [];
    for (const service of services) {
      for (let index = 0; index < 200; index++) {
        const vuln = buildGeneratedVuln(service, mkEntry(`${service}-${index}`, index, 30 * index));
        if (seen.has(vuln.cve)) collisions.push(vuln.cve);
        seen.add(vuln.cve);
      }
    }
    expect(collisions).toEqual([]);
  });
});
