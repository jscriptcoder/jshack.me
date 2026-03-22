import { describe, it, expect } from 'vitest';
import { createPrng } from './prng';
import { wrapInBinaryNoise, binaryTargetPaths } from './binary';

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
  it('binaryTargetPaths has entries for all roles', () => {
    const roles = [
      'webserver',
      'database',
      'fileserver',
      'workstation',
      'mailserver',
      'router',
    ] as const;
    roles.forEach((role) => {
      expect(binaryTargetPaths[role].length).toBeGreaterThan(0);
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
