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
    expect(result).toContain('45.');
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

  it('uses briefingVariantOverride for board missions', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    // GRADE-TAMPER-74 has briefingVariantOverride: 'ssh' but actual entry is exploit
    const result = accept.fn('GRADE-TAMPER-74') as string;

    // Should show SSH hint (from override) instead of nmap -sV hint (from actual variant)
    expect(result).toContain('ssh(');
    expect(result).not.toContain('nmap("-sV"');
  });
});
