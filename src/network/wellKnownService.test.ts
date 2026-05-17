import { describe, it, expect } from 'vitest';
import { serviceForPort } from './wellKnownService';

describe('serviceForPort', () => {
  it.each([
    [22, 'ssh'],
    [21, 'ftp'],
    [80, 'http'],
    [443, 'https'],
    [8080, 'http-alt'],
    [3306, 'mysql'],
    [6379, 'redis'],
    [161, 'snmp'],
    [25, 'smtp'],
    [53, 'dns'],
  ])('maps port %d to %s', (port, expected) => {
    expect(serviceForPort(port)).toBe(expected);
  });

  it('returns undefined for unknown ports', () => {
    // Anything not in the well-known set falls back so callers can pick a
    // sentinel (e.g., "unknown" in the cross-LAN forward synthesizer).
    expect(serviceForPort(12345)).toBeUndefined();
    expect(serviceForPort(9999)).toBeUndefined();
  });
});
