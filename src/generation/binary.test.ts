import { describe, it, expect } from 'vitest';
import { createPrng } from './prng';
import { wrapInBinaryNoise, binaryCredentialPaths, binaryTargetPaths } from './binary';
import { generateTopology } from './topology';
import { generateUsers } from './users';
import { generateAttackChain } from './attackChain';
import { generateFileSystems } from './filesystem';
import type { FileNode } from '../filesystem/types';

// Replicates the strings command's isPrintable logic (ASCII 32-126 + tab + newline)
const isPrintable = (charCode: number): boolean =>
  (charCode >= 32 && charCode <= 126) || charCode === 10 || charCode === 9;

// Minimal strings extraction matching the real command's behavior (minLength = 4)
const extractStrings = (content: string, minLength = 4): readonly string[] => {
  const results: string[] = [];
  let current = '';
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    if (isPrintable(code)) {
      current += content[i];
    } else {
      if (current.trim().length >= minLength) {
        results.push(current.trim());
      }
      current = '';
    }
  }
  if (current.trim().length >= minLength) {
    results.push(current.trim());
  }
  return results;
};

describe('wrapInBinaryNoise', () => {
  it('produces output containing non-printable characters', () => {
    const prng = createPrng('binary-test');
    const content = 'User: admin\nPass: secret123';
    const wrapped = wrapInBinaryNoise(prng, content);

    const hasNonPrintable = [...wrapped].some((ch) => !isPrintable(ch.charCodeAt(0)));
    expect(hasNonPrintable).toBe(true);
  });

  it('preserves readable content extractable by strings', () => {
    const prng = createPrng('extract-test');
    const content = 'SSH Credentials\nUser: admin\nPass: secret123\nHost: web01';
    const wrapped = wrapInBinaryNoise(prng, content);

    const extracted = extractStrings(wrapped);
    const joined = extracted.join('\n');

    expect(joined).toContain('admin');
    expect(joined).toContain('secret123');
    expect(joined).toContain('web01');
  });

  it('produces deterministic output for the same seed', () => {
    const a = wrapInBinaryNoise(createPrng('det-test'), 'hello world');
    const b = wrapInBinaryNoise(createPrng('det-test'), 'hello world');
    expect(a).toBe(b);
  });

  it('produces different output for different seeds', () => {
    const a = wrapInBinaryNoise(createPrng('seed-a'), 'hello world');
    const b = wrapInBinaryNoise(createPrng('seed-b'), 'hello world');
    expect(a).not.toBe(b);
  });

  it('starts with ELF magic bytes', () => {
    const prng = createPrng('elf-test');
    const wrapped = wrapInBinaryNoise(prng, 'test content');
    expect(wrapped.startsWith('\x7fELF')).toBe(true);
  });

  it('wrapped content is longer than original', () => {
    const prng = createPrng('length-test');
    const content = 'short text';
    const wrapped = wrapInBinaryNoise(prng, content);
    expect(wrapped.length).toBeGreaterThan(content.length);
  });

  it('preserves ACCESS-KEY patterns extractable by strings', () => {
    const prng = createPrng('access-key-test');
    const accessKey = 'ACCESS-A1B2-C3D4-E5F6';
    const content = `Secret data\nToken: ${accessKey}\nEnd of file`;
    const wrapped = wrapInBinaryNoise(prng, content);

    const extracted = extractStrings(wrapped);
    const joined = extracted.join('\n');
    expect(joined).toContain(accessKey);
  });
});

