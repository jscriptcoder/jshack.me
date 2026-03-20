import { describe, it, expect } from 'vitest';
import { createPrng } from './prng';
import { generateTopology } from './topology';
import { generateUsers } from './users';
import { buildMissionObjective } from './attackChain';
import type { MissionObjectiveType } from './types';

const buildTestData = (
  seed: string,
  difficulty: 'easy' | 'medium' | 'hard' = 'medium',
  objectiveTypeOverride?: MissionObjectiveType,
) => {
  const prng = createPrng(seed);
  const topology = generateTopology(prng, difficulty);
  const { credentials } = generateUsers(prng, topology.machines, topology.entryPoint);
  const result = buildMissionObjective({
    prng,
    machines: topology.machines,
    credentials,
    entryPoint: topology.entryPoint,
    difficulty,
    objectiveTypeOverride,
  });
  return { topology, result };
};

describe('buildMissionObjective', () => {
  it('produces deterministic output for the same seed', () => {
    const a = buildTestData('chain-seed');
    const b = buildTestData('chain-seed');
    expect(a.result).toEqual(b.result);
  });

  it('produces different output for different seeds', () => {
    const a = buildTestData('chain-alpha');
    const b = buildTestData('chain-beta');
    expect(a.result.clientEmail).not.toBe(b.result.clientEmail);
  });

  it('objective has a valid type', () => {
    const { result } = buildTestData('type-test');
    expect([
      'exfiltrate',
      'tamper',
      'credential_theft',
      'script_fix',
      'sabotage',
      'backdoor',
    ]).toContain(result.objective.type);
  });

  it('exfiltrate objective has ACCESS-KEY format expectedProof', () => {
    for (let i = 0; i < 100; i++) {
      const { result } = buildTestData(`exfil-proof-${i}`);
      if (result.objective.type !== 'exfiltrate') continue;

      expect(result.objective.expectedProof).toMatch(
        /^ACCESS-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/,
      );
      expect(result.objective.targetContent).toContain(result.objective.expectedProof);
      return;
    }
    throw new Error('No exfiltrate objective found in 100 seeds');
  });

  it('tamper objective has tamperOldValue and tamperNewValue', () => {
    for (let i = 0; i < 100; i++) {
      const { result } = buildTestData(`tamper-proof-${i}`);
      if (result.objective.type !== 'tamper') continue;

      expect(result.objective.tamperOldValue).toBeTruthy();
      expect(result.objective.tamperNewValue).toBeTruthy();
      expect(result.objective.expectedProof).toBe('');
      expect(result.objective.targetContent).toContain(result.objective.tamperOldValue);
      return;
    }
    throw new Error('No tamper objective found in 100 seeds');
  });

  it('credential_theft objective has password as expectedProof', () => {
    for (let i = 0; i < 100; i++) {
      const { result } = buildTestData(`cred-theft-${i}`);
      if (result.objective.type !== 'credential_theft') continue;

      expect(result.objective.expectedProof).toBeTruthy();
      expect(result.objective.targetPath).toBe('');
      expect(result.objective.targetContent).toBe('');
      return;
    }
    throw new Error('No credential_theft objective found in 100 seeds');
  });

  it('objective has a clientEmail', () => {
    const { result } = buildTestData('email-test');
    expect(result.objective.clientEmail).toMatch(/@darkmail\.onion$/);
    expect(result.clientEmail).toBe(result.objective.clientEmail);
  });

  it('sabotage objective has empty path and content', () => {
    for (let i = 0; i < 100; i++) {
      const { result } = buildTestData(`sabotage-${i}`);
      if (result.objective.type !== 'sabotage') continue;

      expect(result.objective.targetPath).toBe('');
      expect(result.objective.targetContent).toBe('');
      expect(result.objective.expectedProof).toBe('');
      expect(result.objective.description).toContain('Destroy');
      return;
    }
    throw new Error('No sabotage objective found in 100 seeds');
  });

  it('backdoor objective has port and user', () => {
    const { result } = buildTestData('test-backdoor-easy', 'easy', 'backdoor');

    expect(result.objective.type).toBe('backdoor');
    expect(result.objective.backdoorPort).toBeDefined();
    expect([4444, 31337, 8888, 1337]).toContain(result.objective.backdoorPort);
    expect(result.objective.backdoorUser).toBeDefined();
    expect(['guest', 'user', 'root']).toContain(result.objective.backdoorUser);
    expect(result.objective.targetPath).toBe('');
    expect(result.objective.targetContent).toBe('');
    expect(result.objective.expectedProof).toBe('');
    expect(result.objective.description).toContain('backdoor');
  });

  it('easy backdoor picks guest or user', () => {
    const users = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { result } = buildTestData(`backdoor-easy-user-${i}`, 'easy', 'backdoor');
      if (result.objective.backdoorUser) users.add(result.objective.backdoorUser);
    }
    expect(users.has('guest') || users.has('user')).toBe(true);
    expect(users.has('root')).toBe(false);
  });

  it('hard backdoor always picks root', () => {
    for (let i = 0; i < 100; i++) {
      const { result } = buildTestData(`backdoor-hard-user-${i}`, 'hard', 'backdoor');
      expect(result.objective.backdoorUser).toBe('root');
    }
  });
});
