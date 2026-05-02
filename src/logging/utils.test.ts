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
  // sessionMachine, ownWorkstationId, targetIP, localIP, publicIP

  it('returns the session machine IP when on a remote machine (SSH session)', () => {
    expect(
      resolveLogSourceIP(
        '10.45.12.50',
        'skylab-aabbccdd',
        '10.45.12.75',
        '10.45.12.100',
        '203.45.67.89',
      ),
    ).toBe('10.45.12.50');
  });

  it('returns the LAN IP when on own workstation and target is on the same /24', () => {
    // Same-LAN traffic doesn't traverse a NAT — the target sees our
    // LAN IP directly, matching real network behavior.
    expect(
      resolveLogSourceIP(
        'skylab-aabbccdd',
        'skylab-aabbccdd',
        '10.45.12.50',
        '10.45.12.100',
        '203.45.67.89',
      ),
    ).toBe('10.45.12.100');
  });

  it('returns the public IP when on own workstation and target is on a different network', () => {
    expect(
      resolveLogSourceIP(
        'skylab-aabbccdd',
        'skylab-aabbccdd',
        '203.45.67.89',
        '10.45.12.100',
        '198.51.100.42',
      ),
    ).toBe('198.51.100.42');
  });

  it('returns the public IP for mission internal IPs behind NAT (different /24)', () => {
    expect(
      resolveLogSourceIP(
        'skylab-aabbccdd',
        'skylab-aabbccdd',
        '10.0.1.10',
        '10.45.12.100',
        '198.51.100.42',
      ),
    ).toBe('198.51.100.42');
  });

  it('falls back to LAN IP when on own workstation and public IP is not available', () => {
    expect(
      resolveLogSourceIP(
        'skylab-aabbccdd',
        'skylab-aabbccdd',
        '203.45.67.89',
        '10.45.12.100',
        null,
      ),
    ).toBe('10.45.12.100');
  });

  it('does not leak the workstation hostname into logs', () => {
    // Regression for the bug introduced by PR #94: pre-fix, the
    // function returned 'skylab-aabbccdd' as the "source IP" because
    // the literal-localhost check no longer matched.
    const result = resolveLogSourceIP(
      'skylab-aabbccdd',
      'skylab-aabbccdd',
      '203.45.67.89',
      '10.45.12.100',
      '198.51.100.42',
    );
    expect(result).not.toContain('skylab');
  });
});
