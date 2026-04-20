import { describe, it, expect } from 'vitest';
import type { Command } from '../components/Terminal/types';
import type { FileNode } from '../filesystem/types';
import { wrapWithLibraryCheck, libraryDeps } from './libraryDeps';

// Minimal FileNode factory for /lib/<name>.so fixtures.
const mkLibFile = (filename: string): FileNode => ({
  name: filename,
  type: 'file',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: [],
  },
  content: '\x7fELF',
});

// getNode resolver that returns a file for each library in presentLibs, null
// for anything not in the set. Simulates the subset of /lib/ the test fixture
// cares about.
const mkGetNode =
  (presentLibs: readonly string[]) =>
  (path: string): FileNode | null => {
    const match = /^\/lib\/(.+?)\.so$/.exec(path);
    if (!match) return null;
    const libName = match[1]!;
    return presentLibs.includes(libName) ? mkLibFile(`${libName}.so`) : null;
  };

const baseCommand: Command = {
  name: 'su',
  category: 'general',
  description: 'Test stub',
  manual: { synopsis: 'su', description: 'Test', arguments: [], examples: [] },
  fn: () => 'ran',
};

describe('libraryDeps manifest', () => {
  it('includes every command from the approved manifest', () => {
    const expected = [
      'su',
      'systemctl',
      'reboot',
      'kill',
      'nano',
      'ls',
      'find',
      'grep',
      'cat',
      'strings',
      'rm',
      'chmod',
      'ps',
      'apt',
      'ssh',
      'scp',
      'curl',
    ];
    for (const cmd of expected) {
      expect(libraryDeps[cmd], `${cmd} missing from manifest`).toBeDefined();
      expect(libraryDeps[cmd]!.length).toBeGreaterThan(0);
    }
  });

  it('maps su to libpam + libcrypt', () => {
    expect(libraryDeps.su).toEqual(expect.arrayContaining(['libpam', 'libcrypt']));
  });

  it('maps systemctl to libsystemd', () => {
    expect(libraryDeps.systemctl).toEqual(['libsystemd']);
  });

  it('maps ssh to libssl + libreadline', () => {
    expect(libraryDeps.ssh).toEqual(expect.arrayContaining(['libssl', 'libreadline']));
  });

  it('maps apt to libz + libxml2', () => {
    expect(libraryDeps.apt).toEqual(expect.arrayContaining(['libz', 'libxml2']));
  });

  it('does not include commands without a thematic fit', () => {
    // These were explicitly excluded from v1 (weak thematic fit).
    expect(libraryDeps.mkdir).toBeUndefined();
    expect(libraryDeps.echo).toBeUndefined();
    expect(libraryDeps.man).toBeUndefined();
    expect(libraryDeps.ping).toBeUndefined();
    expect(libraryDeps.ifconfig).toBeUndefined();
    expect(libraryDeps.nmcli).toBeUndefined();
  });
});

describe('wrapWithLibraryCheck', () => {
  it('passes through a command with no libraryDeps entry unchanged', () => {
    const cmd: Command = { ...baseCommand, name: 'mkdir' };
    const wrapped = wrapWithLibraryCheck(cmd, 'mkdir', mkGetNode([]));
    expect(wrapped.fn()).toBe('ran');
  });

  it('executes the wrapped command when every linked library is present', () => {
    const wrapped = wrapWithLibraryCheck(baseCommand, 'su', mkGetNode(['libpam', 'libcrypt']));
    expect(wrapped.fn()).toBe('ran');
  });

  it('throws a glibc-style dynamic-linker error when a library is missing', () => {
    const wrapped = wrapWithLibraryCheck(baseCommand, 'su', mkGetNode(['libcrypt']));
    expect(() => wrapped.fn()).toThrow(
      /su: error while loading shared libraries: libpam\.so: cannot open shared object file: No such file or directory/,
    );
  });

  it('reports the first missing library when multiple are missing', () => {
    // Manifest order: libpam, libcrypt. Both missing → report libpam first
    // (real ld.so stops at the first unresolved library).
    const wrapped = wrapWithLibraryCheck(baseCommand, 'su', mkGetNode([]));
    expect(() => wrapped.fn()).toThrow(/libpam\.so: cannot open shared object file/);
  });

  it('preserves the original command metadata (name, description, manual)', () => {
    const wrapped = wrapWithLibraryCheck(baseCommand, 'su', mkGetNode(['libpam', 'libcrypt']));
    expect(wrapped.name).toBe(baseCommand.name);
    expect(wrapped.description).toBe(baseCommand.description);
    expect(wrapped.manual).toBe(baseCommand.manual);
  });
});
