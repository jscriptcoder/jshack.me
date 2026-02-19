import { describe, it, expect } from 'vitest';
import { createPrng } from './prng';
import { generateTopology } from './topology';
import { generateUsers } from './users';
import { generateAttackChain } from './attackChain';

const buildTestData = (seed: string, difficulty: 'easy' | 'medium' | 'hard' = 'medium') => {
  const prng = createPrng(seed);
  const topology = generateTopology(prng, difficulty);
  const { credentials } = generateUsers(prng, topology.machines, topology.entryPoint);
  const result = generateAttackChain({
    prng,
    machines: topology.machines,
    credentials,
    entryPoint: topology.entryPoint,
    difficulty,
  });
  return { topology, result };
};

describe('generateAttackChain', () => {
  it('produces deterministic output for the same seed', () => {
    const a = buildTestData('chain-seed');
    const b = buildTestData('chain-seed');
    expect(a.result).toEqual(b.result);
  });

  it('produces different output for different seeds', () => {
    const a = buildTestData('chain-alpha');
    const b = buildTestData('chain-beta');
    expect(a.result.objective.flag).not.toBe(b.result.objective.flag);
  });

  it('attack chain starts from entry', () => {
    const { result } = buildTestData('entry-test');
    expect(result.attackChain.length).toBeGreaterThan(0);
    expect(result.attackChain[0]?.fromMachine).toBe('entry');
  });

  it('attack chain target matches objective target', () => {
    const { result } = buildTestData('target-test');
    const lastStep = result.attackChain[result.attackChain.length - 1];
    expect(lastStep?.toMachine).toBe(result.objective.targetMachine);
  });

  it('each step has valid credentials', () => {
    const { result } = buildTestData('creds-test');
    result.attackChain.forEach((step) => {
      expect(step.credential.username).toBeTruthy();
      expect(step.credential.password).toBeTruthy();
    });
  });

  it('each step uses a valid method', () => {
    const { result } = buildTestData('method-test');
    const validMethods = ['ssh', 'ftp', 'nc', 'su'];
    result.attackChain.forEach((step) => {
      expect(validMethods).toContain(step.method);
    });
  });

  it('generates credential placements for each hop', () => {
    const { result } = buildTestData('placement-test');
    expect(result.credentialPlacements.length).toBeGreaterThanOrEqual(
      result.attackChain.length - 1,
    );
    result.credentialPlacements.forEach((p) => {
      expect(p.machineIp).toBeTruthy();
      expect(p.filePath).toBeTruthy();
      expect(p.fileContent).toContain(p.password);
    });
  });

  it('objective has a valid flag format', () => {
    const { result } = buildTestData('flag-test');
    expect(result.objective.flag).toMatch(/^FLAG\{mission_\d{5}\}$/);
  });

  it('objective has a valid type', () => {
    const { result } = buildTestData('type-test');
    expect(['exfiltrate', 'tamper', 'find_flag']).toContain(result.objective.type);
  });

  it('easy difficulty has fewer hops than hard', () => {
    const easy = buildTestData('diff-compare', 'easy');
    const hard = buildTestData('diff-compare', 'hard');
    expect(easy.result.attackChain.length).toBeLessThanOrEqual(hard.result.attackChain.length);
  });

  it('credential placements contain the target username and password', () => {
    const { result } = buildTestData('content-test');
    result.credentialPlacements.forEach((p) => {
      expect(p.fileContent).toContain(p.username);
      expect(p.fileContent).toContain(p.password);
    });
  });
});
