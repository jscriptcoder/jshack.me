import { describe, it, expect } from 'vitest';
import { generateMissionNetwork } from './generateMission';

describe('generateMissionNetwork', () => {
  it('same seed produces identical output (determinism)', () => {
    const a = generateMissionNetwork('HEIST-7734');
    const b = generateMissionNetwork('HEIST-7734');
    expect(a).toEqual(b);
  });

  it('different seeds produce different output', () => {
    const a = generateMissionNetwork('MISSION-ALPHA');
    const b = generateMissionNetwork('MISSION-BETA');
    expect(a.entryPoint).not.toBe(b.entryPoint);
    expect(a.objective.flag).not.toBe(b.objective.flag);
  });

  it('seed containing "easy" produces easy difficulty', () => {
    const result = generateMissionNetwork('easy-mission-01');
    expect(result.difficulty).toBe('easy');
    expect(result.machines).toHaveLength(2);
  });

  it('seed containing "hard" produces hard difficulty', () => {
    const result = generateMissionNetwork('hard-challenge-X');
    expect(result.difficulty).toBe('hard');
    expect(result.machines.length).toBeGreaterThanOrEqual(4);
  });

  it('entry point is one of the machine IPs', () => {
    const result = generateMissionNetwork('ENTRY-TEST');
    const ips = result.machines.map((m) => m.ip);
    expect(ips).toContain(result.entryPoint);
  });

  it('all machines have users', () => {
    const result = generateMissionNetwork('USERS-TEST');
    result.machines.forEach((m) => {
      expect(m.remoteMachine.users.length).toBeGreaterThan(0);
      const root = m.remoteMachine.users.find((u) => u.username === 'root');
      expect(root).toBeDefined();
    });
  });

  it('network config has entries for all machines', () => {
    const result = generateMissionNetwork('CONFIG-TEST');
    result.machines.forEach((m) => {
      expect(result.networkConfig.machineConfigs[m.ip]).toBeDefined();
    });
  });

  it('network config machines have populated users', () => {
    const result = generateMissionNetwork('NET-USERS-TEST');
    Object.values(result.networkConfig.machineConfigs).forEach((config) => {
      config.machines.forEach((rm) => {
        expect(rm.users.length).toBeGreaterThan(0);
      });
    });
  });

  it('file systems exist for all machines', () => {
    const result = generateMissionNetwork('FS-TEST');
    result.machines.forEach((m) => {
      expect(result.fileSystems[m.ip]).toBeDefined();
      expect(result.fileSystems[m.ip]?.name).toBe('/');
    });
  });

  it('target machine filesystem contains the flag', () => {
    const result = generateMissionNetwork('FLAG-TEST');
    const targetFs = result.fileSystems[result.objective.targetMachine];
    expect(targetFs).toBeDefined();

    const resolveNode = (root: typeof targetFs, path: string) => {
      const parts = path.split('/').filter(Boolean);
      let current = root;
      for (const part of parts) {
        if (current?.type !== 'directory' || !current.children) return undefined;
        current = current.children[part];
      }
      return current;
    };

    const flag = resolveNode(targetFs, result.objective.targetPath);
    expect(flag?.content).toBe(result.objective.flag);
  });

  it('attack chain forms a valid path from entry to target', () => {
    const result = generateMissionNetwork('PATH-TEST');
    expect(result.attackChain.length).toBeGreaterThan(0);
    expect(result.attackChain[0]?.fromMachine).toBe('entry');

    const lastStep = result.attackChain[result.attackChain.length - 1];
    expect(lastStep?.toMachine).toBe(result.objective.targetMachine);
  });

  it('objective flag matches FLAG{mission_XXXXX} format', () => {
    const result = generateMissionNetwork('FORMAT-TEST');
    expect(result.objective.flag).toMatch(/^FLAG\{mission_\d{5}\}$/);
  });

  it('preserves seed in output', () => {
    const seed = 'MY-CUSTOM-SEED';
    const result = generateMissionNetwork(seed);
    expect(result.seed).toBe(seed);
  });

  it('generates diverse results across many seeds', () => {
    const results = Array.from({ length: 20 }, (_, i) => generateMissionNetwork(`DIVERSE-${i}`));
    const uniqueFlags = new Set(results.map((r) => r.objective.flag));
    const uniqueEntries = new Set(results.map((r) => r.entryPoint));
    expect(uniqueFlags.size).toBe(20);
    expect(uniqueEntries.size).toBeGreaterThan(1);
  });

  it('exploit entry variant adds vulnerability and owner to entry machine port', () => {
    // Search for a seed that produces exploit variant
    let found = false;
    for (let i = 0; i < 200; i++) {
      const result = generateMissionNetwork(`exploit-gen-${i}`);
      if (result.entryVariant !== 'exploit') continue;

      const entryMachine = result.machines.find((m) => m.ip === result.entryPoint);
      expect(entryMachine).toBeDefined();

      // The non-SSH open port should have a vulnerability and owner
      const vulnPort = entryMachine?.remoteMachine.ports.find((p) => p.service !== 'ssh' && p.open);
      expect(vulnPort?.vulnerability).toBeDefined();
      expect(vulnPort?.vulnerability?.cve).toBeTruthy();
      expect(vulnPort?.owner).toBeDefined();
      expect(vulnPort?.owner?.userType).toBe('guest');
      found = true;
      break;
    }
    expect(found).toBe(true);
  });

  it('entryCredential is set for entry machine', () => {
    const result = generateMissionNetwork('ENTRY-CRED-TEST');
    expect(result.entryCredential).toBeDefined();
    expect(result.entryCredential?.username).toBe('guest');
    expect(result.entryCredential?.password).toBeTruthy();
  });
});
