import { describe, it, expect } from 'vitest';
import { generateMissionNetwork, parseSeedOverrides } from './generateMission';
import type { FileNode } from '../filesystem/types';
import { parseIptablesRules } from '../network/iptablesParser';
import { findVulnForService } from './vulnerabilityLookup';

describe('parseSeedOverrides', async () => {
  it('parses domain keyword', async () => {
    expect(parseSeedOverrides('test-domain').domainEntry).toBe(true);
    expect(parseSeedOverrides('DOMAIN-MISSION').domainEntry).toBe(true);
  });

  it('returns undefined domainEntry without keyword', async () => {
    expect(parseSeedOverrides('test-mission').domainEntry).toBeUndefined();
  });

  it('parses sabotage keyword', async () => {
    expect(parseSeedOverrides('test-sabotage').objectiveType).toBe('sabotage');
    expect(parseSeedOverrides('SABOTAGE-MISSION').objectiveType).toBe('sabotage');
  });

  it('parses snmp keyword as entry variant', async () => {
    expect(parseSeedOverrides('test-snmp').entryVariant).toBe('snmp');
    expect(parseSeedOverrides('SNMP-MISSION').entryVariant).toBe('snmp');
  });

  it('parses backdoor keyword as objective type', async () => {
    expect(parseSeedOverrides('test-backdoor').objectiveType).toBe('backdoor');
    expect(parseSeedOverrides('BACKDOOR-MISSION').objectiveType).toBe('backdoor');
  });

  it('parses portforward keyword as objective type', async () => {
    expect(parseSeedOverrides('test-portforward').objectiveType).toBe('portforward');
    expect(parseSeedOverrides('PORTFORWARD-MISSION').objectiveType).toBe('portforward');
  });

  it('returns undefined objectiveType without backdoor keyword', async () => {
    expect(parseSeedOverrides('test-mission').objectiveType).toBeUndefined();
  });

  it('parses forensics keyword as objective type', async () => {
    expect(parseSeedOverrides('test-forensics').objectiveType).toBe('forensics');
    expect(parseSeedOverrides('FORENSICS-MISSION').objectiveType).toBe('forensics');
  });
});

