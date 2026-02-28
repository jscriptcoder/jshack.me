import { describe, it, expect, vi } from 'vitest';
import { createAcceptCommand, formatEntryHint, formatMissionBriefing } from './accept';
import { generateMissionNetwork } from '../generation/generateMission';
import type { MissionNetwork } from '../generation/types';

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

    // Target should be either an IP or a .mission domain
    expect(result).toMatch(/Target: (\d+\.\d+\.\d+\.\d+|[\w-]+\.mission)/);
  });

  it('shows mail example in briefing', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    const result = accept.fn('MEDTECH-4A7F-easy') as string;

    expect(result).toContain('mail(');
  });

  it('shows domain instead of IP for domain entry missions', () => {
    const startMission = vi.fn();
    const accept = createAcceptCommand({ startMission, isMissionActive: () => false });
    // "domain" keyword forces domain entry mode
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

  it('has correct name and description', () => {
    const accept = createAcceptCommand({ startMission: vi.fn(), isMissionActive: () => false });

    expect(accept.name).toBe('accept');
    expect(accept.description).toBeTruthy();
  });
});

describe('formatEntryHint', () => {
  const makeMission = (overrides: Partial<MissionNetwork>): MissionNetwork => {
    const base = generateMissionNetwork('test-ssh-easy');
    return { ...base, ...overrides };
  };

  it('SSH variant with credentials shown includes username and password', () => {
    const mission = makeMission({
      entryVariant: 'ssh',
      briefingRevealsCredentials: true,
      domainEntry: false,
      entryCredential: { username: 'webadmin', password: 'secret123' },
      routerPublicIp: '45.33.22.11',
    });
    const hint = formatEntryHint(mission);

    expect(hint).toContain('Intel:');
    expect(hint).toContain('SSH access available');
    expect(hint).toContain('webadmin');
    expect(hint).toContain('secret123');
    expect(hint).toContain('ssh(');
  });

  it('SSH variant with credentials hidden suggests default credentials', () => {
    const mission = makeMission({
      entryVariant: 'ssh',
      briefingRevealsCredentials: false,
      domainEntry: false,
      entryCredential: { username: 'webadmin', password: 'secret123' },
      routerPublicIp: '45.33.22.11',
    });
    const hint = formatEntryHint(mission);

    expect(hint).toContain('Intel:');
    expect(hint).toContain('default credentials');
    expect(hint).not.toContain('secret123');
    expect(hint).not.toContain('webadmin');
    expect(hint).not.toContain('ssh(');
  });

  it('SSH variant with domain entry + credentials shown omits ssh() command', () => {
    const mission = makeMission({
      entryVariant: 'ssh',
      briefingRevealsCredentials: true,
      domainEntry: true,
      routerDomain: 'web01.mission',
      entryCredential: { username: 'webadmin', password: 'secret123' },
    });
    const hint = formatEntryHint(mission);

    expect(hint).toContain('SSH access available');
    expect(hint).toContain('webadmin');
    expect(hint).toContain('secret123');
    expect(hint).not.toContain('ssh(');
    expect(hint).toContain('Resolve the target domain first');
  });

  it('FTP variant hints at FTP service', () => {
    const mission = makeMission({
      entryVariant: 'ftp',
      domainEntry: false,
    });
    const hint = formatEntryHint(mission);

    expect(hint).toContain('Intel:');
    expect(hint).toContain('FTP service');
    expect(hint).not.toContain('ssh(');
    expect(hint).not.toContain('ftp(');
  });

  it('NC variant hints at backdoor', () => {
    const mission = makeMission({
      entryVariant: 'nc',
      domainEntry: false,
    });
    const hint = formatEntryHint(mission);

    expect(hint).toContain('Intel:');
    expect(hint).toContain('backdoor');
    expect(hint).toContain('port scan');
    expect(hint).not.toContain('nc(');
    expect(hint).not.toContain('nmap(');
  });

  it('exploit variant hints at vulnerabilities', () => {
    const mission = makeMission({
      entryVariant: 'exploit',
      domainEntry: false,
    });
    const hint = formatEntryHint(mission);

    expect(hint).toContain('Intel:');
    expect(hint).toContain('outdated software');
    expect(hint).toContain('vulnerabilities');
    expect(hint).not.toContain('exploit(');
    expect(hint).not.toContain('nmap(');
  });

  it('HTTP variant hints at web server', () => {
    const mission = makeMission({
      entryVariant: 'http',
      domainEntry: false,
    });
    const hint = formatEntryHint(mission);

    expect(hint).toContain('Intel:');
    expect(hint).toContain('web server');
    expect(hint).not.toContain('curl(');
    expect(hint).not.toContain('nmap(');
  });

  it('domain entry appends resolve hint for non-SSH variants', () => {
    const mission = makeMission({
      entryVariant: 'ftp',
      domainEntry: true,
      routerDomain: 'files01.mission',
    });
    const hint = formatEntryHint(mission);

    expect(hint).toContain('Resolve the target domain first');
  });
});

describe('formatMissionBriefing', () => {
  it('includes Intel section in briefing', () => {
    const mission = generateMissionNetwork('test-ssh-easy');
    const briefing = formatMissionBriefing(mission);

    expect(briefing).toContain('Intel:');
  });

  it('never contains command names like nmap() or nslookup()', () => {
    // Test multiple seeds to cover different variants
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
