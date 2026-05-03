import { describe, it, expect } from 'vitest';
import type { FileNode } from '../../filesystem/types';
import type { UserType } from '../../session/types';
import type { MachineId } from '../../filesystem/machineFileSystems';
import { createNcLsCommand } from './ls';

// --- Factory Functions ---

const createMockFile = (name: string, overrides?: Partial<FileNode>): FileNode => ({
  name,
  type: 'file',
  owner: 'user',
  content: 'test content',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root', 'user'],
    execute: ['root'],
  },
  ...overrides,
});

const createMockDirectory = (
  name: string,
  children: Record<string, FileNode> = {},
  overrides?: Partial<FileNode>,
): FileNode => ({
  name,
  type: 'directory',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  children,
  ...overrides,
});

type NcLsContextConfig = {
  readonly machine?: MachineId;
  readonly cwd?: string;
  readonly userType?: UserType;
  readonly nodes?: Record<string, FileNode | null>;
};

const createMockNcLsContext = (config: NcLsContextConfig = {}) => {
  const {
    machine = '203.0.113.42' as MachineId,
    cwd = '/home/ghost',
    userType = 'user',
    nodes = {},
  } = config;

  const resolvePath = (path: string, currentCwd: string): string => {
    if (path.startsWith('/')) return path;
    if (path.startsWith('../')) {
      const cwdParts = currentCwd.split('/').filter(Boolean);
      cwdParts.pop();
      const remaining = path.slice(3);
      const parentDir = '/' + cwdParts.join('/');
      return remaining
        ? parentDir === '/'
          ? `/${remaining}`
          : `${parentDir}/${remaining}`
        : parentDir || '/';
    }
    if (path === '..') {
      const parts = currentCwd.split('/').filter(Boolean);
      parts.pop();
      return '/' + parts.join('/') || '/';
    }
    return currentCwd === '/' ? `/${path}` : `${currentCwd}/${path}`;
  };

  return {
    getMachine: () => machine,
    getCwd: () => cwd,
    getUserType: () => userType,
    resolvePath,
    getNodeFromMachine: (_machineId: MachineId, path: string, _cwd: string) => nodes[path] ?? null,
    canTraverseOnMachine: () => ({ allowed: true }),
  };
};

// --- Tests ---

