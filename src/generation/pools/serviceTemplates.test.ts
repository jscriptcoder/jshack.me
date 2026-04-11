import { describe, it, expect } from 'vitest';
import { serviceTemplates, formatVersion } from './serviceTemplates';

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

  it('every template uses a non-empty separator string', () => {
    for (const template of Object.values(serviceTemplates)) {
      expect(template.separator.length).toBeGreaterThan(0);
    }
  });
});

describe('formatVersion', () => {
  it('concatenates prefix + joined tuple', () => {
    const template = { prefix: 'Apache/', separator: '.', startTuple: [2, 4, 60] };
    expect(formatVersion(template, [2, 4, 60])).toBe('Apache/2.4.60');
  });

  it('honours the template separator', () => {
    const template = { prefix: 'foo-', separator: '_', startTuple: [1, 0, 0] };
    expect(formatVersion(template, [1, 2, 3])).toBe('foo-1_2_3');
  });
});
