import { describe, it, expect } from 'vitest';
import type { FileNode } from '../../filesystem/types';
import type { UserType } from '../../session/SessionContext';
import type { MachineId } from '../../filesystem/machineFileSystems';
import { createNcLsCommand } from './ls';

// --- Factory Functions ---

const createMockDirectory = (name: string, overrides?: Partial<FileNode>): FileNode => ({
  name,
  type: 'directory',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  children: {},
  ...overrides,
});

const createMockFile = (name: string): FileNode => ({
  name,
  type: 'file',
  owner: 'user',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root', 'user'],
    execute: ['root'],
  },
  content: 'test content',
});

type NcLsContextConfig = {
  readonly machine?: MachineId;
  readonly cwd?: string;
  readonly userType?: UserType;
  readonly nodes?: Record<string, FileNode | null>;
  readonly listings?: Record<string, readonly string[] | null>;
};

const createMockNcLsContext = (config: NcLsContextConfig = {}) => {
  const {
    machine = '203.0.113.42' as MachineId,
    cwd = '/home/ghost',
    userType = 'user',
    nodes = {},
    listings = {},
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
    listDirectoryFromMachine: (
      _machineId: MachineId,
      path: string,
      _cwd: string,
      _userType: UserType,
    ) => listings[path] ?? null,
    canTraverseOnMachine: () => ({ allowed: true }),
  };
};

// --- Tests ---

