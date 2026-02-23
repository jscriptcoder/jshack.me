import { describe, it, expect } from 'vitest';
import { createPrng } from './prng';
import { generateTopology } from './topology';
import { generateUsers } from './users';
import { generateAttackChain } from './attackChain';
import { generateFileSystems } from './filesystem';
import { entryCredentialHintTemplates } from './pools';
import type { FileNode } from '../filesystem/types';

const buildTestData = (seed: string) => {
  const prng = createPrng(seed);
  const topology = generateTopology(prng, 'medium');
  const { usersByMachine, credentials } = generateUsers(
    prng,
    topology.machines,
    topology.entryPoint,
  );
  const { credentialPlacements, objective } = generateAttackChain({
    prng,
    machines: topology.machines,
    credentials,
    entryPoint: topology.entryPoint,
    entryVariant: topology.entryVariant,
    difficulty: 'medium',
  });
  const fileSystems = generateFileSystems({
    prng,
    machines: topology.machines,
    usersByMachine,
    credentialPlacements,
    credentials,
    objective,
    entryPoint: topology.entryPoint,
    entryVariant: topology.entryVariant,
  });
  return { topology, fileSystems, objective, credentialPlacements };
};

const resolveNode = (root: FileNode, path: string): FileNode | undefined => {
  const parts = path.split('/').filter(Boolean);
  let current: FileNode | undefined = root;
  for (const part of parts) {
    if (current?.type !== 'directory' || !current.children) return undefined;
    current = current.children[part];
  }
  return current;
};

describe('generateFileSystems', () => {
  it('produces deterministic output for the same seed', () => {
    const a = buildTestData('fs-seed');
    const b = buildTestData('fs-seed');
    expect(a.fileSystems).toEqual(b.fileSystems);
  });

  it('produces different output for different seeds', () => {
    const a = buildTestData('fs-alpha');
    const b = buildTestData('fs-beta');
    expect(a.fileSystems).not.toEqual(b.fileSystems);
  });

  it('creates a filesystem for each machine', () => {
    const { topology, fileSystems } = buildTestData('count-test');
    topology.machines.forEach((m) => {
      expect(fileSystems[m.ip]).toBeDefined();
      expect(fileSystems[m.ip]?.type).toBe('directory');
      expect(fileSystems[m.ip]?.name).toBe('/');
    });
  });

  it('each filesystem has standard directories', () => {
    const { topology, fileSystems } = buildTestData('dirs-test');
    topology.machines.forEach((m) => {
      const root = fileSystems[m.ip];
      expect(root?.children?.['root']).toBeDefined();
      expect(root?.children?.['home']).toBeDefined();
      expect(root?.children?.['etc']).toBeDefined();
      expect(root?.children?.['var']).toBeDefined();
    });
  });

  it('each filesystem has /etc/passwd', () => {
    const { topology, fileSystems } = buildTestData('passwd-test');
    topology.machines.forEach((m) => {
      const root = fileSystems[m.ip];
      const passwd = resolveNode(root as FileNode, '/etc/passwd');
      expect(passwd).toBeDefined();
      expect(passwd?.type).toBe('file');
      expect(passwd?.content).toBeTruthy();
    });
  });

  it('target machine has the target file for exfiltrate/tamper objectives', () => {
    // Try seeds until we get an exfiltrate or tamper objective (which have target files)
    for (let i = 0; i < 50; i++) {
      const { fileSystems, objective } = buildTestData(`target-file-${i}`);
      if (objective.type === 'credential_theft') continue;

      const targetFs = fileSystems[objective.targetMachine];
      const targetFile = resolveNode(targetFs as FileNode, objective.targetPath);
      expect(targetFile).toBeDefined();
      if (objective.binary) {
        // Binary-wrapped files embed each line in noise — verify first non-empty line is present
        const firstLine = objective.targetContent.split('\n').find((l) => l.trim().length > 0);
        expect(targetFile?.content).toContain(firstLine);
      } else {
        expect(targetFile?.content).toBe(objective.targetContent);
      }
      expect(objective.targetPath).not.toBe('/root/flag.txt');
      return;
    }
    throw new Error('No exfiltrate/tamper objective found in 50 seeds');
  });

  it('credential_theft objective skips target file placement', () => {
    for (let i = 0; i < 100; i++) {
      const { objective } = buildTestData(`cred-theft-fs-${i}`);
      if (objective.type !== 'credential_theft') continue;

      expect(objective.targetPath).toBe('');
      // No target file placed — the objective is a password, not a file
      return;
    }
    throw new Error('No credential_theft objective found in 100 seeds');
  });

  it('non-target machines do not have a flag file in /root', () => {
    const { topology, fileSystems, objective } = buildTestData('no-flag-test');
    topology.machines
      .filter((m) => m.ip !== objective.targetMachine)
      .forEach((m) => {
        const root = fileSystems[m.ip];
        const flagFile = resolveNode(root as FileNode, '/root/flag.txt');
        expect(flagFile).toBeUndefined();
      });
  });

  it('each filesystem has /etc/hostname', () => {
    const { topology, fileSystems } = buildTestData('hostname-test');
    topology.machines.forEach((m) => {
      const root = fileSystems[m.ip];
      const hostname = resolveNode(root as FileNode, '/etc/hostname');
      expect(hostname).toBeDefined();
      expect(hostname?.content).toBe(m.hostname);
    });
  });

  it('each filesystem has auth.log in /var/log', () => {
    const { topology, fileSystems } = buildTestData('log-test');
    topology.machines.forEach((m) => {
      const root = fileSystems[m.ip];
      const authLog = resolveNode(root as FileNode, '/var/log/auth.log');
      expect(authLog).toBeDefined();
      expect(authLog?.content).toBeTruthy();
    });
  });

  it('all FTP entry credential hint paths use /home/ prefix', () => {
    entryCredentialHintTemplates.forEach((t) => {
      expect(t.ftpPath).toMatch(/^\/home\//);
    });
  });

  it('all exploit entry credential hint paths use /home/ prefix', () => {
    entryCredentialHintTemplates.forEach((t) => {
      expect(t.exploitPath).toMatch(/^\/home\//);
    });
  });

  it('credential placements are embedded in filesystems', () => {
    const { fileSystems, credentialPlacements } = buildTestData('embed-test');
    credentialPlacements.forEach((placement) => {
      const fs = fileSystems[placement.machineIp];
      if (!fs) return;

      const fileNames = placement.filePath.split('/').filter(Boolean);
      const fileName = fileNames[fileNames.length - 1] ?? '';

      const searchInNode = (node: FileNode): boolean => {
        if (node.type === 'file' && node.name === fileName) {
          return node.content?.includes(placement.password) ?? false;
        }
        if (node.children) {
          return Object.values(node.children).some(searchInNode);
        }
        return false;
      };

      expect(searchInNode(fs)).toBe(true);
    });
  });
});
