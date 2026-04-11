import { describe, it, expect } from 'vitest';
import { defaultServiceVersion, vulnerabilityTemplates } from './vulnerabilities';

describe('defaultServiceVersion', () => {
  it('returns a version that does not match any CVE entry in the table', () => {
    // Regression guard: if someone accidentally picks a default version that
    // matches a CVE entry, every "safe" port in the game would become
    // exploitable at runtime via findVulnForService.
    const defaultVersion = defaultServiceVersion('http');
    const matches = vulnerabilityTemplates.filter(
      (t) => t.vulnerability.serviceVersion === defaultVersion,
    );
    expect(matches).toHaveLength(0);
  });
});

describe('vulnerabilityTemplates — data invariants', () => {
  it('each (service, version) pair has exactly one CVE entry (1:1 invariant)', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const template of vulnerabilityTemplates) {
      const key = `${template.service}:${template.vulnerability.serviceVersion}`;
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
    }
    expect(duplicates).toHaveLength(0);
  });

  it('every existing CVE has publishedAt = 0 (classic, always active)', () => {
    for (const template of vulnerabilityTemplates) {
      expect(template.vulnerability.publishedAt).toBe(0);
    }
  });

  it('no existing CVE is labeled info (info tier is Phase 4 territory)', () => {
    const infoCves = vulnerabilityTemplates.filter((t) => t.vulnerability.severity === 'info');
    expect(infoCves).toHaveLength(0);
  });
});