describe('nc ls command', () => {
  describe('listing directories', () => {
    it('should list current directory when no argument given', () => {
      const homeDir = createMockDirectory('ghost');

      const context = createMockNcLsContext({
        cwd: '/home/ghost',
        nodes: {
          '/home/ghost': homeDir,
          '/home/ghost/notes.txt': createMockFile('notes.txt'),
          '/home/ghost/docs': createMockDirectory('docs'),
        },
        listings: { '/home/ghost': ['notes.txt', 'docs'] },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn();

      expect(result).toBe('notes.txt  docs/');
    });

    it('should list specified directory with absolute path', () => {
      const varDir = createMockDirectory('var');

      const context = createMockNcLsContext({
        cwd: '/home/ghost',
        nodes: {
          '/var': varDir,
          '/var/log': createMockDirectory('log'),
          '/var/tmp': createMockDirectory('tmp'),
        },
        listings: { '/var': ['log', 'tmp'] },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn('/var');

      expect(result).toBe('log/  tmp/');
    });

    it('should list specified directory with relative path', () => {
      const subdir = createMockDirectory('subdir');

      const context = createMockNcLsContext({
        cwd: '/home/ghost',
        nodes: {
          '/home/ghost/subdir': subdir,
          '/home/ghost/subdir/file1.txt': createMockFile('file1.txt'),
          '/home/ghost/subdir/file2.txt': createMockFile('file2.txt'),
        },
        listings: { '/home/ghost/subdir': ['file1.txt', 'file2.txt'] },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn('subdir');

      expect(result).toBe('file1.txt  file2.txt');
    });

    it('should add trailing slash to directories', () => {
      const homeDir = createMockDirectory('home');

      const context = createMockNcLsContext({
        cwd: '/',
        nodes: {
          '/': createMockDirectory('/'),
          '/home': homeDir,
          '/tmp': createMockDirectory('tmp'),
          '/etc': createMockDirectory('etc'),
        },
        listings: { '/': ['home', 'tmp', 'etc'] },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn('/');

      expect(result).toBe('home/  tmp/  etc/');
    });

    it('should return filename when path is a file', () => {
      const file = createMockFile('secret.txt');

      const context = createMockNcLsContext({
        nodes: { '/home/ghost/secret.txt': file },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn('secret.txt');

      expect(result).toBe('secret.txt');
    });

    it('should return empty directory message', () => {
      const emptyDir = createMockDirectory('empty');

      const context = createMockNcLsContext({
        nodes: { '/home/ghost/empty': emptyDir },
        listings: { '/home/ghost/empty': [] },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn('empty');

      expect(result).toBe('(empty directory)');
    });

    it('should handle mixed files and directories', () => {
      const homeDir = createMockDirectory('ghost');

      const context = createMockNcLsContext({
        cwd: '/home/ghost',
        nodes: {
          '/home/ghost': homeDir,
          '/home/ghost/readme.txt': createMockFile('readme.txt'),
          '/home/ghost/docs': createMockDirectory('docs'),
          '/home/ghost/notes': createMockDirectory('notes'),
          '/home/ghost/script.sh': createMockFile('script.sh'),
        },
        listings: {
          '/home/ghost': ['readme.txt', 'docs', 'notes', 'script.sh'],
        },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn();

      expect(result).toBe('readme.txt  docs/  notes/  script.sh');
    });
  });

  describe('hidden files', () => {
    it('should hide dotfiles by default', () => {
      const context = createMockNcLsContext({
        cwd: '/home/ghost',
        nodes: {
          '/home/ghost': createMockDirectory('ghost'),
          '/home/ghost/.secret': createMockFile('.secret'),
          '/home/ghost/notes.txt': createMockFile('notes.txt'),
        },
        listings: { '/home/ghost': ['.secret', 'notes.txt'] },
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
          '/home/ghost': createMockDirectory('ghost'),
          '/home/ghost/.secret': createMockFile('.secret'),
          '/home/ghost/notes.txt': createMockFile('notes.txt'),
        },
        listings: { '/home/ghost': ['.secret', 'notes.txt'] },
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
          '/opt/tools': createMockDirectory('tools'),
          '/opt/tools/.backdoor_log': createMockFile('.backdoor_log'),
          '/opt/tools/scanner': createMockFile('scanner'),
        },
        listings: { '/opt/tools': ['.backdoor_log', 'scanner'] },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn('/opt/tools', '-a');

      expect(result).toContain('.backdoor_log');
      expect(result).toContain('scanner');
    });

    it('should show empty directory when only dotfiles exist', () => {
      const context = createMockNcLsContext({
        cwd: '/home/ghost',
        nodes: {
          '/home/ghost': createMockDirectory('ghost'),
        },
        listings: { '/home/ghost': ['.only_hidden'] },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn();

      expect(result).toBe('(empty directory)');
    });
  });

  describe('error handling', () => {
    it('should throw error for non-existent path', () => {
      const context = createMockNcLsContext({
        nodes: {},
      });

      const ls = createNcLsCommand(context);

      expect(() => ls.fn('nonexistent')).toThrow('ls: nonexistent: No such file or directory');
    });

    it('should throw error for non-existent absolute path', () => {
      const context = createMockNcLsContext({
        nodes: {},
      });

      const ls = createNcLsCommand(context);

      expect(() => ls.fn('/no/such/path')).toThrow('ls: /no/such/path: No such file or directory');
    });

    it('should throw error when permission denied on directory', () => {
      const restrictedDir = createMockDirectory('secret', {
        permissions: {
          read: ['root'],
          write: ['root'],
          execute: ['root'],
        },
      });

      const context = createMockNcLsContext({
        userType: 'guest',
        nodes: { '/root/secret': restrictedDir },
      });

      const ls = createNcLsCommand(context);

      expect(() => ls.fn('/root/secret')).toThrow('ls: /root/secret: Permission denied');
    });

    it('should throw error when listing returns null', () => {
      const dir = createMockDirectory('protected');

      const context = createMockNcLsContext({
        userType: 'user',
        nodes: { '/protected': dir },
        listings: { '/protected': null },
      });

      const ls = createNcLsCommand(context);

      expect(() => ls.fn('/protected')).toThrow('ls: /protected: Permission denied');
    });
  });

  describe('permissions', () => {
    it('should allow root to list any directory', () => {
      const restrictedDir = createMockDirectory('secret', {
        permissions: {
          read: ['root'],
          write: ['root'],
          execute: ['root'],
        },
      });

      const context = createMockNcLsContext({
        userType: 'root',
        nodes: {
          '/root/secret': restrictedDir,
          '/root/secret/passwords.txt': createMockFile('passwords.txt'),
        },
        listings: { '/root/secret': ['passwords.txt'] },
      });

      const ls = createNcLsCommand(context);
      const result = ls.fn('/root/secret');

      expect(result).toBe('passwords.txt');
    });
  });
});
