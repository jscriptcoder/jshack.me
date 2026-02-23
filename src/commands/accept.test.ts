import { describe, it, expect, vi } from 'vitest';
import { createAcceptCommand } from './accept';

describe('accept command', () => {
  it('starts a mission with a valid seed', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    const result = accept.fn('MEDTECH-4A7F-easy');

    expect(startMission).toHaveBeenCalledWith(
      expect.objectContaining({ seed: 'MEDTECH-4A7F-easy' }),
    );
    expect(typeof result).toBe('string');
    expect(result).toContain('MISSION BRIEFING');
    expect(result).toContain('MEDTECH-4A7F-easy');
  });

  it('shows entry point, difficulty, and client email in briefing', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    const result = accept.fn('MEDTECH-4A7F-easy') as string;

    expect(result).toContain('Difficulty: easy');
    expect(result).toContain('Gateway:');
    // Gateway shows either IP or domain depending on domain entry mode
    expect(result).toMatch(/45\.|\.mission/);
    expect(result).toContain('Reply to:');
    expect(result).toContain('@darkmail.onion');
  });

  it('shows mail example in briefing', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    const result = accept.fn('MEDTECH-4A7F-easy') as string;

    expect(result).toContain('mail(');
  });

  it('trims whitespace from seed', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    accept.fn('  SEED-TEST  ');

    expect(startMission).toHaveBeenCalledWith(expect.objectContaining({ seed: 'SEED-TEST' }));
  });

  it('throws for empty seed', () => {
    const accept = createAcceptCommand({ startMission: vi.fn(), isMissionActive: () => false });

    expect(() => accept.fn('')).toThrow('Usage: accept("SEED-CODE")');
  });

  it('throws for non-string seed', () => {
    const accept = createAcceptCommand({ startMission: vi.fn(), isMissionActive: () => false });

    expect(() => accept.fn(42)).toThrow('Usage: accept("SEED-CODE")');
  });

  it('throws for undefined seed', () => {
    const accept = createAcceptCommand({ startMission: vi.fn(), isMissionActive: () => false });

    expect(() => accept.fn()).toThrow('Usage: accept("SEED-CODE")');
  });

  it('throws when a mission is already active', () => {
    const accept = createAcceptCommand({ startMission: vi.fn(), isMissionActive: () => true });

    expect(() => accept.fn('SOME-SEED')).toThrow('A mission is already active');
  });

  it('has correct name and description', () => {
    const accept = createAcceptCommand({ startMission: vi.fn(), isMissionActive: () => false });

    expect(accept.name).toBe('accept');
    expect(accept.description).toBeTruthy();
  });

  it('shows nslookup hint for domain entry missions', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    // "domain" keyword forces domain entry mode
    const result = accept.fn('test-domain-easy') as string;

    expect(result).toContain('nslookup(');
    expect(result).toContain('.mission');
    // Should NOT show a numeric IP in the gateway line
    expect(result).not.toMatch(/Gateway:.*\d+\.\d+\.\d+\.\d+/);
  });

  it('uses briefingVariantOverride for board missions', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    // GRADE-TAMPER-74 has briefingVariantOverride: 'ssh' but actual entry may differ
    const result = accept.fn('GRADE-TAMPER-74') as string;

    // Domain mode shows nslookup instead of variant hint; otherwise override forces SSH hint
    const isDomainMode = result.includes('nslookup(');
    if (isDomainMode) {
      expect(result).not.toContain('nmap("-sV"');
    } else {
      expect(result).toContain('ssh(');
      expect(result).not.toContain('nmap("-sV"');
    }
  });
});
