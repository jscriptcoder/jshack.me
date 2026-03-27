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
    layers: topology.layers,
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
    const b = buildTestData('chain-gamma-distinct');
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
      'portforward',
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
    expect([4444, 31337, 8888, 1337, 9999, 5555, 6666, 1234]).toContain(
      result.objective.backdoorPort,
    );
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

  it('portforward objective has forward fields and empty targetPath/content', () => {
    const { result } = buildTestData('test-portforward', 'medium', 'portforward');

    expect(result.objective.type).toBe('portforward');
    expect(result.objective.forwardPublicPort).toBeDefined();
    expect([8080, 8443, 9090, 8888, 3000, 4443]).toContain(result.objective.forwardPublicPort);
    expect(result.objective.forwardInternalIp).toBeDefined();
    expect(result.objective.forwardInternalPort).toBeDefined();
    expect(result.objective.targetPath).toBe('');
    expect(result.objective.targetContent).toBe('');
    expect(result.objective.expectedProof).toBe('');
    expect(result.objective.description).toContain('NAT forwarding');
  });

  it('portforward objective targets a non-router machine', () => {
    for (let i = 0; i < 50; i++) {
      const { topology, result } = buildTestData(`pf-target-${i}`, 'medium', 'portforward');
      const routerIp = topology.routerPublicIp;
      expect(result.objective.forwardInternalIp).not.toBe(routerIp);
    }
  });

  it('forensics objective has attackerHandle, attackerIp, and description with root password', () => {
    const { result } = buildTestData('test-forensics', 'medium', 'forensics');

    expect(result.objective.type).toBe('forensics');
    expect(result.objective.attackerHandle).toBeTruthy();
    expect(result.objective.attackerIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(result.objective.expectedProof).toContain(result.objective.attackerHandle);
    expect(result.objective.expectedProof).toContain(result.objective.attackerIp);
    expect(result.objective.description).toContain('Investigate');
    expect(result.objective.description).toMatch(/Root password: \S+/);
  });

  it('forensics attacker handle differs from mission client handle', () => {
    for (let i = 0; i < 50; i++) {
      const { result } = buildTestData(`forensics-unique-${i}`, 'medium', 'forensics');
      const clientHandle = result.clientEmail.split('@')[0];
      expect(result.objective.attackerHandle).not.toBe(clientHandle);
    }
  });

  it('forensics objective is deterministic', () => {
    const a = buildTestData('forensics-determ', 'easy', 'forensics');
    const b = buildTestData('forensics-determ', 'easy', 'forensics');
    expect(a.result.objective).toEqual(b.result.objective);
  });

  it('medium target is in the deepest layer', () => {
    for (let i = 0; i < 30; i++) {
      const { topology, result } = buildTestData(`deep-target-med-${i}`, 'medium', 'exfiltrate');
      const deepestLayer = topology.layers[topology.layers.length - 1]!;
      const deepestIps = deepestLayer.machines.map((m) => m.ip);
      expect(deepestIps).toContain(result.objective.targetMachine);
    }
  });

  it('hard target is in the deepest layer', () => {
    for (let i = 0; i < 30; i++) {
      const { topology, result } = buildTestData(`deep-target-hard-${i}`, 'hard', 'tamper');
      const deepestLayer = topology.layers[topology.layers.length - 1]!;
      const deepestIps = deepestLayer.machines.map((m) => m.ip);
      expect(deepestIps).toContain(result.objective.targetMachine);
    }
  });

  it('easy target is in layer 0', () => {
    for (let i = 0; i < 30; i++) {
      const { topology, result } = buildTestData(`easy-target-${i}`, 'easy', 'exfiltrate');
      const layer0Ips = topology.layers[0]!.machines.map((m) => m.ip);
      expect(layer0Ips).toContain(result.objective.targetMachine);
    }
  });

  it('portforward target is in layer 0 (reachable from outer router)', () => {
    for (let i = 0; i < 30; i++) {
      const { topology, result } = buildTestData(`pf-layer0-${i}`, 'hard', 'portforward');
      const layer0Ips = topology.layers[0]!.machines.map((m) => m.ip);
      expect(layer0Ips).toContain(result.objective.forwardInternalIp);
    }
  });

  it('target is never a gateway machine', () => {
    for (let i = 0; i < 30; i++) {
      const { topology, result } = buildTestData(`no-gw-target-${i}`, 'hard');
      const gatewayIps = topology.layers.slice(1).map((l) => l.gateway.ip);
      expect(gatewayIps).not.toContain(result.objective.targetMachine);
    }
  });
});
