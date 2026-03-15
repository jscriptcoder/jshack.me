import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FileNode, FilePermissions } from '../filesystem/types';
import type { AsyncOutput } from '../components/Terminal/types';
import { createAptCommand } from './apt';

const mkBinaryNode = (name: string): FileNode => ({
  name,
  type: 'file',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  content: '\x7fELF',
});

const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as AsyncOutput).__type === 'async';

type MockAptConfig = {
  readonly machine?: string;
  readonly userType?: 'root' | 'user' | 'guest';
  readonly installedTools?: readonly string[];
};

type CreatedFile = {
  readonly path: string;
  readonly content: string;
  readonly permissions?: FilePermissions;
};

const createMockAptContext = (config: MockAptConfig = {}) => {
  const { machine = '10.0.0.1', userType = 'root', installedTools = [] } = config;
  const createdFiles: CreatedFile[] = [];

  return {
    context: {
      getMachine: () => machine,
      getNode: (path: string): FileNode | null => {
        const name = path.replace('/usr/bin/', '');
        if (installedTools.includes(name)) return mkBinaryNode(name);
        if (createdFiles.some((f) => f.path === path)) return mkBinaryNode(name);
        return null;
      },
      createFile: (
        path: string,
        content: string,
        _userType: string,
        permissions?: FilePermissions,
      ) => {
        createdFiles.push({ path, content, permissions });
        return { allowed: true };
      },
      getUserType: () => userType,
    },
    createdFiles,
  };
};

describe('apt command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('no arguments', () => {
    it('shows usage when called without arguments', () => {
      const { context } = createMockAptContext();
      const apt = createAptCommand(context);
      const result = apt.fn() as string;
      expect(result).toContain('Usage:');
      expect(result).toContain('install');
      expect(result).toContain('list');
    });
  });

  describe('apt install', () => {
    it('throws when no package name specified', () => {
      const { context } = createMockAptContext();
      const apt = createAptCommand(context);
      expect(() => apt.fn('install')).toThrow('No package name specified');
    });

    it('returns message when on localhost', () => {
      const { context } = createMockAptContext({ machine: 'localhost' });
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'nmap') as string;
      expect(result).toBe('All packages are pre-installed on localhost.');
    });

    it('throws when not root on remote machine', () => {
      const { context } = createMockAptContext({ userType: 'user' });
      const apt = createAptCommand(context);
      expect(() => apt.fn('install', 'nmap')).toThrow('are you root?');
    });

    it('throws for unknown package', () => {
      const { context } = createMockAptContext();
      const apt = createAptCommand(context);
      expect(() => apt.fn('install', 'invalid-pkg')).toThrow(
        'E: Unable to locate package invalid-pkg',
      );
    });

    it('returns already installed message when binary exists', () => {
      const { context } = createMockAptContext({ installedTools: ['nmap'] });
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'nmap') as string;
      expect(result).toContain('already the newest version');
    });

    it('returns AsyncOutput and creates binary on successful install', () => {
      const { context, createdFiles } = createMockAptContext();
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'nmap');

      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;

      const lines: string[] = [];
      result.start(
        (line) => lines.push(line),
        () => {},
      );

      // Advance past max jitter range
      vi.advanceTimersByTime(3000);

      expect(lines.some((l) => l.includes('Reading package lists'))).toBe(true);
      expect(lines.some((l) => l.includes('Setting up nmap'))).toBe(true);
      expect(createdFiles.some((f) => f.path === '/usr/bin/nmap')).toBe(true);
    });

    it('creates binary with world-executable permissions', () => {
      const { context, createdFiles } = createMockAptContext();
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'nmap');

      if (!isAsyncOutput(result)) return;

      result.start(
        () => {},
        () => {},
      );

      vi.advanceTimersByTime(3000);

      const created = createdFiles.find((f) => f.path === '/usr/bin/nmap');
      expect(created?.permissions).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user', 'guest'],
      });
    });

    it('creates root-only binary for restricted commands like gpg', () => {
      const { context, createdFiles } = createMockAptContext();
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'gpg');

      if (!isAsyncOutput(result)) return;

      result.start(
        () => {},
        () => {},
      );

      vi.advanceTimersByTime(3000);

      const created = createdFiles.find((f) => f.path === '/usr/bin/gpg');
      expect(created?.permissions?.execute).toEqual(['root']);
    });

    it('calls onComplete after install finishes', () => {
      const { context } = createMockAptContext();
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'nmap');

      if (!isAsyncOutput(result)) return;

      let completed = false;
      result.start(
        () => {},
        () => {
          completed = true;
        },
      );

      vi.advanceTimersByTime(3000);
      expect(completed).toBe(true);
    });

    it('multi-binary package creates all binaries (snmp → snmpwalk + snmpset)', () => {
      const { context, createdFiles } = createMockAptContext();
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'snmp');

      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;

      result.start(
        () => {},
        () => {},
      );

      vi.advanceTimersByTime(3000);

      expect(createdFiles.some((f) => f.path === '/usr/bin/snmpwalk')).toBe(true);
      expect(createdFiles.some((f) => f.path === '/usr/bin/snmpset')).toBe(true);
      // Should NOT create /usr/bin/snmp (that's the package name, not a binary)
      expect(createdFiles.some((f) => f.path === '/usr/bin/snmp')).toBe(false);
    });

    it('multi-binary package reports already installed if first binary exists', () => {
      const { context } = createMockAptContext({ installedTools: ['snmpwalk'] });
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'snmp') as string;
      expect(result).toContain('already the newest version');
    });
  });

  describe('apt list', () => {
    it('lists all available packages', () => {
      const { context } = createMockAptContext();
      const apt = createAptCommand(context);
      const result = apt.fn('list') as string;
      expect(result).toContain('nmap');
      expect(result).toContain('john');
      expect(result).toContain('ftp');
      expect(result).toContain('nc');
    });

    it('shows installed status on localhost', () => {
      const { context } = createMockAptContext({ machine: 'localhost' });
      const apt = createAptCommand(context);
      const result = apt.fn('list') as string;
      expect(result).toContain('[installed]');
    });

    it('shows not installed status on remote without binaries', () => {
      const { context } = createMockAptContext();
      const apt = createAptCommand(context);
      const result = apt.fn('list') as string;
      expect(result).toContain('[not installed]');
    });

    it('filters to installed only with --installed flag', () => {
      const { context } = createMockAptContext({ installedTools: ['nmap'] });
      const apt = createAptCommand(context);
      const result = apt.fn('list', '--installed') as string;
      expect(result).toContain('nmap');
      expect(result).toContain('Listing installed packages');
    });

    it('accepts -i as shorthand for --installed', () => {
      const { context } = createMockAptContext({ installedTools: ['nmap'] });
      const apt = createAptCommand(context);
      const result = apt.fn('list', '-i') as string;
      expect(result).toContain('nmap');
      expect(result).toContain('Listing installed packages');
    });
  });

  describe('invalid subcommand', () => {
    it('throws for unknown subcommand', () => {
      const { context } = createMockAptContext();
      const apt = createAptCommand(context);
      expect(() => apt.fn('remove')).toThrow("Invalid operation 'remove'");
    });
  });
});
