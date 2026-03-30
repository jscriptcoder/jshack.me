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
    expect(result).toContain('done');
  });

  it('shows root password in script_fix briefing', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    const result = accept.fn('test-script-fix-easy') as string;

    expect(result).toContain('Root password:');
  });

  it('shows script_auto briefing with instructions hint', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    const result = accept.fn('test-script-auto-easy') as string;

    expect(result).toContain('mail(');
    expect(result).toContain('node()');
    expect(result).toContain('done');
    expect(result).toContain('Root password:');
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

    expect(() => accept.fn('')).toThrow('accept: missing seed');
  });

  it('throws for non-string seed', () => {
    const accept = createAcceptCommand({ startMission: vi.fn(), isMissionActive: () => false });

    expect(() => accept.fn(42)).toThrow('accept: missing seed');
  });

  it('throws for undefined seed', () => {
    const accept = createAcceptCommand({ startMission: vi.fn(), isMissionActive: () => false });

    expect(() => accept.fn()).toThrow('accept: missing seed');
  });

  it('throws when a mission is already active', () => {
    const accept = createAcceptCommand({ startMission: vi.fn(), isMissionActive: () => true });

    expect(() => accept.fn('SOME-SEED')).toThrow('A mission is already active');
  });

  it('shows backdoor briefing with port and nc instructions', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    const result = accept.fn('test-backdoor-easy') as string;

    expect(result).toContain('mail(');
    expect(result).toContain('backdoor');
    expect(result).toContain('nc(');
    expect(result).toContain('done');
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

  it('shows portforward briefing with NAT forwarding hint', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    const result = accept.fn('test-snmp-easy-portforward') as string;

    expect(result).toContain('mail(');
    expect(result).toContain('NAT port forwarding');
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

  it('SNMP variant does not include SNMP-specific entry hints in briefing', () => {
    const mission = generateMissionNetwork('test-snmp-hard-router-first');
    expect(mission.entryVariant).toBe('snmp');
    const briefing = formatMissionBriefing(mission);

    // SNMP entry has no hints about SNMP/community strings — player must discover independently
    expect(briefing).not.toContain('legacy management');
    expect(briefing).not.toContain('community');
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
      const isBackdoor = mission.objective.type === 'backdoor';

      expect(briefing).not.toContain('nmap(');
      expect(briefing).not.toContain('nslookup(');
      expect(briefing).not.toContain('ftp(');
      // backdoor objectives legitimately contain nc("-l", ...) in the hint
      if (!isBackdoor) expect(briefing).not.toContain('nc(');
      expect(briefing).not.toContain('msfconsole(');
      expect(briefing).not.toContain('curl(');
    }
  });

  it('forensics briefing includes investigation instructions', () => {
    const mission = generateMissionNetwork('test-forensics-easy');
    const briefing = formatMissionBriefing(mission);

    expect(mission.objective.type).toBe('forensics');
    // The hint should mention searching logs, not stealing passwords
    expect(briefing).toContain('Investigate');
    expect(briefing).toContain('logs');
    expect(briefing).not.toContain('Discover the root password');
  });

  it('malware briefing includes neutralization instructions', () => {
    const mission = generateMissionNetwork('test-malware-easy');
    const briefing = formatMissionBriefing(mission);

    expect(mission.objective.type).toBe('malware');
    expect(briefing).toContain('compromised');
    expect(briefing).toContain('kill');
    expect(briefing).toContain('Root password:');
  });

  it('briefing does not reveal network topology', () => {
    const seeds = ['test-medium', 'test-hard-router-first', 'test-easy'];
    for (const seed of seeds) {
      const mission = generateMissionNetwork(seed);
      const briefing = formatMissionBriefing(mission);
      expect(briefing).not.toContain('segmented');
      expect(briefing).not.toContain('gateway');
      expect(briefing).not.toContain('subnet');
      expect(briefing).not.toContain('layer');
    }
  });
});
