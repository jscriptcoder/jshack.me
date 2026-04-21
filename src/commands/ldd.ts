import type { Command } from '../components/Terminal/types';
import type { FileNode } from '../filesystem/types';
import { libraryDeps } from './libraryDeps';

// Mirrors real Linux `ldd`: prints the shared libraries each command links,
// their resolved /lib/<name>.so path (or "not found"), and a fake stable
// load address. Players who've debugged real Linux recognise the format.
//
// Game-ism: real ldd's addresses are randomized per-invocation (ASLR);
// ours are stable per (command, library) for determinism.

type LddContext = {
  readonly getNode: (path: string) => FileNode | null;
};

// Deterministic fake address per library name. Real ldd addresses are
// 12-hex-digit virtual addresses in the process's memory map. We derive a
// plausible-looking number from a simple hash so the output is stable.
const fakeLoadAddress = (libName: string): string => {
  let hash = 0x7f000000;
  for (let i = 0; i < libName.length; i++) {
    hash = (hash * 33 + libName.charCodeAt(i)) >>> 0;
  }
  return `(0x${hash.toString(16).padStart(12, '0')})`;
};

const formatLine = (lib: string, getNode: (path: string) => FileNode | null): string => {
  const path = `/lib/${lib}.so`;
  const present = getNode(path) !== null;
  const resolution = present ? `${path} ${fakeLoadAddress(lib)}` : 'not found';
  return `\t${lib}.so => ${resolution}`;
};

export const createLddCommand = (context: LddContext): Command => ({
  name: 'ldd',
  category: 'general',
  description: 'Print shared library dependencies of a command',
  manual: {
    synopsis: 'ldd <command>',
    description:
      'Lists the shared libraries a command links against and whether each library file is currently present under /lib/. Missing libraries show as "not found" — the same output real Linux ldd produces when a shared object cannot be resolved.',
    arguments: [
      {
        name: 'command',
        description: 'Name of a pre-installed system command to inspect',
        required: true,
      },
    ],
    examples: [
      { command: 'ldd su', description: 'Show which libraries `su` depends on' },
      { command: 'ldd grep', description: 'Inspect the libpcre dependency' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const cmdName = args[0];
    if (typeof cmdName !== 'string' || cmdName.length === 0) {
      throw new Error('Usage: ldd <command>');
    }
    const deps = libraryDeps[cmdName];
    if (!deps || deps.length === 0) {
      return `ldd: ${cmdName}: no shared library dependencies tracked`;
    }
    return deps.map((lib) => formatLine(lib, context.getNode)).join('\n');
  },
});
