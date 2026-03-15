import { describe, it, expect, vi } from 'vitest';
import { createAcceptCommand, formatMissionBriefing } from './accept';
import { generateMissionNetwork } from '../generation/generateMission';

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

  it('shows target, difficulty, and client email in briefing', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    const result = accept.fn('MEDTECH-4A7F-easy') as string;

    expect(result).toContain('Difficulty: easy');
    expect(result).toContain('Target:');
    expect(result).toContain('Reply to:');
    expect(result).toContain('@darkmail.onion');
  });

  it('shows target as IP or domain', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    const result = accept.fn('MEDTECH-4A7F-easy') as string;

    expect(result).toMatch(/Target: (\d+\.\d+\.\d+\.\d+|[\w-]+\.mission)/);
  });

  it('shows mail example in briefing for non-script_fix objectives', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    const result = accept.fn('test-exfiltrate-easy') as string;

    expect(result).toContain('mail(');
  });

  it('shows mail example for script_fix objectives', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    const result = accept.fn('test-script-fix-easy') as string;

    expect(result).toContain('mail(');
    expect(result).toContain('nano()');
    expect(result).toContain('node()');
    expect(result).toContain('ACCESS-KEY');
  });

  it('shows domain instead of IP for domain entry missions', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    const result = accept.fn('test-domain-easy') as string;

    expect(result).toMatch(/Target:.*\.mission/);
    expect(result).not.toMatch(/Target:.*\d+\.\d+\.\d+\.\d+/);
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

  it('shows sabotage briefing with boot file instructions', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    const result = accept.fn('test-sabotage-easy') as string;

    expect(result).toContain('mail(');
    expect(result).toContain('boot files');
    expect(result).toContain('reboot');
    expect(result).toContain('done');
  });
});

describe('formatMissionBriefing', () => {
  it('includes objective hint in briefing', () => {
    const mission = generateMissionNetwork('test-ssh-easy');
    const briefing = formatMissionBriefing(mission);

    expect(briefing).toContain('MISSION BRIEFING');
    expect(briefing).toContain('Objective:');
  });

  it('SNMP variant includes hint about legacy management protocols', () => {
    const mission = generateMissionNetwork('test-snmp-hard-router-first');
    expect(mission.entryVariant).toBe('snmp');
    const briefing = formatMissionBriefing(mission);

    expect(briefing).toContain('legacy management');
    expect(briefing).toContain('community');
  });

  it('does not contain command hints like nmap() or nslookup()', () => {
    const seeds = [
      'test-ssh-easy',
      'test-ftp-easy',
      'test-nc-easy',
      'test-exploit-easy',
      'test-http-easy',
    ];

    for (const seed of seeds) {
      const mission = generateMissionNetwork(seed);
      const briefing = formatMissionBriefing(mission);

      expect(briefing).not.toContain('nmap(');
      expect(briefing).not.toContain('nslookup(');
      expect(briefing).not.toContain('ftp(');
      expect(briefing).not.toContain('nc(');
      expect(briefing).not.toContain('exploit(');
      expect(briefing).not.toContain('curl(');
    }
  });
});