describe('binary path pools', () => {
  it('binaryCredentialPaths has entries for all roles', () => {
    const roles = ['webserver', 'database', 'fileserver', 'workstation', 'router'] as const;
    roles.forEach((role) => {
      expect(binaryCredentialPaths[role].length).toBeGreaterThan(0);
    });
  });

  it('binaryTargetPaths has entries for all roles', () => {
    const roles = ['webserver', 'database', 'fileserver', 'workstation', 'router'] as const;
    roles.forEach((role) => {
      expect(binaryTargetPaths[role].length).toBeGreaterThan(0);
    });
  });

  it('binary credential paths look like binary file paths', () => {
    Object.values(binaryCredentialPaths)
      .flat()
      .forEach((path) => {
        expect(path).toMatch(/\.(so|db)$|\/bin\//);
      });
  });

  it('binary target paths look like binary/data file paths', () => {
    Object.values(binaryTargetPaths)
      .flat()
      .forEach((path) => {
        expect(path).toMatch(/\.(bin|dat|db)$/);
      });
  });
});

describe('binary integration with attack chain', () => {
  it('some credential placements are marked binary across many seeds', () => {
    let binaryCount = 0;
    let totalPlacements = 0;

    for (let i = 0; i < 50; i++) {
      const seed = `binary-chain-${i}`;
      const prng = createPrng(seed);
      const topology = generateTopology(prng, 'medium');
      const { credentials } = generateUsers(prng, topology.machines, topology.entryPoint);
      const { credentialPlacements } = generateAttackChain({
        prng,
        machines: topology.machines,
        credentials,
        entryPoint: topology.entryPoint,
        entryVariant: topology.entryVariant,
        difficulty: 'medium',
      });

      totalPlacements += credentialPlacements.length;
      binaryCount += credentialPlacements.filter((p) => p.binary).length;
    }

    // With ~30% chance, we expect some binary placements
    expect(binaryCount).toBeGreaterThan(0);
    expect(binaryCount).toBeLessThan(totalPlacements);
  });

  it('some exfiltrate objectives are marked binary across many seeds', () => {
    let binaryCount = 0;
    let exfiltrateCount = 0;

    for (let i = 0; i < 100; i++) {
      const seed = `binary-exfil-${i}`;
      const prng = createPrng(seed);
      const topology = generateTopology(prng, 'medium');
      const { credentials } = generateUsers(prng, topology.machines, topology.entryPoint);
      const { objective } = generateAttackChain({
        prng,
        machines: topology.machines,
        credentials,
        entryPoint: topology.entryPoint,
        entryVariant: topology.entryVariant,
        difficulty: 'medium',
      });

      if (objective.type === 'exfiltrate') {
        exfiltrateCount++;
        if (objective.binary) binaryCount++;
      }
    }

    expect(exfiltrateCount).toBeGreaterThan(0);
    expect(binaryCount).toBeGreaterThan(0);
    expect(binaryCount).toBeLessThan(exfiltrateCount);
  });

  it('binary credential placements still contain the password when extracted with strings', () => {
    for (let i = 0; i < 100; i++) {
      const seed = `binary-extract-${i}`;
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

      const binaryPlacements = credentialPlacements.filter((p) => p.binary);
      if (binaryPlacements.length === 0) continue;

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

      binaryPlacements.forEach((p) => {
        const fs = fileSystems[p.machineIp];
        if (!fs) return;

        // Find the binary file in the filesystem
        const findFile = (node: FileNode, name: string): FileNode | undefined => {
          if (node.type === 'file' && node.name === name) return node;
          if (node.children) {
            for (const child of Object.values(node.children)) {
              const found = findFile(child, name);
              if (found) return found;
            }
          }
          return undefined;
        };

        const fileName = p.filePath.split('/').pop() ?? '';
        const file = findFile(fs, fileName);
        if (!file?.content) return;

        // The content should have non-printable chars (binary wrapped)
        const hasNonPrintable = [...file.content].some((ch) => !isPrintable(ch.charCodeAt(0)));
        expect(hasNonPrintable).toBe(true);

        // strings should recover the password
        const extracted = extractStrings(file.content);
        const joined = extracted.join('\n');
        expect(joined).toContain(p.password);
      });
      return;
    }
    throw new Error('No binary credential placements found in 100 seeds');
  });
});
