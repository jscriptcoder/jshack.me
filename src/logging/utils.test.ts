import { describe, expect, it } from 'vitest';

import { generatePid, resolveHostname } from './utils';

describe('generatePid', () => {
  it('returns a number between 1000 and 9999', () => {
    for (let i = 0; i < 100; i++) {
      const pid = generatePid();
      expect(pid).toBeGreaterThanOrEqual(1000);
      expect(pid).toBeLessThanOrEqual(9999);
    }
  });
});

describe('resolveHostname', () => {
  it('returns "localhost" for localhost machine', () => {
    const getMachine = () => undefined;
    expect(resolveHostname('localhost', getMachine)).toBe('localhost');
  });

  it('returns hostname from getMachine for remote machines', () => {
    const getMachine = (ip: string) =>
      ip === '192.168.1.10' ? { hostname: 'webserver' } : undefined;
    expect(resolveHostname('192.168.1.10', getMachine)).toBe('webserver');
  });

  it('falls back to IP when getMachine returns undefined', () => {
    const getMachine = () => undefined;
    expect(resolveHostname('10.0.0.5', getMachine)).toBe('10.0.0.5');
  });
});
