import { describe, it, expect } from 'vitest';
import { createPrng } from '../prng';
import { generateTopology } from '../topology';
import { generateUsers } from '../users';
import { buildMissionObjective } from '../attackChain';
import { generateFileSystems } from '.';
import { forensicsCallingCardTemplates, forensicsLogTypes, forensicsNoiseIps } from '../pools';
import { resolveNode, collectAllContent, collectAllFiles } from './testHelpers';

describe('forensics pools', async () => {
  it('has at least 5 calling card templates with {{handle}} in content', async () => {
    expect(forensicsCallingCardTemplates.length).toBeGreaterThanOrEqual(5);
    for (const template of forensicsCallingCardTemplates) {
      expect(template.content).toContain('{{handle}}');
    }
  });

  it('has 3 log types', async () => {
    expect(forensicsLogTypes).toEqual(['ssh', 'ftp', 'http']);
  });

  it('has noise IPs', async () => {
    expect(forensicsNoiseIps.length).toBeGreaterThanOrEqual(5);
  });
});

describe('forensics evidence placement', async () => {
  const buildForensics = async (
    seed: string,
    difficulty: 'easy' | 'medium' | 'hard' = 'medium',
  ) => {
    const prng = createPrng(seed);
    const topology = await generateTopology(prng, difficulty);
    const { usersByMachine, credentials } = generateUsers(
      prng,
      topology.machines,
      topology.entryPoint,
    );
    const { objective } = buildMissionObjective({
      prng,
      machines: topology.machines,
      credentials,
      entryPoint: topology.entryPoint,
      difficulty,
      objectiveTypeOverride: 'forensics',
    });
    const { fileSystems } = generateFileSystems({
      prng,
      machines: topology.machines,
      usersByMachine,
      credentials,
      objective,
      routerMachine: topology.routerMachine,
      natForwarding: topology.natForwarding,
      entryVariant: topology.entryVariant,
      entryPoint: topology.entryPoint,
      difficulty,
    });
    return { topology, fileSystems, objective, credentials };
  };

  it('places attacker IP in log files on at least one machine', async () => {
    const { fileSystems, objective } = await buildForensics('forensics-logs-1');
    const attackerIp = objective.attackerIp!;

    // Check all log types (auth.log, vsftpd.log, access.log)
    const allLogContent = Object.values(fileSystems).flatMap((fs) => {
      const logFiles = ['auth.log', 'vsftpd.log', 'access.log'];
      return logFiles
        .map((name) => resolveNode(fs, `/var/log/${name}`))
        .filter((node) => node?.type === 'file')
        .map((node) => node!.content ?? '');
    });
    const hasAttackerIp = allLogContent.some((c) => c.includes(attackerIp));

    expect(hasAttackerIp).toBe(true);
  });

  it('uses varied log types across seeds', async () => {
    const logTypesFound = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const { fileSystems } = await buildForensics(`forensics-logtype-${i}`);
      for (const fs of Object.values(fileSystems)) {
        if (resolveNode(fs, '/var/log/auth.log')?.content) logTypesFound.add('ssh');
        if (resolveNode(fs, '/var/log/vsftpd.log')?.content) logTypesFound.add('ftp');
        if (resolveNode(fs, '/var/log/access.log')?.content) logTypesFound.add('http');
      }
      if (logTypesFound.size >= 3) break;
    }
    expect(logTypesFound.size).toBeGreaterThanOrEqual(2);
  });

  it('places attacker calling card file on a machine', async () => {
    const { fileSystems, objective } = await buildForensics('forensics-card-1');
    const handle = objective.attackerHandle!;

    const allContent = Object.values(fileSystems).flatMap((fs) => collectAllContent(fs));
    const hasCallingCard = allContent.some((c) => c.includes(handle));

    expect(hasCallingCard).toBe(true);
  });

  it('uses varied calling card placements across seeds', async () => {
    const topDirs = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const { fileSystems, objective } = await buildForensics(`forensics-card-vary-${i}`);
      const handle = objective.attackerHandle!;
      // Find which top-level directory the calling card ended up in
      for (const fs of Object.values(fileSystems)) {
        for (const [dirName, child] of Object.entries(fs.children ?? {})) {
          if (dirName === 'var') continue; // skip log directories
          const files = collectAllFiles(child);
          if (files.some((f) => f.content?.includes(handle))) {
            topDirs.add(dirName);
          }
        }
      }
      if (topDirs.size >= 3) break;
    }
    expect(topDirs.size).toBeGreaterThanOrEqual(2);
  });

  it('includes noise log entries from non-attacker IPs', async () => {
    const { fileSystems, objective } = await buildForensics('forensics-noise-1');
    const attackerIp = objective.attackerIp!;

    // Collect all log file content
    const logContent = Object.values(fileSystems).flatMap((fs) => {
      return ['auth.log', 'vsftpd.log', 'access.log']
        .map((name) => resolveNode(fs, `/var/log/${name}`))
        .filter((node) => node?.type === 'file')
        .map((node) => node!.content ?? '');
    });

    // At least one log file should contain an IP that isn't the attacker's
    const allLines = logContent.flatMap((c) => c.split('\n'));
    const hasNoiseIp = allLines.some((line) => line.length > 0 && !line.includes(attackerIp));

    expect(hasNoiseIp).toBe(true);
  });

  it('hard difficulty has more noise entries than easy', async () => {
    const countNoiseLines = async (seed: string, difficulty: 'easy' | 'hard') => {
      const { fileSystems, objective } = await buildForensics(seed, difficulty);
      const attackerIp = objective.attackerIp!;
      return Object.values(fileSystems)
        .flatMap((fs) =>
          ['auth.log', 'vsftpd.log', 'access.log']
            .map((name) => resolveNode(fs, `/var/log/${name}`))
            .filter((node) => node?.type === 'file')
            .flatMap((node) => (node!.content ?? '').split('\n')),
        )
        .filter((line) => line.length > 0 && !line.includes(attackerIp)).length;
    };

    // Average across several seeds to account for PRNG variance
    let easyTotal = 0;
    let hardTotal = 0;
    for (let i = 0; i < 20; i++) {
      easyTotal += await countNoiseLines(`forensics-noise-easy-${i}`, 'easy');
      hardTotal += await countNoiseLines(`forensics-noise-hard-${i}`, 'hard');
    }
    expect(hardTotal).toBeGreaterThan(easyTotal);
  });

  it('is deterministic', async () => {
    const a = await buildForensics('forensics-determ');
    const b = await buildForensics('forensics-determ');
    expect(a.fileSystems).toEqual(b.fileSystems);
  });

  it('forensics evidence does not clobber web content on machines with HTTP ports', async () => {
    const HTTP_SERVICES = ['http', 'https', 'http-alt'];
    let foundMachineWithBoth = false;

    for (let i = 0; i < 30; i++) {
      const { topology, fileSystems } = await buildForensics(`forensics-web-${i}`);
      const machinesWithHttp = topology.machines.filter((m) =>
        m.remoteMachine.ports.some((p) => p.open && HTTP_SERVICES.includes(p.service)),
      );

      for (const machine of machinesWithHttp) {
        const fs = fileSystems[machine.ip];
        if (!fs) continue;
        const hasWebContent = resolveNode(fs, '/var/www/html/index.html')?.type === 'file';
        const hasForensicsLog = ['auth.log', 'vsftpd.log', 'access.log'].some(
          (name) => resolveNode(fs, `/var/log/${name}`)?.type === 'file',
        );

        if (hasWebContent && hasForensicsLog) {
          foundMachineWithBoth = true;
          break;
        }

        // If machine has HTTP open, web content must exist (even when forensics evidence is present)
        if (hasForensicsLog) {
          expect(hasWebContent).toBe(true);
        }
      }
      if (foundMachineWithBoth) break;
    }

    expect(foundMachineWithBoth).toBe(true);
  });
});
