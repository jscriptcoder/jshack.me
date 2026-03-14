import { describe, it, expect } from 'vitest';
import { generateMissionNetwork, parseSeedOverrides } from './generateMission';
import type { FileNode } from '../filesystem/types';

describe('parseSeedOverrides', () => {
  it('parses domain keyword', () => {
    expect(parseSeedOverrides('test-domain').domainEntry).toBe(true);
    expect(parseSeedOverrides('DOMAIN-MISSION').domainEntry).toBe(true);
  });

  it('returns undefined domainEntry without keyword', () => {
    expect(parseSeedOverrides('test-mission').domainEntry).toBeUndefined();
  });

  it('parses sabotage keyword', () => {
    expect(parseSeedOverrides('test-sabotage').objectiveType).toBe('sabotage');
    expect(parseSeedOverrides('SABOTAGE-MISSION').objectiveType).toBe('sabotage');
  });
});

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

  it('target machine filesystem contains the target file for exfiltrate/tamper/script_fix', () => {
    for (let i = 0; i < 50; i++) {
      const result = generateMissionNetwork(`TARGET-FILE-${i}`);
      if (result.objective.type === 'credential_theft' || result.objective.type === 'sabotage')
        continue;

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
    throw new Error('No exfiltrate/tamper/script_fix objective found in 50 seeds');
  });

  it('objective has a valid type', () => {
    const result = generateMissionNetwork('FORMAT-TEST');
    expect(['exfiltrate', 'tamper', 'credential_theft', 'script_fix', 'sabotage']).toContain(
      result.objective.type,
    );
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
      expect(['guest', 'user', 'root']).toContain(vulnPort.owner?.userType);
      found = true;
      break;
    }
    expect(found).toBe(true);
  });

  it('NC/exploit owner type varies across seeds', () => {
    const ownerTypes = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const result = generateMissionNetwork(`owner-variety-${i}`);
      if (result.entryVariant !== 'nc' && result.entryVariant !== 'exploit') continue;

      const targetIp = result.natForwarding ? result.entryPoint : result.routerPublicIp;
      const targetMachine = result.natForwarding
        ? result.machines.find((m) => m.ip === targetIp)
        : result.routerMachine;

      const ownerPort = targetMachine?.remoteMachine.ports.find((p) => p.owner);
      if (ownerPort?.owner) {
        ownerTypes.add(ownerPort.owner.userType);
      }
      if (ownerTypes.size >= 2) break;
    }
    expect(ownerTypes.size).toBeGreaterThanOrEqual(2);
  });

  it('non-entry NC machines have backdoor port owners', () => {
    let found = false;
    for (let i = 0; i < 300; i++) {
      const result = generateMissionNetwork(`nc-nonentry-${i}`);
      const nonEntryNc = result.machines.find(
        (m) => m.ip !== result.entryPoint && m.accessVariant === 'nc',
      );
      if (!nonEntryNc) continue;

      const backdoorPort = nonEntryNc.remoteMachine.ports.find(
        (p) => p.service === 'elite' && p.open,
      );
      expect(backdoorPort).toBeDefined();
      expect(backdoorPort?.owner).toBeDefined();
      expect(['guest', 'user']).toContain(backdoorPort?.owner?.userType);
      found = true;
      break;
    }
    expect(found).toBe(true);
  });

  it('non-entry exploit machines have vulnerability and owner', () => {
    let found = false;
    for (let i = 0; i < 300; i++) {
      const result = generateMissionNetwork(`exploit-nonentry-${i}`);
      const nonEntryExploit = result.machines.find(
        (m) => m.ip !== result.entryPoint && m.accessVariant === 'exploit',
      );
      if (!nonEntryExploit) continue;

      const vulnPort = nonEntryExploit.remoteMachine.ports.find(
        (p) => p.service !== 'ssh' && p.open && p.vulnerability,
      );
      if (!vulnPort) continue;

      expect(vulnPort.vulnerability?.cve).toBeTruthy();
      expect(vulnPort.owner).toBeDefined();
      expect(['guest', 'user', 'root']).toContain(vulnPort.owner?.userType);
      found = true;
      break;
    }
    expect(found).toBe(true);
  });

  it('non-entry FTP machines have FTP port owners', () => {
    let found = false;
    for (let i = 0; i < 300; i++) {
      const result = generateMissionNetwork(`ftp-nonentry-${i}`);
      const nonEntryFtp = result.machines.find(
        (m) => m.ip !== result.entryPoint && m.accessVariant === 'ftp',
      );
      if (!nonEntryFtp) continue;

      const ftpPort = nonEntryFtp.remoteMachine.ports.find((p) => p.service === 'ftp' && p.open);
      expect(ftpPort).toBeDefined();
      expect(ftpPort?.owner).toBeDefined();
      expect(['guest', 'user', 'root']).toContain(ftpPort?.owner?.userType);
      found = true;
      break;
    }
    expect(found).toBe(true);
  });

  it('routerMachine is a valid machine with router role', () => {
    const result = generateMissionNetwork('ROUTER-TEST');
    expect(result.routerMachine).toBeDefined();
    expect(result.routerMachine.role).toBe('router');
    expect(result.routerMachine.remoteMachine.users.length).toBeGreaterThan(0);
  });

  it('routerPublicIp is a valid public IP from the known prefix pool', () => {
    const validFirstOctets = [45, 51, 62, 78, 91, 103, 138, 162, 185, 198, 203, 212];
    const result = generateMissionNetwork('PUB-IP-TEST');
    const firstOctet = Number(result.routerPublicIp.split('.')[0]);
    expect(validFirstOctets).toContain(firstOctet);
  });

  it('routerDomain is hostname.mission format', () => {
    const result = generateMissionNetwork('DOMAIN-FORMAT-TEST');
    expect(result.routerDomain).toMatch(/^.+\.mission$/);
    expect(result.routerDomain).toBe(`${result.routerMachine.hostname}.mission`);
  });

  it('seed containing "domain" forces domainEntry true', () => {
    const result = generateMissionNetwork('test-domain-mission');
    expect(result.domainEntry).toBe(true);
  });

  it('domainEntry varies across seeds without keyword', () => {
    const results = Array.from({ length: 200 }, (_, i) =>
      generateMissionNetwork(`VARY-ENTRY-${i}`),
    );
    const trueCount = results.filter((r) => r.domainEntry).length;
    const falseCount = results.filter((r) => !r.domainEntry).length;
    expect(trueCount).toBeGreaterThan(0);
    expect(falseCount).toBeGreaterThan(0);
  });

  it('hard difficulty produces no natForwarding (router-first mode)', () => {
    const results = Array.from({ length: 10 }, (_, i) => generateMissionNetwork(`hard-nat-${i}`));
    results.forEach((r) => {
      if (r.difficulty === 'hard') {
        expect(r.natForwarding).toBeUndefined();
      }
    });
  });

  it('forwarded mode natForwarding has port-level rules for entry machine', () => {
    let found = false;
    for (let i = 0; i < 50; i++) {
      const result = generateMissionNetwork(`fwd-mission-${i}`);
      if (!result.natForwarding) continue;

      expect(result.natForwarding.publicIp).toBe(result.routerPublicIp);
      expect(result.natForwarding.rules.length).toBeGreaterThan(0);

      // All rules should point to the entry machine
      result.natForwarding.rules.forEach((rule) => {
        expect(rule.internalIp).toBe(result.entryPoint);
        expect(rule.publicPort).toBe(rule.internalPort);
      });

      // Rules should match the entry machine's open ports
      const entryMachine = result.machines.find((m) => m.ip === result.entryPoint);
      const openPorts = entryMachine?.remoteMachine.ports.filter((p) => p.open) ?? [];
      expect(result.natForwarding.rules.length).toBe(openPorts.length);

      found = true;
      break;
    }
    expect(found).toBe(true);
  });

  it('seed containing "http" forces http entry variant', () => {
    const result = generateMissionNetwork('MISSION-http-42');
    expect(result.entryVariant).toBe('http');
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

  it('script_fix objective content uses _decode() instead of ACCESS-KEY', () => {
    let found = false;
    for (let i = 0; i < 100; i++) {
      const result = generateMissionNetwork(`script-fix-decode-${i}`);
      if (result.objective.type !== 'script_fix') continue;

      expect(result.objective.targetContent).not.toMatch(/ACCESS-/);
      expect(result.objective.targetContent).toContain('_decode(');
      expect(result.objective.expectedChecksum).toBeTruthy();
      found = true;
      break;
    }
    expect(found).toBe(true);
  });

  it('script_fix with keyword always uses _decode()', () => {
    const result = generateMissionNetwork('test-script-fix-easy');
    expect(result.objective.type).toBe('script_fix');
    expect(result.objective.targetContent).toContain('_decode(');
    expect(result.objective.targetContent).not.toMatch(/ACCESS-/);
    expect(result.objective.expectedChecksum).toBeTruthy();
  });

  describe('port closures', () => {
    it('SSH closure occurs for some seeds (statistical)', () => {
      let sshClosureCount = 0;
      for (let i = 0; i < 200; i++) {
        const result = generateMissionNetwork(`port-closure-ssh-${i}`);
        const hasClosedSsh = result.machines.some(
          (m) =>
            m.role !== 'router' &&
            m.ip !== result.entryPoint &&
            m.remoteMachine.ports.some((p) => p.port === 22 && !p.open),
        );
        if (hasClosedSsh) sshClosureCount++;
      }
      expect(sshClosureCount).toBeGreaterThan(0);
    });

    it('FTP port 21 is always open when SSH is closed on a machine', () => {
      for (let i = 0; i < 200; i++) {
        const result = generateMissionNetwork(`ftp-guarantee-${i}`);
        result.machines.forEach((m) => {
          const sshClosed = m.remoteMachine.ports.some((p) => p.port === 22 && !p.open);
          if (sshClosed) {
            const ftpOpen = m.remoteMachine.ports.some((p) => p.port === 21 && p.open);
            expect(ftpOpen).toBe(true);
          }
        });
      }
    });

    it('entry machine SSH is never closed', () => {
      for (let i = 0; i < 200; i++) {
        const result = generateMissionNetwork(`entry-protect-${i}`);
        const entryMachine = result.machines.find((m) => m.ip === result.entryPoint);
        const sshPort = entryMachine?.remoteMachine.ports.find((p) => p.port === 22);
        if (sshPort) {
          expect(sshPort.open).toBe(true);
        }
      }
    });

    it('router ports are never modified by closures', () => {
      for (let i = 0; i < 200; i++) {
        const result = generateMissionNetwork(`router-protect-${i}`);
        const routerSsh = result.routerMachine.remoteMachine.ports.find((p) => p.port === 22);
        if (routerSsh) {
          expect(routerSsh.open).toBe(true);
        }
      }
    });

    it('script_fix seeds never have SSH closures', () => {
      for (let i = 0; i < 50; i++) {
        const result = generateMissionNetwork(`script-fix-noclose-${i}`);
        if (result.objective.type !== 'script_fix') continue;

        result.machines.forEach((m) => {
          const sshPort = m.remoteMachine.ports.find((p) => p.port === 22);
          if (sshPort) {
            expect(sshPort.open).toBe(true);
          }
        });
      }
    });

    it('SSH variant machines never have SSH closed', () => {
      for (let i = 0; i < 200; i++) {
        const result = generateMissionNetwork(`ssh-var-protect-${i}`);
        result.machines
          .filter((m) => m.accessVariant === 'ssh')
          .forEach((m) => {
            const sshPort = m.remoteMachine.ports.find((p) => p.port === 22);
            if (sshPort) {
              expect(sshPort.open).toBe(true);
            }
          });
      }
    });

    it('FTP variant machines never have FTP closed', () => {
      for (let i = 0; i < 200; i++) {
        const result = generateMissionNetwork(`ftp-var-protect-${i}`);
        result.machines
          .filter((m) => m.accessVariant === 'ftp')
          .forEach((m) => {
            const ftpPort = m.remoteMachine.ports.find((p) => p.port === 21);
            if (ftpPort) {
              expect(ftpPort.open).toBe(true);
            }
          });
      }
    });

    it('never both SSH and FTP closed on the same machine', () => {
      for (let i = 0; i < 200; i++) {
        const result = generateMissionNetwork(`no-double-close-${i}`);
        result.machines.forEach((m) => {
          const sshClosed = m.remoteMachine.ports.some((p) => p.port === 22 && !p.open);
          const ftpClosed = m.remoteMachine.ports.some((p) => p.port === 21 && !p.open);
          expect(sshClosed && ftpClosed).toBe(false);
        });
      }
    });
  });

  it('sabotage keyword forces sabotage objective', () => {
    const result = generateMissionNetwork('test-sabotage-easy');
    expect(result.objective.type).toBe('sabotage');
    expect(result.objective.targetPath).toBe('');
    expect(result.objective.targetContent).toBe('');
    expect(result.objective.description).toContain('Destroy');
  });

  it('sabotage seeds never have SSH closures', () => {
    for (let i = 0; i < 50; i++) {
      const result = generateMissionNetwork(`sabotage-noclose-${i}`);
      if (result.objective.type !== 'sabotage') continue;

      result.machines.forEach((m) => {
        const sshPort = m.remoteMachine.ports.find((p) => p.port === 22);
        if (sshPort) {
          expect(sshPort.open).toBe(true);
        }
      });
    }
  });
});
