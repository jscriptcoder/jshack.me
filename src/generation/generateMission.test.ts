import { describe, it, expect } from 'vitest';
import { generateMissionNetwork } from './generateMission';
import type { FileNode } from '../filesystem/types';

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

  it('entry point is one of the internal machine IPs', () => {
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

  it('network config has entries for all machines plus router', () => {
    const result = generateMissionNetwork('CONFIG-TEST');
    result.machines.forEach((m) => {
      expect(result.networkConfig.machineConfigs[m.ip]).toBeDefined();
    });
    expect(result.networkConfig.machineConfigs[result.routerPublicIp]).toBeDefined();
  });

  it('network config machines have populated users', () => {
    const result = generateMissionNetwork('NET-USERS-TEST');
    Object.values(result.networkConfig.machineConfigs).forEach((config) => {
      config.machines.forEach((rm) => {
        expect(rm.users.length).toBeGreaterThan(0);
      });
    });
  });

  it('file systems exist for all machines plus router', () => {
    const result = generateMissionNetwork('FS-TEST');
    result.machines.forEach((m) => {
      expect(result.fileSystems[m.ip]).toBeDefined();
      expect(result.fileSystems[m.ip]?.name).toBe('/');
    });
    expect(result.fileSystems[result.routerPublicIp]).toBeDefined();
  });

  it('target machine filesystem contains the target file for exfiltrate/tamper', () => {
    // Find a seed with exfiltrate or tamper (they have target files)
    for (let i = 0; i < 50; i++) {
      const result = generateMissionNetwork(`TARGET-FILE-${i}`);
      if (result.objective.type === 'credential_theft') continue;

      const targetFs = result.fileSystems[result.objective.targetMachine];
      expect(targetFs).toBeDefined();

      const resolveNode = (root: FileNode | undefined, path: string) => {
        const parts = path.split('/').filter(Boolean);
        let current = root;
        for (const part of parts) {
          if (current?.type !== 'directory' || !current.children) return undefined;
          current = current.children[part];
        }
        return current;
      };

      const targetFile = resolveNode(targetFs, result.objective.targetPath);
      expect(targetFile?.content).toBe(result.objective.targetContent);
      return;
    }
    throw new Error('No exfiltrate/tamper objective found in 50 seeds');
  });

  it('attack chain forms a valid path from entry to target', () => {
    const result = generateMissionNetwork('PATH-TEST');
    expect(result.attackChain.length).toBeGreaterThan(0);
    expect(result.attackChain[0]?.fromMachine).toBe('entry');

    const lastStep = result.attackChain[result.attackChain.length - 1];
    expect(lastStep?.toMachine).toBe(result.objective.targetMachine);
  });

  it('objective has a valid type', () => {
    const result = generateMissionNetwork('FORMAT-TEST');
    expect(['exfiltrate', 'tamper', 'credential_theft']).toContain(result.objective.type);
  });

  it('clientEmail is set with darkmail.onion domain', () => {
    const result = generateMissionNetwork('EMAIL-TEST');
    expect(result.clientEmail).toMatch(/@darkmail\.onion$/);
    expect(result.objective.clientEmail).toBe(result.clientEmail);
  });

  it('preserves seed in output', () => {
    const seed = 'MY-CUSTOM-SEED';
    const result = generateMissionNetwork(seed);
    expect(result.seed).toBe(seed);
  });

  it('generates diverse results across many seeds', () => {
    const results = Array.from({ length: 20 }, (_, i) => generateMissionNetwork(`DIVERSE-${i}`));
    const uniqueEmails = new Set(results.map((r) => r.clientEmail));
    const uniqueEntries = new Set(results.map((r) => r.entryPoint));
    expect(uniqueEmails.size).toBeGreaterThan(1);
    expect(uniqueEntries.size).toBeGreaterThan(1);
  });

  it('exploit entry variant adds vulnerability and owner to entry machine port', () => {
    let found = false;
    for (let i = 0; i < 200; i++) {
      const result = generateMissionNetwork(`exploit-gen-${i}`);
      if (result.entryVariant !== 'exploit') continue;

      const targetIp = result.natForwarding ? result.entryPoint : result.routerPublicIp;
      const targetMachine = result.natForwarding
        ? result.machines.find((m) => m.ip === targetIp)
        : result.routerMachine;
      expect(targetMachine).toBeDefined();

      const vulnPort = targetMachine?.remoteMachine.ports.find(
        (p) => p.service !== 'ssh' && p.open,
      );
      if (!vulnPort?.vulnerability) continue;

      expect(vulnPort.vulnerability.cve).toBeTruthy();
      expect(vulnPort.owner).toBeDefined();
      expect(vulnPort.owner?.userType).toBe('guest');
      found = true;
      break;
    }
    expect(found).toBe(true);
  });

  it('entryCredential is set for missions', () => {
    const result = generateMissionNetwork('ENTRY-CRED-TEST');
    expect(result.entryCredential).toBeDefined();
    expect(result.entryCredential?.username).toBe('guest');
    expect(result.entryCredential?.password).toBeTruthy();
  });

  it('routerMachine is a valid machine with router role', () => {
    const result = generateMissionNetwork('ROUTER-TEST');
    expect(result.routerMachine).toBeDefined();
    expect(result.routerMachine.role).toBe('router');
    expect(result.routerMachine.remoteMachine.users.length).toBeGreaterThan(0);
  });

  it('routerPublicIp is in 45.x.x.x range', () => {
    const result = generateMissionNetwork('PUB-IP-TEST');
    expect(result.routerPublicIp).toMatch(/^45\.\d+\.\d+\.\d+$/);
  });

  it('hard difficulty produces no natForwarding (router-first mode)', () => {
    const results = Array.from({ length: 10 }, (_, i) => generateMissionNetwork(`hard-nat-${i}`));
    results.forEach((r) => {
      if (r.difficulty === 'hard') {
        expect(r.natForwarding).toBeUndefined();
      }
    });
  });

  it('forwarded mode natForwarding points router public IP to entry machine', () => {
    let found = false;
    for (let i = 0; i < 50; i++) {
      const result = generateMissionNetwork(`fwd-mission-${i}`);
      if (!result.natForwarding) continue;

      expect(result.natForwarding.publicIp).toBe(result.routerPublicIp);
      expect(result.natForwarding.internalIp).toBe(result.entryPoint);
      found = true;
      break;
    }
    expect(found).toBe(true);
  });

  it('router filesystem contains hints about internal machines', () => {
    const result = generateMissionNetwork('ROUTER-FS-TEST');
    const routerFs = result.fileSystems[result.routerPublicIp];
    expect(routerFs).toBeDefined();

    const etc = routerFs?.type === 'directory' ? routerFs.children?.['etc'] : undefined;
    const hosts = etc?.type === 'directory' ? etc.children?.['hosts'] : undefined;
    if (hosts?.type === 'file' && hosts.content) {
      const hasInternalIp = result.machines.some((m) => hosts.content?.includes(m.ip));
      expect(hasInternalIp).toBe(true);
    }
  });
});
