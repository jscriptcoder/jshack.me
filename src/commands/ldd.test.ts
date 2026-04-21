import { describe, it, expect } from 'vitest';
import type { FileNode } from '../filesystem/types';
import { createLddCommand } from './ldd';

const mkLibFile = (filename: string): FileNode => ({
  name: filename,
  type: 'file',
  owner: 'root',
  permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
  content: '\x7fELF',
});

const mkGetNode =
  (presentLibs: readonly string[]) =>
  (path: string): FileNode | null => {
    const match = /^\/lib\/(.+?)\.so$/.exec(path);
    if (!match) return null;
    const libName = match[1]!;
    return presentLibs.includes(libName) ? mkLibFile(`${libName}.so`) : null;
  };

describe('ldd', () => {
  it('lists each linked library with resolved /lib/ path', () => {
    const ldd = createLddCommand({ getNode: mkGetNode(['libpam', 'libcrypt']) });
    const out = ldd.fn('su') as string;
    expect(out).toMatch(/libpam\.so => \/lib\/libpam\.so/);
    expect(out).toMatch(/libcrypt\.so => \/lib\/libcrypt\.so/);
  });

  it("shows 'not found' for missing libraries", () => {
    const ldd = createLddCommand({ getNode: mkGetNode(['libpam']) });
    const out = ldd.fn('su') as string;
    expect(out).toMatch(/libpam\.so => \/lib\/libpam\.so/);
    expect(out).toMatch(/libcrypt\.so => not found/);
  });

  it('renders stable fake load addresses per library', () => {
    // Addresses should look like real ldd output (0x00007f...) and be
    // stable per library so the output is deterministic across runs.
    const ldd = createLddCommand({ getNode: mkGetNode(['libpam', 'libcrypt']) });
    const a = ldd.fn('su') as string;
    const b = ldd.fn('su') as string;
    expect(a).toBe(b);
    expect(a).toMatch(/\(0x[0-9a-f]+\)/);
  });

  it('handles commands with no libraryDeps entry', () => {
    const ldd = createLddCommand({ getNode: mkGetNode([]) });
    const out = ldd.fn('mkdir') as string;
    // Commands not in the manifest should produce a sensible response
    // rather than crash.
    expect(out).toMatch(/mkdir/);
  });

  it('handles an unknown command name', () => {
    const ldd = createLddCommand({ getNode: mkGetNode([]) });
    const out = ldd.fn('no-such-command') as string;
    expect(out).toMatch(/no-such-command/);
  });

  it('throws when no command name is supplied', () => {
    const ldd = createLddCommand({ getNode: mkGetNode([]) });
    expect(() => ldd.fn()).toThrow(/usage/i);
  });
});
