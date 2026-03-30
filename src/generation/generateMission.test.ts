import { describe, it, expect } from 'vitest';
import { generateMissionNetwork, parseSeedOverrides } from './generateMission';
import type { FileNode } from '../filesystem/types';
import { parseIptablesRules } from '../network/iptablesParser';

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

  it('parses snmp keyword as entry variant', () => {
    expect(parseSeedOverrides('test-snmp').entryVariant).toBe('snmp');
    expect(parseSeedOverrides('SNMP-MISSION').entryVariant).toBe('snmp');
  });

  it('parses backdoor keyword as objective type', () => {
    expect(parseSeedOverrides('test-backdoor').objectiveType).toBe('backdoor');
    expect(parseSeedOverrides('BACKDOOR-MISSION').objectiveType).toBe('backdoor');
  });

  it('parses portforward keyword as objective type', () => {
    expect(parseSeedOverrides('test-portforward').objectiveType).toBe('portforward');
    expect(parseSeedOverrides('PORTFORWARD-MISSION').objectiveType).toBe('portforward');
  });

  it('returns undefined objectiveType without backdoor keyword', () => {
    expect(parseSeedOverrides('test-mission').objectiveType).toBeUndefined();
  });

  it('parses forensics keyword as objective type', () => {
    expect(parseSeedOverrides('test-forensics').objectiveType).toBe('forensics');
    expect(parseSeedOverrides('FORENSICS-MISSION').objectiveType).toBe('forensics');
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
      if (
        result.objective.type === 'credential_theft' ||
        result.objective.type === 'sabotage' ||
        result.objective.type === 'backdoor' ||
        result.objective.type === 'portforward' ||
        result.objective.type === 'forensics' ||
        result.objective.binary ||
        result.objective.encrypted
      )
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
    expect([
      'exfiltrate',
      'tamper',
      'credential_theft',
      'script_fix',
      'sabotage',
      'backdoor',
    ]).toContain(result.objective.type);
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

  it('hard difficulty produces no natForwarding on border router (router-first mode)', () => {
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

  it('HTTP entry variant places credential files in /var/www/html/ on entry machine', () => {
    for (let i = 0; i < 50; i++) {
      const result = generateMissionNetwork(`http-integration-${i}-http`);
      expect(result.entryVariant).toBe('http');

      const entryFs = result.fileSystems[result.entryPoint];
      expect(entryFs).toBeDefined();

      // Navigate to /var/www/html/
      const varDir = entryFs?.type === 'directory' ? entryFs.children?.['var'] : undefined;
      const wwwDir = varDir?.type === 'directory' ? varDir.children?.['www'] : undefined;
      const htmlDir = wwwDir?.type === 'directory' ? wwwDir.children?.['html'] : undefined;
      expect(htmlDir?.type).toBe('directory');

      // Should have more than just index.html (credential files or sidecar)
      const childNames = Object.keys(htmlDir?.children ?? {});
      expect(childNames.length).toBeGreaterThan(1);

      // Credentials should belong to a user on the entry machine
      const entryCreds = result.machines
        .filter((m) => m.ip === result.entryPoint)
        .flatMap((m) => m.remoteMachine.users ?? [])
        .filter((u) => u.userType === 'user');
      if (entryCreds.length === 0) continue;

      const username = entryCreds[0]?.username;
      if (!username) continue;

      // Collect all file content from /var/www/html/ tree
      const allContent = collectAllContent(htmlDir);
      const hasCreds = allContent.some((c) => c.includes(username));
      expect(hasCreds).toBe(true);
      return;
    }
    throw new Error('No HTTP entry with user credentials found in 50 seeds');
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

  it('script_fix objective content uses _system() instead of _decode()', () => {
    let found = false;
    for (let i = 0; i < 100; i++) {
      const result = generateMissionNetwork(`script-fix-system-${i}`);
      if (result.objective.type !== 'script_fix') continue;

      expect(result.objective.targetContent).not.toContain('_decode(');
      expect(result.objective.targetContent).toContain('_system(');
      expect(result.objective.expectedChecksum).toBeTruthy();
      found = true;
      break;
    }
    expect(found).toBe(true);
  });

  it('script_fix with keyword always uses _system()', () => {
    const result = generateMissionNetwork('test-script-fix-easy');
    expect(result.objective.type).toBe('script_fix');
    expect(result.objective.targetContent).toContain('_system(');
    expect(result.objective.targetContent).not.toContain('_decode(');
    expect(result.objective.expectedChecksum).toBeTruthy();
  });

  it('script_fix forces SSH entry and includes root password in description', () => {
    const result = generateMissionNetwork('test-script-fix-easy');
    expect(result.objective.type).toBe('script_fix');
    expect(result.entryVariant).toBe('ssh');
    expect(result.objective.description).toContain('Root password:');
  });

  it('script_fix does not generate expectedProof (no ACCESS-KEY)', () => {
    const result = generateMissionNetwork('test-script-fix-easy');
    expect(result.objective.type).toBe('script_fix');
    expect(result.objective.expectedProof).toBe('');
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

    it('FTP port 21 is open when SSH is closed unless dual closure with NC backdoor', () => {
      for (let i = 0; i < 500; i++) {
        const result = generateMissionNetwork(`ftp-guarantee-${i}`);
        result.machines
          .filter((m) => m.role !== 'router')
          .forEach((m) => {
            const sshClosed = m.remoteMachine.ports.some((p) => p.port === 22 && !p.open);
            if (sshClosed) {
              const ftpOpen = m.remoteMachine.ports.some((p) => p.port === 21 && p.open);
              const hasBackdoor = m.remoteMachine.ports.some(
                (p) => p.service === 'elite' && p.open,
              );
              // Either FTP is open (single closure) or there's a backdoor (dual closure)
              expect(ftpOpen || hasBackdoor).toBe(true);
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
        // SNMP variant intentionally has SSH closed (by design, not by closure)
        if (result.entryVariant === 'snmp') continue;
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

        result.machines
          .filter((m) => m.role !== 'router')
          .forEach((m) => {
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

    it('never both SSH and FTP closed without NC backdoor', () => {
      for (let i = 0; i < 200; i++) {
        const result = generateMissionNetwork(`no-double-close-${i}`);
        result.machines.forEach((m) => {
          const sshClosed = m.remoteMachine.ports.some((p) => p.port === 22 && !p.open);
          const ftpClosed = m.remoteMachine.ports.some((p) => p.port === 21 && !p.open);
          if (sshClosed && ftpClosed) {
            // Dual closure — must have an NC backdoor with root owner
            const hasBackdoor = m.remoteMachine.ports.some(
              (p) => p.service === 'elite' && p.open && p.owner?.userType === 'root',
            );
            expect(hasBackdoor).toBe(true);
          }
        });
      }
    });

    it('dual SSH+FTP closure with NC backdoor occurs on non-entry machines (statistical)', () => {
      let dualClosureCount = 0;
      for (let i = 0; i < 500; i++) {
        const result = generateMissionNetwork(`dual-closure-${i}`);
        const hasDualClosure = result.machines.some((m) => {
          if (m.ip === result.entryPoint || m.role === 'router') return false;
          const sshClosed = m.remoteMachine.ports.some((p) => p.port === 22 && !p.open);
          const ftpClosed = !m.remoteMachine.ports.some((p) => p.port === 21 && p.open);
          const hasBackdoor = m.remoteMachine.ports.some((p) => p.service === 'elite' && p.open);
          return sshClosed && ftpClosed && hasBackdoor;
        });
        if (hasDualClosure) dualClosureCount++;
      }
      expect(dualClosureCount).toBeGreaterThan(0);
    });

    it('NC backdoor on SSH-closed machine is always root-owned', () => {
      for (let i = 0; i < 500; i++) {
        const result = generateMissionNetwork(`ssh-backdoor-owner-${i}`);
        result.machines.forEach((m) => {
          if (m.ip === result.entryPoint || m.role === 'router') return;
          const sshClosed = m.remoteMachine.ports.some((p) => p.port === 22 && !p.open);
          if (sshClosed) {
            const backdoors = m.remoteMachine.ports.filter((p) => p.service === 'elite' && p.open);
            backdoors.forEach((b) => {
              expect(b.owner?.userType).toBe('root');
            });
          }
        });
      }
    });

    it('SSH-closed non-entry machines always have an NC backdoor', () => {
      for (let i = 0; i < 500; i++) {
        const result = generateMissionNetwork(`ssh-needs-backdoor-${i}`);
        result.machines.forEach((m) => {
          if (m.ip === result.entryPoint || m.role === 'router') return;
          const sshClosed = m.remoteMachine.ports.some((p) => p.port === 22 && !p.open);
          if (sshClosed) {
            const hasBackdoor = m.remoteMachine.ports.some((p) => p.service === 'elite' && p.open);
            expect(hasBackdoor).toBe(true);
          }
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

  it('backdoor keyword forces backdoor objective', () => {
    const result = generateMissionNetwork('test-backdoor-easy');
    expect(result.objective.type).toBe('backdoor');
    expect(result.objective.backdoorPort).toBeDefined();
    expect([4444, 31337, 8888, 1337, 9999, 5555, 6666, 1234]).toContain(
      result.objective.backdoorPort,
    );
    expect(result.objective.backdoorUser).toBeDefined();
    expect(result.objective.description).toContain('backdoor');
  });

  it('backdoor seeds never have SSH closures', () => {
    for (let i = 0; i < 50; i++) {
      const result = generateMissionNetwork(`backdoor-noclose-${i}`);
      if (result.objective.type !== 'backdoor') continue;

      result.machines
        .filter((m) => m.role !== 'router')
        .forEach((m) => {
          const sshPort = m.remoteMachine.ports.find((p) => p.port === 22);
          if (sshPort) {
            expect(sshPort.open).toBe(true);
          }
        });
    }
  });

  it('sabotage seeds never have SSH closures', () => {
    for (let i = 0; i < 50; i++) {
      const result = generateMissionNetwork(`sabotage-noclose-${i}`);
      if (result.objective.type !== 'sabotage') continue;

      result.machines
        .filter((m) => m.role !== 'router')
        .forEach((m) => {
          const sshPort = m.remoteMachine.ports.find((p) => p.port === 22);
          if (sshPort) {
            expect(sshPort.open).toBe(true);
          }
        });
    }
  });

  it('script-auto keyword forces script_auto objective', () => {
    const result = generateMissionNetwork('test-script-auto-easy');
    expect(result.objective.type).toBe('script_auto');
    expect(result.objective.targetPath).toMatch(/\/(cron\.d|init\.d|network\/if-up\.d)\//);
    expect(result.objective.expectedProof).toBe('');
    expect(result.objective.expectedChecksum).toBeTruthy();
    expect(result.objective.scriptAutoFlavor).toBeDefined();
    expect(result.objective.description).toContain('automated script');
  });

  it('script_auto forces SSH entry and includes root password in description', () => {
    const result = generateMissionNetwork('test-script-auto-easy');
    expect(result.objective.type).toBe('script_auto');
    expect(result.entryVariant).toBe('ssh');
    expect(result.objective.description).toContain('Root password:');
  });

  it('script_auto instructions use _system() not _decode()', () => {
    const result = generateMissionNetwork('test-script-auto-easy');
    expect(result.objective.type).toBe('script_auto');
    expect(result.objective.targetContent).toContain('_system(');
    expect(result.objective.targetContent).not.toContain('_decode(');
  });

  it('script_auto seeds never have SSH closures', () => {
    for (let i = 0; i < 50; i++) {
      const result = generateMissionNetwork(`script-auto-noclose-${i}`);
      if (result.objective.type !== 'script_auto') continue;

      result.machines
        .filter((m) => m.role !== 'router')
        .forEach((m) => {
          const sshPort = m.remoteMachine.ports.find((p) => p.port === 22);
          if (sshPort) {
            expect(sshPort.open).toBe(true);
          }
        });
    }
  });

  it('script_auto is deterministic', () => {
    const a = generateMissionNetwork('SOLARIS-script-auto-easy');
    const b = generateMissionNetwork('SOLARIS-script-auto-easy');
    expect(a.objective).toEqual(b.objective);
  });

  it('portforward keyword forces portforward objective', () => {
    const result = generateMissionNetwork('test-snmp-easy-portforward');
    expect(result.objective.type).toBe('portforward');
    expect(result.objective.forwardPublicPort).toBeDefined();
    expect(result.objective.forwardInternalIp).toBeDefined();
    expect(result.objective.forwardInternalPort).toBeDefined();
    expect(result.objective.description).toContain('NAT forwarding');
  });

  it('portforward forces router-first mode (no natForwarding)', () => {
    const result = generateMissionNetwork('test-snmp-easy-portforward');
    expect(result.natForwarding).toBeUndefined();
  });

  it('portforward seeds never have SSH closures', () => {
    for (let i = 0; i < 50; i++) {
      const result = generateMissionNetwork(`portforward-noclose-${i}`);
      if (result.objective.type !== 'portforward') continue;

      result.machines
        .filter((m) => m.role !== 'router')
        .forEach((m) => {
          const sshPort = m.remoteMachine.ports.find((p) => p.port === 22);
          if (sshPort) {
            expect(sshPort.open).toBe(true);
          }
        });
    }
  });

  it('portforward is deterministic', () => {
    const a = generateMissionNetwork('SOLARIS-snmp-easy-portforward');
    const b = generateMissionNetwork('SOLARIS-snmp-easy-portforward');
    expect(a.objective).toEqual(b.objective);
  });

  it('portforward target IP matches an internal machine', () => {
    const result = generateMissionNetwork('test-snmp-medium-portforward');
    const internalIps = result.machines.map((m) => m.ip);
    expect(internalIps).toContain(result.objective.forwardInternalIp);
  });

  it('router iptables file exists with empty rules for portforward', () => {
    const result = generateMissionNetwork('test-snmp-easy-portforward');
    const routerFs = result.fileSystems[result.routerPublicIp];
    expect(routerFs).toBeDefined();
    // Navigate to /etc/iptables/rules.v4
    const etc = routerFs?.children?.['etc'];
    const iptables = etc?.children?.['iptables'];
    const rulesFile = iptables?.children?.['rules.v4'];
    expect(rulesFile).toBeDefined();
    expect(rulesFile?.type).toBe('file');
    // Router-first mode: no pre-populated forwarding rules (only comment template)
    const rules = parseIptablesRules(rulesFile?.content ?? '');
    expect(rules).toHaveLength(0);
  });
});

describe('generateMissionNetwork usedIps', () => {
  it('avoids public IPs in the usedIps set', () => {
    const seed = 'collision-mission';
    const mission1 = generateMissionNetwork(seed);
    const blocked = new Set([mission1.routerPublicIp]);
    const mission2 = generateMissionNetwork(seed, blocked);
    expect(mission2.routerPublicIp).not.toBe(mission1.routerPublicIp);
  });

  it('behaves identically when usedIps is omitted', () => {
    const seed = 'no-used-ips';
    const mission1 = generateMissionNetwork(seed);
    const mission2 = generateMissionNetwork(seed, new Set());
    expect(mission2.routerPublicIp).toBe(mission1.routerPublicIp);
  });
});

describe('forensics mission end-to-end', () => {
  it('generates a complete forensics mission with SSH entry', () => {
    const mission = generateMissionNetwork('test-forensics-easy-ssh');
    expect(mission.objective.type).toBe('forensics');
    expect(mission.entryVariant).toBe('ssh');
    expect(mission.objective.attackerHandle).toBeTruthy();
    expect(mission.objective.attackerIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(mission.objective.description).toContain('Root password:');
  });

  it('forces SSH entry even when other entry variant is in seed', () => {
    const mission = generateMissionNetwork('test-forensics-ftp-easy');
    expect(mission.objective.type).toBe('forensics');
    expect(mission.entryVariant).toBe('ssh');
  });

  it('has attacker IP in filesystem logs', () => {
    const mission = generateMissionNetwork('forensics-e2e-logs');
    const attackerIp = mission.objective.attackerIp!;
    const allContent = Object.values(mission.fileSystems).flatMap((fs) => collectAllContent(fs));
    const hasAttackerIp = allContent.some((c) => c.includes(attackerIp));
    expect(hasAttackerIp).toBe(true);
  });

  it('has calling card in filesystem', () => {
    const mission = generateMissionNetwork('forensics-e2e-card');
    const handle = mission.objective.attackerHandle!;
    const allContent = Object.values(mission.fileSystems).flatMap((fs) => collectAllContent(fs));
    const hasCallingCard = allContent.some((c) => c.includes(handle));
    expect(hasCallingCard).toBe(true);
  });

  it('is deterministic', () => {
    const a = generateMissionNetwork('forensics-e2e-determ');
    const b = generateMissionNetwork('forensics-e2e-determ');
    expect(a).toEqual(b);
  });
});

// Recursively collects all text content from a FileNode tree.
const collectAllContent = (node: FileNode | undefined): readonly string[] => {
  if (!node) return [];
  if (node.type === 'file') return node.content ? [node.content] : [];
  return Object.values(node.children ?? {}).flatMap((child) => collectAllContent(child));
};

describe('parseSeedOverrides — malware', () => {
  it('parses malware keyword as objective type', () => {
    expect(parseSeedOverrides('test-malware').objectiveType).toBe('malware');
    expect(parseSeedOverrides('MALWARE-MISSION').objectiveType).toBe('malware');
  });
});

describe('malware mission end-to-end', () => {
  it('generates a complete malware mission with SSH entry', () => {
    const mission = generateMissionNetwork('test-malware-easy');
    expect(mission.objective.type).toBe('malware');
    expect(mission.entryVariant).toBe('ssh');
    expect(mission.objective.targetPath).toMatch(/^\//);
    expect(mission.objective.targetContent).toBeTruthy();
    expect(mission.objective.malwarePidPath).toMatch(/^\/var\/run\/.+\.pid$/);
    expect(mission.objective.description).toMatch(/Root password: \S+/);
  });

  it('forces SSH entry even when other entry variant is in seed', () => {
    const mission = generateMissionNetwork('test-malware-ftp-easy');
    expect(mission.objective.type).toBe('malware');
    expect(mission.entryVariant).toBe('ssh');
  });

  it('places malware file on target machine filesystem', () => {
    const mission = generateMissionNetwork('malware-fs-test-easy');
    const targetFs = mission.fileSystems[mission.objective.targetMachine];
    expect(targetFs).toBeDefined();
    const allContent = collectAllContent(targetFs);
    // Binary malware wraps content in noise — check that a key line is present
    const firstLine = mission.objective.targetContent.split('\n')[0];
    expect(allContent.some((c) => c.includes(firstLine))).toBe(true);
  });

  it('places PID file in /var/run/ on target machine', () => {
    const mission = generateMissionNetwork('malware-pid-test-easy');
    const targetFs = mission.fileSystems[mission.objective.targetMachine];
    const varRun = targetFs?.children?.['var']?.children?.['run'];
    expect(varRun).toBeDefined();
    const pidName = mission.objective.malwarePidName!;
    const pidFile = varRun?.children?.[pidName];
    expect(pidFile).toBeDefined();
    expect(pidFile?.type).toBe('file');
    expect(pidFile?.content).toContain(mission.objective.targetPath);
  });

  it('is deterministic', () => {
    const a = generateMissionNetwork('malware-determ');
    const b = generateMissionNetwork('malware-determ');
    expect(a).toEqual(b);
  });
});
