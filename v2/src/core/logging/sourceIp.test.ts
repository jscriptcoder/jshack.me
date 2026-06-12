import { describe, expect, it } from 'vitest';
import { resolveLogSourceIP } from './sourceIp';

/**
 * Source-IP resolution for the line a scan/connection leaves on a TARGET
 * machine — mirrors how a real network records the source of an incoming
 * packet. Ported from legacy `src/logging/utils.ts:resolveLogSourceIP`.
 * The same-LAN-leaks-the-LAN-IP rule is load-bearing realism + defender
 * gameplay (`feedback_log_source_ip_realism`), so it is pinned by tests.
 */

describe('resolveLogSourceIP', () => {
  it('uses the session machine IP when operating from a remote session', () => {
    // On a remote box (e.g. an ssh session), the target sees that box's IP,
    // not our workstation's — even if subnets would otherwise match.
    const source = resolveLogSourceIP({
      sessionMachine: '198.51.100.7',
      ownWorkstationId: 'workstation-abc',
      targetIp: '198.51.100.200',
      localIp: '192.168.1.50',
      publicIp: '203.0.113.9',
    });

    expect(source).toBe('198.51.100.7');
  });

  it('leaks the LAN IP when scanning a target on the same /24 from our own box', () => {
    const source = resolveLogSourceIP({
      sessionMachine: 'workstation-abc',
      ownWorkstationId: 'workstation-abc',
      targetIp: '192.168.1.99',
      localIp: '192.168.1.50',
      publicIp: '203.0.113.9',
    });

    expect(source).toBe('192.168.1.50');
  });

  it('NATs through the home-router public IP when the target is on a different network', () => {
    const source = resolveLogSourceIP({
      sessionMachine: 'workstation-abc',
      ownWorkstationId: 'workstation-abc',
      targetIp: '192.168.2.99',
      localIp: '192.168.1.50',
      publicIp: '203.0.113.9',
    });

    expect(source).toBe('203.0.113.9');
  });

  it('matches subnets per-octet, not by digit concatenation', () => {
    // 12.1.68.x and 1.21.68.x share the same digits but are different /24s.
    // A digit-concatenation subnet check ("12168" === "12168") would wrongly
    // treat them as one LAN and leak the LAN IP; octet-aware matching NATs.
    const source = resolveLogSourceIP({
      sessionMachine: 'workstation-abc',
      ownWorkstationId: 'workstation-abc',
      targetIp: '1.21.68.9',
      localIp: '12.1.68.5',
      publicIp: '203.0.113.9',
    });

    expect(source).toBe('203.0.113.9');
  });

  it('falls back to the LAN IP off-network when there is no public IP (offline-ish)', () => {
    const source = resolveLogSourceIP({
      sessionMachine: 'workstation-abc',
      ownWorkstationId: 'workstation-abc',
      targetIp: '10.0.0.5',
      localIp: '192.168.1.50',
      publicIp: null,
    });

    expect(source).toBe('192.168.1.50');
  });
});
