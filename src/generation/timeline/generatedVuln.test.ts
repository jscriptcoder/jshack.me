import { describe, it, expect } from 'vitest';
import { buildGeneratedVuln } from './generatedVuln';
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
    expect(vuln.cve).toMatch(/^CVE-\d{4}-\d{4}$/);
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
});
