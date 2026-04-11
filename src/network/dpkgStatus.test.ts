import { describe, it, expect } from 'vitest';
import {
  parseDpkgStatus,
  parseDpkgVersions,
  formatDpkgStatus,
  buildEntry,
  buildInitialDpkgStatus,
  setDpkgVersion,
  DPKG_STATUS_PATH,
} from './dpkgStatus';

const SAMPLE_STATUS = `Package: http
Status: install ok installed
Version: Apache/2.4.49

Package: mysql
Status: install ok installed
Version: MySQL 5.5.23

Package: ssh
Status: install ok installed
Version: OpenSSH 9.6
`;

describe('DPKG_STATUS_PATH', () => {
  it('is the real /var/lib/dpkg/status path', () => {
    expect(DPKG_STATUS_PATH).toBe('/var/lib/dpkg/status');
  });
});

describe('parseDpkgStatus', () => {
  it('parses a multi-entry status file into a Map keyed by Package', () => {
    const result = parseDpkgStatus(SAMPLE_STATUS);
    expect(result.size).toBe(3);
    expect(result.get('http')?.version).toBe('Apache/2.4.49');
    expect(result.get('mysql')?.version).toBe('MySQL 5.5.23');
    expect(result.get('ssh')?.version).toBe('OpenSSH 9.6');
  });

  it('returns an empty map for empty content', () => {
    expect(parseDpkgStatus('').size).toBe(0);
    expect(parseDpkgStatus('\n\n\n').size).toBe(0);
  });

  it('skips blocks missing a Package or Version field', () => {
    const content = `Package: http
Status: install ok installed

Package: mysql
Status: install ok installed
Version: MySQL 5.5.23
`;
    const result = parseDpkgStatus(content);
    expect(result.size).toBe(1);
    expect(result.get('mysql')?.version).toBe('MySQL 5.5.23');
  });

  it('preserves the raw block so unknown fields survive a round-trip', () => {
    const content = `Package: http
Status: install ok installed
Version: Apache/2.4.49
Architecture: amd64
Maintainer: Corp <admin@corp.local>
Description: A web server
`;
    const entry = parseDpkgStatus(content).get('http');
    expect(entry?.rawBlock).toContain('Architecture: amd64');
    expect(entry?.rawBlock).toContain('Maintainer:');
    expect(entry?.rawBlock).toContain('Description:');
  });

  it('tolerates trailing whitespace after the Version value', () => {
    const content = `Package: http
Version: Apache/2.4.49   \nStatus: install ok installed\n`;
    const result = parseDpkgStatus(content);
    expect(result.get('http')?.version).toBe('Apache/2.4.49');
  });
});

describe('parseDpkgVersions', () => {
  it('returns a simple Package → Version map', () => {
    const result = parseDpkgVersions(SAMPLE_STATUS);
    expect(result.get('http')).toBe('Apache/2.4.49');
    expect(result.get('mysql')).toBe('MySQL 5.5.23');
  });
});

describe('buildEntry', () => {
  it('produces a status block with Package, Status, and Version fields', () => {
    const entry = buildEntry('http', 'Apache/2.4.60');
    expect(entry.pkg).toBe('http');
    expect(entry.version).toBe('Apache/2.4.60');
    expect(entry.rawBlock).toContain('Package: http');
    expect(entry.rawBlock).toContain('Version: Apache/2.4.60');
    expect(entry.rawBlock).toContain('Status: install ok installed');
  });
});

describe('formatDpkgStatus', () => {
  it('round-trips a parsed file', () => {
    const entries = Array.from(parseDpkgStatus(SAMPLE_STATUS).values());
    const reformatted = formatDpkgStatus(entries);
    // Reparsing gives the same map
    const reparsed = parseDpkgStatus(reformatted);
    expect(reparsed.size).toBe(3);
    expect(reparsed.get('http')?.version).toBe('Apache/2.4.49');
    expect(reparsed.get('mysql')?.version).toBe('MySQL 5.5.23');
    expect(reparsed.get('ssh')?.version).toBe('OpenSSH 9.6');
  });
});

describe('buildInitialDpkgStatus', () => {
  it('produces one entry per unique service', () => {
    const content = buildInitialDpkgStatus([
      { service: 'ssh', serviceVersion: 'OpenSSH 9.6' },
      { service: 'http', serviceVersion: 'Apache/2.4.49' },
      { service: 'mysql', serviceVersion: 'MySQL 5.5.23' },
    ]);
    const parsed = parseDpkgStatus(content);
    expect(parsed.size).toBe(3);
    expect(parsed.get('ssh')?.version).toBe('OpenSSH 9.6');
    expect(parsed.get('http')?.version).toBe('Apache/2.4.49');
    expect(parsed.get('mysql')?.version).toBe('MySQL 5.5.23');
  });

  it('dedupes when the same service appears on multiple ports', () => {
    const content = buildInitialDpkgStatus([
      { service: 'http', serviceVersion: 'Apache/2.4.49' },
      { service: 'http', serviceVersion: 'Apache/2.4.49' },
    ]);
    expect(parseDpkgStatus(content).size).toBe(1);
  });

  it('returns an empty string for a machine with no services', () => {
    expect(buildInitialDpkgStatus([])).toBe('');
  });
});

describe('setDpkgVersion', () => {
  it('updates an existing package version, preserving other packages', () => {
    const result = setDpkgVersion(SAMPLE_STATUS, 'http', 'Apache/2.4.60');
    const parsed = parseDpkgStatus(result);
    expect(parsed.get('http')?.version).toBe('Apache/2.4.60');
    expect(parsed.get('mysql')?.version).toBe('MySQL 5.5.23');
    expect(parsed.get('ssh')?.version).toBe('OpenSSH 9.6');
  });

  it('preserves unknown fields on the updated entry', () => {
    const content = `Package: http
Status: install ok installed
Version: Apache/2.4.49
Architecture: amd64
Maintainer: Corp <admin@corp.local>
`;
    const result = setDpkgVersion(content, 'http', 'Apache/2.4.60');
    expect(result).toContain('Architecture: amd64');
    expect(result).toContain('Maintainer:');
    expect(result).toContain('Version: Apache/2.4.60');
    expect(result).not.toContain('Version: Apache/2.4.49');
  });

  it('appends a new entry when the package is not already present', () => {
    const result = setDpkgVersion(SAMPLE_STATUS, 'redis', 'Redis 7.2.4');
    const parsed = parseDpkgStatus(result);
    expect(parsed.size).toBe(4);
    expect(parsed.get('redis')?.version).toBe('Redis 7.2.4');
    // Existing packages unchanged
    expect(parsed.get('http')?.version).toBe('Apache/2.4.49');
  });

  it('can be called on an empty file to create the first entry', () => {
    const result = setDpkgVersion('', 'http', 'Apache/2.4.60');
    const parsed = parseDpkgStatus(result);
    expect(parsed.size).toBe(1);
    expect(parsed.get('http')?.version).toBe('Apache/2.4.60');
  });

  it('updates the same package twice without duplicating it', () => {
    const first = setDpkgVersion(SAMPLE_STATUS, 'http', 'Apache/2.4.60');
    const second = setDpkgVersion(first, 'http', 'Apache/2.4.62');
    const parsed = parseDpkgStatus(second);
    expect(parsed.size).toBe(3);
    expect(parsed.get('http')?.version).toBe('Apache/2.4.62');
  });
});