describe('nc ls command', () => {
  describe('listing directories', () => {
    it('should list current directory when no argument given', () => {
      const context = createMockNcLsContext({
        cwd: '/home/ghost',
        nodes: {
          '/home/ghost': createMockDirectory('ghost', {
            docs: createMockDirectory('docs'),
            'notes.txt': createMockFile('notes.txt'),
          }),
        },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn();

      expect(result).toBe('docs/  notes.txt');
    });

    it('should list specified directory with absolute path', () => {
      const context = createMockNcLsContext({
        cwd: '/home/ghost',
        nodes: {
          '/var': createMockDirectory('var', {
            log: createMockDirectory('log'),
            tmp: createMockDirectory('tmp'),
          }),
        },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn('/var');

      expect(result).toBe('log/  tmp/');
    });

    it('should list specified directory with relative path', () => {
      const context = createMockNcLsContext({
        cwd: '/home/ghost',
        nodes: {
          '/home/ghost/subdir': createMockDirectory('subdir', {
            'file1.txt': createMockFile('file1.txt'),
            'file2.txt': createMockFile('file2.txt'),
          }),
        },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn('subdir');

      expect(result).toBe('file1.txt  file2.txt');
    });

    it('should add trailing slash to directories', () => {
      const context = createMockNcLsContext({
        cwd: '/',
        nodes: {
          '/': createMockDirectory('/', {
            etc: createMockDirectory('etc'),
            home: createMockDirectory('home'),
            tmp: createMockDirectory('tmp'),
          }),
        },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn('/');

      expect(result).toBe('etc/  home/  tmp/');
    });

    it('should return filename when path is a file', () => {
      const context = createMockNcLsContext({
        nodes: { '/home/ghost/secret.txt': createMockFile('secret.txt') },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn('secret.txt');

      expect(result).toBe('secret.txt');
    });

    it('should return empty string for empty directory', () => {
      const context = createMockNcLsContext({
        nodes: { '/home/ghost/empty': createMockDirectory('empty') },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn('empty');

      expect(result).toBe('');
    });

    it('should sort entries alphabetically', () => {
      const context = createMockNcLsContext({
        cwd: '/home/ghost',
        nodes: {
          '/home/ghost': createMockDirectory('ghost', {
            'script.sh': createMockFile('script.sh'),
            docs: createMockDirectory('docs'),
            notes: createMockDirectory('notes'),
            'readme.txt': createMockFile('readme.txt'),
          }),
        },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn();

      expect(result).toBe('docs/  notes/  readme.txt  script.sh');
    });
  });

  describe('hidden files', () => {
    it('should hide dotfiles by default', () => {
      const context = createMockNcLsContext({
        cwd: '/home/ghost',
        nodes: {
          '/home/ghost': createMockDirectory('ghost', {
            '.secret': createMockFile('.secret'),
            'notes.txt': createMockFile('notes.txt'),
          }),
        },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn();

      expect(result).toBe('notes.txt');
      expect(result).not.toContain('.secret');
    });

    it('should show dotfiles with -a flag', () => {
      const context = createMockNcLsContext({
        cwd: '/home/ghost',
        nodes: {
          '/home/ghost': createMockDirectory('ghost', {
            '.secret': createMockFile('.secret'),
            'notes.txt': createMockFile('notes.txt'),
          }),
        },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn('-a');

      expect(result).toContain('.secret');
      expect(result).toContain('notes.txt');
    });

    it('should show dotfiles with path and -a flag', () => {
      const context = createMockNcLsContext({
        cwd: '/',
        nodes: {
          '/opt/tools': createMockDirectory('tools', {
            '.backdoor_log': createMockFile('.backdoor_log'),
            scanner: createMockFile('scanner'),
          }),
        },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn('/opt/tools', '-a');

      expect(result).toContain('.backdoor_log');
      expect(result).toContain('scanner');
    });

    it('should return empty string when only dotfiles exist', () => {
      const context = createMockNcLsContext({
        cwd: '/home/ghost',
        nodes: {
          '/home/ghost': createMockDirectory('ghost', {
            '.only_hidden': createMockFile('.only_hidden'),
          }),
        },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn();

      expect(result).toBe('');
    });
  });

  describe('error handling', () => {
    it('should throw error for non-existent path', () => {
      const context = createMockNcLsContext({ nodes: {} });
      const ls = createNcLsCommand(context);

      expect(() => ls.fn('nonexistent')).toThrow(
        "ls: cannot access 'nonexistent': No such file or directory",
      );
    });

    it('should throw error for non-existent absolute path', () => {
      const context = createMockNcLsContext({ nodes: {} });
      const ls = createNcLsCommand(context);

      expect(() => ls.fn('/no/such/path')).toThrow(
        "ls: cannot access '/no/such/path': No such file or directory",
      );
    });

    it('should throw error when permission denied on directory', () => {
      const context = createMockNcLsContext({
        userType: 'guest',
        nodes: {
          '/root/secret': createMockDirectory(
            'secret',
            {},
            {
              permissions: {
                read: ['root'],
                write: ['root'],
                execute: ['root'],
              },
            },
          ),
        },
      });

      const ls = createNcLsCommand(context);

      expect(() => ls.fn('/root/secret')).toThrow(
        "ls: cannot open directory '/root/secret': Permission denied",
      );
    });
  });

  describe('permissions', () => {
    it('should allow root to list any directory', () => {
      const context = createMockNcLsContext({
        userType: 'root',
        nodes: {
          '/root/secret': createMockDirectory(
            'secret',
            { 'passwords.txt': createMockFile('passwords.txt') },
            {
              permissions: {
                read: ['root'],
                write: ['root'],
                execute: ['root'],
              },
            },
          ),
        },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn('/root/secret');

      expect(result).toBe('passwords.txt');
    });
  });

  describe('long listing (-l flag)', () => {
    it('should show permission string, owner, and name', () => {
      const context = createMockNcLsContext({
        cwd: '/home/ghost',
        nodes: {
          '/home/ghost': createMockDirectory('ghost', {
            'notes.txt': createMockFile('notes.txt', {
              owner: 'user',
              permissions: {
                read: ['root', 'user'],
                write: ['root', 'user'],
                execute: ['root'],
              },
            }),
          }),
        },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn('-l');

      expect(result).toBe('-rw-rw----  user   notes.txt');
    });
  });
});
