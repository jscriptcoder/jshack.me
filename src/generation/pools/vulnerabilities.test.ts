import { describe, it, expect } from 'vitest';
import { findVulnForService } from './vulnerabilities';

describe('findVulnForService', () => {
  it('returns the matching vulnerability when service and version both match a CVE entry', () => {
    const vuln = findVulnForService('http', 'Apache/2.4.49');
    expect(vuln?.cve).toBe('CVE-2021-41773');
  });

  it('returns undefined when the service matches but the version does not', () => {
    const vuln = findVulnForService('http', 'Apache/999.0.0');
    expect(vuln).toBeUndefined();
  });

  it('returns undefined when the service does not match any CVE entry', () => {
    const vuln = findVulnForService('unknown-service', 'any-version');
    expect(vuln).toBeUndefined();
  });

  it('returns a different CVE for the same service on a different vulnerable version', () => {
    const vuln = findVulnForService('http', 'Apache/2.4.25');
    expect(vuln?.cve).toBe('CVE-2017-7679');
  });

  it('returns undefined when the service is wrong even if the version matches a CVE under a different service', () => {
    // Apache/2.4.49 is a vulnerable version for 'http', not for 'mysql'.
    // Pins that service matching is required, not just version matching.
    const vuln = findVulnForService('mysql', 'Apache/2.4.49');
    expect(vuln).toBeUndefined();
  });
});
