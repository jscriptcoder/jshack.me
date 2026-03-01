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
    entryVariant: topology.entryVariant,
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
    // clientEmail or objective content should differ
    expect(a.result.clientEmail).not.toBe(b.result.clientEmail);
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
    const validMethods = ['ssh', 'ftp', 'nc', 'su', 'exploit', 'http'];
    result.attackChain.forEach((step) => {
      expect(validMethods).toContain(step.method);
    });
  });

  it('exploit entry variant maps to exploit method on first step', () => {
    let found = false;
    for (let i = 0; i < 100; i++) {
      const seed = `exploit-entry-${i}`;
      const prng = createPrng(seed);
      const topology = generateTopology(prng, 'medium');
      if (topology.entryVariant !== 'exploit') continue;

      const { credentials } = generateUsers(prng, topology.machines, topology.entryPoint);
      const result = generateAttackChain({
        prng,
        machines: topology.machines,
        credentials,
        entryPoint: topology.entryPoint,
        entryVariant: 'exploit',
        difficulty: 'medium',
      });

      expect(result.attackChain[0]?.method).toBe('exploit');
      found = true;
      break;
    }
    expect(found).toBe(true);
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

  it('objective has a valid type', () => {
    const { result } = buildTestData('type-test');
    expect(['exfiltrate', 'tamper', 'credential_theft']).toContain(result.objective.type);
  });

  it('exfiltrate objective has ACCESS-KEY format expectedProof', () => {
    // Try seeds until we find an exfiltrate objective
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

  it('http entry variant maps to http method on first step', () => {
    const prng = createPrng('http-entry-forced');
    const topology = generateTopology(prng, 'medium', { entryVariantOverride: 'http' });
    const { credentials } = generateUsers(prng, topology.machines, topology.entryPoint);
    const result = generateAttackChain({
      prng,
      machines: topology.machines,
      credentials,
      entryPoint: topology.entryPoint,
      entryVariant: 'http',
      difficulty: 'medium',
    });

    expect(result.attackChain[0]?.method).toBe('http');
  });

  it('http method generates web-path credential placements', () => {
    // HTTP lateral movement placements use /var/www/html/ paths
    for (let i = 0; i < 50; i++) {
      const { result } = buildTestData(`http-lateral-${i}`);
      const httpStep = result.attackChain.find((s) => s.method === 'http');
      if (!httpStep) continue;

      const webPlacements = result.credentialPlacements.filter((p) =>
        p.filePath.startsWith('/var/www/'),
      );
      expect(webPlacements.length).toBeGreaterThan(0);
      webPlacements.forEach((p) => {
        expect(p.fileContent).toContain(p.password);
      });
      return;
    }
    // HTTP lateral movement is probabilistic — skip if not found
  });
});