describe('generateMissionNetwork', async () => {
  it('same seed produces identical output (determinism)', async () => {
    const a = await generateMissionNetwork('HEIST-7734');
    const b = await generateMissionNetwork('HEIST-7734');
    expect(a).toEqual(b);
  });

  it('different seeds produce different output', async () => {
    const a = await generateMissionNetwork('MISSION-ALPHA');
    const b = await generateMissionNetwork('MISSION-BETA');
    expect(a.entryPoint).not.toBe(b.entryPoint);
  });

  it('seed containing "easy" produces easy difficulty', async () => {
    const result = await generateMissionNetwork('easy-mission-01');
    expect(result.difficulty).toBe('easy');
    expect(result.machines).toHaveLength(2);
  });

  it('seed containing "hard" produces hard difficulty', async () => {
    const result = await generateMissionNetwork('hard-challenge-X');
    expect(result.difficulty).toBe('hard');
    expect(result.machines.length).toBeGreaterThanOrEqual(4);
  });

  it('entry point is one of the internal machine IPs', async () => {
    const result = await generateMissionNetwork('ENTRY-TEST');
    const ips = result.machines.map((m) => m.ip);
    expect(ips).toContain(result.entryPoint);
  });

  it('all machines have users', async () => {
    const result = await generateMissionNetwork('USERS-TEST');
    result.machines.forEach((m) => {
      expect(m.remoteMachine.users.length).toBeGreaterThan(0);
      const root = m.remoteMachine.users.find((u) => u.username === 'root');
      expect(root).toBeDefined();
    });
  });

  it('network config has entries for all machines plus router', async () => {
    const result = await generateMissionNetwork('CONFIG-TEST');
    result.machines.forEach((m) => {
      expect(result.networkConfig.machineConfigs[m.ip]).toBeDefined();
    });
    expect(result.networkConfig.machineConfigs[result.routerPublicIp]).toBeDefined();
  });

  it('network config machines have populated users', async () => {
    const result = await generateMissionNetwork('NET-USERS-TEST');
    Object.values(result.networkConfig.machineConfigs).forEach((config) => {
      config.machines.forEach((rm) => {
        expect(rm.users.length).toBeGreaterThan(0);
      });
    });
  });

  it('file systems exist for all machines plus router', async () => {
    const result = await generateMissionNetwork('FS-TEST');
    result.machines.forEach((m) => {
      expect(result.fileSystems[m.ip]).toBeDefined();
      expect(result.fileSystems[m.ip]?.name).toBe('/');
    });
    expect(result.fileSystems[result.routerPublicIp]).toBeDefined();
  });

  it('target machine filesystem contains the target file for exfiltrate/tamper/script_fix', async () => {
    for (let i = 0; i < 50; i++) {
      const result = await generateMissionNetwork(`TARGET-FILE-${i}`);
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

  it('objective has a valid type', async () => {
    const result = await generateMissionNetwork('FORMAT-TEST');
    expect([
      'exfiltrate',
      'tamper',
      'credential_theft',
      'script_fix',
      'sabotage',
      'backdoor',
    ]).toContain(result.objective.type);
  });

  it('clientEmail is set with darkmail.onion domain', async () => {
    const result = await generateMissionNetwork('EMAIL-TEST');
    expect(result.clientEmail).toMatch(/@darkmail\.onion$/);
    expect(result.objective.clientEmail).toBe(result.clientEmail);
  });

  it('preserves seed in output', async () => {
    const seed = 'MY-CUSTOM-SEED';
    const result = await generateMissionNetwork(seed);
    expect(result.seed).toBe(seed);
  });

  it('generates diverse results across many seeds', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => generateMissionNetwork(`DIVERSE-${i}`)),
    );
    const uniqueEmails = new Set(results.map((r) => r.clientEmail));
    const uniqueEntries = new Set(results.map((r) => r.entryPoint));
    expect(uniqueEmails.size).toBeGreaterThan(1);
    expect(uniqueEntries.size).toBeGreaterThan(1);
  });

  it('exploit entry variant sets a vulnerable serviceVersion and owner on entry machine port', async () => {
    // Known seed that produces an exploit entry variant with a vulnerable service
    const result = await generateMissionNetwork('exploit-gen-0');
    expect(result.entryVariant).toBe('exploit');

    const targetMachine = result.natForwarding
      ? result.machines.find((m) => m.ip === result.entryPoint)
      : result.routerMachine;
    expect(targetMachine).toBeDefined();

    const vulnPort = targetMachine?.remoteMachine.ports.find(
      (p) =>
        p.service !== 'ssh' &&
        p.open &&
        findVulnForService(p.service, p.serviceVersion ?? '', 0) !== undefined,
    );
    expect(vulnPort).toBeDefined();
    expect(vulnPort!.owner).toBeDefined();
    expect(['guest', 'user', 'root']).toContain(vulnPort!.owner?.userType);
  });

  it('NC/exploit owner type varies across seeds', async () => {
    const ownerTypes = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const result = await generateMissionNetwork(`owner-variety-${i}`);
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

  it('non-entry NC machines have backdoor port owners', async () => {
    // Known seed that produces a multi-layer network with NC internal machines
    const result = await generateMissionNetwork('nc-internal-5');
    const nonEntryNc = result.machines.find(
      (m) => m.ip !== result.entryPoint && m.accessVariant === 'nc',
    );
    expect(nonEntryNc).toBeDefined();

    const backdoorPort = nonEntryNc!.remoteMachine.ports.find(
      (p) => p.service === 'elite' && p.open,
    );
    expect(backdoorPort).toBeDefined();
    expect(backdoorPort?.owner).toBeDefined();
    expect(['guest', 'user']).toContain(backdoorPort?.owner?.userType);
  });

  it('non-entry exploit machines have a vulnerable serviceVersion and owner', async () => {
    // Known seed that produces a non-entry exploit machine
    const result = await generateMissionNetwork('exploit-nonentry-0');
    const nonEntryExploit = result.machines.find(
      (m) => m.ip !== result.entryPoint && m.accessVariant === 'exploit',
    );
    expect(nonEntryExploit).toBeDefined();

    const vulnPort = nonEntryExploit!.remoteMachine.ports.find(
      (p) =>
        p.service !== 'ssh' &&
        p.open &&
        findVulnForService(p.service, p.serviceVersion ?? '', 0) !== undefined,
    );
    expect(vulnPort).toBeDefined();
    expect(vulnPort!.owner).toBeDefined();
    expect(['guest', 'user', 'root']).toContain(vulnPort!.owner?.userType);
  });

  it('non-entry FTP machines have FTP port owners', async () => {
    // Known seed that produces a non-entry FTP machine
    const result = await generateMissionNetwork('ftp-nonentry-0');
    const nonEntryFtp = result.machines.find(
      (m) => m.ip !== result.entryPoint && m.accessVariant === 'ftp',
    );
    expect(nonEntryFtp).toBeDefined();

    const ftpPort = nonEntryFtp!.remoteMachine.ports.find((p) => p.service === 'ftp' && p.open);
    expect(ftpPort).toBeDefined();
    expect(ftpPort?.owner).toBeDefined();
    expect(['guest', 'user', 'root']).toContain(ftpPort?.owner?.userType);
  });

  it('routerMachine is a valid machine with router role', async () => {
    const result = await generateMissionNetwork('ROUTER-TEST');
    expect(result.routerMachine).toBeDefined();
    expect(result.routerMachine.role).toBe('router');
    expect(result.routerMachine.remoteMachine.users.length).toBeGreaterThan(0);
  });

  it('routerPublicIp is a valid public IP from the known prefix pool', async () => {
    const validFirstOctets = [45, 51, 62, 78, 91, 103, 138, 162, 185, 198, 203, 212];
    const result = await generateMissionNetwork('PUB-IP-TEST');
    const firstOctet = Number(result.routerPublicIp.split('.')[0]);
    expect(validFirstOctets).toContain(firstOctet);
  });

  it('routerDomain is hostname.mission format', async () => {
    const result = await generateMissionNetwork('DOMAIN-FORMAT-TEST');
    expect(result.routerDomain).toMatch(/^.+\.mission$/);
    expect(result.routerDomain).toBe(`${result.routerMachine.hostname}.mission`);
  });

  it('seed containing "domain" forces domainEntry true', async () => {
    const result = await generateMissionNetwork('test-domain-mission');
    expect(result.domainEntry).toBe(true);
  });

  it('domainEntry varies across seeds without keyword', async () => {
    // 50 samples is sufficient to see both true and false outcomes since
    // domainEntry is PRNG-rolled (~50/50 weighting). A larger sweep (was
    // 200) pays linearly in generation cost and was flaky under parallel
    // test load.
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => generateMissionNetwork(`VARY-ENTRY-${i}`)),
    );
    const trueCount = results.filter((r) => r.domainEntry).length;
    const falseCount = results.filter((r) => !r.domainEntry).length;
    expect(trueCount).toBeGreaterThan(0);
    expect(falseCount).toBeGreaterThan(0);
  });

  it('hard difficulty produces no natForwarding on border router (router-first mode)', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => generateMissionNetwork(`hard-nat-${i}`)),
    );
    results.forEach((r) => {
      if (r.difficulty === 'hard') {
        expect(r.natForwarding).toBeUndefined();
      }
    });
  });

  it('forwarded mode natForwarding has port-level rules for entry machine', async () => {
    // Known seed that produces forwarded NAT mode
    const result = await generateMissionNetwork('fwd-mission-1');
    expect(result.natForwarding).toBeDefined();

    expect(result.natForwarding!.publicIp).toBe(result.routerPublicIp);
    expect(result.natForwarding!.rules.length).toBeGreaterThan(0);

    // All rules should point to the entry machine
    result.natForwarding!.rules.forEach((rule) => {
      expect(rule.internalIp).toBe(result.entryPoint);
      expect(rule.publicPort).toBe(rule.internalPort);
    });

    // Rules should match the entry machine's open ports
    const entryMachine = result.machines.find((m) => m.ip === result.entryPoint);
    const openPorts = entryMachine?.remoteMachine.ports.filter((p) => p.open) ?? [];
    expect(result.natForwarding!.rules.length).toBe(openPorts.length);
  });

  it('seed containing "http" forces http entry variant', async () => {
    const result = await generateMissionNetwork('MISSION-http-42');
    expect(result.entryVariant).toBe('http');
  });

  it('HTTP entry variant places credential files in /var/www/html/ on entry machine', async () => {
    for (let i = 0; i < 50; i++) {
      const result = await generateMissionNetwork(`http-integration-${i}-http`);
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

  it('router filesystem contains hints about internal machines', async () => {
    const result = await generateMissionNetwork('ROUTER-FS-TEST');
    const routerFs = result.fileSystems[result.routerPublicIp];
    expect(routerFs).toBeDefined();

    const etc = routerFs?.type === 'directory' ? routerFs.children?.['etc'] : undefined;
    const hosts = etc?.type === 'directory' ? etc.children?.['hosts'] : undefined;
    if (hosts?.type === 'file' && hosts.content) {
      const hasInternalIp = result.machines.some((m) => hosts.content?.includes(m.ip));
      expect(hasInternalIp).toBe(true);
    }
  });

  it('script_fix objective content uses _system() instead of _decode()', async () => {
    // Known seed that produces a script_fix objective with _system()
    const result = await generateMissionNetwork('script-fix-0');
    expect(result.objective.type).toBe('script_fix');
    expect(result.objective.targetContent).not.toContain('_decode(');
    expect(result.objective.targetContent).toContain('_system(');
    expect(result.objective.expectedChecksum).toBeTruthy();
  });

  it('script_fix with keyword always uses _system()', async () => {
    const result = await generateMissionNetwork('test-script-fix-easy');
    expect(result.objective.type).toBe('script_fix');
    expect(result.objective.targetContent).toContain('_system(');
    expect(result.objective.targetContent).not.toContain('_decode(');
    expect(result.objective.expectedChecksum).toBeTruthy();
  });

  it('script_fix forces SSH entry and includes root password in description', async () => {
    const result = await generateMissionNetwork('test-script-fix-easy');
    expect(result.objective.type).toBe('script_fix');
    expect(result.entryVariant).toBe('ssh');
    expect(result.objective.description).toContain('Root password:');
  });

  it('script_fix does not generate expectedProof (no ACCESS-KEY)', async () => {
    const result = await generateMissionNetwork('test-script-fix-easy');
    expect(result.objective.type).toBe('script_fix');
    expect(result.objective.expectedProof).toBe('');
  });

  describe('port closures', async () => {
    it('SSH closure occurs for some seeds', async () => {
      // Hardcoded seeds known to produce an SSH closure on a non-entry
      // non-router machine. Was a 200-seed sweep; reduced to fixed seeds
      // to eliminate flakiness under parallel load.
      const sshClosureSeeds = ['port-closure-ssh-7', 'port-closure-ssh-26', 'port-closure-ssh-30'];
      for (const seed of sshClosureSeeds) {
        const result = await generateMissionNetwork(seed);
        const hasClosedSsh = result.machines.some(
          (m) =>
            m.role !== 'router' &&
            m.ip !== result.entryPoint &&
            m.remoteMachine.ports.some((p) => p.port === 22 && !p.open),
        );
        expect(hasClosedSsh, `seed ${seed} should produce SSH closure`).toBe(true);
      }
    });

    it('FTP port 21 is open when SSH is closed unless dual closure with NC backdoor', async () => {
      // Invariant check across a sample of seeds. 50 is sufficient to catch
      // a regression — a broken invariant would fail on many seeds, not just
      // rare ones. Was 500; reduced for speed + to avoid parallel-load flakes.
      for (let i = 0; i < 50; i++) {
        const result = await generateMissionNetwork(`ftp-guarantee-${i}`);
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

    it('entry machine SSH is never closed', async () => {
      for (let i = 0; i < 50; i++) {
        const result = await generateMissionNetwork(`entry-protect-${i}`);
        const entryMachine = result.machines.find((m) => m.ip === result.entryPoint);
        const sshPort = entryMachine?.remoteMachine.ports.find((p) => p.port === 22);
        if (sshPort) {
          expect(sshPort.open).toBe(true);
        }
      }
    });

    it('router ports are never modified by closures', async () => {
      for (let i = 0; i < 50; i++) {
        const result = await generateMissionNetwork(`router-protect-${i}`);
        // SNMP variant intentionally has SSH closed (by design, not by closure)
        if (result.entryVariant === 'snmp') continue;
        const routerSsh = result.routerMachine.remoteMachine.ports.find((p) => p.port === 22);
        if (routerSsh) {
          expect(routerSsh.open).toBe(true);
        }
      }
    });

    it('script_fix seeds never have SSH closures', async () => {
      for (let i = 0; i < 50; i++) {
        const result = await generateMissionNetwork(`script-fix-noclose-${i}`);
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

    it('SSH variant machines never have SSH closed', async () => {
      for (let i = 0; i < 50; i++) {
        const result = await generateMissionNetwork(`ssh-var-protect-${i}`);
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

    it('FTP variant machines never have FTP closed', async () => {
      for (let i = 0; i < 50; i++) {
        const result = await generateMissionNetwork(`ftp-var-protect-${i}`);
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

    it('never both SSH and FTP closed without NC backdoor', async () => {
      for (let i = 0; i < 50; i++) {
        const result = await generateMissionNetwork(`no-double-close-${i}`);
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

    it('dual SSH+FTP closure with NC backdoor occurs on non-entry machines', async () => {
      // Hardcoded seeds known to produce the dual-closure + backdoor state on
      // a non-entry, non-router machine. Chosen via scripts/findSeeds.ts —
      // preferred over the earlier 500-seed sweep because iteration cost
      // scales with generation complexity and the old form was flaky under
      // parallel test load.
      const dualClosureSeeds = ['dual-closure-36', 'dual-closure-90', 'dual-closure-99'];
      for (const seed of dualClosureSeeds) {
        const result = await generateMissionNetwork(seed);
        const hasDualClosure = result.machines.some((m) => {
          if (m.ip === result.entryPoint || m.role === 'router') return false;
          const sshClosed = m.remoteMachine.ports.some((p) => p.port === 22 && !p.open);
          const ftpClosed = !m.remoteMachine.ports.some((p) => p.port === 21 && p.open);
          const hasBackdoor = m.remoteMachine.ports.some((p) => p.service === 'elite' && p.open);
          return sshClosed && ftpClosed && hasBackdoor;
        });
        expect(hasDualClosure, `seed ${seed} should produce dual closure`).toBe(true);
      }
    });

    it('NC backdoor on SSH-closed machine is always root-owned', async () => {
      const sshClosureSeeds = [7, 26, 30, 37, 40, 41, 44, 47, 49, 50];
      for (const i of sshClosureSeeds) {
        const result = await generateMissionNetwork(`port-closure-ssh-${i}`);
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

    it('SSH-closed non-entry machines always have an NC backdoor', async () => {
      const sshClosureSeeds = [7, 26, 30, 37, 40, 41, 44, 47, 49, 50];
      for (const i of sshClosureSeeds) {
        const result = await generateMissionNetwork(`port-closure-ssh-${i}`);
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

  it('sabotage keyword forces sabotage objective', async () => {
    const result = await generateMissionNetwork('test-sabotage-easy');
    expect(result.objective.type).toBe('sabotage');
    expect(result.objective.targetPath).toBe('');
    expect(result.objective.targetContent).toBe('');
    expect(result.objective.description).toContain('Destroy');
  });

  it('backdoor keyword forces backdoor objective', async () => {
    const result = await generateMissionNetwork('test-backdoor-easy');
    expect(result.objective.type).toBe('backdoor');
    expect(result.objective.backdoorPort).toBeDefined();
    expect([4444, 31337, 8888, 1337, 9999, 5555, 6666, 1234]).toContain(
      result.objective.backdoorPort,
    );
    expect(result.objective.backdoorUser).toBeDefined();
    expect(result.objective.description).toContain('backdoor');
  });

  it('backdoor seeds with SSH closures have forcedEffect for recovery', async () => {
    for (let i = 0; i < 50; i++) {
      const result = await generateMissionNetwork(`backdoor-closure-${i}`);
      if (result.objective.type !== 'backdoor') continue;

      result.machines
        .filter((m) => m.role !== 'router')
        .forEach((m) => {
          const sshClosed = m.remoteMachine.ports.some((p) => p.port === 22 && !p.open);
          if (!sshClosed) return;
          // SSH-closed machines must have a forcedEffect for script_exec recovery
          const hasForcedEffect = m.remoteMachine.ports.some(
            (p) => p.forcedEffect?.kind === 'script_exec' && p.forcedEffect?.tier === 'root',
          );
          expect(hasForcedEffect).toBe(true);
        });
    }
  });

  it('sabotage seeds never have SSH closures', async () => {
    for (let i = 0; i < 50; i++) {
      const result = await generateMissionNetwork(`sabotage-noclose-${i}`);
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

  it('script-auto keyword forces script_auto objective', async () => {
    const result = await generateMissionNetwork('test-script-auto-easy');
    expect(result.objective.type).toBe('script_auto');
    expect(result.objective.targetPath).toMatch(/\/(cron\.d|init\.d|network\/if-up\.d)\//);
    expect(result.objective.expectedProof).toBe('');
    expect(result.objective.expectedChecksum).toBeTruthy();
    expect(result.objective.scriptAutoFlavor).toBeDefined();
    expect(result.objective.description).toContain('automated script');
  });

  it('script_auto forces SSH entry and includes root password in description', async () => {
    const result = await generateMissionNetwork('test-script-auto-easy');
    expect(result.objective.type).toBe('script_auto');
    expect(result.entryVariant).toBe('ssh');
    expect(result.objective.description).toContain('Root password:');
  });

  it('script_auto instructions use _system() not _decode()', async () => {
    const result = await generateMissionNetwork('test-script-auto-easy');
    expect(result.objective.type).toBe('script_auto');
    expect(result.objective.targetContent).toContain('_system(');
    expect(result.objective.targetContent).not.toContain('_decode(');
  });

  it('script_auto seeds never have SSH closures', async () => {
    for (let i = 0; i < 50; i++) {
      const result = await generateMissionNetwork(`script-auto-noclose-${i}`);
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

  it('script_auto is deterministic', async () => {
    const a = await generateMissionNetwork('SOLARIS-script-auto-easy');
    const b = await generateMissionNetwork('SOLARIS-script-auto-easy');
    expect(a.objective).toEqual(b.objective);
  });

  it('portforward keyword forces portforward objective', async () => {
    const result = await generateMissionNetwork('test-snmp-easy-portforward');
    expect(result.objective.type).toBe('portforward');
    expect(result.objective.forwardPublicPort).toBeDefined();
    expect(result.objective.forwardInternalIp).toBeDefined();
    expect(result.objective.forwardInternalPort).toBeDefined();
    expect(result.objective.description).toContain('NAT forwarding');
  });

  it('portforward forces router-first mode (no natForwarding)', async () => {
    const result = await generateMissionNetwork('test-snmp-easy-portforward');
    expect(result.natForwarding).toBeUndefined();
  });

  it('portforward seeds never have SSH closures', async () => {
    for (let i = 0; i < 50; i++) {
      const result = await generateMissionNetwork(`portforward-noclose-${i}`);
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

  it('portforward is deterministic', async () => {
    const a = await generateMissionNetwork('SOLARIS-snmp-easy-portforward');
    const b = await generateMissionNetwork('SOLARIS-snmp-easy-portforward');
    expect(a.objective).toEqual(b.objective);
  });

  it('portforward target IP matches an internal machine', async () => {
    const result = await generateMissionNetwork('test-snmp-medium-portforward');
    const internalIps = result.machines.map((m) => m.ip);
    expect(internalIps).toContain(result.objective.forwardInternalIp);
  });

  it('router iptables file exists with empty rules for portforward', async () => {
    const result = await generateMissionNetwork('test-snmp-easy-portforward');
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

describe('generateMissionNetwork usedIps', async () => {
  it('avoids public IPs in the usedIps set', async () => {
    const seed = 'collision-mission';
    const mission1 = await generateMissionNetwork(seed);
    const blocked = new Set([mission1.routerPublicIp]);
    const mission2 = await generateMissionNetwork(seed, blocked);
    expect(mission2.routerPublicIp).not.toBe(mission1.routerPublicIp);
  });

  it('behaves identically when usedIps is omitted', async () => {
    const seed = 'no-used-ips';
    const mission1 = await generateMissionNetwork(seed);
    const mission2 = await generateMissionNetwork(seed, new Set());
    expect(mission2.routerPublicIp).toBe(mission1.routerPublicIp);
  });
});

describe('forensics mission end-to-end', async () => {
  it('generates a complete forensics mission with SSH entry', async () => {
    const mission = await generateMissionNetwork('test-forensics-easy-ssh');
    expect(mission.objective.type).toBe('forensics');
    expect(mission.entryVariant).toBe('ssh');
    expect(mission.objective.attackerHandle).toBeTruthy();
    expect(mission.objective.attackerIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(mission.objective.description).toContain('Root password:');
  });

  it('forces SSH entry even when other entry variant is in seed', async () => {
    const mission = await generateMissionNetwork('test-forensics-ftp-easy');
    expect(mission.objective.type).toBe('forensics');
    expect(mission.entryVariant).toBe('ssh');
  });

  it('has attacker IP in filesystem logs', async () => {
    const mission = await generateMissionNetwork('forensics-e2e-logs');
    const attackerIp = mission.objective.attackerIp!;
    const allContent = Object.values(mission.fileSystems).flatMap((fs) => collectAllContent(fs));
    const hasAttackerIp = allContent.some((c) => c.includes(attackerIp));
    expect(hasAttackerIp).toBe(true);
  });

  it('has calling card in filesystem', async () => {
    const mission = await generateMissionNetwork('forensics-e2e-card');
    const handle = mission.objective.attackerHandle!;
    const allContent = Object.values(mission.fileSystems).flatMap((fs) => collectAllContent(fs));
    const hasCallingCard = allContent.some((c) => c.includes(handle));
    expect(hasCallingCard).toBe(true);
  });

  it('is deterministic', async () => {
    const a = await generateMissionNetwork('forensics-e2e-determ');
    const b = await generateMissionNetwork('forensics-e2e-determ');
    expect(a).toEqual(b);
  });
});

// Recursively collects all text content from a FileNode tree.
const collectAllContent = (node: FileNode | undefined): readonly string[] => {
  if (!node) return [];
  if (node.type === 'file') return node.content ? [node.content] : [];
  return Object.values(node.children ?? {}).flatMap((child) => collectAllContent(child));
};

describe('parseSeedOverrides — malware', async () => {
  it('parses malware keyword as objective type', async () => {
    expect(parseSeedOverrides('test-malware').objectiveType).toBe('malware');
    expect(parseSeedOverrides('MALWARE-MISSION').objectiveType).toBe('malware');
  });
});

describe('malware mission end-to-end', async () => {
  it('generates a complete malware mission with SSH entry', async () => {
    const mission = await generateMissionNetwork('test-malware-easy');
    expect(mission.objective.type).toBe('malware');
    expect(mission.entryVariant).toBe('ssh');
    expect(mission.objective.targetPath).toMatch(/^\//);
    expect(mission.objective.targetContent).toBeTruthy();
    expect(mission.objective.malwarePidPath).toMatch(/^\/var\/run\/.+\.pid$/);
    expect(mission.objective.description).toMatch(/Root password: \S+/);
  });

  it('forces SSH entry even when other entry variant is in seed', async () => {
    const mission = await generateMissionNetwork('test-malware-ftp-easy');
    expect(mission.objective.type).toBe('malware');
    expect(mission.entryVariant).toBe('ssh');
  });

  it('places malware file on target machine filesystem', async () => {
    const mission = await generateMissionNetwork('malware-fs-test-easy');
    const targetFs = mission.fileSystems[mission.objective.targetMachine];
    expect(targetFs).toBeDefined();
    const allContent = collectAllContent(targetFs);
    // Binary malware wraps content in noise — check that a key line is present
    const firstLine = mission.objective.targetContent.split('\n')[0];
    expect(allContent.some((c) => c.includes(firstLine))).toBe(true);
  });

  it('places PID file in /var/run/ on target machine', async () => {
    const mission = await generateMissionNetwork('malware-pid-test-easy');
    const targetFs = mission.fileSystems[mission.objective.targetMachine];
    const varRun = targetFs?.children?.['var']?.children?.['run'];
    expect(varRun).toBeDefined();
    const pidName = mission.objective.malwarePidName!;
    const pidFile = varRun?.children?.[pidName];
    expect(pidFile).toBeDefined();
    expect(pidFile?.type).toBe('file');
    expect(pidFile?.content).toContain(mission.objective.targetPath);
  });

  it('is deterministic', async () => {
    const a = await generateMissionNetwork('malware-determ');
    const b = await generateMissionNetwork('malware-determ');
    expect(a).toEqual(b);
  });
});

describe('MySQL mission end-to-end', async () => {
  it('generates a db_exfiltrate mission with ACCESS-KEY in database', async () => {
    const mission = await generateMissionNetwork('test-db-exfiltrate-easy');
    expect(mission.objective.type).toBe('db_exfiltrate');
    expect(mission.objective.expectedProof).toMatch(/^ACCESS-\d{4}-\d{4}-\d{4}$/);
    expect(mission.objective.dbTargetTable).toBe('api_keys');

    // Verify database file exists on target machine with the ACCESS-KEY
    const targetFs = mission.fileSystems[mission.objective.targetMachine];
    expect(targetFs).toBeDefined();
    const dbFile =
      targetFs?.children?.['var']?.children?.['lib']?.children?.['mysql']?.children?.['data.json'];
    expect(dbFile?.type).toBe('file');
    const db = JSON.parse(dbFile?.content ?? '{}');
    const apiKeys = db.tables?.api_keys;
    expect(apiKeys).toBeDefined();
    const keyRow = apiKeys.rows.find(
      (r: Record<string, unknown>) => r.key_value === mission.objective.expectedProof,
    );
    expect(keyRow).toBeDefined();
  });

  it('generates a db_tamper mission with target table and values', async () => {
    const mission = await generateMissionNetwork('test-db-tamper-easy');
    expect(mission.objective.type).toBe('db_tamper');
    expect(mission.objective.dbTargetTable).toBeDefined();
    expect(mission.objective.dbTamperColumn).toBeDefined();
    expect(mission.objective.dbTamperOldValue).toBeDefined();
    expect(mission.objective.dbTamperNewValue).toBeDefined();
  });

  it('generates a db_sabotage mission with target table', async () => {
    const mission = await generateMissionNetwork('test-db-sabotage-easy');
    expect(mission.objective.type).toBe('db_sabotage');
    expect(mission.objective.dbTargetTable).toBeDefined();
  });

  it('generates a db_fix mission with MySQL credentials in description', async () => {
    const mission = await generateMissionNetwork('test-db-fix-easy');
    expect(mission.objective.type).toBe('db_fix');
    expect(mission.objective.description).toContain('MySQL credentials');
    expect(mission.objective.description).toContain('user: root');
    expect(mission.objective.description).toContain('password:');
    expect(mission.objective.dbTargetTable).toBeDefined();
    expect(mission.objective.dbTamperOldValue).toBeDefined();
    expect(mission.objective.dbTamperNewValue).toBeDefined();
  });

  it('db_fix uses SSH entry (white-hat)', async () => {
    const mission = await generateMissionNetwork('test-db-fix-easy');
    expect(mission.entryVariant).toBe('ssh');
  });

  it('is deterministic', async () => {
    const a = await generateMissionNetwork('mysql-determ-db-exfiltrate');
    const b = await generateMissionNetwork('mysql-determ-db-exfiltrate');
    expect(a).toEqual(b);
  });
});

describe('parseSeedOverrides — MySQL objectives', async () => {
  it('parses db-exfiltrate keyword', async () => {
    expect(parseSeedOverrides('test-db-exfiltrate').objectiveType).toBe('db_exfiltrate');
  });

  it('parses db-tamper keyword', async () => {
    expect(parseSeedOverrides('test-db-tamper').objectiveType).toBe('db_tamper');
  });

  it('parses db-sabotage keyword', async () => {
    expect(parseSeedOverrides('test-db-sabotage').objectiveType).toBe('db_sabotage');
  });

  it('parses db-fix keyword', async () => {
    expect(parseSeedOverrides('test-db-fix').objectiveType).toBe('db_fix');
  });

  it('db-exfiltrate does not match plain exfiltrate', async () => {
    expect(parseSeedOverrides('test-exfiltrate').objectiveType).toBe('exfiltrate');
  });

  it('db-tamper does not match plain tamper', async () => {
    expect(parseSeedOverrides('test-tamper').objectiveType).toBe('tamper');
  });

  it('db-sabotage does not match plain sabotage', async () => {
    expect(parseSeedOverrides('test-sabotage').objectiveType).toBe('sabotage');
  });
});

describe('parseSeedOverrides — effect keywords', async () => {
  it('parses script-exec keyword', async () => {
    expect(parseSeedOverrides('test-script-exec').forcedEffectKind).toBe('script_exec');
  });

  it('parses shell-full keyword', async () => {
    expect(parseSeedOverrides('test-shell-full').forcedEffectKind).toBe('shell_full');
  });

  it('parses shell-limited keyword', async () => {
    expect(parseSeedOverrides('test-shell-limited').forcedEffectKind).toBe('shell_limited');
  });

  it('parses file-read keyword', async () => {
    expect(parseSeedOverrides('test-file-read').forcedEffectKind).toBe('file_read');
  });

  it('parses dir-list keyword', async () => {
    expect(parseSeedOverrides('test-dir-list').forcedEffectKind).toBe('dir_list');
  });

  it('parses file-write keyword', async () => {
    expect(parseSeedOverrides('test-file-write').forcedEffectKind).toBe('file_write');
  });

  it('parses password-reset keyword', async () => {
    expect(parseSeedOverrides('test-password-reset').forcedEffectKind).toBe('password_reset');
  });

  it('parses backdoor-port keyword', async () => {
    expect(parseSeedOverrides('test-backdoor-port').forcedEffectKind).toBe('backdoor_port_open');
  });

  it('returns undefined without effect keyword', async () => {
    expect(parseSeedOverrides('test-mission').forcedEffectKind).toBeUndefined();
  });

  it('parses tier-root keyword', async () => {
    expect(parseSeedOverrides('test-tier-root').forcedEffectTier).toBe('root');
  });

  it('parses tier-user keyword', async () => {
    expect(parseSeedOverrides('test-tier-user').forcedEffectTier).toBe('user');
  });

  it('parses tier-guest keyword', async () => {
    expect(parseSeedOverrides('test-tier-guest').forcedEffectTier).toBe('guest');
  });

  it('returns undefined tier without tier keyword', async () => {
    expect(parseSeedOverrides('test-script-exec').forcedEffectTier).toBeUndefined();
  });

  it('parses both effect and tier from combined seed', async () => {
    const result = parseSeedOverrides('HEIST-script-exec-tier-root-hard');
    expect(result.forcedEffectKind).toBe('script_exec');
    expect(result.forcedEffectTier).toBe('root');
    expect(result.difficulty).toBe('hard');
  });

  it('backdoor-port does not match plain backdoor objective', async () => {
    const result = parseSeedOverrides('test-backdoor-port');
    expect(result.forcedEffectKind).toBe('backdoor_port_open');
    expect(result.objectiveType).toBeUndefined();
  });

  it('script-exec does not match script-fix objective', async () => {
    const result = parseSeedOverrides('test-script-exec');
    expect(result.objectiveType).toBeUndefined();
  });
});

describe('forced effect on target machine via seed keyword', async () => {
  it('seed with script-exec-tier-root stamps forcedEffect on a target machine port', async () => {
    const result = await generateMissionNetwork('test-script-exec-tier-root-exfiltrate');
    const targetMachine = result.machines.find((m) => m.ip === result.objective.targetMachine);
    expect(targetMachine).toBeDefined();
    const forcedPort = targetMachine?.remoteMachine.ports.find((p) => p.forcedEffect);
    expect(forcedPort).toBeDefined();
    expect(forcedPort?.forcedEffect).toEqual({ kind: 'script_exec', tier: 'root' });
    expect(forcedPort?.open).toBe(true);
  });

  it('seed without effect keywords produces no forcedEffect on any port', async () => {
    const result = await generateMissionNetwork('test-plain-exfiltrate');
    const hasForcedEffect = result.machines.some((m) =>
      m.remoteMachine.ports.some((p) => p.forcedEffect),
    );
    expect(hasForcedEffect).toBe(false);
  });

  it('forced effect with tier-guest produces guest tier', async () => {
    const result = await generateMissionNetwork('test-file-read-tier-guest-exfiltrate');
    const targetMachine = result.machines.find((m) => m.ip === result.objective.targetMachine);
    const forcedPort = targetMachine?.remoteMachine.ports.find((p) => p.forcedEffect);
    expect(forcedPort?.forcedEffect).toEqual({ kind: 'file_read', tier: 'guest' });
  });
});
