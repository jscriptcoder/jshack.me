import { describe, it, expect, vi } from 'vitest';
import { createAcceptCommand, formatMissionBriefing } from './accept';
import { generateMissionNetwork } from '../generation/generateMission';
import type { AsyncOutput } from '../components/Terminal/types';

// Accept command now returns an AsyncOutput (since mission generation is async
// in B2+). This helper drives the output to completion and returns the joined
// lines, so tests can assert on the briefing text.
const collectAsync = (output: AsyncOutput): Promise<string> =>
  new Promise((resolve) => {
    const lines: string[] = [];
    output.start(
      (line) => lines.push(line),
      () => resolve(lines.join('\n')),
    );
  });

import type { MissionNetwork } from '../generation/types';

type StartMissionSpy = ReturnType<typeof vi.fn<(mission: MissionNetwork) => void>>;

const runAccept = async (
  seed: unknown,
  opts: { startMission?: StartMissionSpy; isActive?: boolean } = {},
): Promise<{ result: string; startMission: StartMissionSpy }> => {
  const startMission: StartMissionSpy = opts.startMission ?? vi.fn();
  const accept = createAcceptCommand({
    startMission,
    isMissionActive: () => opts.isActive ?? false,
  });
  const output = accept.fn(seed) as AsyncOutput;
  const result = await collectAsync(output);
  return { result, startMission };
};

describe('accept command', () => {
  it('starts a mission with a valid seed', async () => {
    const { result, startMission } = await runAccept('MEDTECH-4A7F-easy');

    expect(startMission).toHaveBeenCalledWith(
      expect.objectContaining({ seed: 'MEDTECH-4A7F-easy' }),
    );
    expect(result).toContain('MISSION BRIEFING');
    expect(result).toContain('MEDTECH-4A7F-easy');
  });

  it('shows target, difficulty, and client email in briefing', async () => {
    const { result } = await runAccept('MEDTECH-4A7F-easy');
    expect(result).toContain('Difficulty: easy');
    expect(result).toContain('Target:');
    expect(result).toContain('Reply to:');
    expect(result).toContain('@darkmail.onion');
  });

  it('shows target as IP or domain', async () => {
    const { result } = await runAccept('MEDTECH-4A7F-easy');
    expect(result).toMatch(/Target: (\d+\.\d+\.\d+\.\d+|[\w-]+\.mission)/);
  });

  it('shows mail example in briefing for non-script_fix objectives', async () => {
    const { result } = await runAccept('test-exfiltrate-easy');
    expect(result).toContain('mail ');
  });

  it('shows mail example for script_fix objectives', async () => {
    const { result } = await runAccept('test-script-fix-easy');
    expect(result).toContain('mail ');
    expect(result).toContain('nano');
    expect(result).toContain('node');
    expect(result).toContain('done');
  });

  it('shows root password in script_fix briefing', async () => {
    const { result } = await runAccept('test-script-fix-easy');
    expect(result).toContain('Root password:');
  });

  it('shows script_auto briefing with instructions hint', async () => {
    const { result } = await runAccept('test-script-auto-easy');
    expect(result).toContain('mail ');
    expect(result).toContain('node');
    expect(result).toContain('done');
    expect(result).toContain('Root password:');
  });

  it('shows domain instead of IP for domain entry missions', async () => {
    const { result } = await runAccept('test-domain-easy');
    expect(result).toMatch(/Target:.*\.mission/);
    expect(result).not.toMatch(/Target:.*\d+\.\d+\.\d+\.\d+/);
  });

  it('trims whitespace from seed', async () => {
    const { startMission } = await runAccept('  SEED-TEST  ');
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

  it('shows backdoor briefing with port and nc instructions', async () => {
    const { result } = await runAccept('test-backdoor-easy');
    expect(result).toContain('mail ');
    expect(result).toContain('backdoor');
    expect(result).toContain('nc -l');
    expect(result).toContain('done');
  });

  it('shows sabotage briefing with boot file instructions', async () => {
    const { result } = await runAccept('test-sabotage-easy');
    expect(result).toContain('mail ');
    expect(result).toContain('boot files');
    expect(result).toContain('reboot');
    expect(result).toContain('done');
  });

  it('shows portforward briefing with NAT forwarding hint', async () => {
    const { result } = await runAccept('test-snmp-easy-portforward');
    expect(result).toContain('mail ');
    expect(result).toContain('NAT port forwarding');
    expect(result).toContain('done');
  });
});

describe('formatMissionBriefing', () => {
  it('includes objective hint in briefing', async () => {
    const mission = await generateMissionNetwork('test-ssh-easy');
    const briefing = formatMissionBriefing(mission);

    expect(briefing).toContain('MISSION BRIEFING');
    expect(briefing).toContain('Objective:');
  });

  it('SNMP variant does not include SNMP-specific entry hints in briefing', async () => {
    const mission = await generateMissionNetwork('test-snmp-hard-router-first');
    expect(mission.entryVariant).toBe('snmp');
    const briefing = formatMissionBriefing(mission);

    // SNMP entry has no hints about SNMP/community strings — player must discover independently
    expect(briefing).not.toContain('legacy management');
    expect(briefing).not.toContain('community');
  });

  it('does not contain command hints like nmap() or nslookup()', async () => {
    const seeds = [
      'test-ssh-easy',
      'test-ftp-easy',
      'test-nc-easy',
      'test-exploit-easy',
      'test-http-easy',
    ];

    for (const seed of seeds) {
      const mission = await generateMissionNetwork(seed);
      const briefing = formatMissionBriefing(mission);
      const isBackdoor = mission.objective.type === 'backdoor';

      expect(briefing).not.toContain('nmap(');
      expect(briefing).not.toContain('nslookup(');
      expect(briefing).not.toContain('ftp(');
      // backdoor objectives legitimately contain `nc -l <port>` in the hint
      if (!isBackdoor) expect(briefing).not.toContain('nc -l');
      expect(briefing).not.toContain('msfconsole(');
      expect(briefing).not.toContain('curl(');
    }
  });

  it('forensics briefing includes investigation instructions', async () => {
    const mission = await generateMissionNetwork('test-forensics-easy');
    const briefing = formatMissionBriefing(mission);

    expect(mission.objective.type).toBe('forensics');
    // The hint should mention searching logs, not stealing passwords
    expect(briefing).toContain('Investigate');
    expect(briefing).toContain('logs');
    expect(briefing).not.toContain('Discover the root password');
  });

  it('malware briefing includes neutralization instructions', async () => {
    const mission = await generateMissionNetwork('test-malware-easy');
    const briefing = formatMissionBriefing(mission);

    expect(mission.objective.type).toBe('malware');
    expect(briefing).toContain('neutralize the malware');
    expect(briefing).toContain('kill');
    expect(briefing).toContain('Root password:');
  });

  it('briefing does not reveal network topology', async () => {
    const seeds = ['test-medium', 'test-hard-router-first', 'test-easy'];
    for (const seed of seeds) {
      const mission = await generateMissionNetwork(seed);
      const briefing = formatMissionBriefing(mission);
      expect(briefing).not.toContain('segmented');
      expect(briefing).not.toContain('gateway');
      expect(briefing).not.toContain('subnet');
      expect(briefing).not.toContain('layer');
    }
  });
});
