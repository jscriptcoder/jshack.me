import { describe, expect, it } from 'vitest';

import { generatePid, resolveHostname, resolveLogSourceIP } from './utils';

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

describe('resolveLogSourceIP', () => {
  it('returns session machine IP when not on localhost', () => {
    expect(resolveLogSourceIP('10.45.12.50', '10.45.12.75', '10.45.12.100', '203.45.67.89')).toBe(
      '10.45.12.50',
    );
  });

  it('returns LAN IP when on localhost and target is on same /24 subnet', () => {
    expect(resolveLogSourceIP('localhost', '10.45.12.50', '10.45.12.100', '203.45.67.89')).toBe(
      '10.45.12.100',
    );
  });

  it('returns public IP when on localhost and target is on a different network', () => {
    expect(resolveLogSourceIP('localhost', '203.45.67.89', '10.45.12.100', '198.51.100.42')).toBe(
      '198.51.100.42',
    );
  });

  it('returns public IP for mission internal IPs behind NAT', () => {
    expect(resolveLogSourceIP('localhost', '10.0.1.10', '10.45.12.100', '198.51.100.42')).toBe(
      '198.51.100.42',
    );
  });

  it('falls back to LAN IP when public IP is not available', () => {
    expect(resolveLogSourceIP('localhost', '203.45.67.89', '10.45.12.100', null)).toBe(
      '10.45.12.100',
    );
  });
});
